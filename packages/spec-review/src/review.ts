import type { Spec } from '@wifo/factory-core';
import type { JudgeClient } from '@wifo/factory-harness';
import { cacheGet, cacheSet, computeCacheKey } from './cache.js';
import type { ReviewFinding } from './findings.js';
import { sortFindings } from './findings.js';
import type { ReviewCode } from './findings.js';
import {
  type JudgeApplicabilityCtx,
  type JudgeDef,
  defaultEnabledJudges,
  loadJudgeRegistry,
  ruleSetHash,
} from './judges/index.js';
import { sliceSections } from './slice-sections.js';

export interface RunReviewOptions {
  specPath: string;
  spec: Spec;
  judgeClient: JudgeClient;
  judges?: ReviewCode[];
  cacheDir?: string;
  technicalPlanPath?: string;
  technicalPlan?: string;
  log?: (line: string) => void;
  // Forwarded to JudgeClient.judge — defaults preserve subscription-auth
  // semantics (model is locked by `claude -p`'s active session anyway).
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_TIMEOUT_MS = 60_000;

export async function runReview(opts: RunReviewOptions): Promise<ReviewFinding[]> {
  const enabledJudges = opts.judges ?? defaultEnabledJudges();
  const registry = loadJudgeRegistry();

  // Cache lookup. Spec bytes from raw.source so the key invalidates on any
  // edit (frontmatter or body).
  const specBytes = opts.spec.raw.source;
  const cacheKey = computeCacheKey({
    specBytes,
    ruleSetHash: ruleSetHash(),
    enabledJudges,
  });
  if (opts.cacheDir !== undefined) {
    const cached = cacheGet(opts.cacheDir, cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  const sliced = sliceSections(opts.spec);
  const ctx: JudgeApplicabilityCtx = {
    hasTechnicalPlan: typeof opts.technicalPlan === 'string' && opts.technicalPlan.length > 0,
    hasDod: sliced.dod !== undefined,
  };
  const findings: ReviewFinding[] = [];

  // Run judges sequentially — keeps subprocess pressure bounded (each
  // judge spawns claude -p) and produces deterministic output ordering
  // for the cache.
  for (const code of enabledJudges) {
    const judge: JudgeDef | undefined = registry[code];
    if (judge === undefined) {
      findings.push({
        file: opts.specPath,
        severity: 'warning',
        code: 'review/judge-failed',
        message: `unknown judge code: ${code}`,
      });
      continue;
    }
    if (!judge.applies(opts.spec, ctx)) {
      continue;
    }

    // Section-availability gate: the judge's own buildPrompt may produce
    // an empty/degraded artifact if the section is missing. Surface that
    // as `review/section-missing` info and skip the judge call.
    const missingSection = checkRequiredSections(judge, sliced, opts.spec);
    if (missingSection !== null) {
      findings.push({
        file: opts.specPath,
        line: undefined,
        severity: 'info',
        code: 'review/section-missing',
        message: `Section '## ${missingSection}' not found; ${judge.code.replace('review/', '')} skipped`,
      });
      continue;
    }

    let prompt: ReturnType<JudgeDef['buildPrompt']>;
    try {
      prompt = judge.buildPrompt(opts.spec, sliced, {
        ...(opts.technicalPlan !== undefined ? { technicalPlan: opts.technicalPlan } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      findings.push({
        file: opts.specPath,
        severity: 'error',
        code: 'review/judge-failed',
        message: `judge/build-prompt-failed: ${judge.code}: ${msg}`,
      });
      continue;
    }

    try {
      const judgment = await opts.judgeClient.judge({
        criterion: prompt.criterion,
        scenario: pseudoScenario(judge),
        artifact: prompt.artifact,
        model: opts.model ?? DEFAULT_MODEL,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      if (!judgment.pass) {
        const finding: ReviewFinding = {
          file: opts.specPath,
          severity: judge.defaultSeverity,
          code: judge.code,
          message: judgment.reasoning,
        };
        if (prompt.line !== undefined) finding.line = prompt.line;
        findings.push(finding);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      findings.push({
        file: opts.specPath,
        severity: 'error',
        code: 'review/judge-failed',
        message: `${judge.code}: ${msg}`,
      });
    }
  }

  const sorted = sortFindings(findings);
  if (opts.cacheDir !== undefined) {
    cacheSet(opts.cacheDir, cacheKey, sorted);
  }
  return sorted;
}

function checkRequiredSections(
  judge: JudgeDef,
  sliced: ReturnType<typeof sliceSections>,
  _spec: Spec,
): string | null {
  // Hardcoded knowledge of which judge needs which section. The judge's
  // applies() check is for "should I run at all"; this is for "I would run
  // but the section I need is missing" → emit section-missing instead of
  // calling the judge with an empty artifact.
  if (judge.code === 'review/dod-precision' && sliced.dod === undefined) {
    return 'Definition of Done';
  }
  return null;
}

function pseudoScenario(judge: JudgeDef): {
  id: string;
  given: string;
  when: string;
  then: string;
} {
  const angle = judge.code.replace('review/', '');
  return {
    id: judge.code,
    given: 'A factory spec is being reviewed for quality.',
    when: `The reviewer evaluates the spec for ${angle}.`,
    then: 'The criterion holds for this spec.',
  };
}

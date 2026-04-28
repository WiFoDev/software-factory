import type { Scenario, Spec } from '@wifo/factory-core';
import { type JudgeClient, runJudgeSatisfaction } from './runners/judge.js';
import { runTestSatisfaction } from './runners/test.js';
import {
  type HarnessReport,
  type RunHarnessOptions,
  type SatisfactionResult,
  type ScenarioResult,
  aggregateStatus,
  reportStatusFrom,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'claude-haiku-4-5';
const COST_NOTICE_THRESHOLD = 5;

export interface RunHarnessInternalOptions extends RunHarnessOptions {
  /** Override path to the bun executable (used in tests). */
  bunPath?: string;
}

function selectScenarios(spec: Spec, opts: RunHarnessOptions): Scenario[] {
  const all: Scenario[] = [];
  if (!opts.holdoutsOnly) all.push(...spec.scenarios);
  if (!opts.visibleOnly) all.push(...spec.holdouts);
  if (opts.scenarioIds && opts.scenarioIds.size > 0) {
    return all.filter((s) => opts.scenarioIds?.has(s.id) ?? false);
  }
  return all;
}

function countJudgeSatisfactions(scenarios: Scenario[]): number {
  let count = 0;
  for (const s of scenarios) {
    for (const sat of s.satisfaction) if (sat.kind === 'judge') count++;
  }
  return count;
}

/**
 * Run a parsed Spec end-to-end and produce a typed `HarnessReport`. Never
 * throws on operational state — missing API keys, spawn failures, timeouts,
 * and malformed judge output all surface as `'error'`-status results (or a
 * top-level `'error'` report when fail-fast applies).
 */
export async function runHarness(
  spec: Spec,
  opts: RunHarnessInternalOptions = {},
): Promise<HarnessReport> {
  const startedAt = new Date();
  const t0 = performance.now();
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = opts.judge?.model ?? DEFAULT_MODEL;
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  const selected = selectScenarios(spec, opts);
  const judgeCount = opts.noJudge ? 0 : countJudgeSatisfactions(selected);

  // Resolve judge client lazily (only when needed).
  let judgeClient: JudgeClient | null = null;
  if (judgeCount > 0) {
    const requested = opts.judge?.client;
    if (requested === undefined || requested === 'default') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey === undefined || apiKey === '') {
        const durationMs = Math.round(performance.now() - t0);
        return {
          specId: spec.frontmatter.id,
          ...(spec.raw.filename !== undefined ? { specPath: spec.raw.filename } : {}),
          startedAt: startedAt.toISOString(),
          durationMs,
          scenarios: [
            {
              scenarioId: '<runner>',
              scenarioKind: 'scenario',
              status: 'error',
              durationMs: 0,
              satisfactions: [
                {
                  kind: 'judge',
                  value: '<prerequisite>',
                  line: 0,
                  status: 'error',
                  durationMs: 0,
                  detail:
                    'runner/missing-api-key: ANTHROPIC_API_KEY is not set; pass --no-judge or provide a custom JudgeClient to skip this check',
                },
              ],
            },
          ],
          summary: { pass: 0, fail: 0, error: 1, skipped: 0 },
          status: 'error',
        };
      }
      const { createDefaultJudgeClient } = await import('./runners/judge.js');
      judgeClient = await createDefaultJudgeClient();
    } else {
      judgeClient = requested;
    }

    if (judgeCount > COST_NOTICE_THRESHOLD) {
      log(`${judgeCount} judge calls planned`);
    }
  }

  const scenarioResults: ScenarioResult[] = [];
  for (const scenario of selected) {
    const sT0 = performance.now();
    const satResults: SatisfactionResult[] = [];
    for (const sat of scenario.satisfaction) {
      if (sat.kind === 'test') {
        satResults.push(
          await runTestSatisfaction(
            { kind: 'test', value: sat.value, line: sat.line },
            { cwd, timeoutMs, ...(opts.bunPath !== undefined ? { bunPath: opts.bunPath } : {}) },
          ),
        );
      } else {
        if (opts.noJudge) {
          satResults.push({
            kind: 'judge',
            value: sat.value,
            line: sat.line,
            status: 'skipped',
            durationMs: 0,
            detail: '--no-judge',
          });
          continue;
        }
        if (!judgeClient) {
          // Defensive: should be unreachable given the prerequisite check above.
          satResults.push({
            kind: 'judge',
            value: sat.value,
            line: sat.line,
            status: 'error',
            durationMs: 0,
            detail: 'runner/no-judge-client',
          });
          continue;
        }
        satResults.push(
          await runJudgeSatisfaction(
            { kind: 'judge', value: sat.value, line: sat.line },
            {
              id: scenario.id,
              given: scenario.given,
              when: scenario.when,
              then: scenario.then,
              artifact: spec.body,
            },
            { client: judgeClient, model, timeoutMs },
          ),
        );
      }
    }
    scenarioResults.push({
      scenarioId: scenario.id,
      scenarioKind: scenario.kind,
      status: aggregateStatus(satResults.map((r) => r.status)),
      satisfactions: satResults,
      durationMs: Math.round(performance.now() - sT0),
    });
  }

  const summary = { pass: 0, fail: 0, error: 0, skipped: 0 };
  for (const sr of scenarioResults) summary[sr.status]++;
  const status = reportStatusFrom(scenarioResults.map((s) => s.status));

  return {
    specId: spec.frontmatter.id,
    ...(spec.raw.filename !== undefined ? { specPath: spec.raw.filename } : {}),
    startedAt: startedAt.toISOString(),
    durationMs: Math.round(performance.now() - t0),
    scenarios: scenarioResults,
    summary,
    status,
  };
}

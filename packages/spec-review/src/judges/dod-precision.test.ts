import { describe, expect, test } from 'bun:test';
import { type Spec, parseSpec } from '@wifo/factory-core';
import type { JudgeClient } from '@wifo/factory-harness';
import { runReview } from '../review.js';
import { sliceSections } from '../slice-sections.js';
import { DOD_PRECISION_JUDGE } from './dod-precision.js';
import { ruleSetHash } from './index.js';

const FRONTMATTER = [
  '---',
  'id: demo',
  'classification: light',
  'type: feat',
  'status: ready',
  '---',
  '',
].join('\n');

const COMMON_BODY_HEAD = [
  '## Intent',
  'Add a thing.',
  '',
  '## Constraints / Decisions',
  '- uses zod',
  '',
  '## Scenarios',
  '**S-1** — happy',
  '  Given a',
  '  When b',
  '  Then c',
  '  Satisfaction:',
  '    - test: src/foo.test.ts',
  '',
  '## Subtasks',
  '- T1 — implement',
  '',
].join('\n');

function specWithDod(dodBullets: string[]): Spec {
  const dodSection = ['## Definition of Done', ...dodBullets].join('\n');
  return parseSpec(FRONTMATTER + COMMON_BODY_HEAD + dodSection);
}

const ALLOWLIST_COMMANDS = [
  'pnpm',
  'bun',
  'npm',
  'node',
  'tsc',
  'git',
  'npx',
  'bash',
  'sh',
  'make',
  'biome',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'lint',
  'typecheck',
  'test',
  'check',
  'build',
];

// "tests" as plural variant is treated equivalently to the "test" allowlist
// entry — matches the canonical phrasing "tests pass green" / "tests green".
const IDIOM_RE = new RegExp(
  `\\b(${ALLOWLIST_COMMANDS.join('|')})s?\\b[^\\n]*\\b(green|clean|passes|succeeds)\\b`,
  'i',
);
const NO_ERRORS_RE = new RegExp(
  `\\b(no errors|exit code 0)\\b[^\\n]*\\b(${ALLOWLIST_COMMANDS.join('|')})s?\\b|\\b(${ALLOWLIST_COMMANDS.join('|')})s?\\b[^\\n]*\\b(no errors|exit code 0)\\b`,
  'i',
);
const PRECISE_RE =
  /\b(exit code 0|all tests pass|strictly equal|at most|at least|contains the string)\b/i;
const VAGUE_RE =
  /\b(implementation is good|all edge cases handled|performance is acceptable|is correct|matches|is good|is fine|properly|appropriately|reasonable|graceful|nicely)\b/i;

/**
 * Mock judge client that simulates how the LLM would interpret the v0.0.11
 * CRITERION. Inspects the artifact's DoD bullets: a bullet matching a
 * canonical idiom (allowlisted command + green/clean/passes/succeeds, or
 * no errors / exit code 0 paired with an allowlisted command) passes
 * through; bullets matching obvious vague phrasings get flagged. The mock
 * only honors the allowlist when the criterion advertises POSITIVE EXAMPLES
 * (i.e. v0.0.11+); a v0.0.10 criterion would flag every "X green" bullet.
 */
function idiomAwareMock(): JudgeClient {
  return {
    async judge({ artifact, criterion }) {
      const hasIdiomAllowlist =
        criterion.includes('POSITIVE EXAMPLES') && criterion.includes('canonical idiom');

      // Slice the DoD section out of the artifact and read its bullets.
      const lines = artifact.split('\n');
      const bullets: string[] = [];
      let inDod = false;
      for (const line of lines) {
        if (line.startsWith('## ')) {
          inDod = line.trim() === '## Definition of Done';
          continue;
        }
        if (inDod && line.trimStart().startsWith('- ')) bullets.push(line);
      }

      const failures: string[] = [];
      for (const b of bullets) {
        const isIdiom = hasIdiomAllowlist && (IDIOM_RE.test(b) || NO_ERRORS_RE.test(b));
        const isPrecise = PRECISE_RE.test(b);
        if (isIdiom || isPrecise) continue;
        if (VAGUE_RE.test(b)) {
          failures.push(b);
          continue;
        }
        // Anything else is treated as imprecise — keeps the mock conservative.
        failures.push(b);
      }

      if (failures.length === 0) {
        return { pass: true, score: 1, reasoning: 'all DoD bullets are precise' };
      }
      return {
        pass: false,
        score: 0.3,
        reasoning: `Bullet '${(failures[0] ?? '').trim()}' has no measurable criterion. What constitutes 'good'?`,
      };
    },
  };
}

describe('dod-precision judge — v0.0.11 calibration', () => {
  test('dod-precision passes on tests pass green / lint clean idioms', async () => {
    const spec = specWithDod([
      '- tests pass green',
      '- pnpm typecheck clean',
      '- biome clean',
      '- pnpm test green',
    ]);

    // Proxy assertion: criterion text and artifact carry the v0.0.11 context.
    const sliced = sliceSections(spec);
    const out = DOD_PRECISION_JUDGE.buildPrompt(spec, sliced, {});
    expect(out.criterion).toContain('POSITIVE EXAMPLES');
    expect(out.criterion).toContain('canonical idiom');
    expect(out.artifact).toContain('tests pass green');
    expect(out.artifact).toContain('pnpm typecheck clean');
    expect(out.artifact).toContain('biome clean');

    // Behavioral assertion: judge does not emit a finding for these bullets.
    const findings = await runReview({
      specPath: 'demo.md',
      spec,
      judgeClient: idiomAwareMock(),
      judges: ['review/dod-precision'],
    });
    expect(findings.find((f) => f.code === 'review/dod-precision')).toBeUndefined();
  });

  test('dod-precision passes on every command in the allowlist (pnpm/bun/tsc/biome/lint/typecheck/test/check/build) paired with green or clean', async () => {
    const cmds = ['pnpm', 'bun', 'tsc', 'biome', 'lint', 'typecheck', 'test', 'check', 'build'];
    // Criterion text must explicitly name every allowlisted command.
    const sampleSpec = specWithDod(['- tests pass green']);
    const sampleSliced = sliceSections(sampleSpec);
    const sampleOut = DOD_PRECISION_JUDGE.buildPrompt(sampleSpec, sampleSliced, {});
    for (const cmd of cmds) {
      expect(sampleOut.criterion).toContain(cmd);
    }

    // Behavioral: each command paired with green / clean passes the judge.
    for (const cmd of cmds) {
      const greenSpec = specWithDod([`- ${cmd} green`]);
      const greenFindings = await runReview({
        specPath: 'demo.md',
        spec: greenSpec,
        judgeClient: idiomAwareMock(),
        judges: ['review/dod-precision'],
      });
      expect(greenFindings.find((f) => f.code === 'review/dod-precision')).toBeUndefined();

      const cleanSpec = specWithDod([`- ${cmd} clean`]);
      const cleanFindings = await runReview({
        specPath: 'demo.md',
        spec: cleanSpec,
        judgeClient: idiomAwareMock(),
        judges: ['review/dod-precision'],
      });
      expect(cleanFindings.find((f) => f.code === 'review/dod-precision')).toBeUndefined();
    }
  });

  test('dod-precision still fires on genuinely vague bullets', async () => {
    const spec = specWithDod([
      '- The implementation is good',
      '- All edge cases handled',
      '- Performance is acceptable',
    ]);

    const findings = await runReview({
      specPath: 'demo.md',
      spec,
      judgeClient: idiomAwareMock(),
      judges: ['review/dod-precision'],
    });
    const finding = findings.find((f) => f.code === 'review/dod-precision');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
    expect(finding?.message?.toLowerCase()).toContain('measurable');
  });

  test('dod-precision fires only on the imprecise subset of mixed-bullet specs', async () => {
    // Mixed: one canonical idiom, one genuinely vague bullet.
    const mixed = specWithDod(['- pnpm typecheck clean', '- The implementation is good']);
    const mixedFindings = await runReview({
      specPath: 'demo.md',
      spec: mixed,
      judgeClient: idiomAwareMock(),
      judges: ['review/dod-precision'],
    });
    const mixedFinding = mixedFindings.find((f) => f.code === 'review/dod-precision');
    expect(mixedFinding).toBeDefined();
    expect(mixedFinding?.message).toContain('implementation is good');
    expect(mixedFinding?.message).not.toContain('pnpm typecheck clean');

    // Pure-canonical control: no finding emitted.
    const pure = specWithDod(['- pnpm typecheck clean', '- biome clean']);
    const pureFindings = await runReview({
      specPath: 'demo.md',
      spec: pure,
      judgeClient: idiomAwareMock(),
      judges: ['review/dod-precision'],
    });
    expect(pureFindings.find((f) => f.code === 'review/dod-precision')).toBeUndefined();
  });

  test("v0.0.11 ruleSetHash differs from v0.0.10's hash", () => {
    // v0.0.10's ruleSetHash, captured before the CRITERION update. The
    // calibration must change the hash so cached v0.0.10 entries miss.
    const V0_0_10_HASH = '7fa94e5b16832939b648a30534cd95acf5a9c87af5ddd595dc7954ae17e5a2a2';
    const current = ruleSetHash();
    expect(current).not.toBe(V0_0_10_HASH);
    // Sanity: shape is still hex.
    expect(current).toMatch(/^[0-9a-f]{64}$/);
  });
});

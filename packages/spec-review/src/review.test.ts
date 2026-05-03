import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Spec, parseSpec } from '@wifo/factory-core';
import type { JudgeClient, Judgment } from '@wifo/factory-harness';
import { runReview } from './review.js';

const FRONTMATTER = [
  '---',
  'id: demo',
  'classification: light',
  'type: feat',
  'status: ready',
  '---',
  '',
].join('\n');

const FULL_BODY = [
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
  '## Definition of Done',
  '- all tests pass',
  '- exit code 0',
].join('\n');

function fullSpec(): Spec {
  return parseSpec(FRONTMATTER + FULL_BODY);
}

interface MockJudge {
  client: JudgeClient;
  invocations: () => number;
  setResponse: (judgments: Judgment[] | ((idx: number) => Judgment | Promise<Judgment>)) => void;
}

function makeMockClient(): MockJudge {
  let count = 0;
  let responder: Judgment[] | ((idx: number) => Judgment | Promise<Judgment>) | undefined;
  const client: JudgeClient = {
    async judge() {
      const idx = count++;
      if (responder === undefined) return { pass: true, score: 1, reasoning: 'default ok' };
      if (Array.isArray(responder)) {
        const out = responder[idx];
        if (out === undefined) return { pass: true, score: 1, reasoning: 'fallback' };
        return out;
      }
      return responder(idx);
    },
  };
  return {
    client,
    invocations: () => count,
    setResponse: (j) => {
      responder = j;
    },
  };
}

let cacheDir: string;
beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'spec-review-'));
});
afterEach(async () => {
  await Bun.$`rm -rf ${cacheDir}`.quiet().nothrow();
});

describe('runReview — happy path', () => {
  test('all judges pass → empty findings array', async () => {
    const m = makeMockClient();
    m.setResponse(() => ({ pass: true, score: 1, reasoning: 'ok' }));
    const findings = await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: m.client,
      cacheDir,
    });
    expect(findings).toEqual([]);
    // 5 enabled - cross-doc-consistency (no plan) - judge-parity (1 scenario)
    // - holdout-distinctness (no holdouts) = 2 actually invoked.
    expect(m.invocations()).toBe(2);
  });

  test('one judge fails → one finding emitted at the right severity + line', async () => {
    const m = makeMockClient();
    m.setResponse((idx) =>
      idx === 0
        ? { pass: false, score: 0.2, reasoning: 'unreferenced dep' }
        : { pass: true, score: 1, reasoning: 'ok' },
    );
    const findings = await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: m.client,
      cacheDir,
    });
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f?.code).toBe('review/internal-consistency');
    expect(f?.severity).toBe('warning');
    expect(f?.message).toBe('unreferenced dep');
    expect(f?.file).toBe('demo.md');
    expect(typeof f?.line).toBe('number');
  });
});

describe('runReview — cache invariants', () => {
  test('cache hit: second call invokes JudgeClient zero times', async () => {
    const m = makeMockClient();
    const spec = fullSpec();
    const args = { specPath: 'demo.md', spec, judgeClient: m.client, cacheDir };
    await runReview(args);
    const before = m.invocations();
    await runReview(args);
    expect(m.invocations()).toBe(before);
  });

  test('cache miss on spec edit: differs from prior call', async () => {
    const m = makeMockClient();
    await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: m.client,
      cacheDir,
    });
    const before = m.invocations();
    const editedBody = `${FULL_BODY}\n\n<!-- edit -->`;
    await runReview({
      specPath: 'demo.md',
      spec: parseSpec(FRONTMATTER + editedBody),
      judgeClient: m.client,
      cacheDir,
    });
    expect(m.invocations()).toBeGreaterThan(before);
  });

  test('cache miss on judges-subset change', async () => {
    const m = makeMockClient();
    await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: m.client,
      cacheDir,
    });
    const before = m.invocations();
    await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: m.client,
      cacheDir,
      judges: ['review/internal-consistency'],
    });
    // Subset → only 1 judge invoked.
    expect(m.invocations()).toBe(before + 1);
  });

  test('no cache: cacheDir undefined → judges always invoked, no file written', async () => {
    const m = makeMockClient();
    await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: m.client,
    });
    const before = m.invocations();
    await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: m.client,
    });
    expect(m.invocations()).toBe(before * 2);
  });
});

describe('runReview — failure handling', () => {
  test('judge throws → review/judge-failed finding (severity error); pipeline continues', async () => {
    const m = makeMockClient();
    m.setResponse((idx) => {
      if (idx === 1) throw new Error('judge/malformed-response: garbage');
      return { pass: true, score: 1, reasoning: 'ok' };
    });
    const findings = await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: m.client,
      cacheDir,
    });
    const failed = findings.find((f) => f.code === 'review/judge-failed');
    expect(failed).toBeDefined();
    expect(failed?.severity).toBe('error');
    expect(failed?.message).toContain('judge/malformed-response');
    // Other judges still ran (4 enabled, one threw → 3 callable + 1 failure record).
    expect(m.invocations()).toBeGreaterThanOrEqual(2);
  });
});

describe('runReview — applicability + section-missing', () => {
  test('cross-doc-consistency: skipped when no technical-plan; runs when provided', async () => {
    const withoutPlan = makeMockClient();
    await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: withoutPlan.client,
      cacheDir,
    });
    const withoutCount = withoutPlan.invocations();

    const cacheDir2 = mkdtempSync(join(tmpdir(), 'spec-review-2-'));
    try {
      const withPlan = makeMockClient();
      await runReview({
        specPath: 'demo.md',
        spec: fullSpec(),
        judgeClient: withPlan.client,
        cacheDir: cacheDir2,
        technicalPlan: '## Architecture\nThis is a tech plan.',
      });
      expect(withPlan.invocations()).toBe(withoutCount + 1);
    } finally {
      await Bun.$`rm -rf ${cacheDir2}`.quiet().nothrow();
    }
  });

  test('holdout-distinctness: skipped when no holdouts', async () => {
    const m = makeMockClient();
    const findings = await runReview({
      specPath: 'demo.md',
      spec: fullSpec(),
      judgeClient: m.client,
      cacheDir,
    });
    expect(findings.find((f) => f.code === 'review/holdout-distinctness')).toBeUndefined();
  });

  test('judge-parity: skipped when only 0/1 scenarios', async () => {
    const oneScenarioBody = [
      '## Intent',
      'x.',
      '',
      '## Scenarios',
      '**S-1** — only',
      '  Given a',
      '  When b',
      '  Then c',
      '  Satisfaction:',
      '    - test: src/foo.test.ts',
    ].join('\n');
    const m = makeMockClient();
    const findings = await runReview({
      specPath: 'demo.md',
      spec: parseSpec(FRONTMATTER + oneScenarioBody),
      judgeClient: m.client,
      cacheDir,
    });
    expect(findings.find((f) => f.code === 'review/judge-parity')).toBeUndefined();
  });

  test('runReview threads deps through to cross-doc-consistency judge', async () => {
    const cacheDir2 = mkdtempSync(join(tmpdir(), 'spec-review-deps-'));
    try {
      const m = makeMockClient();
      await runReview({
        specPath: 'demo.md',
        spec: fullSpec(),
        judgeClient: m.client,
        cacheDir: cacheDir2,
        deps: [{ id: 'helper', body: '## Helper\nbody' }],
      });
      // cross-doc-consistency now applies via depsCount > 0 even without a plan.
      // Total = 4 default-enabled judges that apply to a clean spec WITH deps.
      // Compare against a no-deps run on the same spec.
      const cacheDirNoDeps = mkdtempSync(join(tmpdir(), 'spec-review-no-deps-'));
      try {
        const m2 = makeMockClient();
        await runReview({
          specPath: 'demo.md',
          spec: fullSpec(),
          judgeClient: m2.client,
          cacheDir: cacheDirNoDeps,
        });
        // The deps run must have invoked cross-doc-consistency; the no-deps
        // run must have skipped it (no technical-plan, no deps).
        expect(m.invocations()).toBeGreaterThan(m2.invocations());
      } finally {
        await Bun.$`rm -rf ${cacheDirNoDeps}`.quiet().nothrow();
      }
    } finally {
      await Bun.$`rm -rf ${cacheDir2}`.quiet().nothrow();
    }
  });

  test('dod-precision: missing DoD section → review/section-missing info finding', async () => {
    const noDodBody = [
      '## Intent',
      'x.',
      '',
      '## Scenarios',
      '**S-1** — a',
      '  Given a',
      '  When b',
      '  Then c',
      '  Satisfaction:',
      '    - test: src/foo.test.ts',
    ].join('\n');
    const m = makeMockClient();
    const findings = await runReview({
      specPath: 'demo.md',
      spec: parseSpec(FRONTMATTER + noDodBody),
      judgeClient: m.client,
      cacheDir,
    });
    const missing = findings.find((f) => f.code === 'review/section-missing');
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe('info');
    expect(missing?.message).toContain('Definition of Done');
    expect(missing?.message).toContain('dod-precision skipped');
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContextStore } from '@wifo/factory-context';
import { type Spec, parseSpec } from '@wifo/factory-core';
import type { JudgeClient } from '@wifo/factory-harness';
import { FactoryRunSchema, FactoryValidateReportSchema, tryRegister } from '../records.js';
import type { PhaseContext } from '../types.js';
import { dodPhase } from './dod.js';

let storeDir: string;
let workDir: string;

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'runtime-dod-store-'));
  workDir = mkdtempSync(join(tmpdir(), 'runtime-dod-work-'));
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

function makePassingJudgeClient(): JudgeClient {
  return {
    async judge() {
      return { pass: true, score: 1, reasoning: 'fixture-judge: ok' };
    },
  };
}

function makeFailingJudgeClient(): JudgeClient {
  return {
    async judge() {
      return { pass: false, score: 0, reasoning: 'fixture-judge: not satisfied' };
    },
  };
}

function makeSpec(args: {
  dodLines: string[];
  id?: string;
  filename?: string;
}): Spec {
  const lines = [
    '---',
    `id: ${args.id ?? 'dod-test'}`,
    'classification: light',
    'type: feat',
    'status: ready',
    '---',
    '',
    `# ${args.id ?? 'dod-test'}`,
    '',
    '## Intent',
    'A test spec.',
    '',
    '## Scenarios',
    '**S-1** — passes',
    '  Given a',
    '  When b',
    '  Then c',
    '',
    '## Definition of Done',
    '',
    ...args.dodLines,
    '',
  ];
  const source = lines.join('\n');
  return parseSpec(source, args.filename !== undefined ? { filename: args.filename } : {});
}

async function setupCtx(spec: Spec): Promise<{ ctx: PhaseContext; runId: string }> {
  const store = createContextStore({ dir: storeDir });
  tryRegister(store, 'factory-run', FactoryRunSchema);
  tryRegister(store, 'factory-validate-report', FactoryValidateReportSchema);

  const runId = await store.put(
    'factory-run',
    {
      specId: spec.frontmatter.id,
      graphPhases: ['validate', 'dod'],
      maxIterations: 1,
      startedAt: new Date().toISOString(),
    },
    { parents: [] },
  );

  const ctx: PhaseContext = {
    spec,
    contextStore: store,
    log: () => {},
    runId,
    iteration: 1,
    inputs: [],
  };
  return { ctx, runId };
}

describe('dodPhase — happy path (S-2)', () => {
  test('dodPhase runs shell bullets and persists factory-dod-report on pass', async () => {
    const pkg = {
      name: 'dod-fixture',
      private: true,
      scripts: {
        typecheck: 'echo typecheck-ok',
        test: 'echo test-ok',
      },
    };
    writeFileSync(join(workDir, 'package.json'), JSON.stringify(pkg, null, 2));

    const spec = makeSpec({
      dodLines: ['- `bash -c "echo typecheck-ok"`', '- `bash -c "echo test-ok"`'],
    });
    const { ctx } = await setupCtx(spec);
    const phase = dodPhase({ cwd: workDir });
    const result = await phase.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.records).toHaveLength(1);
    const payload = result.records[0]?.payload as {
      status: string;
      bullets: Array<{
        kind: string;
        status: string;
        command?: string;
        exitCode?: number | null;
      }>;
      summary: { pass: number; fail: number; error: number };
    };
    expect(payload.status).toBe('pass');
    expect(payload.bullets).toHaveLength(2);
    expect(payload.bullets[0]?.kind).toBe('shell');
    expect(payload.bullets[0]?.status).toBe('pass');
    expect(payload.bullets[0]?.command).toBe('bash -c "echo typecheck-ok"');
    expect(payload.bullets[0]?.exitCode).toBe(0);
    expect(payload.bullets[1]?.kind).toBe('shell');
    expect(payload.bullets[1]?.status).toBe('pass');
    expect(payload.summary.pass).toBe(2);
    expect(payload.summary.fail).toBe(0);
  });

  test('dodPhase reports fail with exitCode + stderrTail when a shell bullet fails', async () => {
    const spec = makeSpec({
      dodLines: ['- `bash -c "echo error-line >&2; exit 1"`'],
    });
    const { ctx } = await setupCtx(spec);
    const phase = dodPhase({ cwd: workDir });
    const result = await phase.run(ctx);
    expect(result.status).toBe('fail');
    const payload = result.records[0]?.payload as {
      status: string;
      bullets: Array<{
        kind: string;
        status: string;
        exitCode?: number | null;
        stderrTail?: string;
      }>;
    };
    expect(payload.status).toBe('fail');
    expect(payload.bullets[0]?.status).toBe('fail');
    expect(payload.bullets[0]?.exitCode).toBe(1);
    expect(payload.bullets[0]?.stderrTail).toContain('error-line');
  });

  test('dodPhase dispatches non-shell bullets to the judge client', async () => {
    const spec = makeSpec({
      dodLines: ['- Public API surface unchanged.'],
    });
    const { ctx } = await setupCtx(spec);
    const phase = dodPhase({
      cwd: workDir,
      judgeClient: makePassingJudgeClient(),
    });
    const result = await phase.run(ctx);
    expect(result.status).toBe('pass');
    const payload = result.records[0]?.payload as {
      bullets: Array<{ kind: string; status: string; judgeReasoning?: string }>;
    };
    expect(payload.bullets[0]?.kind).toBe('judge');
    expect(payload.bullets[0]?.status).toBe('pass');
    expect(payload.bullets[0]?.judgeReasoning).toBe('fixture-judge: ok');

    // Failing judge propagates to phase fail.
    const phase2 = dodPhase({
      cwd: workDir,
      judgeClient: makeFailingJudgeClient(),
    });
    const result2 = await phase2.run((await setupCtx(spec)).ctx);
    expect(result2.status).toBe('fail');
  });
});

describe('dodPhase — H-1 shell allowlist', () => {
  test('non-allowlisted commands route to judge (rm -rf is NOT executed)', async () => {
    // The bullet contains `rm -rf /tmp/should-not-exist-xyz` which would be
    // catastrophic if executed. parseDodBullets classifies it as judge
    // because `rm` is NOT in the allowlist. With a passing judge stub the
    // phase passes WITHOUT spawning Bash.
    const sentinel = join(workDir, 'sentinel.txt');
    writeFileSync(sentinel, 'still here');
    const spec = makeSpec({
      dodLines: [`- \`rm -rf ${sentinel}\``],
    });
    const { ctx } = await setupCtx(spec);
    const phase = dodPhase({ cwd: workDir, judgeClient: makePassingJudgeClient() });
    const result = await phase.run(ctx);
    expect(result.status).toBe('pass');
    const payload = result.records[0]?.payload as {
      bullets: Array<{ kind: string }>;
    };
    expect(payload.bullets[0]?.kind).toBe('judge');
    // Sentinel intact — proof rm did not run.
    expect((await Bun.file(sentinel).text()).trim()).toBe('still here');
  });
});

describe('dodPhase — H-2 per-bullet timeout', () => {
  test('bullet exceeding timeoutMs reports status=error with dod-timeout marker', async () => {
    const spec = makeSpec({
      dodLines: ['- `bash -c "sleep 5"`'],
    });
    const { ctx } = await setupCtx(spec);
    const phase = dodPhase({ cwd: workDir, timeoutMs: 200 });
    const result = await phase.run(ctx);
    expect(result.status).toBe('error');
    const payload = result.records[0]?.payload as {
      bullets: Array<{
        status: string;
        exitCode?: number | null;
        stderrTail?: string;
      }>;
    };
    expect(payload.bullets[0]?.status).toBe('error');
    expect(payload.bullets[0]?.exitCode).toBeNull();
    expect(payload.bullets[0]?.stderrTail).toContain('dod-timeout (after 200ms)');
  }, 10_000);
});

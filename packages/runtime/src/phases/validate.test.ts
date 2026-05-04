import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContextStore } from '@wifo/factory-context';
import { parseSpec } from '@wifo/factory-core';
import { z } from 'zod';
import { FactoryRunSchema, FactoryValidateReportSchema, tryRegister } from '../records.js';
import type { PhaseContext } from '../types.js';
import { validatePhase } from './validate.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-fixtures');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runtime-validate-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

async function setupCtx(specPath: string): Promise<{ ctx: PhaseContext; runId: string }> {
  const store = createContextStore({ dir });
  // Pre-register types the runtime would normally register.
  tryRegister(store, 'factory-run', FactoryRunSchema);
  tryRegister(store, 'factory-validate-report', FactoryValidateReportSchema);

  const runId = await store.put(
    'factory-run',
    {
      specId: 'fake',
      graphPhases: ['validate'],
      maxIterations: 1,
      startedAt: new Date().toISOString(),
    },
    { parents: [] },
  );

  const source = readFileSync(specPath, 'utf8');
  const spec = parseSpec(source, { filename: specPath });

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

describe('validatePhase — pass fixture', () => {
  test('puts factory-validate-report with parents=[runId] and returns PhaseResult.status="pass"', async () => {
    const { ctx, runId } = await setupCtx(join(FIXTURES, 'all-pass.md'));
    const phase = validatePhase({ cwd: FIXTURES, noJudge: true });
    expect(phase.name).toBe('validate');

    const result = await phase.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.records.length).toBe(1);

    const record = result.records[0];
    expect(record).toBeDefined();
    expect(record?.type).toBe('factory-validate-report');
    expect(record?.parents).toEqual([runId]);

    const payload = record?.payload as { status: string; specId: string };
    expect(payload.status).toBe('pass');
    expect(payload.specId).toBe('runtime-smoke-all-pass');
  });
});

describe('validatePhase — fail fixture', () => {
  test('returns PhaseResult.status="fail" and persists a fail-status report', async () => {
    const { ctx, runId } = await setupCtx(join(FIXTURES, 'will-fail.md'));
    const phase = validatePhase({ cwd: FIXTURES, noJudge: true });

    const result = await phase.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.records.length).toBe(1);

    const record = result.records[0];
    expect(record?.parents).toEqual([runId]);
    const payload = record?.payload as { status: string };
    expect(payload.status).toBe('fail');
  });
});

describe('validatePhase — registration', () => {
  test('idempotent registration: a second invocation does not throw on duplicate type', async () => {
    const { ctx } = await setupCtx(join(FIXTURES, 'all-pass.md'));
    const phase = validatePhase({ cwd: FIXTURES, noJudge: true });
    await phase.run(ctx);
    // Second invocation reuses the same store + already-registered type.
    const result = await phase.run(ctx);
    expect(result.status).toBe('pass');
  });
});

describe('validatePhase — cwd resolution', () => {
  test('falls back to spec.raw.filename when opts.cwd not provided', async () => {
    // setupCtx parses the fixture with its absolute path, so dirname(spec.raw.filename) = FIXTURES.
    const { ctx } = await setupCtx(join(FIXTURES, 'all-pass.md'));
    const phase = validatePhase({ noJudge: true }); // no cwd in opts
    const result = await phase.run(ctx);
    expect(result.status).toBe('pass');
  });
});

// ----- v0.0.11 — checkHoldouts (S-1) -----------------------------------

async function setupCtxFromSource(
  source: string,
  filename: string,
): Promise<{ ctx: PhaseContext; runId: string }> {
  const store = createContextStore({ dir });
  tryRegister(store, 'factory-run', FactoryRunSchema);
  tryRegister(store, 'factory-validate-report', FactoryValidateReportSchema);

  const runId = await store.put(
    'factory-run',
    {
      specId: 'fake',
      graphPhases: ['validate'],
      maxIterations: 1,
      startedAt: new Date().toISOString(),
    },
    { parents: [] },
  );
  const spec = parseSpec(source, { filename });
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

const HOLDOUTS_SPEC_BOTH_PASS = `---
id: runtime-checkholdouts-pass
classification: light
type: feat
status: ready
---

# checkholdouts pass — visible + holdouts both pass

## Scenarios

**S-1** — visible-1 passes
  Given the trivial-pass fixture
  When the harness runs the test satisfaction
  Then the test passes
  Satisfaction:
    - test: trivial-pass.test.ts "trivial passes"

**S-2** — visible-2 passes
  Given the trivial-pass fixture
  When the harness runs the test satisfaction
  Then the test passes
  Satisfaction:
    - test: trivial-pass.test.ts "trivial passes"

## Holdout Scenarios

**H-1** — holdout-1 passes
  Given the trivial-pass fixture
  When the harness runs the holdout satisfaction
  Then the test passes
  Satisfaction:
    - test: trivial-pass.test.ts "trivial passes"

**H-2** — holdout-2 passes
  Given the trivial-pass fixture
  When the harness runs the holdout satisfaction
  Then the test passes
  Satisfaction:
    - test: trivial-pass.test.ts "trivial passes"

## Definition of Done

- the visible scenarios and holdouts pass
`;

const HOLDOUTS_SPEC_VISIBLE_PASS_HOLDOUTS_FAIL = `---
id: runtime-checkholdouts-mixed
classification: light
type: feat
status: ready
---

# checkholdouts mixed — visible pass, holdouts fail

## Scenarios

**S-1** — visible passes
  Given the trivial-pass fixture
  When the harness runs the test satisfaction
  Then the test passes
  Satisfaction:
    - test: trivial-pass.test.ts "trivial passes"

## Holdout Scenarios

**H-1** — holdout fails
  Given the trivial-fail fixture
  When the harness runs the holdout satisfaction
  Then the test fails
  Satisfaction:
    - test: trivial-fail.test.ts "trivial fails"

## Definition of Done

- the visible scenario passes (holdout would fail if run)
`;

describe('validatePhase — v0.0.11 checkHoldouts (S-1)', () => {
  test('--check-holdouts runs visible AND holdouts each iteration', async () => {
    const { ctx } = await setupCtxFromSource(
      HOLDOUTS_SPEC_BOTH_PASS,
      join(FIXTURES, 'check-holdouts-pass.md'),
    );
    const phase = validatePhase({ cwd: FIXTURES, noJudge: true, checkHoldouts: true });
    const result = await phase.run(ctx);
    expect(result.status).toBe('pass');
    const payload = result.records[0]?.payload as {
      status: string;
      scenarios: { scenarioId: string; status: string; scenarioKind: string }[];
      holdouts?: { scenarioId: string; status: string; scenarioKind: string }[];
    };
    expect(payload.status).toBe('pass');
    expect(payload.scenarios.length).toBe(2);
    expect(payload.holdouts?.length).toBe(2);
    // Holdout fail in iter 1 → phase status fails (does not converge in iter 1).
    const { ctx: ctx2 } = await setupCtxFromSource(
      HOLDOUTS_SPEC_VISIBLE_PASS_HOLDOUTS_FAIL,
      join(FIXTURES, 'check-holdouts-mixed.md'),
    );
    const result2 = await phase.run(ctx2);
    expect(result2.status).toBe('fail');
    const payload2 = result2.records[0]?.payload as {
      status: string;
      scenarios: { status: string }[];
      holdouts?: { status: string }[];
    };
    expect(payload2.scenarios.every((s) => s.status === 'pass')).toBe(true);
    expect(payload2.holdouts?.every((h) => h.status === 'fail')).toBe(true);
  });

  test('factory-validate-report has separate scenarios + holdouts arrays when --check-holdouts is set', async () => {
    const { ctx } = await setupCtxFromSource(
      HOLDOUTS_SPEC_BOTH_PASS,
      join(FIXTURES, 'check-holdouts-pass.md'),
    );
    const phase = validatePhase({ cwd: FIXTURES, noJudge: true, checkHoldouts: true });
    const result = await phase.run(ctx);
    const payload = result.records[0]?.payload as {
      scenarios: { scenarioId: string; scenarioKind: string }[];
      holdouts?: { scenarioId: string; scenarioKind: string }[];
    };
    // Visible entries land in `scenarios`; holdouts land in their own array.
    expect(payload.scenarios.map((s) => s.scenarioId).sort()).toEqual(['S-1', 'S-2']);
    expect((payload.holdouts ?? []).map((h) => h.scenarioId).sort()).toEqual(['H-1', 'H-2']);
    // Provenance: holdouts entries carry kind 'holdout'.
    expect(payload.scenarios.every((s) => s.scenarioKind === 'scenario')).toBe(true);
    expect((payload.holdouts ?? []).every((h) => h.scenarioKind === 'holdout')).toBe(true);
  });

  test('absent --check-holdouts leaves holdouts unrun (default v0.0.10 behavior)', async () => {
    // Spec with a holdout that would fail if run; without --check-holdouts the
    // phase should converge on the visible scenarios alone.
    const { ctx } = await setupCtxFromSource(
      HOLDOUTS_SPEC_VISIBLE_PASS_HOLDOUTS_FAIL,
      join(FIXTURES, 'check-holdouts-mixed.md'),
    );
    const phase = validatePhase({ cwd: FIXTURES, noJudge: true });
    const result = await phase.run(ctx);
    expect(result.status).toBe('pass');
    const payload = result.records[0]?.payload as {
      status: string;
      scenarios: { scenarioId: string }[];
      holdouts?: { scenarioId: string }[];
    };
    expect(payload.status).toBe('pass');
    expect(payload.scenarios.map((s) => s.scenarioId)).toEqual(['S-1']);
    // Holdouts array is absent (or empty) by default.
    expect(payload.holdouts === undefined || payload.holdouts.length === 0).toBe(true);
  });
});

describe('validatePhase — v0.0.3 parents extension', () => {
  test('parents = [runId, sameIterImplId] when ctx.inputs holds a factory-implement-report', async () => {
    const { ctx, runId } = await setupCtx(join(FIXTURES, 'all-pass.md'));
    // Register a synthetic factory-implement-report-shaped record and inject
    // it via ctx.inputs (no schema validation — just a record with the right type).
    ctx.contextStore.register('factory-implement-report', z.unknown());
    const synthImplId = await ctx.contextStore.put(
      'factory-implement-report',
      { synthetic: true, iteration: 1 },
      { parents: [runId] },
    );
    const synthImplRec = await ctx.contextStore.get(synthImplId);
    if (synthImplRec === null) throw new Error('vanished');
    const ctxWithImpl: PhaseContext = { ...ctx, inputs: [synthImplRec] };

    const phase = validatePhase({ cwd: FIXTURES, noJudge: true });
    const result = await phase.run(ctxWithImpl);
    expect(result.status).toBe('pass');
    expect(result.records[0]?.parents).toEqual([runId, synthImplId]);
  });

  test('parents = [runId] in --no-implement-style flow (ctx.inputs has no implement-report)', async () => {
    const { ctx, runId } = await setupCtx(join(FIXTURES, 'all-pass.md'));
    // Inject some unrelated record type to confirm the filter is on type, not arity.
    ctx.contextStore.register('unrelated', z.unknown());
    const unrelatedId = await ctx.contextStore.put('unrelated', { x: 1 }, { parents: [runId] });
    const unrelatedRec = await ctx.contextStore.get(unrelatedId);
    if (unrelatedRec === null) throw new Error('vanished');
    const ctxWithUnrelated: PhaseContext = { ...ctx, inputs: [unrelatedRec] };

    const phase = validatePhase({ cwd: FIXTURES, noJudge: true });
    const result = await phase.run(ctxWithUnrelated);
    expect(result.records[0]?.parents).toEqual([runId]);
  });
});

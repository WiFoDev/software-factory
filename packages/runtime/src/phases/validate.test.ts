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

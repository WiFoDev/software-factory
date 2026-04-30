import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ContextRecord, createContextStore } from '@wifo/factory-context';
import type { Spec } from '@wifo/factory-core';
import { z } from 'zod';
import { RuntimeError } from './errors.js';
import { definePhase, definePhaseGraph } from './graph.js';
import { run } from './runtime.js';
import type { Phase, PhaseContext, PhaseResult, PhaseStatus } from './types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runtime-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

function makeSpec(id = 'spec-x'): Spec {
  return {
    frontmatter: {
      id,
      classification: 'light',
      type: 'feat',
      status: 'ready',
      exemplars: [],
    },
    body: '',
    scenarios: [],
    holdouts: [],
    raw: { source: '' },
  };
}

/**
 * A synthetic phase that puts one record of a given type and returns a chosen
 * status. Lets tests drive the runtime deterministically without depending on
 * the harness or the file system beyond the context store dir.
 */
function makeSyntheticPhase(opts: {
  name: string;
  type: string;
  payload?: unknown;
  status?: PhaseStatus;
  putRecord?: boolean;
  ctxAssertions?: (ctx: PhaseContext) => void;
}): Phase {
  return definePhase(opts.name, async (ctx) => {
    opts.ctxAssertions?.(ctx);
    if (opts.putRecord === false) {
      return { status: opts.status ?? 'pass', records: [] };
    }
    // Register the synthetic type lazily so tests don't need to do it.
    try {
      ctx.contextStore.register(opts.type, z.unknown());
    } catch {
      // Already registered; ignore.
    }
    const id = await ctx.contextStore.put(opts.type, opts.payload ?? { name: opts.name }, {
      parents: [ctx.runId],
    });
    const rec = await ctx.contextStore.get(id);
    if (rec === null) throw new Error('record vanished');
    return { status: opts.status ?? 'pass', records: [rec] };
  });
}

describe('run() — smoke', () => {
  test('default maxIterations is 1; single-shot pass converges', async () => {
    const store = createContextStore({ dir });
    const phase = makeSyntheticPhase({
      name: 'p1',
      type: 'synthetic-1',
      status: 'pass',
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });

    expect(report.status).toBe('converged');
    expect(report.iterationCount).toBe(1);
    expect(report.iterations.length).toBe(1);
    expect(report.iterations[0]?.phases.length).toBe(1);
    expect(report.iterations[0]?.phases[0]?.phaseName).toBe('p1');
    expect(report.iterations[0]?.phases[0]?.status).toBe('pass');
  });

  test('persists factory-run with parents=[] and factory-phase chain', async () => {
    const store = createContextStore({ dir });
    const p1 = makeSyntheticPhase({ name: 'p1', type: 'synthetic-1', status: 'pass' });
    const p2 = makeSyntheticPhase({ name: 'p2', type: 'synthetic-2', status: 'pass' });
    const graph = definePhaseGraph([p1, p2], [['p1', 'p2']]);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });

    expect(report.status).toBe('converged');

    const runRec = await store.get(report.runId);
    expect(runRec).not.toBeNull();
    expect(runRec?.type).toBe('factory-run');
    expect(runRec?.parents).toEqual([]);

    const phaseRecs = await store.list({ type: 'factory-phase' });
    expect(phaseRecs.length).toBe(2);

    const p1Rec = phaseRecs.find((r) => (r.payload as { phaseName: string }).phaseName === 'p1');
    const p2Rec = phaseRecs.find((r) => (r.payload as { phaseName: string }).phaseName === 'p2');
    expect(p1Rec).toBeDefined();
    expect(p2Rec).toBeDefined();

    // p1 has no upstream input — parents should be exactly [runId]
    expect(p1Rec?.parents).toEqual([report.runId]);

    // p2 received p1's output as input — parents should be [runId, <p1 output id>]
    const p1OutputIds = (p1Rec?.payload as { outputRecordIds: string[] }).outputRecordIds;
    expect(p1OutputIds.length).toBe(1);
    expect(p2Rec?.parents).toEqual([report.runId, p1OutputIds[0] as string]);
  });

  test('runId and iteration are injected into PhaseContext', async () => {
    const store = createContextStore({ dir });
    const seenCtx: { runId?: string; iteration?: number } = {};
    const phase = definePhase('inspect', async (ctx) => {
      seenCtx.runId = ctx.runId;
      seenCtx.iteration = ctx.iteration;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });

    expect(seenCtx.runId).toBe(report.runId);
    expect(seenCtx.iteration).toBe(1);
  });
});

describe('run() — iteration', () => {
  test('iterates while phase fails until maxIterations → no-converge', async () => {
    const store = createContextStore({ dir });
    let calls = 0;
    const phase = definePhase('always-fail', async () => {
      calls++;
      return { status: 'fail', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 3 },
    });

    expect(calls).toBe(3);
    expect(report.status).toBe('no-converge');
    expect(report.iterationCount).toBe(3);

    const phaseRecs = await store.list({ type: 'factory-phase' });
    expect(phaseRecs.length).toBe(3);
    const iterations = phaseRecs.map((r) => (r.payload as { iteration: number }).iteration).sort();
    expect(iterations).toEqual([1, 2, 3]);
  });

  test('stops iterating on the first pass', async () => {
    const store = createContextStore({ dir });
    let calls = 0;
    const phase = definePhase('flip-on-2', async () => {
      calls++;
      return { status: calls === 1 ? 'fail' : 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 5 },
    });

    expect(calls).toBe(2);
    expect(report.status).toBe('converged');
    expect(report.iterationCount).toBe(2);
  });

  test('rejects non-positive maxIterations as RuntimeError before any record is written', async () => {
    const store = createContextStore({ dir });
    const phase = definePhase('p', async () => ({ status: 'pass', records: [] }));
    const graph = definePhaseGraph([phase], []);

    let caught: unknown;
    try {
      await run({
        spec: makeSpec(),
        graph,
        contextStore: store,
        options: { maxIterations: 0 },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).code).toBe('runtime/invalid-max-iterations');

    // No records written.
    const all = await store.list();
    expect(all.length).toBe(0);
  });

  test('rejects negative maxIterations', async () => {
    const store = createContextStore({ dir });
    const phase = definePhase('p', async () => ({ status: 'pass', records: [] }));
    const graph = definePhaseGraph([phase], []);

    let caught: unknown;
    try {
      await run({
        spec: makeSpec(),
        graph,
        contextStore: store,
        options: { maxIterations: -1 },
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as RuntimeError)?.code).toBe('runtime/invalid-max-iterations');
  });
});

describe('run() — phase exception', () => {
  test('phase that throws becomes status=error, run aborts immediately', async () => {
    const store = createContextStore({ dir });
    let p2Calls = 0;
    const p1 = definePhase('p1', async () => {
      throw new Error('boom');
    });
    const p2 = definePhase('p2', async () => {
      p2Calls++;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([p1, p2], [['p1', 'p2']]);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 5 },
    });

    expect(report.status).toBe('error');
    expect(report.iterationCount).toBe(1);
    expect(report.iterations[0]?.phases.length).toBe(1);
    expect(report.iterations[0]?.phases[0]?.status).toBe('error');
    expect(p2Calls).toBe(0);

    const phaseRecs = await store.list({ type: 'factory-phase' });
    expect(phaseRecs.length).toBe(1);
    const payload = phaseRecs[0]?.payload as { status: string; failureDetail: string };
    expect(payload.status).toBe('error');
    expect(payload.failureDetail).toContain('boom');
  });
});

describe('run() — convergence is generic across phase names (H-2)', () => {
  test("a graph whose terminal phase is named 'check' converges on pass", async () => {
    const store = createContextStore({ dir });
    const phase = definePhase('check', async () => ({ status: 'pass', records: [] }));
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });
    expect(report.status).toBe('converged');
    expect(report.iterationCount).toBe(1);
  });

  test("the same graph with phase named 'whatever' iterates on fail and reaches no-converge", async () => {
    const store = createContextStore({ dir });
    let calls = 0;
    const phase = definePhase('whatever', async () => {
      calls++;
      return { status: 'fail', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 2 },
    });
    expect(calls).toBe(2);
    expect(report.status).toBe('no-converge');
    // Runtime never inspects phase.name — verified by identical observable behavior to
    // the same flow under any other name (the 'always-fail' test above uses a different name).
  });
});

describe('run() — idempotent registration', () => {
  test('two run() calls in the same process against the same store both succeed', async () => {
    const store = createContextStore({ dir });
    const phase = makeSyntheticPhase({ name: 'p1', type: 'idem-1', status: 'pass' });
    const graph = definePhaseGraph([phase], []);

    const r1 = await run({ spec: makeSpec('a'), graph, contextStore: store });
    const r2 = await run({ spec: makeSpec('b'), graph, contextStore: store });

    expect(r1.status).toBe('converged');
    expect(r2.status).toBe('converged');
    expect(r1.runId).not.toBe(r2.runId);

    const runRecs = await store.list({ type: 'factory-run' });
    expect(runRecs.length).toBe(2);
  });
});

describe('run() — RunReport shape', () => {
  test('iterations[].phases[].outputRecordIds match on-disk record ids', async () => {
    const store = createContextStore({ dir });
    const phase = makeSyntheticPhase({ name: 'producer', type: 'output-x' });
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });

    const phaseInvocation = report.iterations[0]?.phases[0];
    expect(phaseInvocation).toBeDefined();
    const outputId = phaseInvocation?.outputRecordIds[0];
    expect(outputId).toBeDefined();
    if (outputId === undefined) return;

    const rec: ContextRecord | null = await store.get(outputId);
    expect(rec).not.toBeNull();
    expect(rec?.type).toBe('output-x');
  });

  test('records the factory-phase record id and durations', async () => {
    const store = createContextStore({ dir });
    const phase = definePhase('p', async () => ({ status: 'pass', records: [] }));
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });

    const inv = report.iterations[0]?.phases[0];
    expect(inv?.phaseRecordId).toMatch(/^[0-9a-f]{16}$/);
    expect(inv?.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);

    // phaseRecordId actually exists on disk
    const rec = await store.get(inv?.phaseRecordId ?? '');
    expect(rec?.type).toBe('factory-phase');
  });
});

describe('run() — multi-phase input dedup', () => {
  test('parents on factory-phase reflect dedup when multiple predecessors share output ids', async () => {
    const store = createContextStore({ dir });
    // a → c, b → c. a and b each output one record; c receives both.
    const a = makeSyntheticPhase({ name: 'a', type: 'shared', payload: { v: 1 } });
    const b = makeSyntheticPhase({ name: 'b', type: 'shared', payload: { v: 2 } });
    const cInputs: { count?: number } = {};
    const c = definePhase('c', async (ctx) => {
      // c doesn't actually inspect inputs in v0.0.1 — but we can verify
      // the persisted parents on the factory-phase record below.
      cInputs.count = 1;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph(
      [a, b, c],
      [
        ['a', 'c'],
        ['b', 'c'],
      ],
    );
    const report = await run({ spec: makeSpec(), graph, contextStore: store });

    expect(report.status).toBe('converged');

    const phaseRecs = await store.list({ type: 'factory-phase' });
    const cRec = phaseRecs.find((r) => (r.payload as { phaseName: string }).phaseName === 'c');
    expect(cRec).toBeDefined();
    // c's parents = [runId, a-output, b-output] — all distinct, no dupes
    expect(cRec?.parents.length).toBe(3);
    expect(cRec?.parents[0]).toBe(report.runId);
  });
});

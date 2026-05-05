import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ContextRecord, createContextStore } from '@wifo/factory-context';
import { type Spec, parseSpec } from '@wifo/factory-core';
import { z } from 'zod';
import { RuntimeError } from './errors.js';
import { definePhase, definePhaseGraph } from './graph.js';
import { dodPhase } from './phases/dod.js';
import { validatePhase } from './phases/validate.js';
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
      'depends-on': [],
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
  test('default maxIterations is 5 (v0.0.3); single-shot pass still converges in iter 1', async () => {
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

    // v0.0.3: persisted factory-run.payload.maxIterations reflects the resolved
    // default (5), not the actual iteration count taken (1).
    const runRec = await store.get(report.runId);
    const runPayload = runRec?.payload as { maxIterations: number } | undefined;
    expect(runPayload?.maxIterations).toBe(5);
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

describe('run() — v0.0.3 ctx.inputs threading', () => {
  test('iter 1 root phase: ctx.inputs is empty', async () => {
    const store = createContextStore({ dir });
    const seen: { inputs?: ReadonlyArray<ContextRecord> } = {};
    const phase = definePhase('root', async (ctx) => {
      seen.inputs = ctx.inputs;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    await run({ spec: makeSpec(), graph, contextStore: store });
    expect(seen.inputs).toEqual([]);
  });

  test('non-root phase on iter 1: ctx.inputs holds same-iter predecessor outputs', async () => {
    const store = createContextStore({ dir });
    const a = makeSyntheticPhase({ name: 'a', type: 'pred-out', payload: { v: 1 } });
    const seen: { inputs?: ReadonlyArray<ContextRecord> } = {};
    const b = definePhase('b', async (ctx) => {
      seen.inputs = ctx.inputs;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([a, b], [['a', 'b']]);
    await run({ spec: makeSpec(), graph, contextStore: store });
    expect(seen.inputs?.length).toBe(1);
    expect(seen.inputs?.[0]?.type).toBe('pred-out');
  });

  test('root phase on iter ≥ 2: ctx.inputs holds prior iteration terminal outputs', async () => {
    const store = createContextStore({ dir });
    const seenByIter: ReadonlyArray<ContextRecord>[] = [];
    let calls = 0;
    const phase = definePhase('root', async (ctx) => {
      seenByIter.push(ctx.inputs);
      calls++;
      // Produce one record per iteration, then fail twice to force iter 2 then iter 3.
      try {
        ctx.contextStore.register('iter-output', z.unknown());
      } catch {
        // already registered
      }
      const id = await ctx.contextStore.put(
        'iter-output',
        { iter: ctx.iteration },
        {
          parents: [ctx.runId],
        },
      );
      const rec = await ctx.contextStore.get(id);
      if (rec === null) throw new Error('record vanished');
      return { status: calls < 3 ? 'fail' : 'pass', records: [rec] };
    });
    const graph = definePhaseGraph([phase], []);
    await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 5 },
    });
    expect(calls).toBe(3);
    expect(seenByIter[0]).toEqual([]);
    expect(seenByIter[1]?.length).toBe(1);
    expect((seenByIter[1]?.[0]?.payload as { iter: number } | undefined)?.iter).toBe(1);
    expect(seenByIter[2]?.length).toBe(1);
    expect((seenByIter[2]?.[0]?.payload as { iter: number } | undefined)?.iter).toBe(2);
  });

  test('REGRESSION: factory-phase.parents does NOT receive prior-iter terminal outputs (parity with v0.0.2 in --no-implement-style root-only graphs)', async () => {
    // Root-only graph iterating 3 times. ctx.inputs gets prior-iter outputs from
    // iter 2 / iter 3 — but factory-phase.parents must stay [runId] across all
    // iterations to preserve v0.0.2 record-set parity.
    const store = createContextStore({ dir });
    const phase = definePhase('only', async (ctx) => {
      try {
        ctx.contextStore.register('only-out', z.unknown());
      } catch {
        // already registered
      }
      const id = await ctx.contextStore.put(
        'only-out',
        { iter: ctx.iteration },
        {
          parents: [ctx.runId],
        },
      );
      const rec = await ctx.contextStore.get(id);
      if (rec === null) throw new Error('vanished');
      return { status: 'fail', records: [rec] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 3 },
    });
    expect(report.status).toBe('no-converge');
    expect(report.iterationCount).toBe(3);

    const phaseRecs = await store.list({ type: 'factory-phase' });
    expect(phaseRecs.length).toBe(3);
    for (const rec of phaseRecs) {
      // Every iteration's factory-phase has parents === [runId] — no leak from ctx.inputs.
      expect(rec.parents).toEqual([report.runId]);
    }
  });
});

describe('run() — v0.0.3 whole-run cost cap', () => {
  function makeImplementProducer(tokens: { input: number; output: number }) {
    return definePhase('implement', async (ctx) => {
      try {
        ctx.contextStore.register(
          'factory-implement-report',
          z
            .object({ tokens: z.object({ input: z.number(), output: z.number() }).passthrough() })
            .passthrough(),
        );
      } catch {
        // already registered (across run() calls in the same store)
      }
      const id = await ctx.contextStore.put(
        'factory-implement-report',
        {
          specId: ctx.spec.frontmatter.id,
          iteration: ctx.iteration,
          startedAt: new Date().toISOString(),
          durationMs: 1,
          cwd: '/tmp',
          prompt: 'p',
          allowedTools: 'Read',
          claudePath: 'claude',
          status: 'pass',
          exitCode: 0,
          result: '',
          filesChanged: [],
          toolsUsed: [],
          tokens: { ...tokens, total: tokens.input + tokens.output },
        },
        { parents: [ctx.runId] },
      );
      const rec = await ctx.contextStore.get(id);
      if (rec === null) throw new Error('vanished');
      return { status: 'fail', records: [rec] };
    });
  }

  test('tokens accumulate across iterations; overrun throws RuntimeError caught + persisted as factory-phase status=error', async () => {
    const store = createContextStore({ dir });
    // Each iter: 200k input + 50k output = 250k. Cap = 400k → trips on iter 2 (running_total=500k > 400k).
    const phase = makeImplementProducer({ input: 200_000, output: 50_000 });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 5, maxTotalTokens: 400_000 },
    });

    expect(report.status).toBe('error');
    expect(report.iterationCount).toBe(2);

    const phaseRecs = await store.list({ type: 'factory-phase' });
    expect(phaseRecs.length).toBe(2);

    // iter 2 phase is the one with status='error' carrying the total-cost-cap-exceeded detail
    const iter2Phase = phaseRecs.find((r) => (r.payload as { iteration: number }).iteration === 2);
    expect(iter2Phase).toBeDefined();
    const iter2Payload = iter2Phase?.payload as {
      status: string;
      failureDetail?: string;
      outputRecordIds: string[];
    };
    expect(iter2Payload.status).toBe('error');
    expect(iter2Payload.failureDetail).toContain('runtime/total-cost-cap-exceeded');
    expect(iter2Payload.failureDetail).toContain('running_charged=500000');
    expect(iter2Payload.failureDetail).toContain('maxTotalTokens=400000');
    // The implement-report from iter 2 IS on disk (parents=[runId]) but factory-phase.outputRecordIds=[]
    expect(iter2Payload.outputRecordIds).toEqual([]);

    // The implement-report from iter 2 is reachable via runId parents.
    const implReports = await store.list({ type: 'factory-implement-report' });
    expect(implReports.length).toBe(2);
    for (const r of implReports) {
      expect(r.parents[0]).toBe(report.runId);
    }
  });

  test('cap NOT tripped: cumulative under cap → run continues normally', async () => {
    const store = createContextStore({ dir });
    const phase = makeImplementProducer({ input: 50_000, output: 50_000 });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 3, maxTotalTokens: 1_000_000 },
    });
    // 3 iterations × 100k = 300k cumulative, under 1M cap.
    expect(report.status).toBe('no-converge');
    expect(report.iterationCount).toBe(3);
  });

  test('default maxTotalTokens is 500_000 (cap trips around iter 5 with 100k/iter)', async () => {
    const store = createContextStore({ dir });
    const phase = makeImplementProducer({ input: 80_000, output: 30_000 });
    const graph = definePhaseGraph([phase], []);
    // 110k/iter with default 500k → cap trips when running_total>500k.
    // After iter 1: 110k. iter 2: 220k. iter 3: 330k. iter 4: 440k. iter 5: 550k > 500k → trips.
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 5 }, // maxTotalTokens not set → default 500k
    });
    expect(report.status).toBe('error');
    expect(report.iterationCount).toBe(5);
    const lastPhase = report.iterations[4]?.phases[0];
    expect(lastPhase?.status).toBe('error');
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

  test('run() with optional runParents arg threads them into factory-run.parents', async () => {
    const store = createContextStore({ dir });
    // Write two real parent records first so the context store's parent
    // existence check accepts them as runParents.
    store.register('synthetic-parent', z.unknown());
    const parentX = await store.put('synthetic-parent', { tag: 'x' }, { parents: [] });
    const parentY = await store.put('synthetic-parent', { tag: 'y' }, { parents: [] });
    const phase = makeSyntheticPhase({ name: 'p', type: 'p-out', status: 'pass' });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      runParents: [parentX, parentY],
    });
    const runRec = await store.get(report.runId);
    expect(runRec?.parents).toEqual([parentX, parentY]);
  });

  test('run() without runParents persists factory-run with parents=[]', async () => {
    const store = createContextStore({ dir });
    const phase = makeSyntheticPhase({ name: 'p', type: 'p-out', status: 'pass' });
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });
    const runRec = await store.get(report.runId);
    expect(runRec?.parents).toEqual([]);
  });

  test("v0.0.9: run() resolves maxAgentTimeoutMs from spec.frontmatter['agent-timeout-ms'] when set", async () => {
    const store = createContextStore({ dir });
    let seenMaxAgentTimeoutMs: number | undefined;
    const phase = definePhase('p', async (ctx) => {
      seenMaxAgentTimeoutMs = ctx.maxAgentTimeoutMs;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    const spec: Spec = {
      ...makeSpec(),
      frontmatter: { ...makeSpec().frontmatter, 'agent-timeout-ms': 1_200_000 },
    };
    await run({ spec, graph, contextStore: store });
    expect(seenMaxAgentTimeoutMs).toBe(1_200_000);
  });

  test("v0.0.9: run() lets RunOptions.maxAgentTimeoutMs override spec.frontmatter['agent-timeout-ms']", async () => {
    const store = createContextStore({ dir });
    let seenMaxAgentTimeoutMs: number | undefined;
    const phase = definePhase('p', async (ctx) => {
      seenMaxAgentTimeoutMs = ctx.maxAgentTimeoutMs;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    const spec: Spec = {
      ...makeSpec(),
      frontmatter: { ...makeSpec().frontmatter, 'agent-timeout-ms': 1_200_000 },
    };
    await run({
      spec,
      graph,
      contextStore: store,
      options: { maxAgentTimeoutMs: 1_800_000 },
    });
    expect(seenMaxAgentTimeoutMs).toBe(1_800_000);
  });

  test('v0.0.9: run() falls back to 600_000 when neither spec frontmatter nor RunOptions sets it', async () => {
    const store = createContextStore({ dir });
    let seenMaxAgentTimeoutMs: number | undefined;
    const phase = definePhase('p', async (ctx) => {
      seenMaxAgentTimeoutMs = ctx.maxAgentTimeoutMs;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    await run({ spec: makeSpec(), graph, contextStore: store });
    expect(seenMaxAgentTimeoutMs).toBe(600_000);
  });

  test('v0.0.9: run() with only RunOptions.maxAgentTimeoutMs set uses that value (existing v0.0.6 behavior)', async () => {
    const store = createContextStore({ dir });
    let seenMaxAgentTimeoutMs: number | undefined;
    const phase = definePhase('p', async (ctx) => {
      seenMaxAgentTimeoutMs = ctx.maxAgentTimeoutMs;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxAgentTimeoutMs: 900_000 },
    });
    expect(seenMaxAgentTimeoutMs).toBe(900_000);
  });

  test('RunReport.chargedTokens is the budget-relevant total', async () => {
    const store = createContextStore({ dir });
    const phase = definePhase('p', async (ctx) => {
      try {
        ctx.contextStore.register('factory-implement-report', z.unknown());
      } catch {
        // already registered
      }
      // 8000 input + 2000 output + 30000 cache-read = SDK total 40000.
      // charged === input + output === 10000.
      const recId = await ctx.contextStore.put(
        'factory-implement-report',
        {
          tokens: { input: 8000, output: 2000, charged: 10000, cacheRead: 30000, total: 40000 },
        },
        { parents: [] },
      );
      const rec = await ctx.contextStore.get(recId);
      return { status: 'pass', records: rec === null ? [] : [rec] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });
    expect(report.chargedTokens).toBe(10_000);
  });

  test('RunReport.totalTokens still exists as deprecated alias for back-compat', async () => {
    const store = createContextStore({ dir });
    const phase = definePhase('p', async (ctx) => {
      try {
        ctx.contextStore.register('factory-implement-report', z.unknown());
      } catch {
        // already registered
      }
      const recId = await ctx.contextStore.put(
        'factory-implement-report',
        { tokens: { input: 50, output: 50 } },
        { parents: [] },
      );
      const rec = await ctx.contextStore.get(recId);
      return { status: 'pass', records: rec === null ? [] : [rec] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });
    expect(report.totalTokens).toBe(100);
    expect(report.chargedTokens).toBe(100);
    // Deprecated alias holds the same value as the canonical field.
    expect(report.totalTokens).toBe(report.chargedTokens);
  });

  test('cost cap enforcement uses tokens.charged not tokens.total', async () => {
    const store = createContextStore({ dir });
    // Per iter: 8000 input + 2000 output (charged=10000) + 30000 cache-read
    // (SDK total=40000). Cap = 10000 → at-or-below charged → must NOT trip.
    const phase = definePhase('implement', async (ctx) => {
      try {
        ctx.contextStore.register('factory-implement-report', z.unknown());
      } catch {
        // already registered
      }
      const id = await ctx.contextStore.put(
        'factory-implement-report',
        {
          tokens: { input: 8000, output: 2000, charged: 10000, cacheRead: 30000, total: 40000 },
        },
        { parents: [ctx.runId] },
      );
      const rec = await ctx.contextStore.get(id);
      if (rec === null) throw new Error('vanished');
      return { status: 'pass', records: [rec] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 1, maxTotalTokens: 10_000 },
    });
    // Cap is inclusive: charged === cap converges, doesn't error.
    expect(report.status).toBe('converged');
    expect(report.chargedTokens).toBe(10_000);
  });

  test('cost-cap-exceeded message names charged value', async () => {
    const store = createContextStore({ dir });
    // Per iter: charged=11000 > cap=10000 → trip.
    const phase = definePhase('implement', async (ctx) => {
      try {
        ctx.contextStore.register('factory-implement-report', z.unknown());
      } catch {
        // already registered
      }
      const id = await ctx.contextStore.put(
        'factory-implement-report',
        {
          tokens: { input: 9000, output: 2000, charged: 11000, cacheRead: 30000, total: 41000 },
        },
        { parents: [ctx.runId] },
      );
      const rec = await ctx.contextStore.get(id);
      if (rec === null) throw new Error('vanished');
      return { status: 'fail', records: [rec] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 1, maxTotalTokens: 10_000 },
    });
    expect(report.status).toBe('error');
    const phaseRecs = await store.list({ type: 'factory-phase' });
    const erroredPhase = phaseRecs.find(
      (r) => (r.payload as { status: string }).status === 'error',
    );
    const detail = (erroredPhase?.payload as { failureDetail?: string }).failureDetail;
    expect(detail).toContain('running_charged=11000');
    expect(detail).toContain('maxTotalTokens=10000');
    // The new format names the budget-relevant variable, not the cache-aware total.
    expect(detail).not.toContain('running_total=');
  });

  test('RunReport.totalTokens sums implement-report tokens across iterations', async () => {
    const store = createContextStore({ dir });
    const phase = definePhase('p', async (ctx) => {
      try {
        ctx.contextStore.register('factory-implement-report', z.unknown());
      } catch {
        // already registered
      }
      const recId = await ctx.contextStore.put(
        'factory-implement-report',
        { tokens: { input: 50, output: 50 } },
        { parents: [] },
      );
      const rec = await ctx.contextStore.get(recId);
      return { status: 'pass', records: rec === null ? [] : [rec] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });
    expect(report.totalTokens).toBe(100);
  });
});

// ----- v0.0.11: RunOptions.worktree + factory-context tree (S-3, S-4) ---

describe('run() — v0.0.11 RunOptions.worktree (S-3 + S-4)', () => {
  async function initGitRepo(d: string): Promise<void> {
    await Bun.$`git init -q ${d}`.quiet();
    await Bun.$`git -C ${d} config user.email "test@example.com"`.quiet();
    await Bun.$`git -C ${d} config user.name "test"`.quiet();
    await Bun.$`git -C ${d} config commit.gpgsign false`.quiet();
    await Bun.write(join(d, 'README.md'), '# fixture\n');
    await Bun.$`git -C ${d} add -A`.quiet();
    await Bun.$`git -C ${d} commit -q -m "init"`.quiet();
  }

  test('RunOptions.worktree=true creates worktree at default root', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'wt-rotr-default-'));
    try {
      await initGitRepo(projectRoot);
      const prevCwd = process.cwd();
      process.chdir(projectRoot);
      try {
        const store = createContextStore({ dir });
        let observedCwd: string | undefined;
        const phase = definePhase('p', async (ctx) => {
          observedCwd = ctx.cwd;
          return { status: 'pass', records: [] };
        });
        const graph = definePhaseGraph([phase], []);
        const report = await run({
          spec: makeSpec(),
          graph,
          contextStore: store,
          options: { worktree: true },
        });
        expect(report.status).toBe('converged');
        // Default root: <projectRoot>/.factory/worktrees/<runId>/
        expect(observedCwd).toBeDefined();
        if (observedCwd === undefined) return;
        expect(observedCwd.endsWith(`.factory/worktrees/${report.runId}`)).toBe(true);
      } finally {
        process.chdir(prevCwd);
      }
    } finally {
      await Bun.$`rm -rf ${projectRoot}`.quiet().nothrow();
    }
  });

  test('RunOptions.worktree.rootDir overrides default root', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'wt-rotr-override-'));
    const altRoot = mkdtempSync(join(tmpdir(), 'wt-altroot-'));
    try {
      await initGitRepo(projectRoot);
      const store = createContextStore({ dir });
      let observedCwd: string | undefined;
      const phase = definePhase('p', async (ctx) => {
        observedCwd = ctx.cwd;
        return { status: 'pass', records: [] };
      });
      const graph = definePhaseGraph([phase], []);
      const report = await run({
        spec: makeSpec(),
        graph,
        contextStore: store,
        options: { worktree: { projectRoot, rootDir: altRoot } },
      });
      expect(observedCwd).toBe(join(altRoot, report.runId));
    } finally {
      // Best-effort prune; the worktree was created under altRoot.
      await Bun.$`rm -rf ${projectRoot} ${altRoot}`.quiet().nothrow();
    }
  });

  test('RunOptions.worktree=undefined preserves v0.0.10 behavior', async () => {
    const store = createContextStore({ dir });
    let observedCwd: string | undefined;
    const phase = definePhase('p', async (ctx) => {
      observedCwd = ctx.cwd;
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({ spec: makeSpec(), graph, contextStore: store });
    expect(report.status).toBe('converged');
    // No ctx.cwd injected; phases fall back to their own opts.cwd / process.cwd().
    expect(observedCwd).toBeUndefined();

    // No factory-worktree record produced.
    const wtRecs = await store.list({ type: 'factory-worktree' });
    expect(wtRecs.length).toBe(0);
  });

  test('factory-worktree is reachable via factory-context tree --direction down <runId>', async () => {
    // S-4 — the factory-worktree record's parents include the runId so a
    // down-walk from factory-run reaches it as a sibling of factory-phase.
    const projectRoot = mkdtempSync(join(tmpdir(), 'wt-tree-down-'));
    try {
      await initGitRepo(projectRoot);
      const store = createContextStore({ dir });
      const phase = definePhase('p', async () => ({ status: 'pass', records: [] }));
      const graph = definePhaseGraph([phase], []);
      const report = await run({
        spec: makeSpec(),
        graph,
        contextStore: store,
        options: { worktree: { projectRoot } },
      });
      expect(report.status).toBe('converged');

      // Walk down from runId: collect descendants whose parents include runId.
      const all = await store.list({});
      const descendants = all.filter((r) => r.parents.includes(report.runId));
      const types = descendants.map((r) => r.type).sort();
      // factory-phase + factory-worktree are both descendants of factory-run.
      expect(types).toContain('factory-phase');
      expect(types).toContain('factory-worktree');

      const wtRec = descendants.find((r) => r.type === 'factory-worktree');
      expect(wtRec).toBeDefined();
      const payload = wtRec?.payload as { runId: string; status: string };
      expect(payload.runId).toBe(report.runId);
      expect(['converged', 'no-converge', 'error']).toContain(payload.status);
    } finally {
      await Bun.$`rm -rf ${projectRoot}`.quiet().nothrow();
    }
  });
});

// ----- v0.0.10: H-3 — factory-dod-report walks via tree (descendant) -----

describe('run() — v0.0.10 H-3 dod-report tree descent', () => {
  test('factory-dod-report is a descendant of factory-run via factory-phase', async () => {
    const store = createContextStore({ dir });
    const specSource = [
      '---',
      'id: dod-tree-spec',
      'classification: light',
      'type: feat',
      'status: ready',
      '---',
      '',
      '# dod-tree-spec',
      '',
      '## Intent',
      'Test fixture spec.',
      '',
      '## Scenarios',
      '**S-1** — passes',
      '  Given a',
      '  When b',
      '  Then c',
      '',
      '## Definition of Done',
      '',
      '- All scenarios pass.',
      '',
    ].join('\n');
    const spec = parseSpec(specSource);

    const validate = validatePhase({ noJudge: true });
    const dod = dodPhase({ noJudge: true });
    const graph = definePhaseGraph([validate, dod], [['validate', 'dod']]);
    const report = await run({ spec, graph, contextStore: store });
    expect(report.status).toBe('converged');

    // Walk descendants: factory-run → factory-phase → factory-dod-report.
    // We list all records and check parents linkage.
    const allRecords = await store.list({});
    const runRecords = allRecords.filter((r: ContextRecord) => r.type === 'factory-run');
    expect(runRecords).toHaveLength(1);
    const runRec = runRecords[0];
    expect(runRec).toBeDefined();
    if (runRec === undefined) return;

    const phaseRecords = allRecords.filter(
      (r: ContextRecord) => r.type === 'factory-phase' && r.parents.includes(runRec.id),
    );
    const phaseNames = phaseRecords
      .map((r: ContextRecord) => (r.payload as { phaseName?: string }).phaseName)
      .sort();
    expect(phaseNames).toEqual(['dod', 'validate']);

    const dodPhaseRec = phaseRecords.find(
      (r: ContextRecord) => (r.payload as { phaseName?: string }).phaseName === 'dod',
    );
    expect(dodPhaseRec).toBeDefined();
    if (dodPhaseRec === undefined) return;

    // The dod-report is reachable from the dod phase record's outputRecordIds
    // AND its parents include the run id (per dodPhase's persist contract).
    const dodOutputIds = (dodPhaseRec.payload as { outputRecordIds: string[] }).outputRecordIds;
    expect(dodOutputIds.length).toBe(1);
    const dodReport = allRecords.find((r: ContextRecord) => r.id === dodOutputIds[0]);
    expect(dodReport).toBeDefined();
    expect(dodReport?.type).toBe('factory-dod-report');
    expect(dodReport?.parents).toContain(runRec.id);
  });
});

// ----- v0.0.12: observability — phase progress + cause-of-iteration + warning -

describe('run() — v0.0.12 progress lines (S-1, S-2, S-3)', () => {
  function captureLog(): { log: (line: string) => void; lines: string[] } {
    const lines: string[] = [];
    return { log: (line) => lines.push(line), lines };
  }

  function makeValidatePhase(opts: {
    name?: string;
    failedScenarios?: string[];
    totalScenarios?: number;
    iterByCall?: { failed: string[]; total: number }[];
  }) {
    let call = 0;
    const phaseName = opts.name ?? 'validate';
    return definePhase(phaseName, async (ctx) => {
      try {
        ctx.contextStore.register('factory-validate-report', z.unknown());
      } catch {
        // already registered
      }
      const conf = opts.iterByCall?.[call] ?? {
        failed: opts.failedScenarios ?? [],
        total: opts.totalScenarios ?? opts.failedScenarios?.length ?? 0,
      };
      call++;
      const failed = conf.failed;
      const total = conf.total;
      const passCount = Math.max(0, total - failed.length);
      const scenarios: { scenarioId: string; status: string }[] = [];
      for (let i = 0; i < passCount; i++) {
        scenarios.push({ scenarioId: `S-pass-${i}`, status: 'pass' });
      }
      for (const id of failed) scenarios.push({ scenarioId: id, status: 'fail' });
      const status = failed.length === 0 ? 'pass' : 'fail';
      const id = await ctx.contextStore.put(
        'factory-validate-report',
        {
          specId: ctx.spec.frontmatter.id,
          startedAt: new Date().toISOString(),
          durationMs: 1,
          scenarios,
          summary: { pass: passCount, fail: failed.length, error: 0, skipped: 0 },
          status,
        },
        { parents: [ctx.runId] },
      );
      const rec = await ctx.contextStore.get(id);
      if (rec === null) throw new Error('vanished');
      return { status, records: [rec] };
    });
  }

  function makeDodPhase(opts: { status?: 'pass' | 'fail'; failedGates?: string[] }) {
    return definePhase('dod', async (ctx) => {
      try {
        ctx.contextStore.register('factory-dod-report', z.unknown());
      } catch {
        // already registered
      }
      const failed = opts.failedGates ?? [];
      const status: 'pass' | 'fail' = opts.status ?? (failed.length === 0 ? 'pass' : 'fail');
      const bullets: {
        kind: 'shell';
        bullet: string;
        status: 'pass' | 'fail';
        command: string;
        durationMs: number;
      }[] = [];
      if (status === 'pass' && failed.length === 0) {
        bullets.push({
          kind: 'shell',
          bullet: '- `pass`',
          status: 'pass',
          command: 'pass',
          durationMs: 1,
        });
      }
      for (const cmd of failed) {
        bullets.push({
          kind: 'shell',
          bullet: `- \`${cmd}\``,
          status: 'fail',
          command: cmd,
          durationMs: 1,
        });
      }
      const id = await ctx.contextStore.put(
        'factory-dod-report',
        {
          specId: ctx.spec.frontmatter.id,
          iteration: ctx.iteration,
          startedAt: new Date().toISOString(),
          durationMs: 1,
          bullets,
          summary: {
            pass: bullets.filter((b) => b.status === 'pass').length,
            fail: bullets.filter((b) => b.status === 'fail').length,
            error: 0,
            skipped: 0,
          },
          status,
        },
        { parents: [ctx.runId] },
      );
      const rec = await ctx.contextStore.get(id);
      if (rec === null) throw new Error('vanished');
      return { status, records: [rec] };
    });
  }

  function makeImplementPhase() {
    return definePhase('implement', async (ctx) => {
      try {
        ctx.contextStore.register('factory-implement-report', z.unknown());
      } catch {
        // already registered
      }
      const id = await ctx.contextStore.put(
        'factory-implement-report',
        {
          specId: ctx.spec.frontmatter.id,
          iteration: ctx.iteration,
          startedAt: new Date().toISOString(),
          durationMs: 1,
          cwd: '/tmp',
          prompt: 'p',
          allowedTools: 'Read',
          claudePath: 'claude',
          status: 'pass',
          exitCode: 0,
          result: '',
          filesChanged: [{ path: 'a.ts', diff: '+a' }],
          toolsUsed: [],
          tokens: { input: 100, output: 50, charged: 150, total: 150 },
        },
        { parents: [ctx.runId] },
      );
      const rec = await ctx.contextStore.get(id);
      if (rec === null) throw new Error('vanished');
      return { status: 'pass', records: [rec] };
    });
  }

  test('iter N+1 start emits cause-of-iteration line built from prior validate + dod reports', async () => {
    const store = createContextStore({ dir });
    const cap = captureLog();
    // Iter 1: validate fails [S-2], dod passes. Iter 2: validate passes (converges).
    const validate = makeValidatePhase({
      iterByCall: [
        { failed: ['S-2'], total: 3 },
        { failed: [], total: 3 },
      ],
    });
    const dod = makeDodPhase({ status: 'pass' });
    const graph = definePhaseGraph([validate, dod], [['validate', 'dod']]);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 3, log: cap.log },
    });
    expect(report.iterationCount).toBeGreaterThanOrEqual(2);
    const causeLine = cap.lines.find((l) =>
      l.startsWith('[runtime] iter 2 implement (start) — retrying:'),
    );
    expect(causeLine).toBeDefined();
    expect(causeLine).toContain('1 failed scenario (S-2)');
    expect(causeLine).toContain('0 failed dod gates');
  });

  test('cause-of-iteration falls back to implement-failed message when validate did not run in prior iter', async () => {
    const store = createContextStore({ dir });
    const cap = captureLog();
    let calls = 0;
    // A single root phase that emits a factory-implement-report and fails;
    // validate does not run (no validate in graph).
    const onlyPhase = definePhase('implement', async (ctx) => {
      try {
        ctx.contextStore.register('factory-implement-report', z.unknown());
      } catch {
        // already registered
      }
      calls++;
      const id = await ctx.contextStore.put(
        'factory-implement-report',
        {
          specId: ctx.spec.frontmatter.id,
          iteration: ctx.iteration,
          startedAt: new Date().toISOString(),
          durationMs: 1,
          cwd: '/tmp',
          prompt: 'p',
          allowedTools: 'Read',
          claudePath: 'claude',
          status: 'fail',
          exitCode: 0,
          result: '',
          filesChanged: [],
          toolsUsed: [],
          tokens: { input: 1, output: 1, charged: 2, total: 2 },
        },
        { parents: [ctx.runId] },
      );
      const rec = await ctx.contextStore.get(id);
      if (rec === null) throw new Error('vanished');
      return { status: calls < 2 ? 'fail' : 'pass', records: [rec] };
    });
    const graph = definePhaseGraph([onlyPhase], []);
    await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 3, log: cap.log },
    });
    const causeLine = cap.lines.find((l) =>
      l.startsWith('[runtime] iter 2 implement (start) — retrying:'),
    );
    expect(causeLine).toBeDefined();
    expect(causeLine).toContain('prior implement phase failed');
    expect(causeLine).toContain('factory-implement-report ');
  });

  test('phase boundaries emit start + end stderr lines with timing and counts', async () => {
    const store = createContextStore({ dir });
    const cap = captureLog();
    const implement = makeImplementPhase();
    const validate = makeValidatePhase({ failedScenarios: [], totalScenarios: 2 });
    const dod = makeDodPhase({ status: 'pass' });
    const graph = definePhaseGraph(
      [implement, validate, dod],
      [
        ['implement', 'validate'],
        ['validate', 'dod'],
      ],
    );
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 1, log: cap.log },
    });
    expect(report.status).toBe('converged');

    // Six lines: start + end for each of implement, validate, dod.
    const startLines = cap.lines.filter((l) => /^\[runtime\] iter 1 \w+ \(start\) —/.test(l));
    expect(startLines.length).toBe(3);

    const endRe = /^\[runtime\] iter 1 \w+ \(\d+s, \d+ charged tokens/;
    const endLines = cap.lines.filter((l) => endRe.test(l));
    expect(endLines.length).toBe(3);

    expect(
      cap.lines.some((l) => l.includes('iter 1 implement (start)') && l.includes('runId=')),
    ).toBe(true);
    expect(
      cap.lines.some((l) =>
        /\[runtime\] iter 1 implement \(\d+s, \d+ charged tokens, 1 files changed\)/.test(l),
      ),
    ).toBe(true);
    expect(
      cap.lines.some((l) =>
        /\[runtime\] iter 1 validate \(\d+s, \d+ charged tokens, 2\/2 scenarios pass\)/.test(l),
      ),
    ).toBe(true);
    expect(
      cap.lines.some((l) =>
        /\[runtime\] iter 1 dod \(\d+s, \d+ charged tokens, 1\/1 dod gates pass\)/.test(l),
      ),
    ).toBe(true);
  });

  test('--quiet (RunOptions.quiet=true) suppresses ALL [runtime] progress + cause-of-iteration + warning', async () => {
    const store = createContextStore({ dir });
    const cap = captureLog();
    // Build a graph that would trigger a cause-of-iteration line AND warning
    // (DoD pass + identical validate fails twice).
    const validate = makeValidatePhase({
      iterByCall: [
        { failed: ['S-2', 'S-5'], total: 5 },
        { failed: ['S-2', 'S-5'], total: 5 },
        { failed: [], total: 5 },
      ],
    });
    const dod = makeDodPhase({ status: 'pass' });
    const graph = definePhaseGraph([validate, dod], [['validate', 'dod']]);
    await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 3, log: cap.log, quiet: true },
    });
    const runtimeLines = cap.lines.filter((l) => l.startsWith('[runtime]'));
    expect(runtimeLines).toEqual([]);
  });

  test('monotonic DoD-pass + identical validate-fail emits warning once at iter N+1 start', async () => {
    const store = createContextStore({ dir });
    const cap = captureLog();
    const validate = makeValidatePhase({
      iterByCall: [
        { failed: ['S-2', 'S-5'], total: 5 },
        { failed: ['S-2', 'S-5'], total: 5 },
        { failed: ['S-2', 'S-5'], total: 5 },
      ],
    });
    const dod = makeDodPhase({ status: 'pass' });
    const graph = definePhaseGraph([validate, dod], [['validate', 'dod']]);
    await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 3, log: cap.log },
    });
    const warningLines = cap.lines.filter((l) => l.startsWith('[runtime] WARNING:'));
    expect(warningLines.length).toBe(1);
    const w = warningLines[0];
    expect(w).toContain('DoD passing + validate fails identical across iter 1/2');
    expect(w).toContain('S-2, S-5');
    expect(w).toContain('--prefer-dod');
  });

  test('post-convergence stdout hint references factory finish-task <spec-id>', async () => {
    const store = createContextStore({ dir });
    const stdoutLines: string[] = [];
    const phase = definePhase('p', async () => ({ status: 'pass', records: [] }));
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec('my-spec-id'),
      graph,
      contextStore: store,
      options: {
        stdoutLog: (line: string) => stdoutLines.push(line),
      },
    });
    expect(report.status).toBe('converged');
    const hint = stdoutLines.find((l) => l.includes('factory finish-task'));
    expect(hint).toBeDefined();
    expect(hint).toContain('my-spec-id converged');
    expect(hint).toContain("'factory finish-task my-spec-id'");
  });

  test('post-convergence hint NOT emitted on no-converge or error', async () => {
    const store = createContextStore({ dir });
    const stdoutLines: string[] = [];
    const phase = definePhase('p', async () => ({ status: 'fail', records: [] }));
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec('flaky'),
      graph,
      contextStore: store,
      options: {
        maxIterations: 1,
        stdoutLog: (line: string) => stdoutLines.push(line),
      },
    });
    expect(report.status).toBe('no-converge');
    expect(stdoutLines.find((l) => l.includes('factory finish-task'))).toBeUndefined();
  });

  test('no warning when failed-scenario set differs between iterations', async () => {
    const store = createContextStore({ dir });
    const cap = captureLog();
    const validate = makeValidatePhase({
      iterByCall: [
        { failed: ['S-2'], total: 5 },
        { failed: ['S-3'], total: 5 },
        { failed: [], total: 5 },
      ],
    });
    const dod = makeDodPhase({ status: 'pass' });
    const graph = definePhaseGraph([validate, dod], [['validate', 'dod']]);
    await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { maxIterations: 3, log: cap.log },
    });
    const warningLines = cap.lines.filter((l) => l.startsWith('[runtime] WARNING:'));
    expect(warningLines.length).toBe(0);
  });
});

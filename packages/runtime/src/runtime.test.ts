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
    expect(iter2Payload.failureDetail).toContain('running_total=500000');
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

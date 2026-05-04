import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ContextRecord, createContextStore, listRecords } from '@wifo/factory-context';
import { RuntimeError } from './errors.js';
import { definePhase, definePhaseGraph } from './graph.js';
import { runSequence } from './sequence.js';
import type { PhaseContext, PhaseResult, PhaseStatus } from './types.js';

let workDir: string;
let ctxDir: string;
let specsDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'seq-'));
  ctxDir = mkdtempSync(join(tmpdir(), 'seq-ctx-'));
  specsDir = mkdtempSync(join(tmpdir(), 'seq-specs-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${workDir} ${ctxDir} ${specsDir}`.quiet().nothrow();
});

function specSource(id: string, deps: string[] = []): string {
  const depsLine =
    deps.length === 0 ? '' : `depends-on:\n${deps.map((d) => `  - ${d}`).join('\n')}\n`;
  return [
    '---',
    `id: ${id}`,
    'classification: light',
    'type: feat',
    'status: ready',
    depsLine.replace(/\n$/, ''),
    '---',
    '',
    `# ${id}`,
    '',
    '## Intent',
    'Test fixture spec.',
    '',
    '## Scenarios',
    '**S-1** — passes',
    '  Given a',
    '  When b',
    '  Then c',
    '  Satisfaction:',
    '    - test: nope.test.ts',
    '',
    '## Definition of Done',
    '- ok',
    '',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
}

function writeSpec(id: string, deps: string[] = []): void {
  writeFileSync(join(specsDir, `${id}.md`), specSource(id, deps));
}

/**
 * Build a `[passOrFail]` synthetic phase graph that always returns the given
 * status without spawning real harness/agent. Each phase invocation may also
 * publish a fake implement-report-style record for token accounting.
 */
function makeSyntheticGraph(opts: { status?: PhaseStatus; tokens?: number } = {}) {
  const status = opts.status ?? 'pass';
  const tokens = opts.tokens ?? 0;
  const phase = definePhase('validate', async (ctx: PhaseContext): Promise<PhaseResult> => {
    if (tokens > 0) {
      try {
        ctx.contextStore.register('factory-implement-report', (await import('zod')).z.unknown());
      } catch {
        // already registered.
      }
      const recId = await ctx.contextStore.put(
        'factory-implement-report',
        {
          tokens: { input: tokens, output: 0 },
        },
        { parents: [] },
      );
      const rec = await ctx.contextStore.get(recId);
      return { status, records: rec === null ? [] : [rec] };
    }
    return { status, records: [] };
  });
  return definePhaseGraph([phase], []);
}

describe('runSequence — happy path', () => {
  test('run-sequence executes specs in topological order; root sequence record + parented per-spec runs persisted', async () => {
    writeSpec('a');
    writeSpec('b', ['a']);
    writeSpec('c', ['a', 'b']);
    const store = createContextStore({ dir: ctxDir });
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store,
      options: { maxIterations: 1 },
    });
    expect(report.status).toBe('converged');
    expect(report.topoOrder).toEqual(['a', 'b', 'c']);
    expect(report.specs).toHaveLength(3);
    for (const s of report.specs) {
      expect(s.status).toBe('converged');
    }
    // Verify the persisted DAG: 1 factory-sequence record + 3 factory-run records.
    const all: ContextRecord[] = (await listRecords(ctxDir)).records;
    const sequenceRecs = all.filter((r) => r.type === 'factory-sequence');
    expect(sequenceRecs).toHaveLength(1);
    expect(sequenceRecs[0]?.id).toBe(report.factorySequenceId);
    const runRecs = all.filter((r) => r.type === 'factory-run');
    expect(runRecs).toHaveLength(3);
    for (const r of runRecs) {
      expect(r.parents).toContain(report.factorySequenceId);
    }
  });

  test('topoOrder ties broken alphabetically by id', async () => {
    // diamond: core, then b/d at same depth (depend on core), then leaf depends on both.
    writeSpec('core');
    writeSpec('beta', ['core']);
    writeSpec('delta', ['core']);
    writeSpec('leaf', ['beta', 'delta']);
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1 },
    });
    expect(report.topoOrder[0]).toBe('core');
    expect(report.topoOrder[3]).toBe('leaf');
    // beta and delta are interchangeable in valid topo orders, but Kahn's
    // alphabetic tie-break makes 'beta' < 'delta'.
    expect(report.topoOrder[1]).toBe('beta');
    expect(report.topoOrder[2]).toBe('delta');
  });
});

describe('runSequence — DAG validation', () => {
  test('run-sequence rejects 2-cycle with runtime/sequence-cycle', async () => {
    writeSpec('a', ['b']);
    writeSpec('b', ['a']);
    let caught: RuntimeError | null = null;
    try {
      await runSequence({
        specsDir,
        graph: makeSyntheticGraph(),
        contextStore: createContextStore({ dir: ctxDir }),
      });
    } catch (e) {
      caught = e as RuntimeError;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    if (!caught) return;
    expect(caught.code).toBe('runtime/sequence-cycle');
    expect(caught.message).toContain('depends-on cycle:');
    expect(caught.message).toMatch(/a → b → a|b → a → b/);
  });

  test('run-sequence rejects missing depends-on target with runtime/sequence-dep-not-found', async () => {
    writeSpec('a', ['ghost']);
    let caught: RuntimeError | null = null;
    try {
      await runSequence({
        specsDir,
        graph: makeSyntheticGraph(),
        contextStore: createContextStore({ dir: ctxDir }),
      });
    } catch (e) {
      caught = e as RuntimeError;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    if (!caught) return;
    expect(caught.code).toBe('runtime/sequence-dep-not-found');
    expect(caught.message).toContain("spec 'a' depends on 'ghost'");
  });

  test('run-sequence reports cycle path in 3-cycle', async () => {
    writeSpec('a', ['b']);
    writeSpec('b', ['c']);
    writeSpec('c', ['a']);
    let caught: RuntimeError | null = null;
    try {
      await runSequence({
        specsDir,
        graph: makeSyntheticGraph(),
        contextStore: createContextStore({ dir: ctxDir }),
      });
    } catch (e) {
      caught = e as RuntimeError;
    }
    expect(caught?.code).toBe('runtime/sequence-cycle');
    expect(caught?.message).toMatch(/[abc] → [abc] → [abc] → [abc]/);
  });
});

describe('runSequence — failure cascade', () => {
  test('--continue-on-fail skips transitive dependents but runs independent roots', async () => {
    writeSpec('a');
    writeSpec('b', ['a']); // will fail (status: 'no-converge')
    writeSpec('c', ['b']); // skipped
    writeSpec('d'); // independent root — runs

    // Build a graph that fails for spec 'b' specifically.
    const phase = definePhase('validate', async (ctx: PhaseContext): Promise<PhaseResult> => {
      const failingId = ctx.spec.frontmatter.id === 'b';
      return { status: failingId ? 'fail' : 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);

    const store = createContextStore({ dir: ctxDir });
    const report = await runSequence({
      specsDir,
      graph,
      contextStore: store,
      options: { maxIterations: 1, continueOnFail: true },
    });
    expect(report.status).toBe('partial');
    const byId = new Map(report.specs.map((s) => [s.specId, s]));
    expect(byId.get('a')?.status).toBe('converged');
    expect(byId.get('b')?.status).toBe('no-converge');
    expect(byId.get('c')?.status).toBe('skipped');
    expect(byId.get('c')?.blockedBy).toBe('b');
    expect(byId.get('d')?.status).toBe('converged');
  });

  test('default (no --continue-on-fail) stops after first non-converging spec', async () => {
    writeSpec('a');
    writeSpec('b', ['a']); // fails
    writeSpec('c'); // independent root — would run if continueOnFail, doesn't otherwise
    writeSpec('d', ['c']);

    const phase = definePhase('validate', async (ctx: PhaseContext): Promise<PhaseResult> => {
      const failingId = ctx.spec.frontmatter.id === 'b';
      return { status: failingId ? 'fail' : 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);

    const report = await runSequence({
      specsDir,
      graph,
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1 },
    });
    expect(report.status).toBe('partial');
    const byId = new Map(report.specs.map((s) => [s.specId, s]));
    expect(byId.get('a')?.status).toBe('converged');
    expect(byId.get('b')?.status).toBe('no-converge');
    // c and d should be skipped (stop-on-fail aborted the loop).
    expect(byId.get('c')?.status).toBe('skipped');
    expect(byId.get('d')?.status).toBe('skipped');
  });
});

describe('runSequence — cost capping', () => {
  test('--max-sequence-tokens trips before invoking next spec when cumulative + next-cap exceeds limit', async () => {
    writeSpec('a');
    writeSpec('b', ['a']);
    writeSpec('c', ['b']);

    // Each spec's run consumes 100k tokens via the synthetic phase. Per-spec
    // cap is 500k by default.
    const graph = makeSyntheticGraph({ status: 'pass', tokens: 100_000 });
    let caught: RuntimeError | null = null;
    try {
      await runSequence({
        specsDir,
        graph,
        contextStore: createContextStore({ dir: ctxDir }),
        options: { maxIterations: 1, maxSequenceTokens: 250_000 },
      });
    } catch (e) {
      caught = e as RuntimeError;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect(caught?.code).toBe('runtime/sequence-cost-cap-exceeded');
    expect(caught?.message).toContain('maxSequenceTokens=250000');
  });

  test('--max-sequence-tokens above cumulative+cap allows all specs to run', async () => {
    writeSpec('a');
    writeSpec('b', ['a']);
    writeSpec('c', ['b']);
    const graph = makeSyntheticGraph({ status: 'pass', tokens: 100_000 });
    const report = await runSequence({
      specsDir,
      graph,
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1, maxSequenceTokens: 5_000_000 },
    });
    expect(report.status).toBe('converged');
    expect(report.specs).toHaveLength(3);
  });

  test('absent --max-sequence-tokens leaves sequence-level cap unbounded', async () => {
    writeSpec('a');
    writeSpec('b', ['a']);
    const graph = makeSyntheticGraph({ status: 'pass', tokens: 100_000 });
    const report = await runSequence({
      specsDir,
      graph,
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1 },
    });
    expect(report.status).toBe('converged');
    expect(report.totalTokens).toBe(200_000);
  });
});

describe('runSequence — provenance (S-5 / H-3)', () => {
  test('factory-run records from run-sequence have factorySequenceId in parents[]', async () => {
    writeSpec('a');
    const store = createContextStore({ dir: ctxDir });
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store,
      options: { maxIterations: 1 },
    });
    const all: ContextRecord[] = (await listRecords(ctxDir)).records;
    const runRecs = all.filter((r) => r.type === 'factory-run');
    expect(runRecs).toHaveLength(1);
    expect(runRecs[0]?.parents).toEqual([report.factorySequenceId]);
  });

  test('H-3: descendants of factorySequenceId include every per-spec run', async () => {
    writeSpec('a');
    writeSpec('b', ['a']);
    const store = createContextStore({ dir: ctxDir });
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store,
      options: { maxIterations: 1 },
    });
    const all: ContextRecord[] = (await listRecords(ctxDir)).records;
    const isDescendantOf = (id: string, ancestorId: string): boolean => {
      if (id === ancestorId) return true;
      const rec = all.find((r) => r.id === id);
      if (rec === undefined) return false;
      return rec.parents.some((p) => isDescendantOf(p, ancestorId));
    };
    const runRecs = all.filter((r) => r.type === 'factory-run');
    for (const r of runRecs) {
      expect(isDescendantOf(r.id, report.factorySequenceId)).toBe(true);
    }
    expect(runRecs).toHaveLength(2);
  });
});

// ----- v0.0.9: drafting filter (S-1) ------------------------------------

describe('runSequence — v0.0.9 drafting filter', () => {
  function specSourceWithStatus(
    id: string,
    status: 'ready' | 'drafting',
    deps: string[] = [],
  ): string {
    const depsLine =
      deps.length === 0 ? '' : `depends-on:\n${deps.map((d) => `  - ${d}`).join('\n')}\n`;
    return [
      '---',
      `id: ${id}`,
      'classification: light',
      'type: feat',
      `status: ${status}`,
      depsLine.replace(/\n$/, ''),
      '---',
      '',
      `# ${id}`,
      '',
      '## Intent',
      'Test fixture spec.',
      '',
      '## Scenarios',
      '**S-1** — passes',
      '  Given a',
      '  When b',
      '  Then c',
      '  Satisfaction:',
      '    - test: nope.test.ts',
      '',
      '## Definition of Done',
      '- ok',
      '',
    ]
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n');
  }
  function writeSpecStatus(id: string, status: 'ready' | 'drafting', deps: string[] = []): void {
    writeFileSync(join(specsDir, `${id}.md`), specSourceWithStatus(id, status, deps));
  }

  test('run-sequence default walks drafting specs dynamically (v0.0.11 default behavior change)', async () => {
    // v0.0.11: drafting specs are no longer skipped upfront. They get
    // promoted (drafting → ready, in-memory) as their deps converge. The
    // v0.0.9 "skipping <id> (status: drafting)" notice no longer fires in
    // default mode.
    writeSpecStatus('a', 'ready');
    writeSpecStatus('b', 'drafting', ['a']);
    writeSpecStatus('c', 'drafting', ['b']);
    const logs: string[] = [];
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1, skipLog: (line) => logs.push(line) },
    });
    expect(report.status).toBe('converged');
    expect(report.topoOrder).toEqual(['a', 'b', 'c']);
    expect(report.specs).toHaveLength(3);
    // No "skipping ... (status: drafting)" lines.
    expect(logs.some((l) => l.includes('skipping') && l.includes('drafting'))).toBe(false);
    // Promotion logs in dep order.
    expect(logs).toContain('factory-runtime: a converged → promoting b');
    expect(logs).toContain('factory-runtime: b converged → promoting c');
  });

  test('run-sequence --include-drafting walks every spec regardless of status', async () => {
    writeSpecStatus('a', 'ready');
    writeSpecStatus('b', 'drafting', ['a']);
    writeSpecStatus('c', 'drafting', ['b']);
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1, includeDrafting: true },
    });
    expect(report.status).toBe('converged');
    expect(report.topoOrder).toEqual(['a', 'b', 'c']);
    expect(report.specs).toHaveLength(3);
  });

  test('run-sequence with no ready specs exits with runtime/sequence-empty', async () => {
    writeSpecStatus('a', 'drafting');
    writeSpecStatus('b', 'drafting', ['a']);
    let caught: RuntimeError | null = null;
    try {
      await runSequence({
        specsDir,
        graph: makeSyntheticGraph({ status: 'pass' }),
        contextStore: createContextStore({ dir: ctxDir }),
        options: { maxIterations: 1 },
      });
    } catch (e) {
      caught = e as RuntimeError;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect(caught?.code).toBe('runtime/sequence-empty');
    expect(caught?.message).toContain('no specs with status: ready found in');
    expect(caught?.message).toContain('--include-drafting');
  });
});

// ----- v0.0.10: already-converged dedup (S-1) ---------------------------

describe('runSequence — v0.0.10 already-converged dedup', () => {
  test('runSequence skips already-converged specs scoped to specsDir', async () => {
    writeSpec('a');
    writeSpec('b', ['a']);
    const store = createContextStore({ dir: ctxDir });

    // First invocation runs both specs fresh.
    const first = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store,
      options: { maxIterations: 1 },
    });
    expect(first.status).toBe('converged');
    expect(first.specs).toHaveLength(2);
    const aRunIdFirst = first.specs.find((s) => s.specId === 'a')?.runReport?.runId;
    expect(aRunIdFirst).toBeDefined();

    // Snapshot factory-run count before re-invoking.
    const allBefore: ContextRecord[] = (await listRecords(ctxDir)).records;
    const runsBefore = allBefore.filter((r) => r.type === 'factory-run').length;
    expect(runsBefore).toBe(2);

    // Second invocation against the same specsDir + same context dir should
    // detect 'a' as already-converged and skip it. 'b' has no prior run
    // because we'll delete it... no wait — the spec says BOTH should be
    // skipped if both have prior converged runs. Per S-1: "spec a is detected
    // as already-converged ... spec b runs as normal" — that's because the
    // S-1 setup only seeds a prior run for 'a', not 'b'.
    //
    // To exercise that, we need a context dir with a prior run for 'a' but
    // not 'b'. That's exactly the state if we re-invoke immediately — both
    // have prior runs. So we set up the test differently: seed a prior run
    // for 'a' only via a separate sequence, then add b.md fresh.
    // The test above already established both. Now make a fresh ctx + seed
    // only 'a'.
    const ctxDir2 = mkdtempSync(join(tmpdir(), 'seq-ctx2-'));
    const specsDir2 = mkdtempSync(join(tmpdir(), 'seq-specs2-'));
    writeFileSync(join(specsDir2, 'a.md'), specSource('a'));
    const store2 = createContextStore({ dir: ctxDir2 });
    // Seed: run 'a' alone first.
    await runSequence({
      specsDir: specsDir2,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store2,
      options: { maxIterations: 1 },
    });
    const seedAll: ContextRecord[] = (await listRecords(ctxDir2)).records;
    const seedRunA = seedAll.find(
      (r) => r.type === 'factory-run' && (r.payload as { specId?: string }).specId === 'a',
    );
    expect(seedRunA).toBeDefined();
    const seedRunAId = seedRunA?.id;

    // Now add b.md and re-invoke.
    writeFileSync(join(specsDir2, 'b.md'), specSource('b', ['a']));
    const skips: string[] = [];
    const second = await runSequence({
      specsDir: specsDir2,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store2,
      options: { maxIterations: 1, skipLog: (line) => skips.push(line) },
    });
    expect(second.status).toBe('converged');
    expect(second.topoOrder).toEqual(['a', 'b']);
    const byId = new Map(second.specs.map((s) => [s.specId, s]));
    expect(byId.get('a')?.status).toBe('converged');
    expect(byId.get('a')?.runReport?.runId).toBe(seedRunAId);
    expect(byId.get('b')?.status).toBe('converged');
    // Skip log includes the already-converged notice for 'a'.
    expect(skips).toContain(`factory-runtime: a already converged in run ${seedRunAId} — skipping`);
    // Only one new factory-run was created for 'b' (no fresh run for 'a').
    const all2: ContextRecord[] = (await listRecords(ctxDir2)).records;
    const runRecs = all2.filter((r) => r.type === 'factory-run');
    // Two factory-run records total: the seed for 'a' + the new one for 'b'.
    expect(runRecs).toHaveLength(2);

    await Bun.$`rm -rf ${ctxDir2} ${specsDir2}`.quiet().nothrow();
  });

  test('runSequence does not skip when prior factory-run was for a different specsDir', async () => {
    // Seed a context dir by running 'a' against a DIFFERENT specsDir.
    const otherSpecsDir = mkdtempSync(join(tmpdir(), 'seq-other-specs-'));
    writeFileSync(join(otherSpecsDir, 'a.md'), specSource('a'));
    const store = createContextStore({ dir: ctxDir });
    const seed = await runSequence({
      specsDir: otherSpecsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store,
      options: { maxIterations: 1 },
    });
    expect(seed.status).toBe('converged');
    const seedAll: ContextRecord[] = (await listRecords(ctxDir)).records;
    const seedRunA = seedAll.find(
      (r) => r.type === 'factory-run' && (r.payload as { specId?: string }).specId === 'a',
    );
    expect(seedRunA).toBeDefined();
    const seedRunAId = seedRunA?.id;

    // Now run 'a' against `specsDir` (a different directory) — share the
    // same context dir but the prior factory-run was rooted under a sequence
    // for `otherSpecsDir`, so it should NOT skip.
    writeSpec('a');
    const skips: string[] = [];
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store,
      options: { maxIterations: 1, skipLog: (line) => skips.push(line) },
    });
    expect(report.status).toBe('converged');
    expect(report.specs).toHaveLength(1);
    const aResult = report.specs.find((s) => s.specId === 'a');
    expect(aResult?.status).toBe('converged');
    // The new run id is NOT the seed run id — fresh run was performed.
    expect(aResult?.runReport?.runId).toBeDefined();
    expect(aResult?.runReport?.runId).not.toBe(seedRunAId);
    // No "already converged" skip log.
    expect(skips.some((line) => line.includes('already converged'))).toBe(false);
    // Two factory-run records exist for 'a': one in each specsDir's lineage.
    const all: ContextRecord[] = (await listRecords(ctxDir)).records;
    const runsForA = all.filter(
      (r) => r.type === 'factory-run' && (r.payload as { specId?: string }).specId === 'a',
    );
    expect(runsForA).toHaveLength(2);

    await Bun.$`rm -rf ${otherSpecsDir}`.quiet().nothrow();
  });

  test('runSequence runs all specs fresh on first invocation against an empty context dir', async () => {
    writeSpec('a');
    writeSpec('b', ['a']);
    const skips: string[] = [];
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1, skipLog: (line) => skips.push(line) },
    });
    expect(report.status).toBe('converged');
    expect(report.specs).toHaveLength(2);
    for (const s of report.specs) {
      expect(s.status).toBe('converged');
    }
    // No "already converged" skip notices on first invocation.
    expect(skips.some((line) => line.includes('already converged'))).toBe(false);
    const all: ContextRecord[] = (await listRecords(ctxDir)).records;
    const runRecs = all.filter((r) => r.type === 'factory-run');
    expect(runRecs).toHaveLength(2);
  });
});

// ----- v0.0.10: done/ dep resolution (S-2) ------------------------------

describe('runSequence — v0.0.10 done/ dep resolution', () => {
  function writeDoneSpec(id: string, deps: string[] = []): void {
    const doneDir = join(specsDir, 'done');
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(join(doneDir, `${id}.md`), specSource(id, deps));
  }

  test('buildDag resolves depends-on against <dir>/done/ for already-shipped deps', async () => {
    writeSpec('b', ['a']);
    writeDoneSpec('a');
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1 },
    });
    expect(report.status).toBe('converged');
    // Only b is in topoOrder; a is dep-context only.
    expect(report.topoOrder).toEqual(['b']);
    expect(report.specs).toHaveLength(1);
    expect(report.specs[0]?.specId).toBe('b');
    expect(report.specs[0]?.status).toBe('converged');
    // No factory-run for 'a' because it wasn't executed.
    const all: ContextRecord[] = (await listRecords(ctxDir)).records;
    const runsForA = all.filter(
      (r) => r.type === 'factory-run' && (r.payload as { specId?: string }).specId === 'a',
    );
    expect(runsForA).toHaveLength(0);
  });

  test('done/ specs are excluded from topological execution order', async () => {
    writeSpec('current', ['shipped']);
    writeSpec('another', ['shipped']);
    writeDoneSpec('shipped');
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1 },
    });
    expect(report.status).toBe('converged');
    expect(report.topoOrder).toEqual(['another', 'current']);
    expect(report.specs).toHaveLength(2);
    const ids = report.specs.map((s) => s.specId).sort();
    expect(ids).toEqual(['another', 'current']);
    // 'shipped' is not in the report.
    expect(ids).not.toContain('shipped');
  });

  test('missing-dep error fires when dep is in neither <dir> nor <dir>/done/', async () => {
    writeSpec('b', ['ghost']);
    writeDoneSpec('a'); // exists but unrelated
    let caught: RuntimeError | null = null;
    try {
      await runSequence({
        specsDir,
        graph: makeSyntheticGraph({ status: 'pass' }),
        contextStore: createContextStore({ dir: ctxDir }),
        options: { maxIterations: 1 },
      });
    } catch (e) {
      caught = e as RuntimeError;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect(caught?.code).toBe('runtime/sequence-dep-not-found');
    expect(caught?.message).toContain("spec 'b' depends on 'ghost'");
  });
});

// ----- v0.0.11: dynamic DAG walk + drafting → ready promotion ------------

describe('runSequence — v0.0.11 dynamic DAG walk', () => {
  function specSourceWithStatus(
    id: string,
    status: 'ready' | 'drafting',
    deps: string[] = [],
  ): string {
    const depsLine =
      deps.length === 0 ? '' : `depends-on:\n${deps.map((d) => `  - ${d}`).join('\n')}\n`;
    return [
      '---',
      `id: ${id}`,
      'classification: light',
      'type: feat',
      `status: ${status}`,
      depsLine.replace(/\n$/, ''),
      '---',
      '',
      `# ${id}`,
      '',
      '## Intent',
      'Test fixture spec.',
      '',
      '## Scenarios',
      '**S-1** — passes',
      '  Given a',
      '  When b',
      '  Then c',
      '  Satisfaction:',
      '    - test: nope.test.ts',
      '',
      '## Definition of Done',
      '- ok',
      '',
    ]
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n');
  }
  function writeSpecStatus(id: string, status: 'ready' | 'drafting', deps: string[] = []): void {
    writeFileSync(join(specsDir, `${id}.md`), specSourceWithStatus(id, status, deps));
  }

  test('run-sequence dynamically promotes direct dependents on convergence in linear chain', async () => {
    // S-1 happy path: 1 ready + 3 drafting in a linear chain. Single
    // invocation runs all 4 in topological order via dynamic promotion.
    writeSpecStatus('a', 'ready');
    writeSpecStatus('b', 'drafting', ['a']);
    writeSpecStatus('c', 'drafting', ['b']);
    writeSpecStatus('d', 'drafting', ['c']);
    const logs: string[] = [];
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1, skipLog: (line) => logs.push(line) },
    });
    expect(report.status).toBe('converged');
    expect(report.specs).toHaveLength(4);
    expect(report.specs.map((s) => s.specId)).toEqual(['a', 'b', 'c', 'd']);
    for (const s of report.specs) expect(s.status).toBe('converged');
    expect(logs).toEqual([
      'factory-runtime: a converged → promoting b',
      'factory-runtime: b converged → promoting c',
      'factory-runtime: c converged → promoting d',
    ]);
  });

  test('failed prior spec stops promotion of its dependents', async () => {
    // S-1 failure cascade: a converges → b promoted → b fails (no-converge).
    // c and d are NEVER promoted (their deps never all converged) and are
    // therefore absent from specs[]. Default continueOnFail=false stops the
    // walk after b's failure too.
    writeSpecStatus('a', 'ready');
    writeSpecStatus('b', 'drafting', ['a']);
    writeSpecStatus('c', 'drafting', ['b']);
    writeSpecStatus('d', 'drafting', ['c']);

    const phase = definePhase('validate', async (ctx: PhaseContext): Promise<PhaseResult> => {
      return { status: ctx.spec.frontmatter.id === 'b' ? 'fail' : 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);

    const logs: string[] = [];
    const report = await runSequence({
      specsDir,
      graph,
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1, skipLog: (line) => logs.push(line) },
    });
    // 'b' failed → status is 'partial' (a converged, b didn't), exit-code-1
    // family in CLI but the report status here.
    expect(report.status).toBe('partial');
    const ids = report.specs.map((s) => s.specId);
    expect(ids).toEqual(['a', 'b']);
    const byId = new Map(report.specs.map((s) => [s.specId, s]));
    expect(byId.get('a')?.status).toBe('converged');
    expect(byId.get('b')?.status).toBe('no-converge');
    // c and d are absent — they were never promoted.
    expect(ids).not.toContain('c');
    expect(ids).not.toContain('d');
    // Only the 'a → promoting b' line appears (b's failure cancels c's promotion).
    expect(logs).toContain('factory-runtime: a converged → promoting b');
    expect(logs.some((l) => l.includes('promoting c'))).toBe(false);
    expect(logs.some((l) => l.includes('promoting d'))).toBe(false);
  });

  test('diamond DAG: dependent promoted only when all deps converged', async () => {
    // S-2 diamond: a → b, a → c, {b, c} → d. After a converges, both b and
    // c are promoted at once (alphabetic tie-break). After b converges, d's
    // deps aren't all converged yet (c missing). After c converges, d is
    // promoted. Final order: [a, b, c, d].
    writeSpecStatus('a', 'ready');
    writeSpecStatus('b', 'drafting', ['a']);
    writeSpecStatus('c', 'drafting', ['a']);
    writeSpecStatus('d', 'drafting', ['b', 'c']);

    const logs: string[] = [];
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1, skipLog: (line) => logs.push(line) },
    });
    expect(report.status).toBe('converged');
    expect(report.specs.map((s) => s.specId)).toEqual(['a', 'b', 'c', 'd']);
    // Promotion log: a triggers b AND c at once (both eligible). b's
    // convergence does NOT promote d (c not converged yet). c's convergence
    // promotes d.
    expect(logs).toEqual([
      'factory-runtime: a converged → promoting b',
      'factory-runtime: a converged → promoting c',
      'factory-runtime: c converged → promoting d',
    ]);
  });

  test('spec with 3 deps stays drafting until all 3 converge', async () => {
    // Variant: 3 ready roots (no deps) + 1 drafting spec depending on all 3.
    // The drafting spec should be promoted exactly once — when the third
    // (final) dep converges, not earlier.
    writeSpecStatus('a', 'ready');
    writeSpecStatus('b', 'ready');
    writeSpecStatus('c', 'ready');
    writeSpecStatus('d', 'drafting', ['a', 'b', 'c']);

    const logs: string[] = [];
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: { maxIterations: 1, skipLog: (line) => logs.push(line) },
    });
    expect(report.status).toBe('converged');
    expect(report.specs.map((s) => s.specId)).toEqual(['a', 'b', 'c', 'd']);
    // d is promoted exactly once, by the last converging dep (c).
    const promotionLines = logs.filter((l) => l.includes('promoting d'));
    expect(promotionLines).toEqual(['factory-runtime: c converged → promoting d']);
  });

  test('--include-drafting flag walks every spec from start; auto-promotion is a no-op', async () => {
    // S-3: --include-drafting preserves the v0.0.10 walk-everything-from-start
    // semantic. Drafting specs are routed to the `included` set by loadSpecs;
    // the runtime's draftingIds is empty; promotion is therefore a no-op.
    writeSpecStatus('a', 'ready');
    writeSpecStatus('b', 'drafting', ['a']);
    writeSpecStatus('c', 'drafting', ['b']);

    const logs: string[] = [];
    const report = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: createContextStore({ dir: ctxDir }),
      options: {
        maxIterations: 1,
        includeDrafting: true,
        skipLog: (line) => logs.push(line),
      },
    });
    expect(report.status).toBe('converged');
    expect(report.topoOrder).toEqual(['a', 'b', 'c']);
    expect(report.specs).toHaveLength(3);
    // Promotion log is silent under --include-drafting.
    expect(logs.some((l) => l.includes('promoting'))).toBe(false);
    // Skipping log is also silent (drafting routed to ready).
    expect(logs.some((l) => l.includes('skipping') && l.includes('drafting'))).toBe(false);
  });

  test('already-converged dedup + dynamic promotion compose: prior-converged specs trigger downstream promotion', async () => {
    // S-4: seed a context dir with a converged factory-run for spec 'a',
    // then re-invoke against (a + b drafting deps=[a] + c drafting deps=[b]).
    // 'a' is detected as already-converged (v0.0.10 dedup) AND triggers
    // promotion of 'b'. b runs, converges, triggers promotion of c.
    writeSpecStatus('a', 'ready');
    const store = createContextStore({ dir: ctxDir });

    // Seed: run 'a' alone first.
    await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store,
      options: { maxIterations: 1 },
    });
    const seedAll: ContextRecord[] = (await listRecords(ctxDir)).records;
    const seedRunA = seedAll.find(
      (r) => r.type === 'factory-run' && (r.payload as { specId?: string }).specId === 'a',
    );
    expect(seedRunA).toBeDefined();

    // Now add b.md + c.md (both drafting) and re-invoke.
    writeSpecStatus('b', 'drafting', ['a']);
    writeSpecStatus('c', 'drafting', ['b']);
    const logs: string[] = [];
    const second = await runSequence({
      specsDir,
      graph: makeSyntheticGraph({ status: 'pass' }),
      contextStore: store,
      options: { maxIterations: 1, skipLog: (line) => logs.push(line) },
    });
    expect(second.status).toBe('converged');
    expect(second.specs.map((s) => s.specId)).toEqual(['a', 'b', 'c']);
    // 'a' is detected as already-converged AND promotes 'b'; 'b' converges
    // and promotes 'c'. The dedup notice for 'a' AND the promotion lines
    // both appear via skipLog.
    expect(logs.some((l) => l.includes('a already converged'))).toBe(true);
    expect(logs).toContain('factory-runtime: a converged → promoting b');
    expect(logs).toContain('factory-runtime: b converged → promoting c');

    // Only 2 NEW factory-run records (b, c) were created; a was reused.
    const all: ContextRecord[] = (await listRecords(ctxDir)).records;
    const runRecs = all.filter((r) => r.type === 'factory-run');
    expect(runRecs).toHaveLength(3); // 1 seed (a) + 2 new (b, c)
  });
});

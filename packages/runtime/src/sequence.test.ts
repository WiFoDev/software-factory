import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

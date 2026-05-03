import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ContextError, type ContextStore } from '@wifo/factory-context';
import { type Spec, parseSpec } from '@wifo/factory-core';
import { RuntimeError } from './errors.js';
import {
  FactoryRunSchema,
  type FactorySequencePayload,
  FactorySequenceSchema,
  tryRegister,
} from './records.js';
import { run } from './runtime.js';
import type { PhaseGraph, RunOptions, RunReport } from './types.js';

const DEFAULT_MAX_TOTAL_TOKENS = 500_000;

export interface RunSequenceArgs {
  /** Directory containing spec files. Walked non-recursively for `*.md`. */
  specsDir: string;
  graph: PhaseGraph;
  contextStore: ContextStore;
  options?: RunSequenceOptions;
}

export interface RunSequenceOptions extends RunOptions {
  /**
   * When true, continue running specs whose deps did not fail after another
   * spec fails. Transitive dependents of any failed spec are still skipped.
   * Default false (stop on first non-converging spec).
   */
  continueOnFail?: boolean;
  /**
   * Whole-sequence cap on summed agent tokens, across every spec's runs.
   * When undefined, no sequence-level cap (per-spec cap from `RunOptions`
   * still applies). Pre-run check: `cumulative + nextSpec.maxTotalTokens
   * > maxSequenceTokens` aborts before invoking `run()` for the next spec.
   */
  maxSequenceTokens?: number;
  /**
   * v0.0.9 — when true, walk every spec in the directory regardless of
   * `frontmatter.status`. Default false: skip specs with `status: drafting`
   * (preserving cluster-atomic shipping requires opting in).
   */
  includeDrafting?: boolean;
  /**
   * v0.0.9 — sink for one-line "skipping <id> (status: drafting)" notices
   * emitted before the sequence runs. Defaults to stdout. Distinct from
   * `RunOptions.log`, which goes to stderr per-phase.
   */
  skipLog?: (line: string) => void;
}

export type SequenceSpecStatus = 'converged' | 'no-converge' | 'error' | 'skipped';

export interface SequenceSpecResult {
  specId: string;
  specPath: string;
  status: SequenceSpecStatus;
  /** Populated when status !== 'skipped'. */
  runReport?: RunReport;
  /** Populated when status === 'skipped'; names the failed dep that caused the skip. */
  blockedBy?: string;
}

export type SequenceStatus = 'converged' | 'partial' | 'no-converge' | 'error';

export interface SequenceReport {
  factorySequenceId: string;
  specsDir: string;
  startedAt: string;
  durationMs: number;
  topoOrder: ReadonlyArray<string>;
  specs: ReadonlyArray<SequenceSpecResult>;
  status: SequenceStatus;
  totalTokens: number;
}

interface LoadedSpec {
  id: string;
  path: string;
  spec: Spec;
  deps: string[];
}

interface LoadSpecsResult {
  included: LoadedSpec[];
  skippedDrafting: LoadedSpec[];
}

/**
 * Walk `<specsDir>/*.md` (non-recursive — `done/` is intentionally skipped).
 * Parse each via `parseSpec`. Returns deterministic-ordered lists (by id
 * ASC). When `includeDrafting === false` (default), specs with
 * `frontmatter.status === 'drafting'` are routed to `skippedDrafting`
 * instead of `included`; the sequence-runner logs a one-line skip notice
 * for each and they are absent from `topoOrder` and `SequenceReport.specs`.
 */
function loadSpecs(specsDir: string, includeDrafting: boolean): LoadSpecsResult {
  const stat = statSync(specsDir);
  if (!stat.isDirectory()) {
    throw new RuntimeError('runtime/io-error', `not a directory: ${specsDir}`);
  }
  const entries = readdirSync(specsDir, { withFileTypes: true });
  const included: LoadedSpec[] = [];
  const skippedDrafting: LoadedSpec[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    const fullPath = join(specsDir, entry.name);
    const source = readFileSync(fullPath, 'utf8');
    const spec = parseSpec(source, { filename: fullPath });
    const loaded: LoadedSpec = {
      id: spec.frontmatter.id,
      path: fullPath,
      spec,
      deps: [...spec.frontmatter['depends-on']],
    };
    if (!includeDrafting && spec.frontmatter.status === 'drafting') {
      skippedDrafting.push(loaded);
    } else {
      included.push(loaded);
    }
  }
  included.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  skippedDrafting.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { included, skippedDrafting };
}

/**
 * Validate dep references + topologically sort via Kahn's algorithm.
 * Tie-break on alphabetic id ASC for deterministic ordering.
 *
 * Throws `RuntimeError` with codes:
 *   - `runtime/sequence-dep-not-found` — a depends-on entry references an id
 *     not present in `specs[]`.
 *   - `runtime/sequence-cycle` — the depends-on graph contains a cycle. The
 *     reported message names the smallest cycle path found via DFS.
 */
function buildDag(specs: LoadedSpec[], specsDir: string): string[] {
  const ids = new Set(specs.map((s) => s.id));
  const byId = new Map(specs.map((s) => [s.id, s]));

  // Validate all deps reference known ids.
  for (const s of specs) {
    for (const dep of s.deps) {
      if (!ids.has(dep)) {
        throw new RuntimeError(
          'runtime/sequence-dep-not-found',
          `spec '${s.id}' depends on '${dep}' which is not in ${specsDir}`,
        );
      }
    }
  }

  // Detect smallest cycle via iterative DFS so the error message is
  // informative ("a → b → c → a"). For each id not yet visited, walk
  // depths-first and watch for revisits on the current path.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(specs.map((s) => [s.id, WHITE]));
  const detectCycleFrom = (start: string): string[] | null => {
    const path: string[] = [];
    const onPath = new Set<string>();
    type Frame = { id: string; depIdx: number };
    const frames: Frame[] = [{ id: start, depIdx: 0 }];
    color.set(start, GRAY);
    path.push(start);
    onPath.add(start);
    while (frames.length > 0) {
      const top = frames[frames.length - 1];
      if (top === undefined) break;
      const node = byId.get(top.id);
      if (node === undefined) {
        frames.pop();
        path.pop();
        onPath.delete(top.id);
        color.set(top.id, BLACK);
        continue;
      }
      const sortedDeps = [...node.deps].sort();
      if (top.depIdx >= sortedDeps.length) {
        frames.pop();
        path.pop();
        onPath.delete(top.id);
        color.set(top.id, BLACK);
        continue;
      }
      const next = sortedDeps[top.depIdx];
      top.depIdx += 1;
      if (next === undefined) continue;
      if (onPath.has(next)) {
        // Cycle found. Slice the path from `next` to the current end + close.
        const idx = path.indexOf(next);
        return [...path.slice(idx), next];
      }
      if (color.get(next) === BLACK) continue;
      color.set(next, GRAY);
      path.push(next);
      onPath.add(next);
      frames.push({ id: next, depIdx: 0 });
    }
    return null;
  };

  for (const s of specs) {
    if (color.get(s.id) !== WHITE) continue;
    const cycle = detectCycleFrom(s.id);
    if (cycle !== null) {
      throw new RuntimeError('runtime/sequence-cycle', `depends-on cycle: ${cycle.join(' → ')}`);
    }
  }

  // Kahn's topological sort; tie-break alphabetically.
  const indeg = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const s of specs) {
    indeg.set(s.id, s.deps.length);
    children.set(s.id, []);
  }
  for (const s of specs) {
    for (const dep of s.deps) {
      const list = children.get(dep);
      if (list !== undefined) list.push(s.id);
    }
  }
  const ready: string[] = [];
  for (const [id, n] of indeg) if (n === 0) ready.push(id);
  ready.sort();
  const result: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    result.push(id);
    for (const child of children.get(id) ?? []) {
      const remaining = (indeg.get(child) ?? 0) - 1;
      indeg.set(child, remaining);
      if (remaining === 0) {
        // Insert keeping alphabetic order.
        const insertAt = ready.findIndex((r) => r > child);
        if (insertAt === -1) ready.push(child);
        else ready.splice(insertAt, 0, child);
      }
    }
  }
  if (result.length !== specs.length) {
    // Should be unreachable — cycle detection above catches this. Defensive.
    throw new RuntimeError(
      'runtime/sequence-cycle',
      'depends-on cycle detected during topological sort',
    );
  }
  return result;
}

async function putOrWrapSequence(
  store: ContextStore,
  payload: FactorySequencePayload,
): Promise<string> {
  try {
    return await store.put('factory-sequence', payload, { parents: [] });
  } catch (err) {
    if (err instanceof ContextError) {
      throw new RuntimeError('runtime/io-error', `failed to put factory-sequence: ${err.message}`);
    }
    throw err;
  }
}

export async function runSequence(args: RunSequenceArgs): Promise<SequenceReport> {
  const { specsDir, graph, contextStore, options = {} } = args;
  const continueOnFail = options.continueOnFail ?? false;
  const maxSequenceTokens = options.maxSequenceTokens;
  const perSpecMaxTotalTokens = options.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
  const includeDrafting = options.includeDrafting ?? false;
  const skipLog = options.skipLog ?? ((line: string) => process.stdout.write(`${line}\n`));

  tryRegister(contextStore, 'factory-run', FactoryRunSchema);
  tryRegister(contextStore, 'factory-sequence', FactorySequenceSchema);

  const startedAt = new Date();
  const t0 = performance.now();

  const { included: loaded, skippedDrafting } = loadSpecs(specsDir, includeDrafting);
  for (const s of skippedDrafting) {
    skipLog(`factory-runtime: skipping ${s.id} (status: drafting)`);
  }
  if (loaded.length === 0) {
    throw new RuntimeError(
      'runtime/sequence-empty',
      `no specs with status: ready found in ${specsDir} (use --include-drafting to walk all specs regardless of status)`,
    );
  }
  const topoOrder = buildDag(loaded, specsDir);
  const byId = new Map(loaded.map((s) => [s.id, s]));

  const sequencePayload: FactorySequencePayload = {
    specsDir,
    topoOrder,
    startedAt: startedAt.toISOString(),
    ...(options.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
    ...(options.maxTotalTokens !== undefined ? { maxTotalTokens: options.maxTotalTokens } : {}),
    ...(maxSequenceTokens !== undefined ? { maxSequenceTokens } : {}),
    continueOnFail,
  };
  const factorySequenceId = await putOrWrapSequence(contextStore, sequencePayload);

  const results: SequenceSpecResult[] = [];
  const failedSet = new Set<string>();
  // Map each spec id → first failed dep that poisoned its lineage.
  const blockedByMap = new Map<string, string>();
  let cumulativeTokens = 0;
  let stopRequested = false;
  let sawError = false;

  // Per-spec inner options: copy options but strip sequence-only keys.
  const perSpecOptions: RunOptions = {};
  if (options.maxIterations !== undefined) perSpecOptions.maxIterations = options.maxIterations;
  if (options.maxTotalTokens !== undefined) perSpecOptions.maxTotalTokens = options.maxTotalTokens;
  if (options.maxAgentTimeoutMs !== undefined)
    perSpecOptions.maxAgentTimeoutMs = options.maxAgentTimeoutMs;
  if (options.log !== undefined) perSpecOptions.log = options.log;

  for (const id of topoOrder) {
    const loadedSpec = byId.get(id);
    if (loadedSpec === undefined) continue;

    if (stopRequested) {
      const cause = blockedByMap.get(id) ?? '<sequence-stopped>';
      results.push({
        specId: id,
        specPath: loadedSpec.path,
        status: 'skipped',
        blockedBy: cause,
      });
      continue;
    }

    // If any of this spec's transitive deps failed, skip.
    const blocking = loadedSpec.deps.find((dep) => failedSet.has(dep));
    if (blocking !== undefined) {
      const upstreamCause = blockedByMap.get(blocking) ?? blocking;
      results.push({
        specId: id,
        specPath: loadedSpec.path,
        status: 'skipped',
        blockedBy: upstreamCause,
      });
      failedSet.add(id);
      blockedByMap.set(id, upstreamCause);
      continue;
    }

    // Sequence-cost-cap pre-run check.
    if (
      maxSequenceTokens !== undefined &&
      cumulativeTokens + perSpecMaxTotalTokens > maxSequenceTokens
    ) {
      throw new RuntimeError(
        'runtime/sequence-cost-cap-exceeded',
        `cumulative=${cumulativeTokens} + next-spec-cap=${perSpecMaxTotalTokens} > maxSequenceTokens=${maxSequenceTokens}`,
      );
    }

    const report = await run({
      spec: loadedSpec.spec,
      graph,
      contextStore,
      options: perSpecOptions,
      runParents: [factorySequenceId],
    });
    cumulativeTokens += report.totalTokens ?? 0;
    results.push({
      specId: id,
      specPath: loadedSpec.path,
      status:
        report.status === 'converged'
          ? 'converged'
          : report.status === 'error'
            ? 'error'
            : 'no-converge',
      runReport: report,
    });

    if (report.status !== 'converged') {
      failedSet.add(id);
      blockedByMap.set(id, id);
      if (report.status === 'error') sawError = true;
      if (!continueOnFail) {
        stopRequested = true;
      }
    }
  }

  const convergedCount = results.filter((r) => r.status === 'converged').length;
  const failureCount = results.length - convergedCount;
  let status: SequenceStatus;
  if (sawError) {
    status = 'error';
  } else if (failureCount === 0) {
    status = 'converged';
  } else if (convergedCount === 0) {
    status = 'no-converge';
  } else {
    status = 'partial';
  }

  const durationMs = Math.round(performance.now() - t0);
  return {
    factorySequenceId,
    specsDir,
    startedAt: startedAt.toISOString(),
    durationMs,
    topoOrder,
    specs: results,
    status,
    totalTokens: cumulativeTokens,
  };
}

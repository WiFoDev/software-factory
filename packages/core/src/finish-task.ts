import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface FinishTaskOptions {
  specId: string;
  /**
   * Directory containing the spec file. The spec is expected at `<dir>/<specId>.md`.
   * The shipped spec lands at `<dir>/done/<specId>.md`.
   */
  dir: string;
  /** Context store directory containing prior factory-run records. */
  contextDir: string;
}

/**
 * v0.0.13 — batch ship every converged spec from a factory-sequence in one
 * call. Mutually exclusive with the per-spec form: pass `allConverged: true`
 * to opt in. `since` pins to a specific factory-sequence id; omit to walk
 * the most recent factory-sequence.
 */
export interface FinishTaskBatchOptions {
  allConverged: true;
  since?: string;
  dir: string;
  contextDir: string;
}

export interface FinishTaskResult {
  shippedRecordId: string;
  fromPath: string;
  toPath: string;
  /** The converged factory-run record's id whose lineage adopted the new record. */
  runId: string;
  /** The shipped spec's id. */
  specId: string;
}

export interface FinishTaskBatchResult {
  /** The factory-sequence whose converged specs were walked. */
  factorySequenceId: string;
  /** Per-spec ship results, one entry per converged + moved spec. */
  shipped: FinishTaskResult[];
  /**
   * v0.0.14 — per-spec skip records for runs whose final iteration's terminal
   * phase did NOT pass. Mirrors run-sequence's `no-converge` verdict so
   * `--all-converged` no longer ships specs the runtime considered un-shipped.
   */
  skipped: Array<{ specId: string; runId: string; terminalPhase: string }>;
}

interface ContextRecordEnvelope {
  version: 1;
  id: string;
  type: string;
  recordedAt: string;
  parents: string[];
  payload: unknown;
}

const ID_FILENAME_RE = /^[0-9a-f]{16}\.json$/;

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    const parts = value.map((item) => canonicalJson(item));
    return `[${parts.join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

function hashRecord(input: { type: string; parents: readonly string[]; payload: unknown }): string {
  const dedupedSorted = [...new Set(input.parents)].sort();
  const canonical = canonicalJson({
    type: input.type,
    parents: dedupedSorted,
    payload: input.payload,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

async function readAllRecords(dir: string): Promise<ContextRecordEnvelope[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw err;
  }
  const records: ContextRecordEnvelope[] = [];
  for (const name of entries) {
    if (!ID_FILENAME_RE.test(name)) continue;
    const raw = await readFile(join(dir, name), 'utf8');
    try {
      const parsed = JSON.parse(raw) as ContextRecordEnvelope;
      records.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return records;
}

/**
 * v0.0.14 — status-aggregator helper for `--all-converged`. Walks
 * factory-phase records belonging to `runId`, groups by iteration, and
 * returns the FINAL iteration's terminal phase status (`{ converged,
 * terminalPhase }`).
 *
 * Aligns finish-task's batch predicate with run-sequence's verdict — both
 * count only the FINAL iteration, since earlier iterations' failures are
 * part of the implement-validate-iterate loop, not a verdict. The canonical
 * cousin lives in `factory-runtime/src/sequence.ts` (`verifyRunConverged`,
 * v0.0.12); this duplicate avoids cross-package coupling deferred per the
 * v0.0.14 spec.
 *
 * Exported within the package so the helper unit tests in
 * `finish-task.test.ts` can call it directly. NOT re-exported from
 * `index.ts` — it's a package-internal helper.
 */
export async function getRunConvergenceStatus(
  contextDir: string,
  runId: string,
): Promise<{ converged: boolean; terminalPhase: string }> {
  const all = await readAllRecords(resolve(contextDir));
  return computeConvergenceFromRecords(runId, all);
}

function computeConvergenceFromRecords(
  runId: string,
  records: ContextRecordEnvelope[],
): { converged: boolean; terminalPhase: string } {
  const phases = records.filter((r) => r.type === 'factory-phase' && r.parents.includes(runId));
  if (phases.length === 0) return { converged: false, terminalPhase: 'unknown' };
  const byIter = new Map<number, ContextRecordEnvelope[]>();
  for (const p of phases) {
    const it = (p.payload as { iteration?: unknown }).iteration;
    if (typeof it !== 'number') continue;
    const list = byIter.get(it);
    if (list === undefined) byIter.set(it, [p]);
    else list.push(p);
  }
  if (byIter.size === 0) return { converged: false, terminalPhase: 'unknown' };
  let maxIter = Number.NEGATIVE_INFINITY;
  for (const it of byIter.keys()) if (it > maxIter) maxIter = it;
  const finalPhases = byIter.get(maxIter);
  if (finalPhases === undefined || finalPhases.length === 0) {
    return { converged: false, terminalPhase: 'unknown' };
  }
  finalPhases.sort((a, b) =>
    a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0,
  );
  const terminal = finalPhases[finalPhases.length - 1];
  if (terminal === undefined) return { converged: false, terminalPhase: 'unknown' };
  const status = (terminal.payload as { status?: unknown }).status;
  const terminalPhase = typeof status === 'string' ? status : 'unknown';
  return { converged: terminalPhase === 'pass', terminalPhase };
}

/**
 * Walks `factory-phase` records grouped by iteration; an iteration's terminal
 * phase (last by `recordedAt`) must have `status: 'pass'` for the run to
 * count as converged. Used by the positional `finishTask({ specId })` path —
 * v0.0.14 leaves this predicate unchanged for backward compatibility (S-3).
 */
function isRunConverged(runId: string, allRecords: ContextRecordEnvelope[]): boolean {
  const phases = allRecords.filter((r) => r.type === 'factory-phase' && r.parents.includes(runId));
  if (phases.length === 0) return false;
  const byIter = new Map<number, ContextRecordEnvelope[]>();
  for (const p of phases) {
    const it = (p.payload as { iteration?: unknown }).iteration;
    if (typeof it !== 'number') continue;
    const list = byIter.get(it);
    if (list === undefined) byIter.set(it, [p]);
    else list.push(p);
  }
  if (byIter.size === 0) return false;
  for (const list of byIter.values()) {
    list.sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
    const terminal = list[list.length - 1];
    if (terminal === undefined) return false;
    const status = (terminal.payload as { status?: unknown }).status;
    if (status !== 'pass') return false;
  }
  return true;
}

async function writeRecord(dir: string, record: ContextRecordEnvelope): Promise<void> {
  await mkdir(dir, { recursive: true });
  const finalPath = join(dir, `${record.id}.json`);
  const tmpPath = `${finalPath}.tmp.${randomBytes(6).toString('hex')}`;
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  try {
    await writeFile(tmpPath, payload, 'utf8');
    await rename(tmpPath, finalPath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

async function shipOneSpec(
  specId: string,
  runId: string,
  dirAbs: string,
  contextDirAbs: string,
): Promise<FinishTaskResult> {
  const fromPath = join(dirAbs, `${specId}.md`);
  const toPath = join(dirAbs, 'done', `${specId}.md`);
  if (!existsSync(fromPath)) {
    throw new Error(`factory: spec file not found: ${fromPath}`);
  }
  await mkdir(dirname(toPath), { recursive: true });
  await rename(fromPath, toPath);

  const shippedAt = new Date().toISOString();
  const payload = {
    specId,
    shippedAt,
    fromPath,
    toPath,
  };
  const parents = [runId];
  const id = hashRecord({ type: 'factory-spec-shipped', parents, payload });
  const record: ContextRecordEnvelope = {
    version: 1,
    id,
    type: 'factory-spec-shipped',
    recordedAt: shippedAt,
    parents,
    payload,
  };
  await writeRecord(contextDirAbs, record);

  return { shippedRecordId: id, fromPath, toPath, runId, specId };
}

/**
 * Mark a converged spec as shipped: move its file to `<dir>/done/` and
 * persist a `factory-spec-shipped` context record parented on the converged
 * `factory-run` so the lifecycle is reconstructible from the store alone.
 *
 * Refuses to move if no converged factory-run exists for the spec id.
 *
 * v0.0.13 — overloaded to also accept `{ allConverged: true, since? }` to
 * batch-ship every converged spec under a factory-sequence in one call.
 */
export function finishTask(opts: FinishTaskOptions): Promise<FinishTaskResult>;
export function finishTask(opts: FinishTaskBatchOptions): Promise<FinishTaskBatchResult>;
export async function finishTask(
  opts: FinishTaskOptions | FinishTaskBatchOptions,
): Promise<FinishTaskResult | FinishTaskBatchResult> {
  if ('allConverged' in opts && opts.allConverged === true) {
    return finishTaskBatch(opts);
  }
  return finishTaskOne(opts as FinishTaskOptions);
}

async function finishTaskOne(opts: FinishTaskOptions): Promise<FinishTaskResult> {
  const { specId, dir, contextDir } = opts;
  const dirAbs = resolve(dir);
  const contextDirAbs = resolve(contextDir);

  const all = await readAllRecords(contextDirAbs);
  // Newest-first so we ship against the most recent converged run when
  // multiple exist (e.g. a re-run after a fix).
  const candidates = all
    .filter((r) => r.type === 'factory-run')
    .filter((r) => (r.payload as { specId?: unknown }).specId === specId)
    .sort((a, b) => (a.recordedAt > b.recordedAt ? -1 : a.recordedAt < b.recordedAt ? 1 : 0));

  const converged = candidates.find((r) => isRunConverged(r.id, all));
  if (converged === undefined) {
    throw new Error(
      `factory: no converged factory-run found for spec id ${specId}; refusing to move`,
    );
  }

  return shipOneSpec(specId, converged.id, dirAbs, contextDirAbs);
}

async function finishTaskBatch(opts: FinishTaskBatchOptions): Promise<FinishTaskBatchResult> {
  const { since, dir, contextDir } = opts;
  const dirAbs = resolve(dir);
  const contextDirAbs = resolve(contextDir);

  const all = await readAllRecords(contextDirAbs);
  const sequences = all.filter((r) => r.type === 'factory-sequence');

  let target: ContextRecordEnvelope | undefined;
  if (since !== undefined) {
    target = sequences.find((s) => s.id === since);
    if (target === undefined) {
      throw new Error(`factory: no factory-sequence found with id ${since}`);
    }
  } else {
    if (sequences.length === 0) {
      throw new Error(
        `factory: no factory-sequence found in context dir; --all-converged requires at least one run-sequence invocation. Use 'factory finish-task <spec-id>' for individual specs.`,
      );
    }
    // Most recent by recordedAt; tie-break on lex-larger id (deterministic).
    const sorted = [...sequences].sort((a, b) => {
      if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
    target = sorted[0];
  }
  if (target === undefined) {
    // Defensive — covered above, but TS narrowing.
    throw new Error(
      `factory: no factory-sequence found in context dir; --all-converged requires at least one run-sequence invocation. Use 'factory finish-task <spec-id>' for individual specs.`,
    );
  }

  const sequenceId = target.id;

  // Walk descendant factory-run records (parents include this sequence id).
  // Dedup by specId — keep the MOST RECENT run per spec (regardless of
  // convergence). v0.0.14: classify each spec's latest run via the
  // status-aggregator helper. Converged → ship. Not converged → skip + log.
  const runs = all
    .filter((r) => r.type === 'factory-run')
    .filter((r) => r.parents.includes(sequenceId));
  const latestRunBySpec = new Map<string, ContextRecordEnvelope>();
  for (const run of runs) {
    const payload = run.payload as { specId?: unknown };
    if (typeof payload.specId !== 'string') continue;
    const existing = latestRunBySpec.get(payload.specId);
    if (existing === undefined || existing.recordedAt < run.recordedAt) {
      latestRunBySpec.set(payload.specId, run);
    }
  }

  const bySpec = new Map<string, ContextRecordEnvelope>();
  const skippedBySpec = new Map<string, { run: ContextRecordEnvelope; terminalPhase: string }>();
  for (const [specId, run] of latestRunBySpec) {
    const status = computeConvergenceFromRecords(run.id, all);
    if (status.converged) {
      bySpec.set(specId, run);
    } else {
      skippedBySpec.set(specId, { run, terminalPhase: status.terminalPhase });
    }
  }

  // Order by the sequence's topoOrder for stable, semantically meaningful
  // output. Specs not present in topoOrder fall through to alphabetic.
  const seqPayload = target.payload as { topoOrder?: unknown };
  const topoOrder = Array.isArray(seqPayload.topoOrder)
    ? seqPayload.topoOrder.filter((x): x is string => typeof x === 'string')
    : [];
  const orderIndex = new Map<string, number>();
  for (let i = 0; i < topoOrder.length; i++) {
    const id = topoOrder[i];
    if (id !== undefined) orderIndex.set(id, i);
  }
  const orderBySpecId = (aId: string, bId: string): number => {
    const ai = orderIndex.get(aId) ?? Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.get(bId) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  };
  const ordered = Array.from(bySpec.entries()).sort(([aId], [bId]) => orderBySpecId(aId, bId));
  const orderedSkips = Array.from(skippedBySpec.entries()).sort(([aId], [bId]) =>
    orderBySpecId(aId, bId),
  );

  const shipped: FinishTaskResult[] = [];
  for (const [specId, run] of ordered) {
    const result = await shipOneSpec(specId, run.id, dirAbs, contextDirAbs);
    shipped.push(result);
  }
  const skipped = orderedSkips.map(([specId, info]) => ({
    specId,
    runId: info.run.id,
    terminalPhase: info.terminalPhase,
  }));

  return { factorySequenceId: sequenceId, shipped, skipped };
}

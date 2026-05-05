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

export interface FinishTaskResult {
  shippedRecordId: string;
  fromPath: string;
  toPath: string;
  /** The converged factory-run record's id whose lineage adopted the new record. */
  runId: string;
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
 * Walks `factory-phase` records grouped by iteration; an iteration's terminal
 * phase (last by `recordedAt`) must have `status: 'pass'` for the run to
 * count as converged. Mirrors the verifyRunConverged logic in sequence.ts.
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

/**
 * Mark a converged spec as shipped: move its file to `<dir>/done/` and
 * persist a `factory-spec-shipped` context record parented on the converged
 * `factory-run` so the lifecycle is reconstructible from the store alone.
 *
 * Refuses to move if no converged factory-run exists for the spec id.
 */
export async function finishTask(opts: FinishTaskOptions): Promise<FinishTaskResult> {
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
  const parents = [converged.id];
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

  return { shippedRecordId: id, fromPath, toPath, runId: converged.id };
}

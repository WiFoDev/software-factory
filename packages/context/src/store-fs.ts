import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ContextError } from './errors.js';
import type { ContextRecord } from './types.js';

export interface SkippedFile {
  filename: string;
  reason: string;
}

export interface ListRecordsResult {
  records: ContextRecord[];
  skipped: SkippedFile[];
}

const ID_FILENAME_RE = /^[0-9a-f]{16}\.json$/;
const ID_RE = /^[0-9a-f]{16}$/;

function recordPath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

function validateEnvelope(value: unknown): ContextRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContextError('context/parse-error', 'record is not a JSON object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new ContextError(
      'context/version-mismatch',
      `expected version 1, got ${JSON.stringify(obj.version)}`,
    );
  }
  const id = obj.id;
  const type = obj.type;
  const recordedAt = obj.recordedAt;
  const parents = obj.parents;
  if (typeof id !== 'string') {
    throw new ContextError('context/parse-error', 'record.id must be a string');
  }
  if (typeof type !== 'string') {
    throw new ContextError('context/parse-error', 'record.type must be a string');
  }
  if (typeof recordedAt !== 'string') {
    throw new ContextError('context/parse-error', 'record.recordedAt must be a string');
  }
  if (!Array.isArray(parents) || parents.some((p) => typeof p !== 'string')) {
    throw new ContextError('context/parse-error', 'record.parents must be a string[]');
  }
  if (!('payload' in obj)) {
    throw new ContextError('context/parse-error', 'record.payload missing');
  }
  return {
    version: 1,
    id,
    type,
    recordedAt,
    parents: parents as string[],
    payload: obj.payload,
  };
}

export async function readRecord(dir: string, id: string): Promise<ContextRecord | null> {
  if (!ID_RE.test(id)) {
    throw new ContextError('context/parse-error', `invalid id: ${JSON.stringify(id)}`);
  }
  const path = recordPath(dir, id);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new ContextError(
      'context/io-error',
      `failed to read record ${id}: ${(err as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ContextError(
      'context/parse-error',
      `failed to parse record ${id}: ${(err as Error).message}`,
    );
  }
  return validateEnvelope(parsed);
}

export async function writeRecord(dir: string, record: ContextRecord): Promise<void> {
  if (!ID_RE.test(record.id)) {
    throw new ContextError(
      'context/parse-error',
      `invalid record.id: ${JSON.stringify(record.id)}`,
    );
  }
  await mkdir(dir, { recursive: true });
  const finalPath = recordPath(dir, record.id);
  const tmpPath = `${finalPath}.tmp.${randomBytes(6).toString('hex')}`;
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  try {
    await writeFile(tmpPath, payload, 'utf8');
    await rename(tmpPath, finalPath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw new ContextError(
      'context/io-error',
      `failed to write record ${record.id}: ${(err as Error).message}`,
    );
  }
}

function compareRecords(a: ContextRecord, b: ContextRecord): number {
  const t = a.recordedAt.localeCompare(b.recordedAt);
  if (t !== 0) return t;
  return a.id.localeCompare(b.id);
}

export async function listRecords(dir: string): Promise<ListRecordsResult> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    throw new ContextError(
      'context/io-error',
      `failed to read directory ${dir}: ${(err as Error).message}`,
    );
  }
  const candidates = entries.filter((name) => ID_FILENAME_RE.test(name));
  const records: ContextRecord[] = [];
  const skipped: SkippedFile[] = [];
  for (const filename of candidates) {
    let raw: string;
    try {
      raw = await readFile(join(dir, filename), 'utf8');
    } catch (err) {
      skipped.push({ filename, reason: `read failed: ${(err as Error).message}` });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      skipped.push({ filename, reason: `parse failed: ${(err as Error).message}` });
      continue;
    }
    try {
      records.push(validateEnvelope(parsed));
    } catch (err) {
      skipped.push({ filename, reason: (err as Error).message });
    }
  }
  records.sort(compareRecords);
  return { records, skipped };
}

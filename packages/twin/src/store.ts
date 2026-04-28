import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TwinReplayError } from './errors.js';
import type { Recording } from './types.js';

export interface SkippedFile {
  filename: string;
  reason: string;
}

export interface ListResult {
  recordings: Recording[];
  skipped: SkippedFile[];
}

export interface PruneResult {
  pruned: string[];
  skipped: SkippedFile[];
}

const HASH_FILENAME_RE = /^[0-9a-f]{16}\.json$/;

function recordingPath(recordingsDir: string, hash: string): string {
  return join(recordingsDir, `${hash}.json`);
}

export async function readRecording(
  recordingsDir: string,
  hash: string,
): Promise<Recording | null> {
  const path = recordingPath(recordingsDir, hash);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new TwinReplayError(
      'twin/io-error',
      `failed to read recording ${hash}: ${(err as Error).message}`,
    );
  }
  try {
    return JSON.parse(raw) as Recording;
  } catch (err) {
    throw new TwinReplayError(
      'twin/parse-error',
      `failed to parse recording ${hash}: ${(err as Error).message}`,
    );
  }
}

export async function writeRecording(recordingsDir: string, recording: Recording): Promise<void> {
  await mkdir(recordingsDir, { recursive: true });
  const finalPath = recordingPath(recordingsDir, recording.hash);
  const tmpPath = `${finalPath}.tmp.${randomBytes(6).toString('hex')}`;
  const payload = `${JSON.stringify(recording, null, 2)}\n`;
  try {
    await writeFile(tmpPath, payload, 'utf8');
    await rename(tmpPath, finalPath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw new TwinReplayError(
      'twin/io-error',
      `failed to write recording ${recording.hash}: ${(err as Error).message}`,
    );
  }
}

async function readDir(recordingsDir: string): Promise<string[]> {
  try {
    return await readdir(recordingsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new TwinReplayError(
        'twin/io-error',
        `recordings directory not found: ${recordingsDir}`,
      );
    }
    throw new TwinReplayError(
      'twin/io-error',
      `failed to read recordings directory ${recordingsDir}: ${(err as Error).message}`,
    );
  }
}

export async function listRecordings(recordingsDir: string): Promise<ListResult> {
  const entries = await readDir(recordingsDir);
  const candidates = entries.filter((name) => HASH_FILENAME_RE.test(name));
  const recordings: Recording[] = [];
  const skipped: SkippedFile[] = [];
  for (const filename of candidates) {
    const raw = await readFile(join(recordingsDir, filename), 'utf8').catch((err: Error) => {
      skipped.push({ filename, reason: `read failed: ${err.message}` });
      return null;
    });
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as Recording;
      recordings.push(parsed);
    } catch (err) {
      skipped.push({ filename, reason: `parse failed: ${(err as Error).message}` });
    }
  }
  recordings.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  return { recordings, skipped };
}

export async function pruneRecordings(
  recordingsDir: string,
  options: { olderThanDays: number; dryRun?: boolean; now?: Date },
): Promise<PruneResult> {
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - options.olderThanDays * 24 * 60 * 60 * 1000;
  const entries = await readDir(recordingsDir);
  const candidates = entries.filter((name) => HASH_FILENAME_RE.test(name));
  const pruned: string[] = [];
  const skipped: SkippedFile[] = [];

  for (const filename of candidates) {
    const path = join(recordingsDir, filename);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      skipped.push({ filename, reason: `read failed: ${(err as Error).message}` });
      continue;
    }
    let parsed: Recording;
    try {
      parsed = JSON.parse(raw) as Recording;
    } catch (err) {
      skipped.push({ filename, reason: `parse failed: ${(err as Error).message}` });
      continue;
    }
    const recordedAt = Date.parse(parsed.recordedAt);
    if (!Number.isFinite(recordedAt)) {
      skipped.push({ filename, reason: 'invalid recordedAt' });
      continue;
    }
    if (recordedAt >= cutoff) continue;
    if (options.dryRun !== true) {
      try {
        await rm(path);
      } catch (err) {
        skipped.push({ filename, reason: `unlink failed: ${(err as Error).message}` });
        continue;
      }
    }
    pruned.push(parsed.hash);
  }
  return { pruned, skipped };
}

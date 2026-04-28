import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TwinReplayError } from './errors.js';
import { listRecordings, pruneRecordings, readRecording, writeRecording } from './store.js';
import type { Recording } from './types.js';

function makeRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    version: 1,
    hash: 'abcdef0123456789',
    recordedAt: '2026-04-28T10:00:00.000Z',
    request: {
      method: 'GET',
      url: 'https://api.x/y',
      headers: {},
      body: null,
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      body: 'hi',
      bodyEncoding: 'utf8',
    },
    ...overrides,
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'twin-store-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

describe('writeRecording / readRecording', () => {
  test('writes and reads back a recording', async () => {
    const rec = makeRecording();
    await writeRecording(dir, rec);
    const read = await readRecording(dir, rec.hash);
    expect(read).toEqual(rec);
  });

  test('readRecording returns null on missing file', async () => {
    const read = await readRecording(dir, 'deadbeefdeadbeef');
    expect(read).toBe(null);
  });

  test('writeRecording creates the directory if missing', async () => {
    const nested = join(dir, 'nested', 'rec');
    const rec = makeRecording();
    await writeRecording(nested, rec);
    const read = await readRecording(nested, rec.hash);
    expect(read).not.toBe(null);
  });

  test('readRecording throws TwinReplayError on corrupt JSON', async () => {
    const bad = join(dir, '0000000000000000.json');
    writeFileSync(bad, '{not json');
    let caught: unknown;
    try {
      await readRecording(dir, '0000000000000000');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TwinReplayError);
    expect((caught as TwinReplayError).code).toBe('twin/parse-error');
  });

  test('writeRecording is atomic — never leaves partial files on success', async () => {
    const rec = makeRecording();
    await writeRecording(dir, rec);
    const entries = await readdir(dir);
    expect(entries).toEqual([`${rec.hash}.json`]);
    const raw = await readFile(join(dir, `${rec.hash}.json`), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test('concurrent writes for same hash leave a complete JSON (last-writer-wins)', async () => {
    const a = makeRecording({ recordedAt: '2026-04-28T10:00:00.000Z' });
    const b = makeRecording({ recordedAt: '2026-04-28T10:00:01.000Z' });
    await Promise.all([writeRecording(dir, a), writeRecording(dir, b)]);
    const entries = await readdir(dir);
    expect(entries).toEqual([`${a.hash}.json`]);
    const raw = readFileSync(join(dir, `${a.hash}.json`), 'utf8');
    const parsed = JSON.parse(raw) as Recording;
    expect([a.recordedAt, b.recordedAt]).toContain(parsed.recordedAt);
  });
});

describe('listRecordings', () => {
  test('returns recordings sorted by recordedAt ascending', async () => {
    const a = makeRecording({ hash: '0000000000000001', recordedAt: '2026-04-28T10:00:00.000Z' });
    const b = makeRecording({ hash: '0000000000000002', recordedAt: '2026-04-27T10:00:00.000Z' });
    await writeRecording(dir, a);
    await writeRecording(dir, b);
    const result = await listRecordings(dir);
    expect(result.recordings.map((r) => r.hash)).toEqual([b.hash, a.hash]);
    expect(result.skipped).toEqual([]);
  });

  test('skips files that fail to parse and reports them', async () => {
    await writeRecording(dir, makeRecording({ hash: '0000000000000001' }));
    writeFileSync(join(dir, '0000000000000002.json'), '{not json');
    const result = await listRecordings(dir);
    expect(result.recordings).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.filename).toBe('0000000000000002.json');
    expect(result.skipped[0]?.reason).toContain('parse failed');
  });

  test('ignores non-recording filenames', async () => {
    await writeRecording(dir, makeRecording({ hash: '0000000000000001' }));
    writeFileSync(join(dir, 'README.md'), 'hi');
    writeFileSync(join(dir, 'index.json'), '{}');
    const result = await listRecordings(dir);
    expect(result.recordings).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });

  test('throws TwinReplayError when dir does not exist', async () => {
    let caught: unknown;
    try {
      await listRecordings(join(dir, 'nope'));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TwinReplayError);
    expect((caught as TwinReplayError).code).toBe('twin/io-error');
  });
});

describe('pruneRecordings', () => {
  test('removes recordings older than N days', async () => {
    const now = new Date('2026-04-28T10:00:00.000Z');
    const old = makeRecording({
      hash: '0000000000000001',
      recordedAt: '2026-04-18T10:00:00.000Z',
    });
    const fresh = makeRecording({
      hash: '0000000000000002',
      recordedAt: '2026-04-28T08:00:00.000Z',
    });
    await writeRecording(dir, old);
    await writeRecording(dir, fresh);
    const result = await pruneRecordings(dir, { olderThanDays: 7, now });
    expect(result.pruned).toEqual([old.hash]);
    expect(result.skipped).toEqual([]);
    const entries = await readdir(dir);
    expect(entries).toEqual([`${fresh.hash}.json`]);
  });

  test('--dry-run leaves files on disk', async () => {
    const now = new Date('2026-04-28T10:00:00.000Z');
    const old = makeRecording({
      hash: '0000000000000001',
      recordedAt: '2026-04-18T10:00:00.000Z',
    });
    await writeRecording(dir, old);
    const result = await pruneRecordings(dir, {
      olderThanDays: 7,
      now,
      dryRun: true,
    });
    expect(result.pruned).toEqual([old.hash]);
    const entries = await readdir(dir);
    expect(entries).toEqual([`${old.hash}.json`]);
  });

  test('skips corrupt files without crashing', async () => {
    const now = new Date('2026-04-28T10:00:00.000Z');
    const old = makeRecording({
      hash: '0000000000000001',
      recordedAt: '2026-04-18T10:00:00.000Z',
    });
    await writeRecording(dir, old);
    writeFileSync(join(dir, '0000000000000002.json'), '{not json');
    const result = await pruneRecordings(dir, { olderThanDays: 7, now });
    expect(result.pruned).toEqual([old.hash]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.filename).toBe('0000000000000002.json');
    expect(readFileSync(join(dir, '0000000000000002.json'), 'utf8')).toBe('{not json');
  });

  test('cutoff math: exactly-N-day-old recording is NOT pruned (boundary inclusive)', async () => {
    const now = new Date('2026-04-28T10:00:00.000Z');
    const exactly = makeRecording({
      hash: '0000000000000001',
      recordedAt: '2026-04-21T10:00:00.000Z',
    });
    await writeRecording(dir, exactly);
    const result = await pruneRecordings(dir, { olderThanDays: 7, now });
    expect(result.pruned).toEqual([]);
  });
});

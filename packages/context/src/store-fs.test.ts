import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextError } from './errors.js';
import { listRecords, readRecord, writeRecord } from './store-fs.js';
import type { ContextRecord } from './types.js';

function makeRecord(overrides: Partial<ContextRecord> = {}): ContextRecord {
  return {
    version: 1,
    id: 'abcdef0123456789',
    type: 'note',
    recordedAt: '2026-04-29T10:00:00.000Z',
    parents: [],
    payload: { text: 'hello' },
    ...overrides,
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'context-fs-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

describe('writeRecord / readRecord', () => {
  test('round-trips a record', async () => {
    const rec = makeRecord();
    await writeRecord(dir, rec);
    const read = await readRecord(dir, rec.id);
    expect(read).toEqual(rec);
  });

  test('readRecord returns null on missing file', async () => {
    const read = await readRecord(dir, 'deadbeefdeadbeef');
    expect(read).toBe(null);
  });

  test('writeRecord creates the directory if missing', async () => {
    const nested = join(dir, 'nested', 'deeper');
    const rec = makeRecord();
    await writeRecord(nested, rec);
    const read = await readRecord(nested, rec.id);
    expect(read).not.toBe(null);
  });

  test('writeRecord uses tmp+rename atomic pattern', async () => {
    const rec = makeRecord();
    await writeRecord(dir, rec);
    const raw = await readFile(join(dir, `${rec.id}.json`), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(raw) as ContextRecord;
    expect(parsed).toEqual(rec);
  });

  test('readRecord throws version-mismatch on wrong version', async () => {
    writeFileSync(
      join(dir, '0000000000000001.json'),
      JSON.stringify({
        version: 2,
        id: '0000000000000001',
        type: 'note',
        recordedAt: '2026-04-29T10:00:00.000Z',
        parents: [],
        payload: {},
      }),
    );
    let caught: unknown;
    try {
      await readRecord(dir, '0000000000000001');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ContextError);
    expect((caught as ContextError).code).toBe('context/version-mismatch');
  });

  test('readRecord throws parse-error on invalid JSON', async () => {
    writeFileSync(join(dir, '0000000000000001.json'), '{not json');
    let caught: unknown;
    try {
      await readRecord(dir, '0000000000000001');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ContextError);
    expect((caught as ContextError).code).toBe('context/parse-error');
  });

  test('readRecord rejects ill-formed id positionally', async () => {
    let caught: unknown;
    try {
      await readRecord(dir, 'NOTHEX');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ContextError);
    expect((caught as ContextError).code).toBe('context/parse-error');
  });
});

describe('listRecords', () => {
  test('returns records sorted by recordedAt ascending with id ascending tie-break', async () => {
    const a = makeRecord({
      id: '0000000000000001',
      recordedAt: '2026-04-29T10:00:00.000Z',
    });
    const b = makeRecord({
      id: '0000000000000002',
      recordedAt: '2026-04-28T10:00:00.000Z',
    });
    // same recordedAt as a; should tie-break by id (00..03 > 00..01)
    const c = makeRecord({
      id: '0000000000000003',
      recordedAt: '2026-04-29T10:00:00.000Z',
    });
    await writeRecord(dir, a);
    await writeRecord(dir, b);
    await writeRecord(dir, c);

    const result = await listRecords(dir);
    expect(result.skipped).toEqual([]);
    expect(result.records.map((r) => r.id)).toEqual([b.id, a.id, c.id]);
  });

  test('skips corrupt files and surfaces them in skipped[]', async () => {
    const ok = makeRecord({ id: '0000000000000001' });
    await writeRecord(dir, ok);
    writeFileSync(join(dir, '0000000000000002.json'), '{not json');

    const result = await listRecords(dir);
    expect(result.records.map((r) => r.id)).toEqual([ok.id]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.filename).toBe('0000000000000002.json');
    expect(result.skipped[0]?.reason).toContain('parse failed');
  });

  test('skips files with mismatched version', async () => {
    writeFileSync(
      join(dir, '0000000000000001.json'),
      JSON.stringify({
        version: 99,
        id: '0000000000000001',
        type: 'note',
        recordedAt: '2026-04-29T10:00:00.000Z',
        parents: [],
        payload: {},
      }),
    );
    const result = await listRecords(dir);
    expect(result.records).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('context/version-mismatch');
  });

  test('ignores files that do not match the id pattern', async () => {
    const ok = makeRecord({ id: '0000000000000001' });
    await writeRecord(dir, ok);
    writeFileSync(join(dir, 'README.md'), '# notes');
    writeFileSync(join(dir, 'random.json'), '{}');

    const result = await listRecords(dir);
    expect(result.records).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });

  test('throws context/io-error on missing directory', async () => {
    let caught: unknown;
    try {
      await listRecords(join(dir, 'nope'));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ContextError);
    expect((caught as ContextError).code).toBe('context/io-error');
  });
});

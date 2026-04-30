import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeRecord } from './store-fs.js';
import type { ContextRecord } from './types.js';

const CLI = resolve(import.meta.dir, 'cli.ts');

function makeRecord(overrides: Partial<ContextRecord> & Pick<ContextRecord, 'id'>): ContextRecord {
  return {
    version: 1,
    type: 'note',
    recordedAt: '2026-04-29T10:00:00.000Z',
    parents: [],
    payload: { text: 'hi' },
    ...overrides,
  };
}

async function runCliProc(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'context-cli-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

describe('cli — usage', () => {
  test('no subcommand exits 2 with usage', async () => {
    const r = await runCliProc([]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Usage');
  });

  test('unknown subcommand exits 2', async () => {
    const r = await runCliProc(['nope']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Unknown subcommand: nope');
  });
});

describe('cli list and get', () => {
  test('list (with and without --type filter) and get (hit + miss)', async () => {
    const note = makeRecord({
      id: '0000000000000001',
      type: 'note',
      recordedAt: '2026-04-28T10:00:00.000Z',
    });
    const design = makeRecord({
      id: '0000000000000002',
      type: 'design',
      recordedAt: '2026-04-29T10:00:00.000Z',
    });
    await writeRecord(dir, note);
    await writeRecord(dir, design);

    const all = await runCliProc(['list', '--dir', dir]);
    expect(all.exitCode).toBe(0);
    const lines = all.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`${note.id}\tnote\t${note.recordedAt}`);
    expect(lines[1]).toBe(`${design.id}\tdesign\t${design.recordedAt}`);

    const filtered = await runCliProc(['list', '--type', 'design', '--dir', dir]);
    expect(filtered.exitCode).toBe(0);
    expect(filtered.stdout.trim()).toBe(`${design.id}\tdesign\t${design.recordedAt}`);

    const got = await runCliProc(['get', note.id, '--dir', dir]);
    expect(got.exitCode).toBe(0);
    const parsed = JSON.parse(got.stdout) as ContextRecord;
    expect(parsed).toEqual(note);

    const miss = await runCliProc(['get', 'deadbeefdeadbeef', '--dir', dir]);
    expect(miss.exitCode).toBe(3);
    expect(miss.stderr).toContain('context/record-not-found');
    expect(miss.stderr).toContain('deadbeefdeadbeef');
    expect(miss.stdout).toBe('');
  });

  test('list reports corrupt files on stderr but exits 0', async () => {
    const ok = makeRecord({ id: '0000000000000001' });
    await writeRecord(dir, ok);
    writeFileSync(join(dir, '0000000000000002.json'), '{not json');

    const r = await runCliProc(['list', '--dir', dir]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(ok.id);
    expect(r.stderr).toContain('0000000000000002.json');
    expect(r.stderr).toContain('skipped');
  });

  test('list exits 3 when --dir does not exist', async () => {
    const r = await runCliProc(['list', '--dir', join(dir, 'nope')]);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('context/io-error');
  });

  test('get exits 2 when <id> positional is missing', async () => {
    const r = await runCliProc(['get', '--dir', dir]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Missing <id>');
  });
});

describe('cli tree', () => {
  test('tree renders ancestry; missing root exits 3', async () => {
    const a = makeRecord({
      id: 'aaaaaaaaaaaaaaaa',
      type: 'note',
      recordedAt: '2026-04-25T00:00:00.000Z',
    });
    const b = makeRecord({
      id: 'bbbbbbbbbbbbbbbb',
      type: 'brief',
      recordedAt: '2026-04-26T00:00:00.000Z',
      parents: [a.id],
    });
    const c = makeRecord({
      id: 'cccccccccccccccc',
      type: 'design',
      recordedAt: '2026-04-27T00:00:00.000Z',
      parents: [b.id],
    });
    await writeRecord(dir, a);
    await writeRecord(dir, b);
    await writeRecord(dir, c);

    const ok = await runCliProc(['tree', c.id, '--dir', dir]);
    expect(ok.exitCode).toBe(0);
    const lines = ok.stdout.trim().split('\n');
    expect(lines[0]).toBe(`${c.id} [type=design] 2026-04-27T00:00:00.000Z`);
    expect(lines[1]).toBe(`└── ${b.id} [type=brief] 2026-04-26T00:00:00.000Z`);
    expect(lines[2]).toBe(`    └── ${a.id} [type=note] 2026-04-25T00:00:00.000Z`);

    const miss = await runCliProc(['tree', 'deadbeefdeadbeef', '--dir', dir]);
    expect(miss.exitCode).toBe(3);
    expect(miss.stderr).toContain('context/record-not-found');
    expect(miss.stderr).toContain('deadbeefdeadbeef');
  });

  test('tree renders <missing> for absent ancestor and exits 0 (H-2)', async () => {
    const x = makeRecord({
      id: '1111111111111111',
      parents: ['00000000deadbeef'],
    });
    await writeRecord(dir, x);
    const r = await runCliProc(['tree', x.id, '--dir', dir]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${x.id}`);
    expect(r.stdout).toContain('00000000deadbeef <missing>');
  });

  test('tree renders <cycle> for cyclic records and exits 0 (H-3)', async () => {
    const aId = 'aaaaaaaaaaaaaaaa';
    const bId = 'bbbbbbbbbbbbbbbb';
    writeFileSync(
      join(dir, `${aId}.json`),
      `${JSON.stringify(
        {
          version: 1,
          id: aId,
          type: 'note',
          recordedAt: '2026-04-29T10:00:00.000Z',
          parents: [bId],
          payload: {},
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(dir, `${bId}.json`),
      `${JSON.stringify(
        {
          version: 1,
          id: bId,
          type: 'note',
          recordedAt: '2026-04-29T10:00:00.000Z',
          parents: [aId],
          payload: {},
        },
        null,
        2,
      )}\n`,
    );

    const r = await runCliProc(['tree', aId, '--dir', dir]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${aId} <cycle>`);
    // Each id appears at most twice (once as itself, once as cycle marker)
    const occurrencesA = (r.stdout.match(new RegExp(aId, 'g')) ?? []).length;
    const occurrencesB = (r.stdout.match(new RegExp(bId, 'g')) ?? []).length;
    expect(occurrencesA).toBeLessThanOrEqual(2);
    expect(occurrencesB).toBeLessThanOrEqual(2);
  });

  test('tree exits 2 when <id> positional is missing', async () => {
    const r = await runCliProc(['tree', '--dir', dir]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Missing <id>');
  });
});

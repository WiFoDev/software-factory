import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeRecording } from './store.js';
import type { Recording } from './types.js';

const CLI = resolve(import.meta.dir, 'cli.ts');

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
  dir = mkdtempSync(join(tmpdir(), 'twin-cli-'));
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

  test('unknown subcommand exits 2 with usage', async () => {
    const r = await runCliProc(['nope']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Unknown subcommand: nope');
  });
});

describe('cli list', () => {
  test('emits one tab-separated line per recording sorted ascending', async () => {
    const a = makeRecording({
      hash: '0000000000000001',
      recordedAt: '2026-04-28T10:00:00.000Z',
      request: { method: 'POST', url: 'https://api.x/a', headers: {}, body: null },
    });
    const b = makeRecording({
      hash: '0000000000000002',
      recordedAt: '2026-04-27T10:00:00.000Z',
      request: { method: 'GET', url: 'https://api.x/b', headers: {}, body: null },
    });
    await writeRecording(dir, a);
    await writeRecording(dir, b);

    const r = await runCliProc(['list', '--dir', dir]);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`${b.hash}\tGET\thttps://api.x/b\t${b.recordedAt}`);
    expect(lines[1]).toBe(`${a.hash}\tPOST\thttps://api.x/a\t${a.recordedAt}`);
  });

  test('exit 3 when dir does not exist', async () => {
    const r = await runCliProc(['list', '--dir', join(dir, 'nope')]);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('twin/io-error');
  });

  test('skipped corrupt files reported on stderr; exit 0', async () => {
    await writeRecording(dir, makeRecording({ hash: '0000000000000001' }));
    writeFileSync(join(dir, '0000000000000002.json'), '{not json');
    const r = await runCliProc(['list', '--dir', dir]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('0000000000000001');
    expect(r.stderr).toContain('0000000000000002.json');
    expect(r.stderr).toContain('skipped');
  });
});

describe('cli inspect', () => {
  test('prints recording JSON when found', async () => {
    const rec = makeRecording({ hash: '0000000000000001' });
    await writeRecording(dir, rec);
    const r = await runCliProc(['inspect', rec.hash, '--dir', dir]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as Recording;
    expect(parsed).toEqual(rec);
  });

  test('exits 3 with twin/recording-not-found on miss', async () => {
    const r = await runCliProc(['inspect', 'deadbeefdeadbeef', '--dir', dir]);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('twin/recording-not-found');
    expect(r.stderr).toContain('deadbeefdeadbeef');
    expect(r.stdout).toBe('');
  });

  test('exits 2 when hash positional is missing', async () => {
    const r = await runCliProc(['inspect', '--dir', dir]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Missing <hash>');
  });
});

describe('cli prune', () => {
  test('deletes recordings older than N days; --dry-run leaves them', async () => {
    // Both recordings are old relative to "now". Use tiny olderThanDays so
    // they're definitely older than the cutoff regardless of the wall clock
    // at test time.
    const old = makeRecording({
      hash: '0000000000000001',
      recordedAt: '2020-01-01T00:00:00.000Z',
    });
    await writeRecording(dir, old);

    const dryRun = await runCliProc(['prune', '--older-than', '1', '--dir', dir, '--dry-run']);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout.trim()).toBe(`${old.hash}\twould-prune`);
    let entries = await readdir(dir);
    expect(entries).toEqual([`${old.hash}.json`]);

    const real = await runCliProc(['prune', '--older-than', '1', '--dir', dir]);
    expect(real.exitCode).toBe(0);
    expect(real.stdout.trim()).toBe(`${old.hash}\tpruned`);
    entries = await readdir(dir);
    expect(entries).toEqual([]);
  });

  test('exits 0 when corrupt neighbor file is skipped, reports it on stderr', async () => {
    const old = makeRecording({
      hash: '0000000000000001',
      recordedAt: '2020-01-01T00:00:00.000Z',
    });
    await writeRecording(dir, old);
    writeFileSync(join(dir, '0000000000000002.json'), '{not json');

    const r = await runCliProc(['prune', '--older-than', '1', '--dir', dir]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${old.hash}\tpruned`);
    expect(r.stderr).toContain('0000000000000002.json');
    expect(r.stderr).toContain('skipped');
  });

  test('exits 2 when --older-than is missing', async () => {
    const r = await runCliProc(['prune', '--dir', dir]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Missing --older-than');
  });

  test('exits 2 when --older-than is malformed', async () => {
    const r = await runCliProc(['prune', '--older-than', 'abc', '--dir', dir]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('non-negative integer');
  });
});

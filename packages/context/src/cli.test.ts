import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

async function runCliProc(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
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

  test('default --direction is up; explicit --direction up matches default', async () => {
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
    await writeRecord(dir, a);
    await writeRecord(dir, b);

    const noFlag = await runCliProc(['tree', b.id, '--dir', dir]);
    expect(noFlag.exitCode).toBe(0);
    const explicit = await runCliProc(['tree', b.id, '--dir', dir, '--direction', 'up']);
    expect(explicit.exitCode).toBe(0);
    expect(explicit.stdout).toBe(noFlag.stdout);
    expect(noFlag.stdout).toContain(`${b.id}`);
    expect(noFlag.stdout).toContain(`└── ${a.id}`);
  });

  test('--direction down on root walks descendants', async () => {
    const root = makeRecord({
      id: 'aaaaaaaaaaaaaaaa',
      type: 'note',
      recordedAt: '2026-04-25T00:00:00.000Z',
    });
    const mid = makeRecord({
      id: 'bbbbbbbbbbbbbbbb',
      type: 'brief',
      recordedAt: '2026-04-26T00:00:00.000Z',
      parents: [root.id],
    });
    const leaf = makeRecord({
      id: 'cccccccccccccccc',
      type: 'design',
      recordedAt: '2026-04-27T00:00:00.000Z',
      parents: [mid.id],
    });
    await writeRecord(dir, root);
    await writeRecord(dir, mid);
    await writeRecord(dir, leaf);

    const r = await runCliProc(['tree', root.id, '--dir', dir, '--direction', 'down']);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines[0]).toBe(`${root.id} [type=note] 2026-04-25T00:00:00.000Z`);
    expect(lines[1]).toBe(`└── ${mid.id} [type=brief] 2026-04-26T00:00:00.000Z`);
    expect(lines[2]).toBe(`    └── ${leaf.id} [type=design] 2026-04-27T00:00:00.000Z`);
  });

  test('--direction down on missing root → exit 3', async () => {
    const r = await runCliProc(['tree', 'deadbeefdeadbeef', '--dir', dir, '--direction', 'down']);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('context/record-not-found');
  });

  test('--direction sideways → exit 2 with stderr label context/invalid-direction', async () => {
    const r = await runCliProc([
      'tree',
      'aaaaaaaaaaaaaaaa',
      '--dir',
      dir,
      '--direction',
      'sideways',
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('context/invalid-direction');
    expect(r.stderr).toContain("got 'sideways'");
  });

  test('--direction down with multiple descendants sorted by recordedAt then id', async () => {
    const root = makeRecord({ id: 'aaaaaaaaaaaaaaaa', recordedAt: '2026-04-25T00:00:00.000Z' });
    const c1 = makeRecord({
      id: 'cccccccccccccccc',
      recordedAt: '2026-04-27T00:00:00.000Z',
      parents: [root.id],
    });
    const c2 = makeRecord({
      id: 'bbbbbbbbbbbbbbbb',
      recordedAt: '2026-04-26T00:00:00.000Z',
      parents: [root.id],
    });
    await writeRecord(dir, root);
    await writeRecord(dir, c1);
    await writeRecord(dir, c2);
    const r = await runCliProc(['tree', root.id, '--dir', dir, '--direction', 'down']);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.trim().split('\n');
    // c2 (04-26) before c1 (04-27)
    expect(lines[1]).toContain(c2.id);
    expect(lines[2]).toContain(c1.id);
  });
});

// ----- v0.0.10: --context-dir synonym + --dir deprecation (S-3) ----------

describe('cli — v0.0.10 --context-dir synonym for --dir', () => {
  test('--context-dir is a synonym for --dir on factory-context tree', async () => {
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
    await writeRecord(dir, a);
    await writeRecord(dir, b);

    const withDir = await runCliProc(['tree', b.id, '--dir', dir]);
    const withContextDir = await runCliProc(['tree', b.id, '--context-dir', dir]);
    expect(withContextDir.exitCode).toBe(withDir.exitCode);
    expect(withContextDir.stdout).toBe(withDir.stdout);
    // --context-dir alone emits NO deprecation notice.
    expect(withContextDir.stderr).not.toContain('context/deprecated-flag');
  });

  test('--dir emits one-line deprecation notice', async () => {
    const a = makeRecord({
      id: 'aaaaaaaaaaaaaaaa',
      type: 'note',
      recordedAt: '2026-04-25T00:00:00.000Z',
    });
    await writeRecord(dir, a);

    const r = await runCliProc(['tree', a.id, '--dir', dir]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain(
      'context/deprecated-flag: --dir is deprecated; use --context-dir (will be removed in v0.1.0)',
    );
    // Deprecation notice fires exactly once.
    const occurrences = (r.stderr.match(/context\/deprecated-flag/g) ?? []).length;
    expect(occurrences).toBe(1);

    // When BOTH flags are passed, --context-dir wins (canonical takes precedence)
    // AND deprecation still fires for --dir.
    const both = await runCliProc([
      'tree',
      a.id,
      '--dir',
      '/nonexistent/path',
      '--context-dir',
      dir,
    ]);
    expect(both.exitCode).toBe(0);
    expect(both.stderr).toContain('context/deprecated-flag');
    expect(both.stdout).toContain(a.id);
  });

  test('factory-context list also accepts --context-dir as a synonym', async () => {
    const note = makeRecord({
      id: '0000000000000001',
      type: 'note',
      recordedAt: '2026-04-28T10:00:00.000Z',
    });
    await writeRecord(dir, note);

    const withDir = await runCliProc(['list', '--dir', dir]);
    const withContextDir = await runCliProc(['list', '--context-dir', dir]);
    expect(withContextDir.exitCode).toBe(0);
    expect(withContextDir.stdout).toBe(withDir.stdout);
    expect(withContextDir.stderr).not.toContain('context/deprecated-flag');
    // --dir variant emits deprecation.
    expect(withDir.stderr).toContain('context/deprecated-flag');

    // get also accepts --context-dir.
    const got = await runCliProc(['get', note.id, '--context-dir', dir]);
    expect(got.exitCode).toBe(0);
    expect(got.stderr).not.toContain('context/deprecated-flag');
    const parsed = JSON.parse(got.stdout) as ContextRecord;
    expect(parsed).toEqual(note);
  });
});

// ----- v0.0.14: universal default ./.factory + factory.config.json (S-2) ----

describe('cli — v0.0.14 default --context-dir resolves to ./.factory', () => {
  test('factory-context default --context-dir resolves to ./.factory', async () => {
    // Set up a tmp project with .factory/ holding records and NO ./context/.
    const project = mkdtempSync(join(tmpdir(), 'context-cli-default-'));
    const factoryDir = join(project, '.factory');
    mkdirSync(factoryDir);
    const note = makeRecord({
      id: '0000000000000001',
      type: 'note',
      recordedAt: '2026-04-28T10:00:00.000Z',
    });
    await writeRecord(factoryDir, note);

    // Invoke with NO --dir / --context-dir flag, cwd=project. The CLI's
    // resolution chain falls back to ./.factory (the v0.0.14 universal default).
    const r = await runCliProc(['list'], { cwd: project });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(`${note.id}\tnote\t${note.recordedAt}`);
    expect(r.stderr).not.toContain('context/deprecated-flag');

    // factory.config.json runtime.contextDir wins over the universal default.
    const customDir = join(project, 'custom-records');
    mkdirSync(customDir);
    const otherNote = makeRecord({
      id: '0000000000000002',
      type: 'design',
      recordedAt: '2026-04-29T10:00:00.000Z',
    });
    await writeRecord(customDir, otherNote);
    writeFileSync(
      join(project, 'factory.config.json'),
      JSON.stringify({ runtime: { contextDir: './custom-records' } }, null, 2),
    );
    const withConfig = await runCliProc(['list'], { cwd: project });
    expect(withConfig.exitCode).toBe(0);
    expect(withConfig.stdout.trim()).toBe(`${otherNote.id}\tdesign\t${otherNote.recordedAt}`);

    // CLI flag still wins over factory.config.json.
    const cliFlagDir = await runCliProc(['list', '--context-dir', factoryDir], { cwd: project });
    expect(cliFlagDir.exitCode).toBe(0);
    expect(cliFlagDir.stdout.trim()).toBe(`${note.id}\tnote\t${note.recordedAt}`);

    await Bun.$`rm -rf ${project}`.quiet().nothrow();
  });

  test('--dir alias from v0.0.10 still works', async () => {
    const note = makeRecord({
      id: '0000000000000001',
      type: 'note',
      recordedAt: '2026-04-28T10:00:00.000Z',
    });
    await writeRecord(dir, note);

    const r = await runCliProc(['list', '--dir', dir]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(`${note.id}\tnote\t${note.recordedAt}`);
    // The deprecation notice is still emitted on --dir.
    expect(r.stderr).toContain(
      'context/deprecated-flag: --dir is deprecated; use --context-dir (will be removed in v0.1.0)',
    );
  });
});

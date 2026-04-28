import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CliIo, runCli } from './cli';

const HARNESS_ROOT = resolve(import.meta.dir, '..');
const ALL_PASS_PATH = join(HARNESS_ROOT, 'test-fixtures/all-pass.md');

interface CapturedIo {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
  exitCode: () => number | null;
}

class ExitSignal extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`exit:${code}`);
    this.code = code;
  }
}

function makeIo(): CapturedIo {
  let out = '';
  let err = '';
  let code: number | null = null;
  const io: CliIo = {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    exit: (c) => {
      code = c;
      throw new ExitSignal(c);
    },
  };
  return {
    io,
    stdout: () => out,
    stderr: () => err,
    exitCode: () => code,
  };
}

async function run(argv: string[], io: CliIo): Promise<void> {
  try {
    await runCli(argv, io);
  } catch (err) {
    if (!(err instanceof ExitSignal)) throw err;
  }
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'harness-cli-'));
}

const FAILING_SPEC = (failingTestPath: string): string =>
  [
    '---',
    'id: harness-failing',
    'classification: light',
    'type: feat',
    'status: ready',
    '---',
    '',
    '## Scenarios',
    '**S-1** — fail',
    '  Given x',
    '  When y',
    '  Then z',
    '  Satisfaction:',
    `    - test: ${failingTestPath}`,
    '',
  ].join('\n');

describe('factory-harness CLI', () => {
  test('exit 0 on all-pass fixture (DoD smoke)', async () => {
    const io = makeIo();
    await run(['run', ALL_PASS_PATH, '--no-judge'], io.io);
    expect(io.exitCode()).toBe(0);
    expect(io.stdout()).toContain('summary: pass=2');
    expect(io.stdout()).toContain('→ pass');
  }, 30_000);

  test('exit 1 when a scenario fails', async () => {
    const dir = tmpDir();
    const specPath = join(dir, 'failing.md');
    // Use absolute path so cwd-relative resolution finds the fixture.
    writeFileSync(specPath, FAILING_SPEC(join(HARNESS_ROOT, 'test-fixtures/failing.test.ts')));
    const io = makeIo();
    await run(['run', specPath, '--no-judge'], io.io);
    expect(io.exitCode()).toBe(1);
    expect(io.stdout()).toContain('→ fail');
  }, 30_000);

  test('exit 3 on missing spec file', async () => {
    const io = makeIo();
    await run(['run', '/definitely/not/a/spec-xyz.md'], io.io);
    expect(io.exitCode()).toBe(3);
    expect(io.stderr()).toContain('Spec not found');
  });

  test('--scenario S-1 filters to one scenario', async () => {
    const io = makeIo();
    await run(['run', ALL_PASS_PATH, '--no-judge', '--scenario', 'S-1'], io.io);
    expect(io.exitCode()).toBe(0);
    expect(io.stdout()).toContain('summary: pass=1');
  }, 30_000);

  test('--scenario S-1,S-2 filters to two scenarios', async () => {
    const io = makeIo();
    await run(['run', ALL_PASS_PATH, '--no-judge', '--scenario', 'S-1,S-2'], io.io);
    expect(io.exitCode()).toBe(0);
    expect(io.stdout()).toContain('summary: pass=2');
  }, 30_000);

  test('--visible and --holdouts together exits 2', async () => {
    const io = makeIo();
    await run(['run', ALL_PASS_PATH, '--visible', '--holdouts'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('mutually exclusive');
  });

  test('missing <spec-path> exits 2', async () => {
    const io = makeIo();
    await run(['run'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('Missing <spec-path>');
  });

  test('unknown subcommand exits 2', async () => {
    const io = makeIo();
    await run(['wat'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('Unknown subcommand');
  });

  test('--reporter json emits a single valid JSON document to stdout', async () => {
    const io = makeIo();
    await run(['run', ALL_PASS_PATH, '--no-judge', '--reporter', 'json'], io.io);
    expect(io.exitCode()).toBe(0);
    const parsed = JSON.parse(io.stdout()) as { specId: string; status: string };
    expect(parsed.specId).toBe('harness-smoke-all-pass');
    expect(parsed.status).toBe('pass');
    // Notices/log lines stay on stderr; stdout is pure JSON.
    expect(io.stdout().trim().startsWith('{')).toBe(true);
  }, 30_000);

  test('invalid --reporter exits 2', async () => {
    const io = makeIo();
    await run(['run', ALL_PASS_PATH, '--reporter', 'xml'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain("--reporter must be 'text' or 'json'");
  });

  test('invalid --timeout-ms exits 2', async () => {
    const io = makeIo();
    await run(['run', ALL_PASS_PATH, '--timeout-ms', 'abc'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('--timeout-ms must be a positive integer');
  });
});

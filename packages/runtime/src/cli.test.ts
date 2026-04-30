import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CliIo, runCli } from './cli.js';

const RUNTIME_ROOT = resolve(import.meta.dir, '..');
const ALL_PASS = join(RUNTIME_ROOT, 'test-fixtures/all-pass.md');
const WILL_FAIL = join(RUNTIME_ROOT, 'test-fixtures/will-fail.md');

class ExitSignal extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`exit:${code}`);
    this.code = code;
  }
}

interface CapturedIo {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
  exitCode: () => number | null;
}

function makeIo(): CapturedIo {
  let out = '';
  let err = '';
  let code: number | null = null;
  const io: CliIo = {
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    exit: (c) => {
      code = c;
      throw new ExitSignal(c);
    },
  };
  return { io, stdout: () => out, stderr: () => err, exitCode: () => code };
}

async function invoke(argv: string[], io: CliIo): Promise<void> {
  try {
    await runCli(argv, io);
  } catch (err) {
    if (!(err instanceof ExitSignal)) throw err;
  }
}

let ctxDir: string;

beforeEach(() => {
  ctxDir = mkdtempSync(join(tmpdir(), 'runtime-cli-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${ctxDir}`.quiet().nothrow();
});

describe('factory-runtime CLI — usage', () => {
  test('no subcommand → exit 2', async () => {
    const cap = makeIo();
    await invoke([], cap.io);
    expect(cap.exitCode()).toBe(2);
    expect(cap.stderr()).toContain('Usage');
  });

  test('unknown subcommand → exit 2 with "Unknown subcommand"', async () => {
    const cap = makeIo();
    await invoke(['nope'], cap.io);
    expect(cap.exitCode()).toBe(2);
    expect(cap.stderr()).toContain('Unknown subcommand: nope');
  });

  test('run without spec path → exit 2', async () => {
    const cap = makeIo();
    await invoke(['run'], cap.io);
    expect(cap.exitCode()).toBe(2);
    expect(cap.stderr()).toContain('Missing <spec-path>');
  });
});

describe('factory-runtime CLI — converged path', () => {
  test('all-pass spec exits 0 with converged summary; persists run/phase/validate-report records', async () => {
    const cap = makeIo();
    await invoke(['run', ALL_PASS, '--no-judge', '--context-dir', ctxDir], cap.io);

    expect(cap.exitCode()).toBe(0);
    expect(cap.stdout()).toMatch(
      /^factory-runtime: converged in 1 iteration\(s\) \(run=[0-9a-f]{16},/,
    );

    // Persisted three record types
    const types = (await Bun.$`ls ${ctxDir}`.quiet().text()).trim().split('\n');
    expect(types.length).toBe(3);
  });
});

describe('factory-runtime CLI — no-converge path', () => {
  test('will-fail spec with --max-iterations 2 exits 1 and persists 2 phase + 2 validate-report records', async () => {
    const cap = makeIo();
    await invoke(
      ['run', WILL_FAIL, '--no-judge', '--max-iterations', '2', '--context-dir', ctxDir],
      cap.io,
    );

    expect(cap.exitCode()).toBe(1);
    expect(cap.stdout()).toContain('factory-runtime: no-converge after 2 iteration(s)');
    expect(cap.stdout()).toMatch(/run=[0-9a-f]{16}/);

    // 1 factory-run + 2 factory-phase + 2 factory-validate-report = 5 records
    const files = (await Bun.$`ls ${ctxDir}`.quiet().text()).trim().split('\n');
    expect(files.length).toBe(5);
  });
});

describe('factory-runtime CLI — operational errors', () => {
  test('missing spec → exit 3 with "Spec not found"', async () => {
    const cap = makeIo();
    await invoke(['run', '/tmp/does-not-exist-runtime-spec.md'], cap.io);
    expect(cap.exitCode()).toBe(3);
    expect(cap.stderr()).toContain('Spec not found');
  });

  test('invalid --max-iterations (0) → exit 2 with runtime/invalid-max-iterations', async () => {
    const cap = makeIo();
    await invoke(
      ['run', ALL_PASS, '--no-judge', '--max-iterations', '0', '--context-dir', ctxDir],
      cap.io,
    );
    expect(cap.exitCode()).toBe(2);
    expect(cap.stderr()).toContain('runtime/invalid-max-iterations');
  });

  test('invalid --max-iterations (negative) → exit 2', async () => {
    const cap = makeIo();
    await invoke(
      ['run', ALL_PASS, '--no-judge', '--max-iterations', '-1', '--context-dir', ctxDir],
      cap.io,
    );
    expect(cap.exitCode()).toBe(2);
  });

  test('invalid --max-iterations (non-numeric) → exit 2', async () => {
    const cap = makeIo();
    await invoke(
      ['run', ALL_PASS, '--no-judge', '--max-iterations', 'abc', '--context-dir', ctxDir],
      cap.io,
    );
    expect(cap.exitCode()).toBe(2);
  });
});

describe('factory-runtime CLI — scenario filter', () => {
  test('--scenario S-1 passes through to harness (validate-report.scenarios reflects filter)', async () => {
    const cap = makeIo();
    await invoke(
      ['run', ALL_PASS, '--no-judge', '--scenario', 'S-1', '--context-dir', ctxDir],
      cap.io,
    );
    expect(cap.exitCode()).toBe(0);

    // Locate the validate-report file and assert scenarios.length === 1.
    const fileList = (await Bun.$`ls ${ctxDir}`.quiet().text()).trim().split('\n');
    let foundReport = false;
    for (const fname of fileList) {
      const text = await Bun.file(join(ctxDir, fname)).text();
      const rec = JSON.parse(text) as { type: string; payload: { scenarios: unknown[] } };
      if (rec.type === 'factory-validate-report') {
        expect(rec.payload.scenarios.length).toBe(1);
        foundReport = true;
      }
    }
    expect(foundReport).toBe(true);
  });
});

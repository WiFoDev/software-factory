import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CliIo, runCli } from './cli.js';

const RUNTIME_ROOT = resolve(import.meta.dir, '..');
const ALL_PASS = join(RUNTIME_ROOT, 'test-fixtures/all-pass.md');
const WILL_FAIL = join(RUNTIME_ROOT, 'test-fixtures/will-fail.md');
const NEEDS_IMPL = join(RUNTIME_ROOT, 'test-fixtures/needs-impl.md');
const FAKE_CLAUDE = join(RUNTIME_ROOT, 'test-fixtures/fake-claude.ts');

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

describe('factory-runtime CLI — converged path (v0.0.1 [validate]-only via --no-implement)', () => {
  test('all-pass spec exits 0 with converged summary; persists run/phase/validate-report records', async () => {
    const cap = makeIo();
    await invoke(
      ['run', ALL_PASS, '--no-judge', '--no-implement', '--context-dir', ctxDir],
      cap.io,
    );

    expect(cap.exitCode()).toBe(0);
    expect(cap.stdout()).toMatch(
      /^factory-runtime: converged in 1 iteration\(s\) \(run=[0-9a-f]{16},/,
    );

    // Persisted three record types
    const types = (await Bun.$`ls ${ctxDir}`.quiet().text()).trim().split('\n');
    expect(types.length).toBe(3);
  });
});

describe('factory-runtime CLI — no-converge path (--no-implement)', () => {
  test('will-fail spec with --max-iterations 2 exits 1 and persists 2 phase + 2 validate-report records', async () => {
    const cap = makeIo();
    await invoke(
      [
        'run',
        WILL_FAIL,
        '--no-judge',
        '--no-implement',
        '--max-iterations',
        '2',
        '--context-dir',
        ctxDir,
      ],
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

describe('factory-runtime CLI — scenario filter (--no-implement)', () => {
  test('--scenario S-1 passes through to harness (validate-report.scenarios reflects filter)', async () => {
    const cap = makeIo();
    await invoke(
      [
        'run',
        ALL_PASS,
        '--no-judge',
        '--no-implement',
        '--scenario',
        'S-1',
        '--context-dir',
        ctxDir,
      ],
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

// ----- v0.0.2: default graph [implement → validate] (T6) ---------------

describe('factory-runtime CLI — default graph [implement → validate] (S-6)', () => {
  test('default flow with --claude-bin <fake>: exits 0; persists run + 2 phase + implement-report + validate-report; both phases pin to invocation cwd', async () => {
    // Isolated workdir so the agent's edits don't leak between test cases.
    // The CLI passes `cwd: process.cwd()` to both phases, so we chdir to the
    // workdir for the duration of the call and assert the persisted
    // implement-report.payload.cwd matches.
    const work = mkdtempSync(join(tmpdir(), 'runtime-cli-impl-work-'));
    const specMd = (await Bun.file(NEEDS_IMPL).text());
    const testTs = (await Bun.file(join(RUNTIME_ROOT, 'test-fixtures/needs-impl.test.ts')).text());
    await Bun.write(join(work, 'needs-impl.md'), specMd);
    await Bun.write(join(work, 'needs-impl.test.ts'), testTs);

    const cap = makeIo();
    const prevCwd = process.cwd();
    process.chdir(work);
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '5000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(work, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    process.env.FAKE_CLAUDE_RESULT = 'wrote src/needs-impl.ts';
    try {
      await invoke(
        [
          'run',
          'needs-impl.md',
          '--no-judge',
          '--claude-bin',
          FAKE_CLAUDE,
          '--twin-mode',
          'off',
          '--context-dir',
          ctxDir,
        ],
        cap.io,
      );

      expect(cap.exitCode()).toBe(0);
      expect(cap.stdout()).toMatch(
        /^factory-runtime: converged in 1 iteration\(s\) \(run=[0-9a-f]{16},/,
      );

      // 1 factory-run + 2 factory-phase + 1 factory-implement-report + 1 factory-validate-report = 5 records
      const fileList = (await Bun.$`ls ${ctxDir}`.quiet().text()).trim().split('\n');
      expect(fileList.length).toBe(5);

      // Locate the implement-report and verify cwd === workDir.
      let implementCwd: string | null = null;
      let graphPhases: string[] | null = null;
      for (const fname of fileList) {
        const text = await Bun.file(join(ctxDir, fname)).text();
        const rec = JSON.parse(text) as { type: string; payload: { cwd?: string; graphPhases?: string[] } };
        if (rec.type === 'factory-implement-report') {
          implementCwd = rec.payload.cwd ?? null;
        }
        if (rec.type === 'factory-run') {
          graphPhases = rec.payload.graphPhases ?? null;
        }
      }
      // macOS resolves /var to /private/var via symlink after chdir, so
      // compare against the resolved realpath.
      expect(implementCwd).toBe(realpathSync(work));
      expect(graphPhases).toEqual(['implement', 'validate']);
    } finally {
      process.chdir(prevCwd);
      delete process.env.FAKE_CLAUDE_MODE;
      delete process.env.FAKE_CLAUDE_TOKENS;
      delete process.env.FAKE_CLAUDE_EDIT_FILE;
      delete process.env.FAKE_CLAUDE_EDIT_CONTENT;
      delete process.env.FAKE_CLAUDE_RESULT;
      await Bun.$`rm -rf ${work}`.quiet().nothrow();
    }
  });

  test('cost-cap overrun via --max-prompt-tokens 100 + fake-claude tokens=150000 → exit 3 with detail line', async () => {
    const work = mkdtempSync(join(tmpdir(), 'runtime-cli-costcap-work-'));
    const specMd = (await Bun.file(NEEDS_IMPL).text());
    const testTs = (await Bun.file(join(RUNTIME_ROOT, 'test-fixtures/needs-impl.test.ts')).text());
    await Bun.write(join(work, 'needs-impl.md'), specMd);
    await Bun.write(join(work, 'needs-impl.test.ts'), testTs);

    const cap = makeIo();
    const prevCwd = process.cwd();
    process.chdir(work);
    process.env.FAKE_CLAUDE_MODE = 'cost-overrun';
    process.env.FAKE_CLAUDE_TOKENS = '150000';
    process.env.FAKE_CLAUDE_RESULT = 'over budget';
    try {
      await invoke(
        [
          'run',
          'needs-impl.md',
          '--no-judge',
          '--claude-bin',
          FAKE_CLAUDE,
          '--max-prompt-tokens',
          '100',
          '--twin-mode',
          'off',
          '--context-dir',
          ctxDir,
        ],
        cap.io,
      );

      expect(cap.exitCode()).toBe(3);
      expect(cap.stdout()).toContain("factory-runtime: error during phase 'implement' iteration 1");
      expect(cap.stdout()).toContain('detail: runtime/cost-cap-exceeded: input_tokens=150000 > maxPromptTokens=100');

      // factory-implement-report exists on disk with status='error'.
      let foundError = false;
      const fileList = (await Bun.$`ls ${ctxDir}`.quiet().text()).trim().split('\n');
      for (const fname of fileList) {
        const text = await Bun.file(join(ctxDir, fname)).text();
        const rec = JSON.parse(text) as { type: string; payload: { status?: string; failureDetail?: string } };
        if (rec.type === 'factory-implement-report') {
          expect(rec.payload.status).toBe('error');
          expect(rec.payload.failureDetail).toContain('cost-cap-exceeded:');
          foundError = true;
        }
      }
      expect(foundError).toBe(true);
    } finally {
      process.chdir(prevCwd);
      delete process.env.FAKE_CLAUDE_MODE;
      delete process.env.FAKE_CLAUDE_TOKENS;
      delete process.env.FAKE_CLAUDE_RESULT;
      await Bun.$`rm -rf ${work}`.quiet().nothrow();
    }
  });

  test('--max-prompt-tokens 0 → exit 2 with runtime/invalid-max-prompt-tokens', async () => {
    const cap = makeIo();
    await invoke(
      [
        'run',
        ALL_PASS,
        '--no-judge',
        '--max-prompt-tokens',
        '0',
        '--context-dir',
        ctxDir,
      ],
      cap.io,
    );
    expect(cap.exitCode()).toBe(2);
    expect(cap.stderr()).toContain('runtime/invalid-max-prompt-tokens');
    expect(cap.stderr()).toContain('must be a positive integer');
  });

  test('--max-prompt-tokens non-numeric → exit 2', async () => {
    const cap = makeIo();
    await invoke(
      [
        'run',
        ALL_PASS,
        '--no-judge',
        '--max-prompt-tokens',
        'huge',
        '--context-dir',
        ctxDir,
      ],
      cap.io,
    );
    expect(cap.exitCode()).toBe(2);
    expect(cap.stderr()).toContain('runtime/invalid-max-prompt-tokens');
  });

  test('--twin-mode invalid → exit 2 with runtime/invalid-twin-mode', async () => {
    const cap = makeIo();
    await invoke(
      [
        'run',
        ALL_PASS,
        '--no-judge',
        '--twin-mode',
        'bogus',
        '--context-dir',
        ctxDir,
      ],
      cap.io,
    );
    expect(cap.exitCode()).toBe(2);
    expect(cap.stderr()).toContain('runtime/invalid-twin-mode');
  });
});

// ----- v0.0.2: H-2 holdout — --no-implement parity with v0.0.1 ----------

describe('factory-runtime CLI — --no-implement parity (H-2)', () => {
  test('--no-implement against all-pass: exact v0.0.1 record set; works even with claude not on PATH', async () => {
    const cap = makeIo();
    // Force claude off PATH so the test proves --no-implement does NOT
    // instantiate implementPhase. (We override claudePath via --claude-bin
    // pointing at a guaranteed-missing path; the implement-tuning flags are
    // inert in --no-implement mode and should have no effect.)
    await invoke(
      [
        'run',
        ALL_PASS,
        '--no-judge',
        '--no-implement',
        '--claude-bin',
        '/this/does/not/exist/claude',
        '--context-dir',
        ctxDir,
      ],
      cap.io,
    );

    expect(cap.exitCode()).toBe(0);
    expect(cap.stdout()).toMatch(
      /^factory-runtime: converged in 1 iteration\(s\) \(run=[0-9a-f]{16},/,
    );

    // Exactly v0.0.1 record set: 1 factory-run + 1 factory-phase + 1 factory-validate-report.
    const fileList = (await Bun.$`ls ${ctxDir}`.quiet().text()).trim().split('\n');
    expect(fileList.length).toBe(3);
    const types = new Set<string>();
    for (const fname of fileList) {
      const text = await Bun.file(join(ctxDir, fname)).text();
      const rec = JSON.parse(text) as { type: string; payload: { phaseName?: string; graphPhases?: string[] } };
      types.add(rec.type);
      if (rec.type === 'factory-phase') {
        expect(rec.payload.phaseName).toBe('validate');
      }
      if (rec.type === 'factory-run') {
        expect(rec.payload.graphPhases).toEqual(['validate']);
      }
    }
    expect(types).toEqual(new Set(['factory-run', 'factory-phase', 'factory-validate-report']));
  });
});

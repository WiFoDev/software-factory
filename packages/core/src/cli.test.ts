import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CliIo, runCli } from './cli';

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

function run(argv: string[], io: CliIo): void {
  try {
    runCli(argv, io);
  } catch (err) {
    if (!(err instanceof ExitSignal)) throw err;
  }
}

const VALID_SPEC = [
  '---',
  'id: demo-1',
  'classification: light',
  'type: feat',
  'status: ready',
  '---',
  '',
  '## Scenarios',
  '**S-1** — happy',
  '  Given a',
  '  When b',
  '  Then c',
  '  Satisfaction:',
  '    - test: src/foo.test.ts',
  '',
].join('\n');

const BROKEN_SPEC = VALID_SPEC.replace('id: demo-1\n', '');

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'factory-cli-'));
}

describe('runCli', () => {
  test('exit codes and output match expectations', () => {
    const dir = tmpDir();
    const validPath = join(dir, 'valid.md');
    const brokenPath = join(dir, 'broken.md');
    writeFileSync(validPath, VALID_SPEC);
    writeFileSync(brokenPath, BROKEN_SPEC);

    const okIo = makeIo();
    run(['spec', 'lint', validPath], okIo.io);
    expect(okIo.exitCode()).toBe(0);
    expect(okIo.stdout()).toBe('OK\n');
    expect(okIo.stderr()).toBe('');

    const failIo = makeIo();
    run(['spec', 'lint', brokenPath], failIo.io);
    expect(failIo.exitCode()).toBe(1);
    expect(failIo.stderr()).toContain('frontmatter/missing-field');
    expect(failIo.stderr()).toContain(brokenPath);
    expect(failIo.stdout()).toBe('');
  });

  test('lint walks a directory recursively for *.md files', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'a.md'), VALID_SPEC);
    const sub = join(dir, 'sub');
    require('node:fs').mkdirSync(sub);
    writeFileSync(join(sub, 'b.md'), BROKEN_SPEC);
    writeFileSync(join(dir, 'c.txt'), 'ignored');

    const io = makeIo();
    run(['spec', 'lint', dir], io.io);
    expect(io.exitCode()).toBe(1);
    expect(io.stderr()).toContain('b.md');
    expect(io.stderr()).not.toContain('c.txt');
  });

  test('schema subcommand prints JSON Schema to stdout', () => {
    const io = makeIo();
    run(['spec', 'schema'], io.io);
    expect(io.exitCode()).toBe(0);
    const parsed = JSON.parse(io.stdout()) as { title?: string };
    expect(parsed.title).toBe('Factory Spec Frontmatter');
  });

  test('schema --out writes to file', () => {
    const dir = tmpDir();
    const out = join(dir, 'schema.json');
    const io = makeIo();
    run(['spec', 'schema', '--out', out], io.io);
    expect(io.exitCode()).toBe(0);
    const written = require('node:fs').readFileSync(out, 'utf8');
    expect(JSON.parse(written).title).toBe('Factory Spec Frontmatter');
  });

  test('unknown subcommand exits 2 with usage on stderr', () => {
    const io = makeIo();
    run(['spec', 'wat'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('Usage:');
  });

  test('missing <path> on lint exits 2', () => {
    const io = makeIo();
    run(['spec', 'lint'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('Missing <path>');
  });

  test('lint of a nonexistent path exits 1 with a clear message', () => {
    const io = makeIo();
    run(['spec', 'lint', '/definitely/not/a/real/path-xyz.md'], io.io);
    expect(io.exitCode()).toBe(1);
    expect(io.stderr()).toContain('Path not found');
  });
});

describe('CLI subprocess (Bun.spawn)', () => {
  test('runs the source CLI end-to-end via bun', async () => {
    const dir = tmpDir();
    const validPath = join(dir, 'valid.md');
    writeFileSync(validPath, VALID_SPEC);
    const cliPath = resolve(import.meta.dir, 'cli.ts');
    const proc = Bun.spawn(['bun', 'run', cliPath, 'spec', 'lint', validPath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toBe('OK\n');
  });
});

describe('runCli — top-level dispatch', () => {
  test('factory init dispatches to runInit (creates scaffold in cwd)', () => {
    const originalCwd = process.cwd();
    const dir = tmpDir();
    process.chdir(dir);
    try {
      const io = makeIo();
      run(['init'], io.io);
      expect(io.exitCode()).toBe(0);
      expect(require('node:fs').existsSync(join(dir, 'package.json'))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('factory init --name forwards the flag', () => {
    const originalCwd = process.cwd();
    const dir = tmpDir();
    process.chdir(dir);
    try {
      const io = makeIo();
      run(['init', '--name', 'demo'], io.io);
      expect(io.exitCode()).toBe(0);
      const pkg = JSON.parse(require('node:fs').readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.name).toBe('demo');
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('USAGE includes init and spec review entries', () => {
    const io = makeIo();
    run([], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('factory init');
    expect(io.stderr()).toContain('spec review');
  });
});

describe('runCli — v0.0.14 spec review subprocess transition (S-1, S-2, S-3)', () => {
  const CLI_PATH = resolve(import.meta.dir, 'cli.ts');
  // Use the running bun's absolute path so we don't depend on PATH lookup
  // for the test runner itself — only for resolving `factory-spec-review`.
  const BUN_BIN = process.execPath;

  function makeFakeBinDir(scriptBody: string): string {
    const dir = tmpDir();
    const bin = join(dir, 'factory-spec-review');
    writeFileSync(bin, scriptBody);
    chmodSync(bin, 0o755);
    return dir;
  }

  test('factory spec review spawns factory-spec-review bin (v0.0.14 — subprocess transition)', async () => {
    const fakeDir = makeFakeBinDir(
      [
        '#!/usr/bin/env bash',
        'echo "fake-bin-stdout: $@"',
        'echo "fake-bin-stderr" >&2',
        'exit 0',
        '',
      ].join('\n'),
    );
    const proc = Bun.spawn([BUN_BIN, 'run', CLI_PATH, 'spec', 'review', 'docs/specs/foo.md'], {
      stdout: 'pipe',
      stderr: 'pipe',
      // PATH points only at the fake-bin dir — proves the dispatcher
      // resolves `factory-spec-review` via PATH, not via package resolution.
      // Include /usr/bin:/bin so the fake bin's `#!/usr/bin/env bash`
      // shebang can resolve. factory-spec-review is NOT in those system
      // dirs, so this still proves the dispatcher resolves via PATH.
      env: { ...process.env, PATH: `${fakeDir}:/usr/bin:/bin` },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain('fake-bin-stdout: docs/specs/foo.md');
    expect(stderr).toContain('fake-bin-stderr');
  });

  test('factory spec review surfaces ENOENT cleanly when bin is not on PATH', async () => {
    const emptyDir = tmpDir();
    const proc = Bun.spawn([BUN_BIN, 'run', CLI_PATH, 'spec', 'review', 'foo.md'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PATH: emptyDir },
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(2);
    expect(stderr).toContain('factory-spec-review not found on PATH');
    expect(stderr).toContain('npm install @wifo/factory-spec-review');
  });

  test('core/cli.ts no longer imports createRequire', () => {
    // v0.0.14 retired the cycle-break workaround in favor of
    // child_process.spawn — process boundary eliminates the CJS/ESM
    // mismatch against spec-review's ESM-only exports map.
    const cliSource = readFileSync(CLI_PATH, 'utf8');
    expect(cliSource).not.toContain("import { createRequire } from 'node:module'");
    expect(cliSource).not.toContain('createRequire(import.meta.url)');
    expect(cliSource).not.toContain("from 'node:module'");
  });

  test('core/cli.ts uses node:child_process.spawn for the spec-review dispatcher', () => {
    const cliSource = readFileSync(CLI_PATH, 'utf8');
    expect(cliSource).toContain("import { spawn } from 'node:child_process';");
    expect(cliSource).toContain("spawn('factory-spec-review'");
  });

  test('factory spec review exit code propagates from spawned bin', async () => {
    const fakeDir = makeFakeBinDir(
      ['#!/usr/bin/env bash', 'echo "running"', 'echo "boom" >&2', 'exit 1', ''].join('\n'),
    );
    const proc = Bun.spawn([BUN_BIN, 'run', CLI_PATH, 'spec', 'review', 'x.md'], {
      stdout: 'pipe',
      stderr: 'pipe',
      // Include /usr/bin:/bin so the fake bin's `#!/usr/bin/env bash`
      // shebang can resolve. factory-spec-review is NOT in those system
      // dirs, so this still proves the dispatcher resolves via PATH.
      env: { ...process.env, PATH: `${fakeDir}:/usr/bin:/bin` },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stdout).toContain('running');
    expect(stderr).toContain('boom');
  });
});

describe('runCli — v0.0.14 factory finish-task (S-3)', () => {
  // The CLI subcommand `factory finish-task <id>` calls the library helper
  // `finishTask({ specId, dir, contextDir })` (exported from
  // `packages/core/src/index.ts`). These tests exercise that helper directly —
  // the CLI's only job above it is `parseArgs` + `io.exit` formatting.
  function tmpCtxAndDir(): { ctxDir: string; specsDir: string } {
    return {
      ctxDir: mkdtempSync(join(tmpdir(), 'factory-finish-ctx-')),
      specsDir: mkdtempSync(join(tmpdir(), 'factory-finish-specs-')),
    };
  }

  function writeRecord(
    ctxDir: string,
    record: {
      version: 1;
      id: string;
      type: string;
      recordedAt: string;
      parents: string[];
      payload: unknown;
    },
  ): void {
    writeFileSync(join(ctxDir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  }

  function makeConvergedRunFixture(
    ctxDir: string,
    specId: string,
    runId = '0123456789abcdef',
  ): string {
    writeRecord(ctxDir, {
      version: 1,
      id: runId,
      type: 'factory-run',
      recordedAt: '2026-05-05T00:00:00.000Z',
      parents: [],
      payload: {
        specId,
        graphPhases: ['validate'],
        maxIterations: 5,
        startedAt: '2026-05-05T00:00:00.000Z',
      },
    });
    writeRecord(ctxDir, {
      version: 1,
      id: `${runId.slice(0, 8)}fedcba98`.slice(0, 16),
      type: 'factory-phase',
      recordedAt: '2026-05-05T00:00:01.000Z',
      parents: [runId],
      payload: {
        phaseName: 'validate',
        iteration: 1,
        status: 'pass',
        durationMs: 10,
        outputRecordIds: [],
      },
    });
    return runId;
  }

  test('factory finish-task <id> moves spec file to done/ and emits factory-spec-shipped record', async () => {
    const { finishTask } = await import('./finish-task.js');
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const specId = 'core-store-and-slug';
    const runId = makeConvergedRunFixture(ctxDir, specId);
    const fromPath = join(specsDir, `${specId}.md`);
    writeFileSync(fromPath, '---\nid: core-store-and-slug\n---\n# spec\n');

    const result = await finishTask({ specId, dir: specsDir, contextDir: ctxDir });

    expect(result.runId).toBe(runId);
    expect(result.fromPath).toBe(fromPath);
    expect(result.toPath).toBe(join(specsDir, 'done', `${specId}.md`));
    expect(existsSync(fromPath)).toBe(false);
    expect(existsSync(result.toPath)).toBe(true);

    // Persisted factory-spec-shipped record references the run as parent.
    const fs = require('node:fs') as typeof import('node:fs');
    const ctxEntries = fs.readdirSync(ctxDir).filter((f) => f.endsWith('.json'));
    let shippedRecord:
      | {
          type: string;
          parents: string[];
          payload: { specId: string; fromPath: string; toPath: string; shippedAt: string };
        }
      | undefined;
    for (const f of ctxEntries) {
      const rec = JSON.parse(fs.readFileSync(join(ctxDir, f), 'utf8'));
      if (rec.type === 'factory-spec-shipped') shippedRecord = rec;
    }
    expect(shippedRecord).toBeDefined();
    if (shippedRecord === undefined) return;
    expect(shippedRecord.parents).toEqual([runId]);
    expect(shippedRecord.payload.specId).toBe(specId);
    expect(shippedRecord.payload.fromPath).toBe(fromPath);
    expect(shippedRecord.payload.toPath).toBe(result.toPath);
    expect(shippedRecord.payload.shippedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('factory finish-task refuses to move when no converged factory-run exists', async () => {
    const { finishTask } = await import('./finish-task.js');
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const specId = 'never-ran';
    const fromPath = join(specsDir, `${specId}.md`);
    writeFileSync(fromPath, '---\nid: never-ran\n---\n');

    let caught: unknown;
    try {
      await finishTask({ specId, dir: specsDir, contextDir: ctxDir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(
      `factory: no converged factory-run found for spec id ${specId}; refusing to move`,
    );
    // Spec was NOT moved.
    expect(existsSync(fromPath)).toBe(true);
    expect(existsSync(join(specsDir, 'done', `${specId}.md`))).toBe(false);
  });

  test('factory finish-task creates done/ dir when missing', async () => {
    const { finishTask } = await import('./finish-task.js');
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const specId = 'fresh-dir';
    makeConvergedRunFixture(ctxDir, specId);
    writeFileSync(join(specsDir, `${specId}.md`), '---\nid: fresh-dir\n---\n');

    expect(existsSync(join(specsDir, 'done'))).toBe(false);
    const result = await finishTask({ specId, dir: specsDir, contextDir: ctxDir });
    expect(existsSync(result.toPath)).toBe(true);
  });

  test('factory finish-task refuses when only a no-converge factory-run exists for the spec', async () => {
    const { finishTask } = await import('./finish-task.js');
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const specId = 'flaky-spec';
    const runId = '0011223344556677';
    writeRecord(ctxDir, {
      version: 1,
      id: runId,
      type: 'factory-run',
      recordedAt: '2026-05-05T00:00:00.000Z',
      parents: [],
      payload: {
        specId,
        graphPhases: ['validate'],
        maxIterations: 5,
        startedAt: '2026-05-05T00:00:00.000Z',
      },
    });
    // Terminal phase status='fail' → not converged.
    writeRecord(ctxDir, {
      version: 1,
      id: 'aabbccddeeff0011',
      type: 'factory-phase',
      recordedAt: '2026-05-05T00:00:01.000Z',
      parents: [runId],
      payload: {
        phaseName: 'validate',
        iteration: 1,
        status: 'fail',
        durationMs: 10,
        outputRecordIds: [],
      },
    });
    writeFileSync(join(specsDir, `${specId}.md`), '---\nid: flaky-spec\n---\n');

    let caught: unknown;
    try {
      await finishTask({ specId, dir: specsDir, contextDir: ctxDir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('refusing to move');
  });
});

describe('runCli — v0.0.14 factory finish-task --all-converged (S-3 mutual-exclusion)', () => {
  test('factory finish-task rejects positional id + --all-converged combination', () => {
    const io = makeIo();
    run(['finish-task', 'my-spec', '--all-converged'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain(
      'factory: --all-converged is mutually exclusive with positional <spec-id>',
    );
  });
});

// ----- v0.0.14: resolveContextDir precedence (S-3) ----------

describe('runCli — v0.0.14 resolveContextDir precedence (S-3)', () => {
  test('resolveContextDir precedence: CLI flag > config > universal default', async () => {
    const { resolveContextDir, FACTORY_CONTEXT_DIR_DEFAULT } = await import('./context-dir.js');

    // CLI flag wins over everything.
    expect(resolveContextDir({ cliFlag: './from-cli', configValue: './from-config' })).toBe(
      './from-cli',
    );
    expect(resolveContextDir({ cliFlag: './from-cli' })).toBe('./from-cli');

    // Config wins over default when no CLI flag.
    expect(resolveContextDir({ configValue: './from-config' })).toBe('./from-config');

    // Universal default applies when neither flag nor config is set.
    expect(resolveContextDir({})).toBe('./.factory');
    expect(FACTORY_CONTEXT_DIR_DEFAULT).toBe('./.factory');

    // Undefined inputs (explicit) treated like missing inputs.
    expect(resolveContextDir({ cliFlag: undefined, configValue: undefined })).toBe('./.factory');
  });
});

describe('factory spec watch documentation', () => {
  const README = resolve(import.meta.dir, '..', 'README.md');

  test('factory spec watch is documented in packages/core/README.md', () => {
    const text = readFileSync(README, 'utf8');
    expect(text).toContain('factory spec watch');
    expect(text).toContain('--review');
    expect(text).toContain('--debounce-ms');
  });

  test('Hook recipe is documented in packages/core/README.md', () => {
    const text = readFileSync(README, 'utf8');
    expect(text).toContain('PostToolUse');
    expect(text).toContain('Harness-enforced spec linting');
    expect(text).toContain('factory spec lint');
    expect(text).toContain('factory spec review');
  });
});

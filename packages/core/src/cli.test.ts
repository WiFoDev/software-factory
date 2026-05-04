import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

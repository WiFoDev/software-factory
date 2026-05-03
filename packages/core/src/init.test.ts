import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { CliIo } from './cli.js';
import { GITIGNORE_TEMPLATE } from './init-templates.js';
import { runInit } from './init.js';

class ExitSignal extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`exit:${code}`);
    this.code = code;
  }
}

function makeIo(): {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
  exitCode: () => number | null;
} {
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
  return { io, stdout: () => out, stderr: () => err, exitCode: () => code };
}

function run(args: string[], io: CliIo): void {
  try {
    runInit(args, io);
  } catch (err) {
    if (!(err instanceof ExitSignal)) throw err;
  }
}

let dir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'factory-init-'));
  process.chdir(dir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

describe('runInit — happy path', () => {
  test('init in empty cwd creates the canonical scaffold + prints next-steps', () => {
    const io = makeIo();
    run([], io.io);
    expect(io.exitCode()).toBe(0);

    // All 7 expected files exist.
    expect(existsSync(join(dir, 'package.json'))).toBe(true);
    expect(existsSync(join(dir, 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
    expect(existsSync(join(dir, 'src/.gitkeep'))).toBe(true);
    expect(existsSync(join(dir, 'docs/specs/done/.gitkeep'))).toBe(true);
    expect(existsSync(join(dir, 'docs/technical-plans/done/.gitkeep'))).toBe(true);

    // package.json name = sanitized basename(cwd) (lowercased; mkdtemp's
    // suffix may include uppercase chars which the npm-style regex rejects).
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const expectedName = basename(dir)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+/, '');
    expect(pkg.name).toBe(expectedName);
    expect(pkg.dependencies['@wifo/factory-core']).toBe('^0.0.8');

    // tsconfig.json is self-contained.
    const tsconfig = JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8'));
    expect(tsconfig.extends).toBeUndefined();
    expect(tsconfig.compilerOptions.strict).toBe(true);

    // .gitignore byte-equal to template.
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(GITIGNORE_TEMPLATE);

    // README has the (sanitized) package name in the first heading.
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain(`# ${expectedName}`);
    expect(readme).not.toContain('{{name}}');

    // .gitkeep files are zero bytes.
    expect(statSync(join(dir, 'src/.gitkeep')).size).toBe(0);
    expect(statSync(join(dir, 'docs/specs/done/.gitkeep')).size).toBe(0);

    // Next-steps checklist on stdout.
    const out = io.stdout();
    expect(out).toContain('Created scaffold:');
    expect(out).toContain('Next steps:');
    expect(out).toContain('pnpm install');
    expect(out).toContain('factory spec lint docs/specs/');
  });

  test('--name overrides package.json name; everything else identical', () => {
    const io = makeIo();
    run(['--name', 'my-thing'], io.io);
    expect(io.exitCode()).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-thing');
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('# my-thing');
  });
});

describe('runInit — name validation', () => {
  test('--name with spaces → exit 2 with stderr label init/invalid-name', () => {
    const io = makeIo();
    run(['--name', 'Bad Name'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('init/invalid-name');
    expect(io.stderr()).toContain("got 'Bad Name'");
    // No files written.
    expect(existsSync(join(dir, 'package.json'))).toBe(false);
  });

  test('--name with uppercase → exit 2', () => {
    const io = makeIo();
    run(['--name', 'MyThing'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('init/invalid-name');
  });

  test('--name starting with dash → exit 2', () => {
    // parseArgs rejects bare `--name -bad` as ambiguous; use `=` form to
    // route the value through to runInit's regex check.
    const io = makeIo();
    run(['--name=-bad'], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('init/invalid-name');
  });
});

describe('runInit — v0.0.5.1 first-contact UX scaffolds', () => {
  test('scaffold devDependencies include @wifo/factory-spec-review at ^0.0.5', () => {
    const io = makeIo();
    run(['--name', 'test'], io.io);
    expect(io.exitCode()).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@wifo/factory-spec-review']).toBe('^0.0.8');
    // Existing devDep stays alongside.
    expect(pkg.devDependencies['@types/bun']).toBeDefined();
  });

  test('scaffold gitignore includes .factory-spec-review-cache', () => {
    const io = makeIo();
    run(['--name', 'test'], io.io);
    expect(io.exitCode()).toBe(0);
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.factory-spec-review-cache');
    // Existing entries still present.
    expect(gitignore).toContain('node_modules');
    expect(gitignore).toContain('.factory');
    expect(gitignore).toContain('*.log');
    expect(gitignore).toContain('.DS_Store');
  });

  test('scaffold writes factory.config.json with documented defaults', () => {
    const io = makeIo();
    run(['--name', 'test'], io.io);
    expect(io.exitCode()).toBe(0);
    const configPath = join(dir, 'factory.config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config).toEqual({
      runtime: {
        maxIterations: 5,
        maxTotalTokens: 1000000,
        maxPromptTokens: 100000,
        noJudge: false,
      },
    });
  });

  test('scaffold writes .claude/commands/scope-project.md byte-identical to bundled source', () => {
    const io = makeIo();
    run(['--name', 'test'], io.io);
    expect(io.exitCode()).toBe(0);
    const scaffolded = join(dir, '.claude/commands/scope-project.md');
    expect(existsSync(scaffolded)).toBe(true);
    const canonical = resolve(import.meta.dir, '..', 'commands', 'scope-project.md');
    expect(readFileSync(scaffolded, 'utf8')).toBe(readFileSync(canonical, 'utf8'));
  });

  test('scaffold .claude/commands/scope-project.md is a regular file, not a symlink', () => {
    const io = makeIo();
    run(['--name', 'test'], io.io);
    expect(io.exitCode()).toBe(0);
    const scaffolded = join(dir, '.claude/commands/scope-project.md');
    const stat = lstatSync(scaffolded);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isFile()).toBe(true);
  });

  test('scaffold dependencies pin @wifo/factory-* at ^0.0.8', () => {
    const io = makeIo();
    run(['--name', 'test'], io.io);
    expect(io.exitCode()).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@wifo/factory-context']).toBe('^0.0.8');
    expect(pkg.dependencies['@wifo/factory-core']).toBe('^0.0.8');
    expect(pkg.dependencies['@wifo/factory-runtime']).toBe('^0.0.8');
    expect(pkg.devDependencies['@wifo/factory-spec-review']).toBe('^0.0.8');
  });

  test('scaffold README contains Multi-spec products section', () => {
    const io = makeIo();
    run(['--name', 'test'], io.io);
    expect(io.exitCode()).toBe(0);
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('## Multi-spec products');
    expect(readme).toContain('/scope-project');
    expect(readme).toContain('factory-runtime run-sequence');
    expect(readme).toContain('.claude/commands/scope-project.md');
  });

  test('scaffold is self-contained: README + slash command + config + deps all at v0.0.8', () => {
    const io = makeIo();
    run(['--name', 'test'], io.io);
    expect(io.exitCode()).toBe(0);

    // README documents the multi-spec flow.
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('## Multi-spec products');
    expect(readme).toContain('/scope-project');
    expect(readme).toContain('factory-runtime run-sequence');

    // Slash command is auto-installed.
    expect(existsSync(join(dir, '.claude/commands/scope-project.md'))).toBe(true);

    // factory.config.json provides defaults (v0.0.5.1+).
    expect(existsSync(join(dir, 'factory.config.json'))).toBe(true);

    // package.json deps at ^0.0.8.
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@wifo/factory-core']).toBe('^0.0.8');
    expect(pkg.dependencies['@wifo/factory-runtime']).toBe('^0.0.8');
    expect(pkg.dependencies['@wifo/factory-context']).toBe('^0.0.8');
    expect(pkg.devDependencies['@wifo/factory-spec-review']).toBe('^0.0.8');
  });
});

describe('runInit — fail-fast on preexisting targets', () => {
  test('preexisting package.json → exit 2 + stderr lists conflict + zero writes', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"existing"}');
    const beforeFiles = readDirRecursive(dir);

    const io = makeIo();
    run([], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('init/path-exists');
    expect(io.stderr()).toContain('package.json');

    const afterFiles = readDirRecursive(dir);
    expect(afterFiles).toEqual(beforeFiles);
    // Verify the existing file was NOT overwritten.
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{"name":"existing"}');
  });

  test('preexisting src/ directory → exit 2 listing src/ as conflict', () => {
    mkdirSync(join(dir, 'src'));
    const io = makeIo();
    run([], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('init/path-exists');
    expect(io.stderr()).toContain('src/');
  });

  test('fully-populated cwd → exit 2 listing every conflict', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    writeFileSync(join(dir, 'README.md'), '# existing');
    const io = makeIo();
    run([], io.io);
    expect(io.exitCode()).toBe(2);
    expect(io.stderr()).toContain('package.json');
    expect(io.stderr()).toContain('tsconfig.json');
    expect(io.stderr()).toContain('README.md');
  });
});

function readDirRecursive(root: string): string[] {
  const out: string[] = [];
  const visit = (rel: string) => {
    const abs = join(root, rel);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      const fs = require('node:fs') as typeof import('node:fs');
      for (const entry of fs.readdirSync(abs)) {
        visit(rel === '' ? entry : `${rel}/${entry}`);
      }
    } else {
      out.push(rel);
    }
  };
  visit('');
  return out.sort();
}

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { CliIo } from './cli.js';
import {
  GITIGNORE_TEMPLATE,
  PACKAGE_JSON_TEMPLATE,
  README_TEMPLATE,
  TSCONFIG_TEMPLATE,
} from './init-templates.js';
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

describe('init-templates', () => {
  test('PACKAGE_JSON_TEMPLATE has the expected keys + workspace-stripped semver deps', () => {
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-core']).toBe('^0.0.4');
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-runtime']).toBe('^0.0.4');
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-context']).toBe('^0.0.4');
    expect(PACKAGE_JSON_TEMPLATE.type).toBe('module');
    expect(PACKAGE_JSON_TEMPLATE.private).toBe(true);
  });

  test('TSCONFIG_TEMPLATE is self-contained — does NOT extend a relative path', () => {
    // The example slugify tsconfig extends ../../tsconfig.json which only works
    // inside this monorepo. The template must not have an `extends` field.
    expect(TSCONFIG_TEMPLATE).not.toHaveProperty('extends');
    expect(TSCONFIG_TEMPLATE.compilerOptions.strict).toBe(true);
    expect(TSCONFIG_TEMPLATE.compilerOptions.verbatimModuleSyntax).toBe(true);
    expect(TSCONFIG_TEMPLATE.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(TSCONFIG_TEMPLATE.compilerOptions.types).toEqual(['bun']);
  });

  test('GITIGNORE_TEMPLATE matches examples/slugify/.gitignore byte-for-byte', () => {
    // Resolve from this test file up to the repo root.
    const slugifyGitignore = join(
      import.meta.dir,
      '..',
      '..',
      '..',
      'examples',
      'slugify',
      '.gitignore',
    );
    if (!existsSync(slugifyGitignore)) {
      // Skip in environments that don't have the examples checked out (e.g.,
      // a published npm consumer). The template's correctness is otherwise
      // covered by structural tests.
      return;
    }
    const slugifyContents = readFileSync(slugifyGitignore, 'utf8');
    expect(GITIGNORE_TEMPLATE).toBe(slugifyContents);
  });

  test('README_TEMPLATE has a {{name}} placeholder and references the v0.0.4 caveat', () => {
    expect(README_TEMPLATE).toContain('{{name}}');
    expect(README_TEMPLATE).toContain('v0.0.4 caveat');
    expect(README_TEMPLATE).toContain('factory spec lint');
    expect(README_TEMPLATE).toContain('factory-runtime run');
  });
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
    expect(pkg.dependencies['@wifo/factory-core']).toBe('^0.0.4');

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

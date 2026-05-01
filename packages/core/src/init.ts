import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliIo } from './cli.js';
import {
  GITIGNORE_TEMPLATE,
  PACKAGE_JSON_TEMPLATE,
  README_TEMPLATE,
  TSCONFIG_TEMPLATE,
} from './init-templates.js';

// npm package-name basics — lowercase alphanumerics, dashes, underscores.
// Must start with alphanumeric. Matches what npm allows for unscoped names.
const NAME_RE = /^[a-z0-9][a-z0-9-_]*$/;

interface PlannedFile {
  relPath: string;
  contents: string;
}

function planFiles(name: string): PlannedFile[] {
  const pkg = { ...PACKAGE_JSON_TEMPLATE, name };
  return [
    { relPath: 'package.json', contents: `${JSON.stringify(pkg, null, 2)}\n` },
    {
      relPath: 'tsconfig.json',
      contents: `${JSON.stringify(TSCONFIG_TEMPLATE, null, 2)}\n`,
    },
    { relPath: '.gitignore', contents: GITIGNORE_TEMPLATE },
    { relPath: 'README.md', contents: README_TEMPLATE.replaceAll('{{name}}', name) },
    { relPath: 'src/.gitkeep', contents: '' },
    { relPath: 'docs/specs/done/.gitkeep', contents: '' },
    { relPath: 'docs/technical-plans/done/.gitkeep', contents: '' },
  ];
}

export function runInit(args: string[], io: CliIo): void {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: { name: { type: 'string' } },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr(`${msg}\n`);
    io.exit(2);
    return;
  }

  const cwd = process.cwd();
  const nameRaw = parsed.values.name;
  let name: string;
  if (typeof nameRaw === 'string') {
    // User-supplied: validate strictly. npm package-name rules.
    if (!NAME_RE.test(nameRaw)) {
      io.stderr(
        `init/invalid-name: --name must match /^[a-z0-9][a-z0-9-_]*$/ (got '${nameRaw}')\n`,
      );
      io.exit(2);
      return;
    }
    name = nameRaw;
  } else {
    // Default: sanitize basename(cwd). Lowercase + replace any chars outside
    // the allowed set with '-'. Strip leading non-alphanumeric. If nothing
    // sane survives, fall back to 'project'.
    const raw = basename(cwd)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+/, '');
    name = NAME_RE.test(raw) ? raw : 'project';
  }

  const files = planFiles(name);

  // Atomic check: collect every preexisting target before any write. Fail fast
  // if any exists (no --force in v0.0.4; preserves user files unconditionally).
  const conflicts: string[] = [];
  for (const file of files) {
    const abs = resolve(cwd, file.relPath);
    if (existsSync(abs)) conflicts.push(file.relPath);
  }
  // Also check parent directories that the scaffold owns end-to-end. A
  // preexisting `src/` (without a .gitkeep) still counts — `factory init` is
  // for fresh repos. Listing the directory itself in conflicts is clearer
  // than reporting a missing .gitkeep when the dir is the actual blocker.
  for (const dir of [
    'src',
    'docs',
    'docs/specs',
    'docs/specs/done',
    'docs/technical-plans',
    'docs/technical-plans/done',
  ]) {
    const abs = resolve(cwd, dir);
    if (existsSync(abs) && !conflicts.includes(`${dir}/.gitkeep`)) {
      // Only report if the dir exists AND we'd be writing into it.
      // For the .gitkeep targets, the dir-existing case is the real blocker.
      if (dir === 'src' || dir === 'docs/specs/done' || dir === 'docs/technical-plans/done') {
        conflicts.push(`${dir}/`);
      }
    }
  }

  if (conflicts.length > 0) {
    io.stderr('init/path-exists: refusing to write — these targets already exist:\n');
    for (const path of conflicts) io.stderr(`  ${path}\n`);
    io.exit(2);
    return;
  }

  for (const file of files) {
    const abs = resolve(cwd, file.relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.contents);
  }

  io.stdout('Created scaffold:\n');
  for (const file of files) io.stdout(`  ${file.relPath}\n`);
  io.stdout(
    [
      '',
      'Next steps:',
      '  pnpm install',
      '  pnpm exec factory spec lint docs/specs/',
      '  # write your first spec under docs/specs/<id>.md (or use /scope-task)',
      '',
    ].join('\n'),
  );
  io.exit(0);
}

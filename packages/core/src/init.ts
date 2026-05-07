import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliIo } from './cli.js';
import {
  BIOME_JSON_TEMPLATE,
  FACTORY_CONFIG_TEMPLATE,
  GITIGNORE_TEMPLATE,
  PACKAGE_JSON_TEMPLATE,
  README_TEMPLATE,
  TSCONFIG_TEMPLATE,
  readScopeProjectCommandTemplate,
} from './init-templates.js';

// npm package-name basics — lowercase alphanumerics, dashes, underscores.
// Must start with alphanumeric. Matches what npm allows for unscoped names.
const NAME_RE = /^[a-z0-9][a-z0-9-_]*$/;

// v0.0.12 — `--adopt` mode skips these top-level files when they already exist
// (rather than refusing to run). `.gitignore` is special-cased: appended, not
// skipped, so factory entries land alongside whatever the host repo had.
const IGNORE_IF_PRESENT = new Set([
  'package.json',
  'tsconfig.json',
  'biome.json',
  'bunfig.toml',
  '.gitignore',
  'README.md',
]);

// Entries that `--adopt` ensures are present in the host's .gitignore. Idempotent:
// each entry only appends if not already a literal line in the existing file.
//
// v0.0.13 — `.factory` (the dir itself) is no longer gitignored; it's tracked
// via a committed `.gitkeep`. Only the per-record subdirs the runtime writes
// (`worktrees/`, `twin-recordings/`) are ignored.
const GITIGNORE_FACTORY_ENTRIES = [
  '.factory/worktrees/',
  '.factory/twin-recordings/',
  '.factory-spec-review-cache',
];

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
    {
      relPath: 'factory.config.json',
      contents: `${JSON.stringify(FACTORY_CONFIG_TEMPLATE, null, 2)}\n`,
    },
    { relPath: 'biome.json', contents: `${JSON.stringify(BIOME_JSON_TEMPLATE, null, 2)}\n` },
    {
      relPath: '.claude/commands/scope-project.md',
      contents: readScopeProjectCommandTemplate(),
    },
    { relPath: 'README.md', contents: README_TEMPLATE.replaceAll('{{name}}', name) },
    { relPath: 'src/.gitkeep', contents: '' },
    { relPath: '.factory/.gitkeep', contents: '' },
    { relPath: 'docs/specs/done/.gitkeep', contents: '' },
    { relPath: 'docs/technical-plans/done/.gitkeep', contents: '' },
  ];
}

function appendGitignoreEntries(absPath: string): string[] {
  const existing = existsSync(absPath) ? readFileSync(absPath, 'utf8') : '';
  const lines = existing.split('\n').map((line) => line.trim());
  const present = new Set(lines);
  const toAdd = GITIGNORE_FACTORY_ENTRIES.filter((entry) => !present.has(entry));
  if (toAdd.length === 0) return [];
  const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
  const appended = `${needsLeadingNewline ? '\n' : ''}${toAdd.join('\n')}\n`;
  writeFileSync(absPath, existing + appended);
  return toAdd;
}

export function runInit(args: string[], io: CliIo): void {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        name: { type: 'string' },
        adopt: { type: 'boolean' },
      },
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

  const adopt = parsed.values.adopt === true;
  const files = planFiles(name);

  if (adopt) {
    runAdopt(cwd, files, io);
    return;
  }

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

function runAdopt(cwd: string, files: PlannedFile[], io: CliIo): void {
  const skipped: string[] = [];
  const created: string[] = [];

  for (const file of files) {
    const abs = resolve(cwd, file.relPath);

    if (file.relPath === '.gitignore') {
      if (existsSync(abs)) {
        const added = appendGitignoreEntries(abs);
        if (added.length > 0) {
          io.stdout(`append: .gitignore (added ${added.join(', ')})\n`);
        } else {
          io.stdout('skip: .gitignore (factory entries already present)\n');
        }
      } else {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, file.contents);
        created.push(file.relPath);
      }
      continue;
    }

    if (IGNORE_IF_PRESENT.has(file.relPath) && existsSync(abs)) {
      io.stdout(`skip: ${file.relPath} (already present)\n`);
      skipped.push(file.relPath);
      continue;
    }

    if (file.relPath.endsWith('/.gitkeep')) {
      // The dir itself is what we care about. If it (or its parent dir we
      // own) exists we still want to ensure the leaf dir is present, but we
      // don't overwrite an existing .gitkeep.
      const dir = dirname(abs);
      if (existsSync(dir)) {
        // Log the directory skip once at the top-level (e.g. docs/specs/, src/).
        const dirRel = dirname(file.relPath);
        if (!skipped.includes(`${dirRel}/`)) {
          io.stdout(`skip: ${dirRel}/ (already present)\n`);
          skipped.push(`${dirRel}/`);
        }
        if (!existsSync(abs)) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(abs, file.contents);
          created.push(file.relPath);
        }
        continue;
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(abs, file.contents);
      created.push(file.relPath);
      continue;
    }

    if (existsSync(abs)) {
      io.stdout(`skip: ${file.relPath} (already present)\n`);
      skipped.push(file.relPath);
      continue;
    }

    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.contents);
    created.push(file.relPath);
  }

  if (created.length > 0) {
    io.stdout('Created:\n');
    for (const path of created) io.stdout(`  ${path}\n`);
  }
  io.stdout(
    [
      '',
      'Adopted into existing repo. Next steps:',
      '  # Add factory devDeps yourself (this command does not mutate your package.json):',
      '  #   pnpm add -D @wifo/factory-core @wifo/factory-spec-review',
      '  pnpm exec factory spec lint docs/specs/',
      '',
    ].join('\n'),
  );
  io.exit(0);
}

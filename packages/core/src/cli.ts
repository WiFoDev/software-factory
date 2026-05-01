#!/usr/bin/env node
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runInit } from './init.js';
import { getFrontmatterJsonSchema } from './json-schema.js';
import { type LintError, lintSpec } from './lint.js';

const USAGE = `Usage:
  factory init [--name <pkg-name>]   Bootstrap a new factory project in cwd
  factory spec lint <path>           Lint a spec file or directory of *.md
  factory spec review <path>         Review spec quality with LLM judges (subscription auth)
  factory spec schema [--out <file>] Print the frontmatter JSON Schema
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  exit: (code: number) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  exit: (code) => {
    // Flush stdout/stderr before exiting. TTY writes are synchronous, but when
    // stdout is a pipe (`pnpm exec`, `| cat`, CI capture) writes are buffered —
    // process.exit too soon drops the buffered tail.
    process.stdout.write('', () => {
      process.stderr.write('', () => process.exit(code));
    });
  },
};

export function runCli(argv: string[], io: CliIo = defaultIo): void {
  const [domain, command, ...rest] = argv;
  if (domain === 'init') {
    // `factory init` is a top-level subcommand (not under `spec`). The rest
    // of argv after `init` is forwarded to runInit verbatim.
    runInit(argv.slice(1), io);
    return;
  }
  if (domain !== 'spec' || command === undefined) {
    io.stderr(USAGE);
    io.exit(2);
    return;
  }

  if (command === 'lint') {
    runLint(rest, io);
    return;
  }
  if (command === 'schema') {
    runSchema(rest, io);
    return;
  }
  if (command === 'review') {
    // Dispatched in async fashion: the reviewer package is dynamic-imported
    // so factory-core stays dep-free for callers that never run review.
    runReviewDispatch(rest, io);
    return;
  }

  io.stderr(`Unknown subcommand: ${command}\n${USAGE}`);
  io.exit(2);
}

function runReviewDispatch(args: string[], io: CliIo): void {
  // Dynamic import so factory-core does not pull spec-review into its
  // dependency closure when the user only runs `factory spec lint` /
  // `factory init`. The reviewer package is an optional peer dep.
  //
  // Resolution must start from the CONSUMER's cwd (not from this CLI
  // module's location). When the CLI is invoked via a workspace symlink
  // at `<consumer>/node_modules/.bin/factory`, both ESM import() AND
  // createRequire().resolve() fall back to packages/core/ as the base —
  // where @wifo/factory-spec-review is NOT a dep. We walk node_modules
  // up from process.cwd() manually to find it.
  void (async () => {
    try {
      const pkgRoot = findPackageRoot(process.cwd(), '@wifo/factory-spec-review');
      if (pkgRoot === null) {
        io.stderr(
          'spec/review-unavailable: install @wifo/factory-spec-review to use this command\n',
        );
        io.exit(2);
        return;
      }
      const cliPath = join(pkgRoot, 'dist', 'cli.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import(pathToFileURL(cliPath).href)) as {
        runReviewCli: (args: string[], io: CliIo) => Promise<void>;
      };
      await mod.runReviewCli(args, io);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.stderr(`${msg}\n`);
      io.exit(2);
    }
  })();
}

/**
 * Walk up node_modules from `cwd` looking for `<cur>/node_modules/<pkgName>/`.
 * Returns the absolute path to the package's root if found, else null.
 * Handles pnpm workspace symlinks transparently (statSync follows the symlink).
 */
function findPackageRoot(cwd: string, pkgName: string): string | null {
  let cur = resolve(cwd);
  while (true) {
    const candidate = join(cur, 'node_modules', pkgName);
    try {
      if (statSync(candidate).isDirectory()) return realpathSync(candidate);
    } catch {
      // not present at this level
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function runLint(args: string[], io: CliIo): void {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {},
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr(`${msg}\n${USAGE}`);
    io.exit(2);
    return;
  }

  const target = parsed.positionals[0];
  if (target === undefined) {
    io.stderr(`Missing <path>\n${USAGE}`);
    io.exit(2);
    return;
  }

  const targetPath = resolve(process.cwd(), target);
  let files: string[];
  try {
    files = collectMarkdownFiles(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      io.stderr(`Path not found: ${target}\n`);
      io.exit(1);
      return;
    }
    throw err;
  }
  if (files.length === 0) {
    io.stderr(`No markdown files found at ${target}\n`);
    io.exit(1);
    return;
  }

  const allErrors: LintError[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const rel = relative(process.cwd(), file) || file;
    const errors = lintSpec(source, { filename: rel });
    allErrors.push(...errors);
  }

  if (allErrors.length === 0) {
    io.stdout('OK\n');
    io.exit(0);
    return;
  }

  for (const err of allErrors) formatError(err, io);
  const errCount = allErrors.filter((e) => e.severity === 'error').length;
  const warnCount = allErrors.filter((e) => e.severity === 'warning').length;
  io.stderr(formatSummary(errCount, warnCount));
  io.exit(errCount > 0 ? 1 : 0);
}

function runSchema(args: string[], io: CliIo): void {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        out: { type: 'string' },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr(`${msg}\n${USAGE}`);
    io.exit(2);
    return;
  }

  const schema = getFrontmatterJsonSchema();
  const text = `${JSON.stringify(schema, null, 2)}\n`;
  const out = parsed.values.out;
  if (typeof out === 'string') {
    writeFileSync(resolve(process.cwd(), out), text);
    io.stdout(`Wrote ${out}\n`);
  } else {
    io.stdout(text);
  }
  io.exit(0);
}

export function collectMarkdownFiles(target: string): string[] {
  const stat = statSync(target);
  if (stat.isFile()) {
    return target.endsWith('.md') ? [target] : [];
  }
  if (!stat.isDirectory()) return [];
  const out: string[] = [];
  const entries = readdirSync(target, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    const dir =
      (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
      (entry as unknown as { path?: string }).path ??
      target;
    out.push(join(dir, entry.name));
  }
  return out.sort();
}

function formatError(err: LintError, io: CliIo): void {
  const file = err.file ?? '<input>';
  const line = err.line !== undefined ? `:${err.line}` : '';
  const sev = err.severity === 'error' ? 'error  ' : 'warning';
  io.stderr(`${file}${line}  ${sev}  ${err.code.padEnd(28)}  ${err.message}\n`);
}

function formatSummary(errors: number, warnings: number): string {
  const errPart = `${errors} error${errors === 1 ? '' : 's'}`;
  const warnPart = `${warnings} warning${warnings === 1 ? '' : 's'}`;
  return `${errPart}, ${warnPart}\n`;
}

if (typeof process !== 'undefined' && Array.isArray(process.argv)) {
  const entry = process.argv[1];
  if (entry !== undefined) {
    let isMain = false;
    try {
      // realpathSync resolves symlinks — required because workspace deps make
      // `process.argv[1]` (the launched bin path) and `import.meta.url` (the
      // resolved module path) differ when the package is symlinked into another
      // workspace's node_modules.
      isMain = realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
    } catch {
      // not a file:// URL — skip auto-run
    }
    if (isMain) runCli(process.argv.slice(2));
  }
}

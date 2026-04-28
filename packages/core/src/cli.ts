#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getFrontmatterJsonSchema } from './json-schema.js';
import { type LintError, lintSpec } from './lint.js';

const USAGE = `Usage:
  factory spec lint <path>           Lint a spec file or directory of *.md
  factory spec schema [--out <file>] Print the frontmatter JSON Schema
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  exit: (code: number) => never;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  exit: (code) => process.exit(code) as never,
};

export function runCli(argv: string[], io: CliIo = defaultIo): void {
  const [domain, command, ...rest] = argv;
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

  io.stderr(`Unknown subcommand: ${command}\n${USAGE}`);
  io.exit(2);
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
      isMain = resolve(fileURLToPath(import.meta.url)) === resolve(entry);
    } catch {
      // not a file:// URL — skip auto-run
    }
    if (isMain) runCli(process.argv.slice(2));
  }
}

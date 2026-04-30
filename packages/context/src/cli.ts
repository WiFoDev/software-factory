#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ContextError } from './errors.js';
import { listRecords, readRecord } from './store-fs.js';
import { buildTree, formatTree } from './tree.js';

const USAGE = `Usage:
  factory-context list          [--type <name>] [--dir <path>]
  factory-context get  <id>     [--dir <path>]
  factory-context tree <id>     [--dir <path>]

Flags:
  --type <name>   For list: filter by record type
  --dir <path>    Records directory (default: ./context)
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

function resolveDir(value: unknown): string {
  const dir = typeof value === 'string' ? value : './context';
  return resolve(process.cwd(), dir);
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<void> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    io.stderr(USAGE);
    io.exit(2);
    return;
  }
  switch (command) {
    case 'list':
      await runList(rest, io);
      return;
    case 'get':
      await runGet(rest, io);
      return;
    case 'tree':
      await runTree(rest, io);
      return;
    default:
      io.stderr(`Unknown subcommand: ${command}\n${USAGE}`);
      io.exit(2);
  }
}

async function runList(args: string[], io: CliIo): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        dir: { type: 'string' },
        type: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    io.stderr(`${(err as Error).message}\n${USAGE}`);
    io.exit(2);
    return;
  }
  const dir = resolveDir(parsed.values.dir);
  const typeFilter = typeof parsed.values.type === 'string' ? parsed.values.type : undefined;
  let result: Awaited<ReturnType<typeof listRecords>>;
  try {
    result = await listRecords(dir);
  } catch (err) {
    if (err instanceof ContextError) {
      io.stderr(`${err.code}\t${err.message}\n`);
      io.exit(3);
      return;
    }
    throw err;
  }
  const filtered =
    typeFilter === undefined ? result.records : result.records.filter((r) => r.type === typeFilter);
  for (const rec of filtered) {
    io.stdout(`${rec.id}\t${rec.type}\t${rec.recordedAt}\n`);
  }
  for (const skip of result.skipped) {
    io.stderr(`${skip.filename}\tskipped\t${skip.reason}\n`);
  }
  io.exit(0);
}

async function runGet(args: string[], io: CliIo): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: { dir: { type: 'string' } },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    io.stderr(`${(err as Error).message}\n${USAGE}`);
    io.exit(2);
    return;
  }
  const id = parsed.positionals[0];
  if (id === undefined) {
    io.stderr(`Missing <id>\n${USAGE}`);
    io.exit(2);
    return;
  }
  const dir = resolveDir(parsed.values.dir);
  let rec: Awaited<ReturnType<typeof readRecord>>;
  try {
    rec = await readRecord(dir, id);
  } catch (err) {
    if (err instanceof ContextError) {
      io.stderr(`${err.code}\t${err.message}\n`);
      io.exit(3);
      return;
    }
    throw err;
  }
  if (rec === null) {
    io.stderr(`context/record-not-found\t${id}\n`);
    io.exit(3);
    return;
  }
  io.stdout(`${JSON.stringify(rec, null, 2)}\n`);
  io.exit(0);
}

async function runTree(args: string[], io: CliIo): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: { dir: { type: 'string' } },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    io.stderr(`${(err as Error).message}\n${USAGE}`);
    io.exit(2);
    return;
  }
  const id = parsed.positionals[0];
  if (id === undefined) {
    io.stderr(`Missing <id>\n${USAGE}`);
    io.exit(2);
    return;
  }
  const dir = resolveDir(parsed.values.dir);
  // Probe the root first so a missing root maps to exit 3, while missing
  // ancestors stay non-fatal inside buildTree.
  let root: Awaited<ReturnType<typeof readRecord>>;
  try {
    root = await readRecord(dir, id);
  } catch (err) {
    if (err instanceof ContextError) {
      io.stderr(`${err.code}\t${err.message}\n`);
      io.exit(3);
      return;
    }
    throw err;
  }
  if (root === null) {
    io.stderr(`context/record-not-found\t${id}\n`);
    io.exit(3);
    return;
  }
  const tree = await buildTree(id, async (lookupId) => {
    try {
      return await readRecord(dir, lookupId);
    } catch (err) {
      // Treat unreadable parent ids (malformed shape, parse failure, version
      // mismatch) as missing so the tree renders inline rather than crashing.
      if (err instanceof ContextError) return null;
      throw err;
    }
  });
  io.stdout(formatTree(tree));
  io.exit(0);
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
    if (isMain) {
      runCli(process.argv.slice(2)).catch((err) => {
        process.stderr.write(
          `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
        );
        process.exit(3);
      });
    }
  }
}

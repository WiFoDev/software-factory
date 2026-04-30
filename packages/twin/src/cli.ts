#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TwinReplayError } from './errors.js';
import { listRecordings, pruneRecordings, readRecording } from './store.js';

const USAGE = `Usage:
  factory-twin list                    [--dir <path>]
  factory-twin inspect <hash>          [--dir <path>]
  factory-twin prune --older-than <n>  [--dir <path>] [--dry-run]

Flags:
  --dir <path>          Recordings directory (default: ./recordings)
  --older-than <days>   Prune recordings older than N days (integer)
  --dry-run             For prune: print what would be deleted without unlinking
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
  const dir = typeof value === 'string' ? value : './recordings';
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
    case 'inspect':
      await runInspect(rest, io);
      return;
    case 'prune':
      await runPrune(rest, io);
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
      options: { dir: { type: 'string' } },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    io.stderr(`${(err as Error).message}\n${USAGE}`);
    io.exit(2);
    return;
  }
  const dir = resolveDir(parsed.values.dir);
  let result: Awaited<ReturnType<typeof listRecordings>>;
  try {
    result = await listRecordings(dir);
  } catch (err) {
    if (err instanceof TwinReplayError) {
      io.stderr(`${err.code}\t${err.message}\n`);
      io.exit(3);
      return;
    }
    throw err;
  }
  for (const rec of result.recordings) {
    io.stdout(`${rec.hash}\t${rec.request.method}\t${rec.request.url}\t${rec.recordedAt}\n`);
  }
  for (const skip of result.skipped) {
    io.stderr(`${skip.filename}\tskipped\t${skip.reason}\n`);
  }
  io.exit(0);
}

async function runInspect(args: string[], io: CliIo): Promise<void> {
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
  const hash = parsed.positionals[0];
  if (hash === undefined) {
    io.stderr(`Missing <hash>\n${USAGE}`);
    io.exit(2);
    return;
  }
  const dir = resolveDir(parsed.values.dir);
  let rec: Awaited<ReturnType<typeof readRecording>>;
  try {
    rec = await readRecording(dir, hash);
  } catch (err) {
    if (err instanceof TwinReplayError) {
      io.stderr(`${err.code}\t${err.message}\n`);
      io.exit(3);
      return;
    }
    throw err;
  }
  if (rec === null) {
    io.stderr(`twin/recording-not-found\t${hash}\n`);
    io.exit(3);
    return;
  }
  io.stdout(`${JSON.stringify(rec, null, 2)}\n`);
  io.exit(0);
}

async function runPrune(args: string[], io: CliIo): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        dir: { type: 'string' },
        'older-than': { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    io.stderr(`${(err as Error).message}\n${USAGE}`);
    io.exit(2);
    return;
  }
  const olderThanRaw = parsed.values['older-than'];
  if (typeof olderThanRaw !== 'string' || olderThanRaw === '') {
    io.stderr(`Missing --older-than <days>\n${USAGE}`);
    io.exit(2);
    return;
  }
  const olderThanDays = Number.parseInt(olderThanRaw, 10);
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    io.stderr(`--older-than must be a non-negative integer (got '${olderThanRaw}')\n${USAGE}`);
    io.exit(2);
    return;
  }
  const dir = resolveDir(parsed.values.dir);
  const dryRun = parsed.values['dry-run'] === true;
  let result: Awaited<ReturnType<typeof pruneRecordings>>;
  try {
    result = await pruneRecordings(dir, { olderThanDays, dryRun });
  } catch (err) {
    if (err instanceof TwinReplayError) {
      io.stderr(`${err.code}\t${err.message}\n`);
      io.exit(3);
      return;
    }
    throw err;
  }
  const verb = dryRun ? 'would-prune' : 'pruned';
  for (const hash of result.pruned) {
    io.stdout(`${hash}\t${verb}\n`);
  }
  for (const skip of result.skipped) {
    io.stderr(`${skip.filename}\tskipped\t${skip.reason}\n`);
  }
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

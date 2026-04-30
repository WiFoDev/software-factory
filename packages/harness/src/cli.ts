#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SpecParseError, parseSpec } from '@wifo/factory-core';
import { type ReporterKind, formatReport } from './format.js';
import { runHarness } from './runner.js';

const USAGE = `Usage:
  factory-harness run <spec-path> [flags]

Flags:
  --scenario <ids>       Comma-separated scenario ids to run (e.g. S-1,S-2,H-1)
  --visible              Run only visible scenarios (default: visible + holdouts)
  --holdouts             Run only holdout scenarios
  --no-judge             Skip judge satisfaction lines (status=skipped)
  --model <name>         Override judge model (default: claude-haiku-4-5)
  --timeout-ms <n>       Per-satisfaction timeout (default: 30000)
  --reporter <text|json> Output format (default: text)
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

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<void> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    io.stderr(USAGE);
    io.exit(2);
    return;
  }
  if (command === 'run') {
    await runRun(rest, io);
    return;
  }
  io.stderr(`Unknown subcommand: ${command}\n${USAGE}`);
  io.exit(2);
}

async function runRun(args: string[], io: CliIo): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        scenario: { type: 'string' },
        visible: { type: 'boolean' },
        holdouts: { type: 'boolean' },
        'no-judge': { type: 'boolean' },
        model: { type: 'string' },
        'timeout-ms': { type: 'string' },
        reporter: { type: 'string' },
      },
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
    io.stderr(`Missing <spec-path>\n${USAGE}`);
    io.exit(2);
    return;
  }

  const visible = parsed.values.visible === true;
  const holdouts = parsed.values.holdouts === true;
  if (visible && holdouts) {
    io.stderr(`--visible and --holdouts are mutually exclusive\n${USAGE}`);
    io.exit(2);
    return;
  }

  const reporterRaw = parsed.values.reporter ?? 'text';
  if (reporterRaw !== 'text' && reporterRaw !== 'json') {
    io.stderr(`--reporter must be 'text' or 'json' (got '${reporterRaw}')\n${USAGE}`);
    io.exit(2);
    return;
  }
  const reporter = reporterRaw as ReporterKind;

  const timeoutRaw = parsed.values['timeout-ms'];
  let timeoutMs: number | undefined;
  if (typeof timeoutRaw === 'string') {
    const n = Number.parseInt(timeoutRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      io.stderr(`--timeout-ms must be a positive integer (got '${timeoutRaw}')\n${USAGE}`);
      io.exit(2);
      return;
    }
    timeoutMs = n;
  }

  const scenarioIdsArg = parsed.values.scenario;
  const scenarioIds =
    typeof scenarioIdsArg === 'string'
      ? new Set(
          scenarioIdsArg
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id !== ''),
        )
      : undefined;

  const specPath = resolve(process.cwd(), target);
  let source: string;
  try {
    source = readFileSync(specPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      io.stderr(`Spec not found: ${target}\n`);
      io.exit(3);
      return;
    }
    throw err;
  }

  const filename = relative(process.cwd(), specPath) || specPath;
  let spec: ReturnType<typeof parseSpec>;
  try {
    spec = parseSpec(source, { filename });
  } catch (err) {
    if (err instanceof SpecParseError) {
      for (const issue of err.issues) {
        io.stderr(`${filename}:${issue.line ?? '?'}  error  ${issue.code}  ${issue.message}\n`);
      }
      io.exit(3);
      return;
    }
    throw err;
  }

  const report = await runHarness(spec, {
    cwd: dirname(specPath),
    ...(scenarioIds !== undefined ? { scenarioIds } : {}),
    visibleOnly: visible,
    holdoutsOnly: holdouts,
    noJudge: parsed.values['no-judge'] === true,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(typeof parsed.values.model === 'string' ? { judge: { model: parsed.values.model } } : {}),
  });

  if (reporter === 'json') {
    io.stdout(formatReport(report, 'json'));
  } else {
    io.stdout(formatReport(report, 'text'));
  }

  if (report.status === 'pass') io.exit(0);
  else if (report.status === 'fail') io.exit(1);
  else io.exit(3);
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

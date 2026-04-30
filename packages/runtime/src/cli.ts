#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createContextStore } from '@wifo/factory-context';
import { SpecParseError, parseSpec } from '@wifo/factory-core';
import { RuntimeError } from './errors.js';
import { definePhaseGraph } from './graph.js';
import { validatePhase } from './phases/validate.js';
import { run } from './runtime.js';

const USAGE = `Usage:
  factory-runtime run <spec-path> [flags]

Flags:
  --max-iterations <n>     Max iterations (default: 1; v0.0.2 may flip to 3 or 5)
  --context-dir <path>     Context store directory (default: ./context)
  --scenario <ids>         Comma-separated scenario ids (e.g. S-1,S-2,H-1)
  --no-judge               Skip judge satisfactions in the harness
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
        'max-iterations': { type: 'string' },
        'context-dir': { type: 'string' },
        scenario: { type: 'string' },
        'no-judge': { type: 'boolean' },
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

  // --max-iterations: positive integer or fail with exit 2.
  const maxItRaw = parsed.values['max-iterations'];
  let maxIterations: number | undefined;
  if (typeof maxItRaw === 'string') {
    const n = Number.parseInt(maxItRaw, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== maxItRaw.trim()) {
      io.stderr(
        `runtime/invalid-max-iterations: --max-iterations must be a positive integer (got '${maxItRaw}')\n${USAGE}`,
      );
      io.exit(2);
      return;
    }
    maxIterations = n;
  }

  // --scenario: comma-separated, trimmed, drop empties.
  const scenarioRaw = parsed.values.scenario;
  const scenarioIds =
    typeof scenarioRaw === 'string'
      ? new Set(
          scenarioRaw
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id !== ''),
        )
      : undefined;

  // --context-dir: default ./context, mkdir -p.
  const contextDirRaw =
    typeof parsed.values['context-dir'] === 'string' ? parsed.values['context-dir'] : './context';
  const contextDir = resolve(process.cwd(), contextDirRaw);
  try {
    mkdirSync(contextDir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr(`failed to create context dir: ${msg}\n`);
    io.exit(3);
    return;
  }

  // Read + parse spec.
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

  // Build the default validate-only graph.
  const phase = validatePhase({
    cwd: dirname(specPath),
    ...(scenarioIds !== undefined ? { scenarioIds } : {}),
    ...(parsed.values['no-judge'] === true ? { noJudge: true } : {}),
  });
  const graph = definePhaseGraph([phase], []);

  const store = createContextStore({ dir: contextDir });

  let report: Awaited<ReturnType<typeof run>>;
  try {
    report = await run({
      spec,
      graph,
      contextStore: store,
      options: {
        ...(maxIterations !== undefined ? { maxIterations } : {}),
      },
    });
  } catch (err) {
    if (err instanceof RuntimeError) {
      io.stderr(`${err.message}\n`);
      io.exit(3);
      return;
    }
    throw err;
  }

  if (report.status === 'converged') {
    io.stdout(
      `factory-runtime: converged in ${report.iterationCount} iteration(s) (run=${report.runId}, ${report.durationMs}ms)\n`,
    );
    io.exit(0);
    return;
  }
  if (report.status === 'no-converge') {
    io.stdout(
      `factory-runtime: no-converge after ${report.iterationCount} iteration(s) (run=${report.runId})\n`,
    );
    io.exit(1);
    return;
  }
  // status === 'error'
  const lastIter = report.iterations[report.iterations.length - 1];
  const erroredPhase = lastIter?.phases.find((p) => p.status === 'error');
  io.stdout(
    `factory-runtime: error during phase '${erroredPhase?.phaseName ?? '<unknown>'}' iteration ${lastIter?.iteration ?? '?'} (run=${report.runId})\n`,
  );
  // Stream the failureDetail from the persisted factory-phase record if available.
  if (erroredPhase !== undefined) {
    const phaseRec = await store.get(erroredPhase.phaseRecordId);
    const detail = (phaseRec?.payload as { failureDetail?: string } | undefined)?.failureDetail;
    if (detail !== undefined) io.stdout(`  detail: ${detail}\n`);
  }
  io.exit(3);
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

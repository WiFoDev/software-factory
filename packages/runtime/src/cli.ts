#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createContextStore } from '@wifo/factory-context';
import { SpecParseError, parseSpec } from '@wifo/factory-core';
import { z } from 'zod';
import { RuntimeError } from './errors.js';
import { definePhaseGraph } from './graph.js';
import { type ImplementPhaseOptions, implementPhase } from './phases/implement.js';
import { validatePhase } from './phases/validate.js';
import { run } from './runtime.js';

const USAGE = `Usage:
  factory-runtime run <spec-path> [flags]

Flags:
  --max-iterations <n>             Max iterations (default: 5)
  --max-total-tokens <n>           Whole-run cap on summed agent tokens (default: 500000)
  --context-dir <path>              Context store directory (default: ./context)
  --scenario <ids>                  Comma-separated scenario ids (e.g. S-1,S-2,H-1)
  --no-judge                        Skip judge satisfactions in the harness
  --no-implement                    Drop the implement phase (v0.0.1 [validate]-only graph)
  --max-prompt-tokens <n>           Per-phase cap on agent input tokens (default: 100000)
  --max-agent-timeout-ms <n>        Per-phase agent subprocess wall-clock timeout in ms (default: 600000)
  --claude-bin <path>               Path to the claude executable (default: 'claude' on PATH)
  --twin-mode <record|replay|off>   Twin recording mode (default: record)
  --twin-recordings-dir <path>      Twin recordings dir (default: <cwd>/.factory/twin-recordings)
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  exit: (code: number) => void;
}

// v0.0.5.1: optional `<cwd>/factory.config.json`. Validated with Zod; absent
// or malformed files return null silently (config is OPTIONAL by design).
// Unknown keys are ignored so v0.0.6 sections can be added without breaking
// older runtimes.
const FactoryConfigRuntimeSchema = z
  .object({
    maxIterations: z.number().int().positive().optional(),
    maxTotalTokens: z.number().int().positive().optional(),
    maxPromptTokens: z.number().int().positive().optional(),
    noJudge: z.boolean().optional(),
  })
  .partial();

const FactoryConfigSchema = z
  .object({
    runtime: FactoryConfigRuntimeSchema.optional(),
  })
  .partial();

type FactoryConfig = z.infer<typeof FactoryConfigSchema>;

function readFactoryConfig(cwd: string): FactoryConfig | null {
  const path = resolve(cwd, 'factory.config.json');
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(text);
    const result = FactoryConfigSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
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
        'max-iterations': { type: 'string' },
        'max-total-tokens': { type: 'string' },
        'context-dir': { type: 'string' },
        scenario: { type: 'string' },
        'no-judge': { type: 'boolean' },
        'no-implement': { type: 'boolean' },
        'max-prompt-tokens': { type: 'string' },
        'max-agent-timeout-ms': { type: 'string' },
        'claude-bin': { type: 'string' },
        'twin-mode': { type: 'string' },
        'twin-recordings-dir': { type: 'string' },
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

  // --max-total-tokens: positive integer or fail with exit 2. Mirrors
  // --max-prompt-tokens validation. Note: the stderr label
  // 'runtime/invalid-max-total-tokens' is a string format only — there is
  // NO matching RuntimeErrorCode (locked: only one new code in v0.0.3,
  // 'runtime/total-cost-cap-exceeded'). Programmatic RunOptions.maxTotalTokens
  // is unvalidated; non-positive values trip the cap on first implement.
  const maxTotalTokensRaw = parsed.values['max-total-tokens'];
  let maxTotalTokens: number | undefined;
  if (typeof maxTotalTokensRaw === 'string') {
    const n = Number.parseInt(maxTotalTokensRaw, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== maxTotalTokensRaw.trim()) {
      io.stderr(
        `runtime/invalid-max-total-tokens: --max-total-tokens must be a positive integer (got '${maxTotalTokensRaw}')\n${USAGE}`,
      );
      io.exit(2);
      return;
    }
    maxTotalTokens = n;
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

  // --no-implement: drop back to the v0.0.1 [validate]-only graph. The
  // implement-tuning flags (--max-prompt-tokens, --claude-bin, --twin-*) are
  // inert in this mode (no warning emitted).
  const noImplement = parsed.values['no-implement'] === true;

  // v0.0.5.1: optional `<cwd>/factory.config.json` supplies defaults for the
  // matching options. Precedence: CLI flag > config file > built-in default.
  // Absent/malformed config returns null silently — config is OPTIONAL.
  const fileConfig = readFactoryConfig(process.cwd());
  const fileRuntime = fileConfig?.runtime;

  // --max-prompt-tokens: positive integer or fail with exit 2. Manual stderr
  // line mirrors the --max-iterations pattern; the CLI does not construct
  // RuntimeError directly (that fires for programmatic implementPhase callers).
  const maxPromptTokensRaw = parsed.values['max-prompt-tokens'];
  let maxPromptTokens: number | undefined;
  if (typeof maxPromptTokensRaw === 'string') {
    const n = Number.parseInt(maxPromptTokensRaw, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== maxPromptTokensRaw.trim()) {
      io.stderr(
        `runtime/invalid-max-prompt-tokens: --max-prompt-tokens must be a positive integer (got '${maxPromptTokensRaw}')\n${USAGE}`,
      );
      io.exit(2);
      return;
    }
    maxPromptTokens = n;
  }

  // v0.0.5.2 — --max-agent-timeout-ms: positive integer or fail with exit 2.
  // Mirrors --max-prompt-tokens validation. The stderr label
  // 'runtime/invalid-max-agent-timeout-ms' is a string format only — there
  // is NO matching RuntimeErrorCode (zero new codes in v0.0.5.2).
  // Programmatic RunOptions.maxAgentTimeoutMs is unvalidated.
  const maxAgentTimeoutMsRaw = parsed.values['max-agent-timeout-ms'];
  let maxAgentTimeoutMs: number | undefined;
  if (typeof maxAgentTimeoutMsRaw === 'string') {
    const n = Number.parseInt(maxAgentTimeoutMsRaw, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== maxAgentTimeoutMsRaw.trim()) {
      io.stderr(
        `runtime/invalid-max-agent-timeout-ms: --max-agent-timeout-ms must be a positive integer (got '${maxAgentTimeoutMsRaw}')\n${USAGE}`,
      );
      io.exit(2);
      return;
    }
    maxAgentTimeoutMs = n;
  }

  // v0.0.5.1: layer config-file values under any unset CLI flag.
  if (maxIterations === undefined && fileRuntime?.maxIterations !== undefined) {
    maxIterations = fileRuntime.maxIterations;
  }
  if (maxTotalTokens === undefined && fileRuntime?.maxTotalTokens !== undefined) {
    maxTotalTokens = fileRuntime.maxTotalTokens;
  }
  if (maxPromptTokens === undefined && fileRuntime?.maxPromptTokens !== undefined) {
    maxPromptTokens = fileRuntime.maxPromptTokens;
  }
  // --no-judge has no negative form on the CLI; if the flag isn't passed,
  // config can opt-in. CLI passing `--no-judge` always wins (already true).
  const noJudgeFromCli = parsed.values['no-judge'] === true;
  const noJudge = noJudgeFromCli || fileRuntime?.noJudge === true;

  // --twin-mode: validate set membership (record|replay|off). The 'off'
  // value drives `opts.twin = 'off'`; others drive `opts.twin = { mode, ... }`.
  const twinModeRaw = parsed.values['twin-mode'];
  let twinOption: ImplementPhaseOptions['twin'];
  if (typeof twinModeRaw === 'string') {
    if (twinModeRaw === 'off') {
      twinOption = 'off';
    } else if (twinModeRaw === 'record' || twinModeRaw === 'replay') {
      const recordingsDirRaw = parsed.values['twin-recordings-dir'];
      twinOption = {
        mode: twinModeRaw,
        ...(typeof recordingsDirRaw === 'string'
          ? { recordingsDir: resolve(process.cwd(), recordingsDirRaw) }
          : {}),
      };
    } else {
      io.stderr(
        `runtime/invalid-twin-mode: --twin-mode must be one of 'record', 'replay', 'off' (got '${twinModeRaw}')\n${USAGE}`,
      );
      io.exit(2);
      return;
    }
  } else if (typeof parsed.values['twin-recordings-dir'] === 'string') {
    // Allow --twin-recordings-dir without --twin-mode (defaults to record).
    twinOption = {
      recordingsDir: resolve(process.cwd(), parsed.values['twin-recordings-dir']),
    };
  }

  // --claude-bin: explicit binary path for the agent subprocess.
  const claudeBin =
    typeof parsed.values['claude-bin'] === 'string' ? parsed.values['claude-bin'] : undefined;

  // Build the graph. Both phases pin cwd: process.cwd() so the agent's edits
  // and the harness's bun test invocation resolve against the same tree.
  const validate = validatePhase({
    cwd: process.cwd(),
    ...(scenarioIds !== undefined ? { scenarioIds } : {}),
    ...(noJudge ? { noJudge: true } : {}),
  });

  let graph: ReturnType<typeof definePhaseGraph>;
  if (noImplement) {
    graph = definePhaseGraph([validate], []);
  } else {
    let implement: ReturnType<typeof implementPhase>;
    try {
      implement = implementPhase({
        cwd: process.cwd(),
        ...(maxPromptTokens !== undefined ? { maxPromptTokens } : {}),
        ...(claudeBin !== undefined ? { claudePath: claudeBin } : {}),
        ...(twinOption !== undefined ? { twin: twinOption } : {}),
      });
    } catch (err) {
      // implementPhase only throws RuntimeError({ code: 'runtime/invalid-max-prompt-tokens' })
      // synchronously; the CLI flag validator above should catch this first,
      // but we map any factory-call-time error to exit 3 defensively.
      if (err instanceof RuntimeError) {
        io.stderr(`${err.message}\n`);
        io.exit(3);
        return;
      }
      throw err;
    }
    graph = definePhaseGraph([implement, validate], [['implement', 'validate']]);
  }

  const store = createContextStore({ dir: contextDir });

  let report: Awaited<ReturnType<typeof run>>;
  try {
    report = await run({
      spec,
      graph,
      contextStore: store,
      options: {
        ...(maxIterations !== undefined ? { maxIterations } : {}),
        ...(maxTotalTokens !== undefined ? { maxTotalTokens } : {}),
        ...(maxAgentTimeoutMs !== undefined ? { maxAgentTimeoutMs } : {}),
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

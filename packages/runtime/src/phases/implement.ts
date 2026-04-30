import { spawn } from 'node:child_process';
import { RuntimeError } from '../errors.js';

// ----- subprocess wrapper internals (T3) ---------------------------------
// Lifted from packages/harness/src/runners/test.ts (we duplicate the small
// helpers rather than depending on harness internals — runtime should not
// import harness's private modules).

const STDERR_TAIL_LINES = 20;
const STDERR_TAIL_BYTES = 4 * 1024;
const TRUNCATION_MARKER = '\n… [truncated]';

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC byte is required to match ANSI CSI escape sequences
// biome-ignore lint/complexity/useRegexLiterals: literal would require an unescaped ESC, which biome also rejects
const ANSI_PATTERN = new RegExp('\\x1b\\[[0-9;]*[A-Za-z]', 'g');

/** Strip ANSI escape sequences from text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Trim a long captured stream to the last N lines, then cap byte length with
 * a truncation marker so a runaway producer can't balloon the report.
 */
export function tailDetail(text: string): string {
  const stripped = stripAnsi(text).trimEnd();
  const lines = stripped.split('\n');
  const tail = lines.slice(Math.max(0, lines.length - STDERR_TAIL_LINES)).join('\n');
  if (Buffer.byteLength(tail, 'utf8') <= STDERR_TAIL_BYTES) return tail;
  let acc = '';
  for (let i = tail.length; i > 0; i--) {
    const slice = tail.slice(i - 1);
    if (Buffer.byteLength(slice, 'utf8') > STDERR_TAIL_BYTES) {
      return TRUNCATION_MARKER + acc;
    }
    acc = slice;
  }
  return acc;
}

export interface SpawnAgentOptions {
  claudePath: string;
  allowedTools: string;
  cwd: string;
  env: Record<string, string | undefined>;
  prompt: string;
  timeoutMs: number;
  log: (line: string) => void;
}

export interface AgentSpawnResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn `claude -p --allowedTools <list> --bare --output-format json`,
 * write the prompt to its stdin, and resolve with the captured streams on
 * a clean exit (any exit code). Rejects with `RuntimeError({ code:
 * 'runtime/agent-failed' })` for every operational failure, with a
 * `failureDetail` prefix that names the specific reason:
 *   - agent-spawn-failed: ENOENT or other spawn error
 *   - agent-timeout (after Nms): wall-clock timeout fired (we sent SIGKILL)
 *   - agent-killed-by-signal SIG: child was killed by a signal we did not send
 *
 * Note: a non-zero exit code is **not** an operational failure here — it's
 * surfaced via the resolved result's `exitCode` field. The caller decides
 * whether to throw on non-zero (T4 does, with the `agent-exit-nonzero`
 * prefix).
 */
export function spawnAgent(opts: SpawnAgentOptions): Promise<AgentSpawnResult> {
  return new Promise<AgentSpawnResult>((resolvePromise, rejectPromise) => {
    const child = spawn(
      opts.claudePath,
      ['-p', '--allowedTools', opts.allowedTools, '--bare', '--output-format', 'json'],
      {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      // Tail stderr lines through ctx.log so the user sees progress while the
      // agent runs (claude may write its own progress hints to stderr).
      const text = chunk.toString('utf8');
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trimEnd();
        if (line !== '') opts.log(`[claude] ${stripAnsi(line)}`);
      }
    });

    let timedOut = false;
    let settled = false;
    const settle = (
      action: 'resolve' | 'reject',
      payload: AgentSpawnResult | RuntimeError,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (action === 'resolve') resolvePromise(payload as AgentSpawnResult);
      else rejectPromise(payload as RuntimeError);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.on('error', (err) => {
      // Typically ENOENT — claude binary not on PATH.
      settle(
        'reject',
        new RuntimeError('runtime/agent-failed', `agent-spawn-failed: ${err.message}`),
      );
    });

    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (timedOut) {
        settle(
          'reject',
          new RuntimeError(
            'runtime/agent-failed',
            `agent-timeout (after ${opts.timeoutMs}ms): ${tailDetail(stderr)}`,
          ),
        );
        return;
      }

      if (code === null && signal !== null) {
        settle(
          'reject',
          new RuntimeError(
            'runtime/agent-failed',
            `agent-killed-by-signal ${signal}: ${tailDetail(stderr)}`,
          ),
        );
        return;
      }

      settle('resolve', {
        exitCode: code ?? -1,
        signal,
        stdout,
        stderr,
      });
    });

    // Write the prompt and close stdin so claude reads to EOF.
    child.stdin?.end(opts.prompt, 'utf8');
  });
}

/**
 * The subset of fields the runtime cares about from `claude -p
 * --output-format json`'s stdout envelope. Defensive: every field is
 * optional and unknown-typed; T4's extractor coerces with `numOr0` /
 * `String(...)` / fallbacks.
 */
export interface AgentJsonEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  // The `tool_uses` field's exact shape varies by claude CLI version; we
  // accept either a name array or an object array and dedup string names.
  tool_uses?: unknown;
}

/**
 * Parse the agent's stdout as a single JSON envelope. Throws
 * `RuntimeError({ code: 'runtime/agent-failed' })` with `agent-output-invalid`
 * prefix on parse failure; the `output tail` in the message helps diagnose
 * malformed CLI banners or partial writes.
 */
export function parseAgentJson(stdout: string): AgentJsonEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new RuntimeError(
      'runtime/agent-failed',
      `agent-output-invalid: ${reason}; output tail: ${tailDetail(stdout)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new RuntimeError(
      'runtime/agent-failed',
      `agent-output-invalid: stdout did not parse to a JSON object; output tail: ${tailDetail(stdout)}`,
    );
  }
  return parsed as AgentJsonEnvelope;
}

// ----- implementPhase factory (T4) ---------------------------------------
// Filled in by T4.

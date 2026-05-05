import { spawn } from 'node:child_process';
import { normalizeTestNamePattern, parseTestLine } from '../parse-test-line.js';
import type { SatisfactionResult } from '../types.js';

export interface TestRunnerOptions {
  /** Directory the `bun test` subprocess runs in. */
  cwd: string;
  /** Per-satisfaction timeout in milliseconds. */
  timeoutMs: number;
  /**
   * Override the bun executable. Defaults to `'bun'` (resolved on PATH).
   * Tests can pass an explicit path.
   */
  bunPath?: string;
}

const STDERR_TAIL_LINES = 20;
const STDERR_TAIL_BYTES = 4 * 1024;
const TRUNCATION_MARKER = '\n… [truncated]';

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC byte is required to match ANSI CSI escape sequences
// biome-ignore lint/complexity/useRegexLiterals: literal would require an unescaped ESC, which biome also rejects
const ANSI_PATTERN = new RegExp('\\x1b\\[[0-9;]*[A-Za-z]', 'g');

/**
 * Strip ANSI escape sequences from text. Matches both colour and cursor codes.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Trim a long captured stream to the last N lines, then cap the byte length
 * with a truncation marker so a runaway producer can't balloon a report.
 */
export function tailDetail(text: string): string {
  const stripped = stripAnsi(text).trimEnd();
  const lines = stripped.split('\n');
  const tail = lines.slice(Math.max(0, lines.length - STDERR_TAIL_LINES)).join('\n');
  if (Buffer.byteLength(tail, 'utf8') <= STDERR_TAIL_BYTES) return tail;
  // Cut from the start so the most recent output (typically the failure) is kept.
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

// `bun test -t <pattern>` interprets the pattern as a regex. Spec authors
// almost always write satisfactions as literal substrings (e.g.
// `"... at ^0.0.5"`); escape the standard regex metacharacters so a literal
// `^`, `+`, or `.` in a satisfaction matches the literal character in the
// test name rather than acting as an anchor or quantifier.
const REGEX_META_RE = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
  return s.replace(REGEX_META_RE, '\\$&');
}

function buildArgs(value: string): string[] {
  const parsed = parseTestLine(value);
  const args: string[] = ['test'];
  if (parsed.file !== undefined) args.push(parsed.file);
  if (parsed.pattern !== undefined)
    args.push('-t', escapeRegex(normalizeTestNamePattern(parsed.pattern)));
  return args;
}

/**
 * Run a single `test:` satisfaction. Spawns `bun test [<file>] [-t <pattern>]`
 * in `opts.cwd`, races the exit against a timeout, and returns a typed
 * `SatisfactionResult`. Never throws on operational state — spawn failures
 * and timeouts surface as `status: 'error'`.
 */
export async function runTestSatisfaction(
  satisfaction: { kind: 'test'; value: string; line: number },
  opts: TestRunnerOptions,
): Promise<SatisfactionResult> {
  const startedAt = performance.now();
  const args = buildArgs(satisfaction.value);
  const bun = opts.bunPath ?? 'bun';

  return new Promise<SatisfactionResult>((resolvePromise) => {
    const child = spawn(bun, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    let timedOut = false;
    let settled = false;
    const settle = (result: SatisfactionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolvePromise(result);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.on('error', (err) => {
      settle({
        kind: 'test',
        value: satisfaction.value,
        line: satisfaction.line,
        status: 'error',
        durationMs: Math.round(performance.now() - startedAt),
        detail: `runner/spawn-failed: ${err.message}`,
      });
    });

    child.on('close', (code, signal) => {
      const stdoutText = Buffer.concat(stdoutChunks).toString('utf8');
      const stderrText = Buffer.concat(stderrChunks).toString('utf8');
      const combined = `${stderrText}${stdoutText}`.trim();
      const durationMs = Math.round(performance.now() - startedAt);
      const exitCode = code ?? -1;

      if (timedOut) {
        settle({
          kind: 'test',
          value: satisfaction.value,
          line: satisfaction.line,
          status: 'error',
          durationMs,
          detail: `runner/timeout: exceeded ${opts.timeoutMs}ms\n${tailDetail(combined)}`,
          exitCode,
        });
        return;
      }

      // Killed by an external signal (not our timeout) → operational error.
      if (code === null && signal !== null) {
        settle({
          kind: 'test',
          value: satisfaction.value,
          line: satisfaction.line,
          status: 'error',
          durationMs,
          detail: `runner/signal: ${signal}\n${tailDetail(combined)}`,
        });
        return;
      }

      const status = exitCode === 0 ? 'pass' : 'fail';
      settle({
        kind: 'test',
        value: satisfaction.value,
        line: satisfaction.line,
        status,
        durationMs,
        detail: tailDetail(combined),
        exitCode,
      });
    });
  });
}

// JudgeClient impl that spawns `claude -p` (subscription auth) instead of
// using the Anthropic SDK directly. Mirrors packages/runtime/src/phases/
// implement.ts's locked-args pattern with `--allowedTools '[]'` since judges
// are read-only.
//
// Why not the SDK path: the BACKLOG explicitly wants the reviewer on
// subscription auth (no ANTHROPIC_API_KEY). The harness's anthropicJudgeClient
// uses the SDK, which is per-token-billed. Reviewer-quality work runs
// constantly in dev; subscription auth keeps the cost story honest.
//
// Why not forced tool-use: claude -p with --allowedTools '[]' blocks all tool
// calls, so we can't use the SDK's record_judgment tool path. Instead the
// prompt instructs the model to emit strict JSON in the response text; we
// parse it (with a regex-extract fallback for prefixed/suffixed JSON).

import { spawn } from 'node:child_process';
import type { JudgeClient, Judgment } from '@wifo/factory-harness';

export interface ClaudeCliJudgeClientOptions {
  claudeBin?: string;
  // Locked at construction time so callers can't override per-call. Default:
  // 30s, mirrors anthropicJudgeClient's default.
  timeoutMs?: number;
}

const STRICT_JSON_INSTRUCTION =
  'Respond with a single JSON object on one line, with no surrounding prose: ' +
  '{"pass": <boolean>, "score": <number 0-1>, "reasoning": "<one or two sentences>"}';

interface ClaudeEnvelope {
  result?: unknown;
}

export function claudeCliJudgeClient(opts: ClaudeCliJudgeClientOptions = {}): JudgeClient {
  const claudeBin = opts.claudeBin ?? 'claude';
  const defaultTimeoutMs = opts.timeoutMs ?? 30_000;

  return {
    async judge({ criterion, scenario, artifact, timeoutMs }) {
      const effectiveTimeoutMs = timeoutMs > 0 ? timeoutMs : defaultTimeoutMs;
      const prompt = [
        `Scenario: ${scenario.id}`,
        `Given: ${scenario.given}`,
        `When: ${scenario.when}`,
        `Then: ${scenario.then}`,
        '',
        'Criterion:',
        criterion,
        '',
        'Artifact:',
        artifact,
        '',
        STRICT_JSON_INSTRUCTION,
      ].join('\n');

      const envelope = await spawnClaudeJudge(claudeBin, prompt, effectiveTimeoutMs);
      return extractJudgment(envelope);
    },
  };
}

function spawnClaudeJudge(bin: string, prompt: string, timeoutMs: number): Promise<ClaudeEnvelope> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, ['-p', '--allowedTools', '[]', '--output-format', 'json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));

    let timedOut = false;
    let settled = false;
    const settle = (action: 'resolve' | 'reject', payload: ClaudeEnvelope | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (action === 'resolve') resolvePromise(payload as ClaudeEnvelope);
      else rejectPromise(payload as Error);
    };
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      settle('reject', new Error(`judge/spawn-failed: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (timedOut) {
        settle('reject', new Error(`judge/timeout: claude -p timed out after ${timeoutMs}ms`));
        return;
      }
      if (code === null && signal !== null) {
        settle('reject', new Error(`judge/killed: signal=${signal} ${stderr.slice(0, 500)}`));
        return;
      }
      if ((code ?? 0) !== 0) {
        settle(
          'reject',
          new Error(`judge/exit-nonzero: claude -p exited ${code} stderr=${stderr.slice(0, 500)}`),
        );
        return;
      }
      try {
        const env = JSON.parse(stdout) as ClaudeEnvelope;
        settle('resolve', env);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        settle('reject', new Error(`judge/envelope-parse-failed: ${msg}`));
      }
    });

    child.stdin?.end(prompt, 'utf8');
  });
}

/**
 * Extract a `Judgment` from the envelope's `result` field. Strict JSON parse
 * first; regex-extract first balanced `{...}` containing `"pass"` as a
 * fallback (handles preamble like `Sure, here's the JSON: {...}`). Throws
 * `Error('judge/malformed-response: <detail>')` on both failures.
 */
export function extractJudgment(envelope: ClaudeEnvelope): Judgment {
  const result = envelope.result;
  if (typeof result !== 'string') {
    throw new Error(
      `judge/malformed-response: envelope.result is not a string (got ${typeof result})`,
    );
  }
  const trimmed = result.trim();
  // Try direct parse first.
  try {
    return validateJudgment(JSON.parse(trimmed));
  } catch {
    // fall through to regex
  }
  // Regex-extract the first {...} substring containing `"pass"`. Non-greedy
  // match; multiline-safe.
  const match = trimmed.match(/\{[^{}]*"pass"[\s\S]*?\}/);
  if (match) {
    try {
      return validateJudgment(JSON.parse(match[0]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`judge/malformed-response: regex-extracted JSON failed validation: ${msg}`);
    }
  }
  throw new Error(
    `judge/malformed-response: response did not contain a JSON object with "pass" field. response head: ${trimmed.slice(0, 200)}`,
  );
}

function validateJudgment(value: unknown): Judgment {
  if (typeof value !== 'object' || value === null) {
    throw new Error('judge/malformed-response: not an object');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.pass !== 'boolean') {
    throw new Error('judge/malformed-response: missing or non-boolean `pass`');
  }
  const score = typeof v.score === 'number' ? v.score : v.pass ? 1 : 0;
  if (score < 0 || score > 1 || Number.isNaN(score)) {
    throw new Error('judge/malformed-response: out-of-range `score`');
  }
  const reasoning = typeof v.reasoning === 'string' ? v.reasoning : '(no reasoning)';
  return { pass: v.pass, score, reasoning };
}

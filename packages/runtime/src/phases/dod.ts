import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { type DodBullet, findSection, parseDodBullets } from '@wifo/factory-core';
import type { JudgeClient } from '@wifo/factory-harness';
import { definePhase } from '../graph.js';
import { FactoryDodReportSchema, tryRegister } from '../records.js';
import type { Phase } from '../types.js';

const DEFAULT_SHELL_BIN = 'bash';
const DEFAULT_BULLET_TIMEOUT_MS = 60_000;
const DEFAULT_JUDGE_MODEL = 'claude-3-5-haiku-20241022';
const STDERR_TAIL_BYTES_CAP = 2 * 1024; // 2 KB per bullet
const STDERR_TRUNCATION_MARKER = '\n[runtime] truncated stderr';

export interface DodPhaseOptions {
  cwd?: string;
  /** Shell binary used for `kind: 'shell'` bullets. Default 'bash'. */
  shellBin?: string;
  /** Per-bullet timeout in milliseconds. Default 60_000. */
  timeoutMs?: number;
  /**
   * Judge client for `kind: 'judge'` bullets. Test-injection point. When
   * omitted and judge bullets are present, the phase tries to lazy-load
   * the default Anthropic-backed client; missing `ANTHROPIC_API_KEY`
   * surfaces as `status: 'error'` on each judge bullet (the phase returns
   * `'error'` overall).
   */
  judgeClient?: JudgeClient;
  /** When true, judge bullets are skipped (`status: 'skipped'`). */
  noJudge?: boolean;
  /** Optional judge model override. */
  judge?: { model?: string };
}

interface BulletResult {
  kind: 'shell' | 'judge';
  bullet: string;
  status: 'pass' | 'fail' | 'error';
  command?: string;
  exitCode?: number | null;
  stderrTail?: string;
  judgeReasoning?: string;
  durationMs: number;
}

interface ShellRunResult {
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

function tailStderr(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= STDERR_TAIL_BYTES_CAP) return text;
  const markerBytes = Buffer.byteLength(STDERR_TRUNCATION_MARKER, 'utf8');
  const target = Math.max(0, STDERR_TAIL_BYTES_CAP - markerBytes);
  let cut = text.length;
  while (cut > 0 && Buffer.byteLength(text.slice(text.length - cut), 'utf8') > target) cut--;
  return `${text.slice(text.length - cut)}${STDERR_TRUNCATION_MARKER}`;
}

function runShellBullet(args: {
  shellBin: string;
  command: string;
  cwd: string;
  timeoutMs: number;
}): Promise<ShellRunResult> {
  return new Promise<ShellRunResult>((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(args.shellBin, ['-c', args.command], {
        cwd: args.cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolvePromise({ exitCode: null, stderr: '', timedOut: false, spawnError: message });
      return;
    }

    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    let timedOut = false;
    let settled = false;
    const settle = (result: ShellRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolvePromise(result);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, args.timeoutMs);

    child.on('error', (err) => {
      settle({
        exitCode: null,
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut: false,
        spawnError: err.message,
      });
    });

    child.on('close', (code) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (timedOut) {
        settle({ exitCode: null, stderr, timedOut: true });
        return;
      }
      settle({ exitCode: code, stderr, timedOut: false });
    });
  });
}

async function lazyLoadJudgeClient(): Promise<JudgeClient | { error: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    return {
      error:
        'runtime/dod-bullet-error: ANTHROPIC_API_KEY is not set; pass --skip-dod-phase or provide a custom JudgeClient',
    };
  }
  const mod = await import('@wifo/factory-harness');
  return mod.createDefaultJudgeClient();
}

/**
 * v0.0.10 — Built-in phase factory: returns a `Phase` named `'dod'` that
 * reads the spec's `## Definition of Done` section, parses each bullet via
 * `parseDodBullets`, dispatches `kind: 'shell'` bullets to a Bash subprocess
 * and `kind: 'judge'` bullets to a JudgeClient, and persists a single
 * `factory-dod-report` record with per-bullet status. Convergence requires
 * every bullet to pass.
 */
export function dodPhase(opts: DodPhaseOptions = {}): Phase {
  return definePhase('dod', async (ctx) => {
    tryRegister(ctx.contextStore, 'factory-dod-report', FactoryDodReportSchema);

    const cwd =
      opts.cwd ??
      (ctx.spec.raw.filename !== undefined
        ? dirname(resolve(ctx.spec.raw.filename))
        : process.cwd());
    const shellBin = opts.shellBin ?? DEFAULT_SHELL_BIN;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_BULLET_TIMEOUT_MS;
    const judgeModel = opts.judge?.model ?? DEFAULT_JUDGE_MODEL;
    const judgeTimeoutMs = ctx.maxAgentTimeoutMs ?? 600_000;

    const startedAt = new Date();
    const t0 = performance.now();

    const section = findSection(ctx.spec.raw.source, 'Definition of Done');
    const bullets = parseDodBullets(section);

    const summary = { pass: 0, fail: 0, error: 0, skipped: 0 };
    const results: BulletResult[] = [];

    // Resolve judge client lazily — only when a judge bullet is present.
    let judgeClient: JudgeClient | null = null;
    let judgeClientLoadError: string | null = null;
    const needsJudge = bullets.some((b) => b.kind === 'judge') && opts.noJudge !== true;
    if (needsJudge) {
      if (opts.judgeClient !== undefined) {
        judgeClient = opts.judgeClient;
      } else {
        const loaded = await lazyLoadJudgeClient();
        if ('error' in loaded) {
          judgeClientLoadError = loaded.error;
        } else {
          judgeClient = loaded;
        }
      }
    }

    for (const bullet of bullets) {
      const bulletT0 = performance.now();
      if (bullet.kind === 'shell') {
        const run = await runShellBullet({
          shellBin,
          command: bullet.command,
          cwd,
          timeoutMs,
        });
        const durationMs = Math.round(performance.now() - bulletT0);
        if (run.timedOut) {
          const result: BulletResult = {
            kind: 'shell',
            bullet: bullet.raw,
            status: 'error',
            command: bullet.command,
            exitCode: null,
            stderrTail: `dod-timeout (after ${timeoutMs}ms)`,
            durationMs,
          };
          results.push(result);
          summary.error++;
          continue;
        }
        if (run.spawnError !== undefined) {
          const result: BulletResult = {
            kind: 'shell',
            bullet: bullet.raw,
            status: 'error',
            command: bullet.command,
            exitCode: null,
            stderrTail: `runtime/dod-bullet-error: ${run.spawnError}`,
            durationMs,
          };
          results.push(result);
          summary.error++;
          continue;
        }
        const passed = run.exitCode === 0;
        const result: BulletResult = {
          kind: 'shell',
          bullet: bullet.raw,
          status: passed ? 'pass' : 'fail',
          command: bullet.command,
          exitCode: run.exitCode,
          ...(run.stderr !== '' ? { stderrTail: tailStderr(run.stderr) } : {}),
          durationMs,
        };
        results.push(result);
        if (passed) summary.pass++;
        else summary.fail++;
        continue;
      }

      // judge bullet
      if (opts.noJudge === true) {
        const durationMs = Math.round(performance.now() - bulletT0);
        results.push({
          kind: 'judge',
          bullet: bullet.raw,
          status: 'pass',
          durationMs,
          judgeReasoning: '--no-judge (skipped)',
        });
        // Mirror harness: --no-judge marks judges as skipped in summary but
        // doesn't fail the phase. We choose 'pass' status so the phase still
        // converges; this matches the validatePhase --no-judge contract.
        summary.skipped++;
        continue;
      }
      if (judgeClient === null) {
        const durationMs = Math.round(performance.now() - bulletT0);
        results.push({
          kind: 'judge',
          bullet: bullet.raw,
          status: 'error',
          durationMs,
          judgeReasoning: judgeClientLoadError ?? 'runtime/dod-bullet-error: no judge client',
        });
        summary.error++;
        continue;
      }
      try {
        const judgment = await judgeClient.judge({
          criterion: bullet.criterion,
          scenario: {
            id: 'dod',
            given: 'the implementation that satisfies the spec',
            when: 'the maintainer evaluates the Definition of Done',
            then: 'this DoD criterion is met',
          },
          artifact: ctx.spec.raw.source,
          model: judgeModel,
          timeoutMs: judgeTimeoutMs,
        });
        const durationMs = Math.round(performance.now() - bulletT0);
        results.push({
          kind: 'judge',
          bullet: bullet.raw,
          status: judgment.pass ? 'pass' : 'fail',
          durationMs,
          judgeReasoning: judgment.reasoning,
        });
        if (judgment.pass) summary.pass++;
        else summary.fail++;
      } catch (err) {
        const durationMs = Math.round(performance.now() - bulletT0);
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          kind: 'judge',
          bullet: bullet.raw,
          status: 'error',
          durationMs,
          judgeReasoning: `runtime/dod-bullet-error: ${message}`,
        });
        summary.error++;
      }
    }

    let status: 'pass' | 'fail' | 'error';
    if (summary.error > 0) status = 'error';
    else if (summary.fail > 0) status = 'fail';
    else status = 'pass';

    const durationMs = Math.round(performance.now() - t0);
    const payload = {
      specId: ctx.spec.frontmatter.id,
      ...(ctx.spec.raw.filename !== undefined ? { specPath: ctx.spec.raw.filename } : {}),
      iteration: ctx.iteration,
      startedAt: startedAt.toISOString(),
      durationMs,
      bullets: results,
      summary,
      status,
    };

    // Parents include the same-iteration validate-report when threaded via
    // ctx.inputs (in the default [implement → validate → dod] graph).
    const sameIterValidate = ctx.inputs.find((r) => r.type === 'factory-validate-report');
    const parents = sameIterValidate !== undefined ? [ctx.runId, sameIterValidate.id] : [ctx.runId];
    const id = await ctx.contextStore.put('factory-dod-report', payload, { parents });
    const record = await ctx.contextStore.get(id);
    if (record === null) {
      return { status: 'error', records: [] };
    }
    return { status, records: [record] };
  });
}

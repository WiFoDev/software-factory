import { dirname, resolve } from 'node:path';
import { type RunHarnessOptions, runHarness } from '@wifo/factory-harness';
import { definePhase } from '../graph.js';
import { FactoryValidateReportSchema, tryRegister } from '../records.js';
import type { Phase, PhaseStatus } from '../types.js';

export interface ValidatePhaseOptions {
  cwd?: string;
  scenarioIds?: ReadonlySet<string>;
  visibleOnly?: boolean;
  holdoutsOnly?: boolean;
  noJudge?: boolean;
  timeoutMs?: number;
  judge?: { model?: string };
  /**
   * v0.0.11 — When true, the validate phase runs both visible scenarios
   * AND `## Holdout Scenarios` each iteration. The persisted
   * `factory-validate-report` payload carries a separate `holdouts` array
   * (entries with `scenarioKind: 'holdout'`); convergence requires both
   * sets to pass. Default `false`: only visible scenarios run (v0.0.10
   * behavior preserved).
   */
  checkHoldouts?: boolean;
}

function aggregateReportStatus(...statuses: PhaseStatus[]): PhaseStatus {
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('fail')) return 'fail';
  return 'pass';
}

/**
 * Built-in phase factory: returns a `Phase` named `'validate'` that runs the
 * harness against the spec, persists a `factory-validate-report` record (with
 * `parents: [ctx.runId]`), and returns a `PhaseResult` whose `status` mirrors
 * the harness report's status.
 */
export function validatePhase(opts: ValidatePhaseOptions = {}): Phase {
  return definePhase('validate', async (ctx) => {
    tryRegister(ctx.contextStore, 'factory-validate-report', FactoryValidateReportSchema);

    // v0.0.11 — `ctx.cwd` (set by runtime when worktree mode is enabled)
    // wins over `opts.cwd` so the maintainer's main tree is never touched
    // by the harness's `bun test` invocation.
    const cwd =
      ctx.cwd ??
      opts.cwd ??
      (ctx.spec.raw.filename !== undefined
        ? dirname(resolve(ctx.spec.raw.filename))
        : process.cwd());

    const baseHarnessOpts: RunHarnessOptions = {
      cwd,
      ...(opts.scenarioIds !== undefined ? { scenarioIds: opts.scenarioIds } : {}),
      ...(opts.noJudge !== undefined ? { noJudge: opts.noJudge } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.judge !== undefined ? { judge: opts.judge } : {}),
      log: ctx.log,
    };

    let payload:
      | Awaited<ReturnType<typeof runHarness>>
      | (Awaited<ReturnType<typeof runHarness>> & {
          holdouts: Awaited<ReturnType<typeof runHarness>>['scenarios'];
        });
    let phaseStatus: PhaseStatus;

    if (opts.checkHoldouts === true) {
      // v0.0.11 — split into two harness passes so visible scenarios and
      // holdouts land in distinct payload arrays. Both must pass to
      // converge; the agent prompt's `# Prior holdout fail` section only
      // reads the holdouts array.
      const visibleReport = await runHarness(ctx.spec, {
        ...baseHarnessOpts,
        visibleOnly: true,
      });
      const holdoutReport = await runHarness(ctx.spec, {
        ...baseHarnessOpts,
        holdoutsOnly: true,
      });
      const summary = {
        pass: visibleReport.summary.pass + holdoutReport.summary.pass,
        fail: visibleReport.summary.fail + holdoutReport.summary.fail,
        error: visibleReport.summary.error + holdoutReport.summary.error,
        skipped: visibleReport.summary.skipped + holdoutReport.summary.skipped,
      };
      phaseStatus = aggregateReportStatus(visibleReport.status, holdoutReport.status);
      payload = {
        specId: ctx.spec.frontmatter.id,
        ...(ctx.spec.raw.filename !== undefined ? { specPath: ctx.spec.raw.filename } : {}),
        startedAt: visibleReport.startedAt,
        durationMs: visibleReport.durationMs + holdoutReport.durationMs,
        scenarios: visibleReport.scenarios,
        holdouts: holdoutReport.scenarios,
        summary,
        status: phaseStatus,
      };
    } else {
      // v0.0.11 default: visible-only. Programmatic callers can still
      // toggle via opts.visibleOnly / opts.holdoutsOnly.
      const visibleOnly =
        opts.visibleOnly !== undefined ? opts.visibleOnly : opts.holdoutsOnly !== true;
      const harnessOpts: RunHarnessOptions = {
        ...baseHarnessOpts,
        visibleOnly,
        ...(opts.holdoutsOnly !== undefined ? { holdoutsOnly: opts.holdoutsOnly } : {}),
      };
      const report = await runHarness(ctx.spec, harnessOpts);
      payload = report;
      phaseStatus = report.status;
    }

    // v0.0.3 — extend parents with the same-iteration implement-report id when
    // the runtime threaded it via ctx.inputs (i.e. in the [implement → validate]
    // graph). In --no-implement mode ctx.inputs has no implement-report and
    // parents falls back to [runId] — preserving v0.0.2 record-set parity.
    const sameIterImpl = ctx.inputs.find((r) => r.type === 'factory-implement-report');
    const parents = sameIterImpl !== undefined ? [ctx.runId, sameIterImpl.id] : [ctx.runId];
    const id = await ctx.contextStore.put('factory-validate-report', payload, { parents });
    const record = await ctx.contextStore.get(id);
    if (record === null) {
      // Defensive — unreachable since put just succeeded.
      return { status: 'error', records: [] };
    }
    return { status: phaseStatus, records: [record] };
  });
}

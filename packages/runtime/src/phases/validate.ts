import { dirname, resolve } from 'node:path';
import { type RunHarnessOptions, runHarness } from '@wifo/factory-harness';
import { definePhase } from '../graph.js';
import { FactoryValidateReportSchema, tryRegister } from '../records.js';
import type { Phase } from '../types.js';

export interface ValidatePhaseOptions {
  cwd?: string;
  scenarioIds?: ReadonlySet<string>;
  visibleOnly?: boolean;
  holdoutsOnly?: boolean;
  noJudge?: boolean;
  timeoutMs?: number;
  judge?: { model?: string };
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

    const cwd =
      opts.cwd ??
      (ctx.spec.raw.filename !== undefined
        ? dirname(resolve(ctx.spec.raw.filename))
        : process.cwd());

    const harnessOpts: RunHarnessOptions = {
      cwd,
      ...(opts.scenarioIds !== undefined ? { scenarioIds: opts.scenarioIds } : {}),
      ...(opts.visibleOnly !== undefined ? { visibleOnly: opts.visibleOnly } : {}),
      ...(opts.holdoutsOnly !== undefined ? { holdoutsOnly: opts.holdoutsOnly } : {}),
      ...(opts.noJudge !== undefined ? { noJudge: opts.noJudge } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.judge !== undefined ? { judge: opts.judge } : {}),
      log: ctx.log,
    };

    const report = await runHarness(ctx.spec, harnessOpts);
    const id = await ctx.contextStore.put('factory-validate-report', report, {
      parents: [ctx.runId],
    });
    const record = await ctx.contextStore.get(id);
    if (record === null) {
      // Defensive — unreachable since put just succeeded.
      return { status: 'error', records: [] };
    }
    return { status: report.status, records: [record] };
  });
}

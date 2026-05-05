import {
  ContextError,
  type ContextRecord,
  type ContextStore,
  hashRecord,
} from '@wifo/factory-context';
import type { Spec } from '@wifo/factory-core';
import { RuntimeError } from './errors.js';
import {
  FactoryDodReportSchema,
  FactoryPhaseSchema,
  type FactoryRunPayload,
  FactoryRunSchema,
  type FactoryWorktreePayload,
  FactoryWorktreeSchema,
  tryRegister,
} from './records.js';
import type {
  Phase,
  PhaseGraph,
  PhaseInvocationResult,
  PhaseIterationResult,
  PhaseStatus,
  RunOptions,
  RunReport,
  RunStatus,
} from './types.js';
import { type CreatedWorktree, type WorktreeOptions, createWorktree } from './worktree.js';

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_TOTAL_TOKENS = 500_000;
const DEFAULT_MAX_AGENT_TIMEOUT_MS = 600_000;

interface ImplementTokens {
  input?: number;
  output?: number;
}

function sumImplementTokens(records: ContextRecord[]): number {
  let sum = 0;
  for (const rec of records) {
    if (rec.type !== 'factory-implement-report') continue;
    const t = (rec.payload as { tokens?: ImplementTokens } | null | undefined)?.tokens;
    if (t === undefined) continue;
    sum += typeof t.input === 'number' && Number.isFinite(t.input) ? t.input : 0;
    sum += typeof t.output === 'number' && Number.isFinite(t.output) ? t.output : 0;
  }
  return sum;
}

interface ScenarioRow {
  scenarioId?: string;
  status?: string;
}

interface DodBulletRow {
  bullet?: string;
  command?: string;
  status?: string;
}

function truncateList(ids: string[], max = 5): string {
  if (ids.length <= max) return ids.join(', ');
  return `${ids.slice(0, max).join(', ')}, ...`;
}

function getFailedScenarios(records: ContextRecord[]): string[] {
  const validateReport = records.find((r) => r.type === 'factory-validate-report');
  if (validateReport === undefined) return [];
  const scenarios =
    (validateReport.payload as { scenarios?: ScenarioRow[] } | null | undefined)?.scenarios ?? [];
  const failed: string[] = [];
  for (const s of scenarios) {
    if (s.status === 'fail' || s.status === 'error') {
      if (typeof s.scenarioId === 'string') failed.push(s.scenarioId);
    }
  }
  return failed;
}

function getFailedDodGates(records: ContextRecord[]): string[] {
  const dodReport = records.find((r) => r.type === 'factory-dod-report');
  if (dodReport === undefined) return [];
  const bullets =
    (dodReport.payload as { bullets?: DodBulletRow[] } | null | undefined)?.bullets ?? [];
  const failed: string[] = [];
  for (const b of bullets) {
    if (b.status === 'fail' || b.status === 'error') {
      const label = typeof b.command === 'string' ? b.command : (b.bullet ?? '<bullet>');
      failed.push(label);
    }
  }
  return failed;
}

function getDodStatus(records: ContextRecord[]): 'pass' | 'fail' | 'error' | 'absent' {
  const dodReport = records.find((r) => r.type === 'factory-dod-report');
  if (dodReport === undefined) return 'absent';
  const status = (dodReport.payload as { status?: string } | null | undefined)?.status;
  if (status === 'pass' || status === 'fail' || status === 'error') return status;
  return 'absent';
}

function buildCauseOfIteration(iter: number, priorOutputs: ContextRecord[]): string {
  const failedScenarios = getFailedScenarios(priorOutputs);
  const failedGates = getFailedDodGates(priorOutputs);

  if (failedScenarios.length === 0 && failedGates.length === 0) {
    const implementReport = priorOutputs.find((r) => r.type === 'factory-implement-report');
    const ref =
      implementReport !== undefined
        ? `factory-implement-report ${implementReport.id}`
        : 'factory-implement-report <none>';
    return `[runtime] iter ${iter} implement (start) — retrying: prior implement phase failed (see ${ref})`;
  }

  const scenarioPart =
    failedScenarios.length === 1
      ? `1 failed scenario (${truncateList(failedScenarios)})`
      : `${failedScenarios.length} failed scenarios${
          failedScenarios.length === 0 ? '' : ` (${truncateList(failedScenarios)})`
        }`;

  const gatePart =
    failedGates.length === 1
      ? `1 failed dod gate (${truncateList(failedGates)})`
      : `${failedGates.length} failed dod gates${
          failedGates.length === 0 ? '' : ` (${truncateList(failedGates)})`
        }`;

  return `[runtime] iter ${iter} implement (start) — retrying: ${scenarioPart}; ${gatePart}`;
}

function formatPhaseStart(iter: number, phaseName: string, specId: string, runId: string): string {
  const shortRunId = runId.slice(0, 8);
  return `[runtime] iter ${iter} ${phaseName} (start) — spec=${specId} phase=${phaseName} runId=${shortRunId}`;
}

function formatPhaseEnd(
  iter: number,
  phaseName: string,
  durationMs: number,
  outputs: ContextRecord[],
): string {
  const elapsedSec = Math.round(durationMs / 1000);
  const phaseChargedTokens = sumImplementTokens(outputs);
  let suffix = '';
  if (phaseName === 'implement') {
    const implReport = outputs.find((r) => r.type === 'factory-implement-report');
    const filesChanged = (
      (implReport?.payload as { filesChanged?: unknown[] } | undefined)?.filesChanged ?? []
    ).length;
    suffix = `, ${filesChanged} files changed`;
  } else if (phaseName === 'validate') {
    const valReport = outputs.find((r) => r.type === 'factory-validate-report');
    if (valReport !== undefined) {
      const scenarios =
        (valReport.payload as { scenarios?: ScenarioRow[] } | undefined)?.scenarios ?? [];
      const total = scenarios.length;
      const pass = scenarios.filter((s) => s.status === 'pass').length;
      suffix = `, ${pass}/${total} scenarios pass`;
    }
  } else if (phaseName === 'dod') {
    const dodReport = outputs.find((r) => r.type === 'factory-dod-report');
    if (dodReport !== undefined) {
      const bullets =
        (dodReport.payload as { bullets?: DodBulletRow[] } | undefined)?.bullets ?? [];
      const total = bullets.length;
      const pass = bullets.filter((b) => b.status === 'pass').length;
      suffix = `, ${pass}/${total} dod gates pass`;
    }
  }
  return `[runtime] iter ${iter} ${phaseName} (${elapsedSec}s, ${phaseChargedTokens} charged tokens${suffix})`;
}

interface IterDiagnostic {
  failedScenarios: string[];
  dodStatus: 'pass' | 'fail' | 'error' | 'absent';
}

function detectToolingMismatchLoop(diagnostics: IterDiagnostic[]): {
  mismatchDetected: boolean;
  failedScenarios: string[];
} {
  if (diagnostics.length < 2) return { mismatchDetected: false, failedScenarios: [] };
  const prev = diagnostics[diagnostics.length - 2];
  const cur = diagnostics[diagnostics.length - 1];
  if (prev === undefined || cur === undefined) {
    return { mismatchDetected: false, failedScenarios: [] };
  }
  if (prev.dodStatus !== 'pass' || cur.dodStatus !== 'pass') {
    return { mismatchDetected: false, failedScenarios: [] };
  }
  if (prev.failedScenarios.length === 0 || cur.failedScenarios.length === 0) {
    return { mismatchDetected: false, failedScenarios: [] };
  }
  const prevSorted = [...prev.failedScenarios].sort();
  const curSorted = [...cur.failedScenarios].sort();
  if (prevSorted.length !== curSorted.length) {
    return { mismatchDetected: false, failedScenarios: [] };
  }
  for (let i = 0; i < prevSorted.length; i++) {
    if (prevSorted[i] !== curSorted[i]) {
      return { mismatchDetected: false, failedScenarios: [] };
    }
  }
  return { mismatchDetected: true, failedScenarios: cur.failedScenarios };
}

export interface RunArgs {
  spec: Spec;
  graph: PhaseGraph;
  contextStore: ContextStore;
  options?: RunOptions;
  /**
   * v0.0.7 — when set, the persisted `factory-run` record uses these as its
   * `parents[]`. The sequence-runner passes `[factorySequenceId]`; per-spec
   * CLI callers pass nothing and get the root behavior.
   */
  runParents?: string[];
}

function defaultLog(line: string): void {
  process.stderr.write(`${line}\n`);
}

function defaultStdoutLog(line: string): void {
  process.stdout.write(`${line}\n`);
}

function aggregateIterationStatus(invocations: PhaseInvocationResult[]): PhaseStatus {
  if (invocations.some((p) => p.status === 'error')) return 'error';
  if (invocations.some((p) => p.status === 'fail')) return 'fail';
  return 'pass';
}

async function putOrWrap<T>(
  store: ContextStore,
  type: string,
  payload: T,
  parents: string[],
): Promise<string> {
  try {
    return await store.put(type, payload, { parents });
  } catch (err) {
    if (err instanceof ContextError) {
      throw new RuntimeError('runtime/io-error', `failed to put ${type}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Execute a phase graph against a parsed spec, persisting provenance records to
 * the context store and iterating until convergence or the iteration budget is
 * exhausted.
 *
 * Convergence is generic across phase names: an iteration converges when every
 * phase status is `'pass'`; iterates while any status is `'fail'` and the
 * budget allows; aborts immediately on any `'error'`.
 *
 * Phase exceptions are caught and recorded as `factory-phase` records with
 * `status: 'error'` and the error message in `failureDetail`. The run aborts
 * with `RunReport.status === 'error'`. `run()` never re-throws on phase
 * exceptions; only pre-loop validation (invalid `maxIterations`) and IO
 * failures on the runtime's own `factory-run` / `factory-phase` writes
 * propagate as `RuntimeError`.
 */
export async function run(args: RunArgs): Promise<RunReport> {
  const { spec, graph, contextStore, options = {} } = args;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new RuntimeError(
      'runtime/invalid-max-iterations',
      `must be a positive integer (got ${String(maxIterations)})`,
    );
  }
  const maxTotalTokens = options.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
  // v0.0.9 — per-spec agent-timeout-ms layer between RunOptions and the
  // built-in default. RunOptions wins (CLI/programmatic override is
  // intentional); spec frontmatter is the spec author's declared budget;
  // built-in is the floor.
  const maxAgentTimeoutMs =
    options.maxAgentTimeoutMs ??
    spec.frontmatter['agent-timeout-ms'] ??
    DEFAULT_MAX_AGENT_TIMEOUT_MS;
  const log = options.log ?? defaultLog;
  const stdoutLog = options.stdoutLog ?? defaultStdoutLog;
  const quiet = options.quiet === true;
  const progress = (line: string): void => {
    if (!quiet) log(line);
  };

  tryRegister(contextStore, 'factory-run', FactoryRunSchema);
  tryRegister(contextStore, 'factory-phase', FactoryPhaseSchema);
  tryRegister(contextStore, 'factory-dod-report', FactoryDodReportSchema);

  const startedAt = new Date();
  const t0 = performance.now();

  const runPayload: FactoryRunPayload = {
    specId: spec.frontmatter.id,
    ...(spec.raw.filename !== undefined ? { specPath: spec.raw.filename } : {}),
    graphPhases: [...graph.topoOrder],
    maxIterations,
    startedAt: startedAt.toISOString(),
  };

  // v0.0.11 — When `RunOptions.worktree` is set, create the isolated git
  // worktree BEFORE persisting `factory-run` so a creation failure leaves
  // no orphan run record (H-2). The runId is pre-computed from the same
  // canonical hash inputs that `put()` uses, so the worktree path
  // (`<rootDir>/<runId>/`) and the eventual factory-run id agree.
  const runParents = args.runParents ?? [];
  let worktree: CreatedWorktree | undefined;
  if (options.worktree !== undefined && options.worktree !== false) {
    tryRegister(contextStore, 'factory-worktree', FactoryWorktreeSchema);
    const worktreeOpts: WorktreeOptions = options.worktree === true ? {} : options.worktree;
    const preRunId = hashRecord({
      type: 'factory-run',
      parents: runParents,
      payload: runPayload,
    });
    worktree = createWorktree(preRunId, worktreeOpts);
  }

  const runId = await putOrWrap(contextStore, 'factory-run', runPayload, runParents);

  // Captured for the factory-worktree record that's persisted at run end
  // (once we know the final run status). Not persisted up-front: the
  // context store is content-addressed, so an "active → converged"
  // mutation would change the id; recording once with the final status
  // keeps the record set immutable + small.
  const worktreeCreatedAt = worktree !== undefined ? new Date().toISOString() : undefined;

  const phaseByName = new Map<string, Phase>();
  for (const phase of graph.phases) phaseByName.set(phase.name, phase);

  const predecessors = new Map<string, string[]>();
  for (const name of graph.topoOrder) predecessors.set(name, []);
  for (const [from, to] of graph.edges) {
    const list = predecessors.get(to);
    if (list !== undefined) list.push(from);
  }

  const iterations: PhaseIterationResult[] = [];
  let runStatus: RunStatus = 'no-converge';

  // v0.0.3: whole-run token budget accumulator. Sums tokens.input + tokens.output
  // from every factory-implement-report produced across all iterations.
  // v0.0.11: this is the "charged" total — the budget-relevant value
  // (cache reads/creates are free per Anthropic's pricing).
  let runningChargedTokens = 0;

  // v0.0.3: prior iteration's terminal-phase outputs, threaded into the next
  // iteration's root phase via ctx.inputs (NOT via factory-phase.parents).
  let priorIterationTerminalOutputs: ContextRecord[] = [];

  // v0.0.12 — observability: prior iter's full output set (across all phases)
  // for cause-of-iteration, plus per-iter diagnostic for tooling-mismatch
  // detection. Both are read-only views; nothing is persisted.
  let priorIterAllOutputs: ContextRecord[] = [];
  const iterDiagnostics: IterDiagnostic[] = [];
  let mismatchWarningEmitted = false;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const invocations: PhaseInvocationResult[] = [];
    const outputsByPhase = new Map<string, ContextRecord[]>();
    let aborted = false;

    // v0.0.12 — At iter ≥ 2, surface (a) why this iter is retrying, then
    // (b) a one-shot tooling-mismatch warning when DoD passed but the same
    // scenarios failed validate twice in a row. Both are stderr progress
    // lines; `--quiet` (or RunOptions.quiet) suppresses them.
    if (iteration >= 2) {
      progress(buildCauseOfIteration(iteration, priorIterAllOutputs));
      if (!mismatchWarningEmitted && iterDiagnostics.length >= 2) {
        const detection = detectToolingMismatchLoop(iterDiagnostics);
        if (detection.mismatchDetected) {
          const prevIter = iteration - 2;
          const curIter = iteration - 1;
          progress(
            `[runtime] WARNING: DoD passing + validate fails identical across iter ${prevIter}/${curIter} — likely tooling mismatch; consider --prefer-dod or inspect per-scenario harness invocation. Failed scenarios: ${detection.failedScenarios.join(', ')}`,
          );
          mismatchWarningEmitted = true;
        }
      }
    }

    for (const phaseName of graph.topoOrder) {
      const phase = phaseByName.get(phaseName);
      if (phase === undefined) {
        // Unreachable — definePhaseGraph guarantees every name in topoOrder is in phases[].
        throw new RuntimeError(
          'runtime/io-error',
          `internal: phase '${phaseName}' missing from graph`,
        );
      }

      // Same-iteration predecessor outputs (existing v0.0.2 logic). Flows into
      // factory-phase.parents AND ctx.inputs.
      const phasePredecessors = predecessors.get(phaseName) ?? [];
      const sameIterInputs: ContextRecord[] = [];
      const seenSameIterIds = new Set<string>();
      for (const predName of phasePredecessors) {
        for (const rec of outputsByPhase.get(predName) ?? []) {
          if (seenSameIterIds.has(rec.id)) continue;
          seenSameIterIds.add(rec.id);
          sameIterInputs.push(rec);
        }
      }

      // Cross-iteration threading (v0.0.3). For root phases on iter ≥ 2,
      // include the prior iteration's terminal outputs. This flows into
      // ctx.inputs ONLY — NOT into factory-phase.parents (preserves v0.0.2
      // record-set parity in --no-implement mode; pinned by H-3).
      const ctxInputs: ContextRecord[] = [...sameIterInputs];
      if (phasePredecessors.length === 0 && iteration > 1) {
        const seen = new Set<string>(sameIterInputs.map((r) => r.id));
        for (const rec of priorIterationTerminalOutputs) {
          if (seen.has(rec.id)) continue;
          seen.add(rec.id);
          ctxInputs.push(rec);
        }
      }

      progress(formatPhaseStart(iteration, phaseName, spec.frontmatter.id, runId));
      const phaseT0 = performance.now();
      let status: PhaseStatus;
      let outputRecords: ContextRecord[] = [];
      let failureDetail: string | undefined;
      try {
        const result = await phase.run({
          spec,
          contextStore,
          log,
          runId,
          iteration,
          inputs: ctxInputs,
          maxAgentTimeoutMs,
          ...(worktree !== undefined ? { cwd: worktree.path } : {}),
        });
        status = result.status;
        outputRecords = result.records;

        // v0.0.3 whole-run cost cap. Sum tokens from any factory-implement-report
        // in this phase's outputs and trip the cap if cumulative exceeds the
        // limit. Throwing here lands in the same catch below — runtime persists
        // factory-phase with status='error' and failureDetail naming the code,
        // mirroring the v0.0.2 per-phase cost-cap chain.
        const implementTokens = sumImplementTokens(outputRecords);
        if (implementTokens > 0) {
          runningChargedTokens += implementTokens;
          if (runningChargedTokens > maxTotalTokens) {
            throw new RuntimeError(
              'runtime/total-cost-cap-exceeded',
              `running_charged=${runningChargedTokens} > maxTotalTokens=${maxTotalTokens}`,
            );
          }
        }
      } catch (err) {
        status = 'error';
        outputRecords = [];
        failureDetail = err instanceof Error ? err.message : String(err);
      }
      const durationMs = Math.round(performance.now() - phaseT0);
      progress(formatPhaseEnd(iteration, phaseName, durationMs, outputRecords));

      const phasePayload = {
        phaseName,
        iteration,
        status,
        durationMs,
        outputRecordIds: outputRecords.map((r) => r.id),
        ...(failureDetail !== undefined ? { failureDetail } : {}),
      };
      // factory-phase.parents uses sameIterInputs (NOT ctxInputs) so v0.0.2
      // record-set parity is preserved across iterations in --no-implement mode.
      const phaseRecordId = await putOrWrap(contextStore, 'factory-phase', phasePayload, [
        runId,
        ...sameIterInputs.map((r) => r.id),
      ]);

      outputsByPhase.set(phaseName, outputRecords);
      invocations.push({
        phaseName,
        phaseRecordId,
        status,
        outputRecordIds: outputRecords.map((r) => r.id),
        durationMs,
      });

      if (status === 'error') {
        aborted = true;
        break;
      }
    }

    // After every iteration: stash the terminal phase's outputs so the next
    // iteration's root phase can thread them via ctx.inputs.
    const terminalName = graph.topoOrder[graph.topoOrder.length - 1];
    if (terminalName !== undefined) {
      priorIterationTerminalOutputs = outputsByPhase.get(terminalName) ?? [];
    }

    // v0.0.12 — flatten this iter's full output set for the next iter's
    // cause-of-iteration line; record the per-iter diagnostic for the
    // tooling-mismatch loop detector.
    priorIterAllOutputs = [];
    for (const phaseName of graph.topoOrder) {
      for (const rec of outputsByPhase.get(phaseName) ?? []) {
        priorIterAllOutputs.push(rec);
      }
    }
    iterDiagnostics.push({
      failedScenarios: getFailedScenarios(priorIterAllOutputs),
      dodStatus: getDodStatus(priorIterAllOutputs),
    });

    const iterationStatus = aborted ? 'error' : aggregateIterationStatus(invocations);
    iterations.push({ iteration, phases: invocations, status: iterationStatus });

    if (iterationStatus === 'error') {
      runStatus = 'error';
      break;
    }
    if (iterationStatus === 'pass') {
      runStatus = 'converged';
      break;
    }
    if (iteration === maxIterations) {
      runStatus = 'no-converge';
    }
  }

  const durationMs = Math.round(performance.now() - t0);

  // v0.0.12 — post-convergence stdout hint. Surfaces the next ship-action so
  // the maintainer doesn't have to remember the `factory finish-task` invocation
  // (CORE-836 friction). stdout (NOT stderr) so a `factory-runtime run | grep`
  // pipeline picks it up; not gated on `quiet` because convergence is a
  // lifecycle event, not progress noise.
  if (runStatus === 'converged') {
    stdoutLog(
      `factory-runtime: ${spec.frontmatter.id} converged → ship via 'factory finish-task ${spec.frontmatter.id}'`,
    );
  }

  // v0.0.11 — Persist the `factory-worktree` record (parents=[runId]) once
  // we know the final run status. The CLI `worktree clean` subcommand
  // walks these to decide which worktrees to prune (converged → remove
  // by default; no-converge / error → preserve for forensic value).
  if (worktree !== undefined && worktreeCreatedAt !== undefined) {
    const worktreePayload: FactoryWorktreePayload = {
      runId,
      worktreePath: worktree.path,
      branch: worktree.branch,
      baseSha: worktree.baseSha,
      baseRef: worktree.baseRef,
      createdAt: worktreeCreatedAt,
      status: runStatus,
    };
    await putOrWrap(contextStore, 'factory-worktree', worktreePayload, [runId]);
  }

  return {
    runId,
    specId: spec.frontmatter.id,
    startedAt: startedAt.toISOString(),
    durationMs,
    iterationCount: iterations.length,
    iterations,
    status: runStatus,
    chargedTokens: runningChargedTokens,
    totalTokens: runningChargedTokens,
  };
}

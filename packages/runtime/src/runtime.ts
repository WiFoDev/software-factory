import { ContextError, type ContextRecord, type ContextStore } from '@wifo/factory-context';
import type { Spec } from '@wifo/factory-core';
import { RuntimeError } from './errors.js';
import {
  FactoryPhaseSchema,
  type FactoryRunPayload,
  FactoryRunSchema,
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

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_TOTAL_TOKENS = 500_000;

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

export interface RunArgs {
  spec: Spec;
  graph: PhaseGraph;
  contextStore: ContextStore;
  options?: RunOptions;
}

function defaultLog(line: string): void {
  process.stderr.write(`${line}\n`);
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
  const log = options.log ?? defaultLog;

  tryRegister(contextStore, 'factory-run', FactoryRunSchema);
  tryRegister(contextStore, 'factory-phase', FactoryPhaseSchema);

  const startedAt = new Date();
  const t0 = performance.now();

  const runPayload: FactoryRunPayload = {
    specId: spec.frontmatter.id,
    ...(spec.raw.filename !== undefined ? { specPath: spec.raw.filename } : {}),
    graphPhases: [...graph.topoOrder],
    maxIterations,
    startedAt: startedAt.toISOString(),
  };

  const runId = await putOrWrap(contextStore, 'factory-run', runPayload, []);

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
  let runningTotalTokens = 0;

  // v0.0.3: prior iteration's terminal-phase outputs, threaded into the next
  // iteration's root phase via ctx.inputs (NOT via factory-phase.parents).
  let priorIterationTerminalOutputs: ContextRecord[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const invocations: PhaseInvocationResult[] = [];
    const outputsByPhase = new Map<string, ContextRecord[]>();
    let aborted = false;

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
          runningTotalTokens += implementTokens;
          if (runningTotalTokens > maxTotalTokens) {
            throw new RuntimeError(
              'runtime/total-cost-cap-exceeded',
              `running_total=${runningTotalTokens} > maxTotalTokens=${maxTotalTokens}`,
            );
          }
        }
      } catch (err) {
        status = 'error';
        outputRecords = [];
        failureDetail = err instanceof Error ? err.message : String(err);
      }
      const durationMs = Math.round(performance.now() - phaseT0);

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

  return {
    runId,
    specId: spec.frontmatter.id,
    startedAt: startedAt.toISOString(),
    durationMs,
    iterationCount: iterations.length,
    iterations,
    status: runStatus,
  };
}

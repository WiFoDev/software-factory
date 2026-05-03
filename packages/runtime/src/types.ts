import type { ContextRecord, ContextStore } from '@wifo/factory-context';
import type { Spec } from '@wifo/factory-core';

export type PhaseStatus = 'pass' | 'fail' | 'error';

export interface PhaseResult {
  status: PhaseStatus;
  records: ContextRecord[];
}

export interface PhaseContext {
  spec: Spec;
  contextStore: ContextStore;
  log: (line: string) => void;
  runId: string;
  iteration: number;
  /**
   * Records the runtime threads into this phase invocation. Population:
   *   - Non-root phase: same-iteration predecessor outputs.
   *   - Root phase, iteration ≥ 2: the prior iteration's terminal-phase outputs.
   *   - Root phase, iteration 1: empty.
   * Phases consume by filtering on `record.type` and ignore unknown types.
   * Distinct from the runtime's `factory-phase.parents` list, which only
   * carries same-iteration predecessor ids — see runtime.ts for the split.
   */
  inputs: readonly ContextRecord[];
  /**
   * v0.0.5.2 — Per-phase agent subprocess timeout in milliseconds. Resolved
   * by the runtime from `RunOptions.maxAgentTimeoutMs ?? 600_000` and
   * threaded to every phase invocation. Phases that spawn agent subprocesses
   * (built-in `implementPhase`) consult this when their own `timeoutMs`
   * option is unset; an explicit per-phase `timeoutMs` always wins.
   */
  maxAgentTimeoutMs?: number;
}

export interface Phase {
  readonly name: string;
  readonly run: (ctx: PhaseContext) => Promise<PhaseResult>;
}

export interface PhaseGraph {
  readonly phases: ReadonlyArray<Phase>;
  readonly edges: ReadonlyArray<readonly [string, string]>;
  readonly topoOrder: ReadonlyArray<string>;
}

export interface RunOptions {
  maxIterations?: number;
  log?: (line: string) => void;
  /**
   * Whole-run cap on the sum of `tokens.input + tokens.output` across every
   * `factory-implement-report` produced during the run. Default 500_000.
   * On overrun, the runtime aborts with `RuntimeError({ code:
   * 'runtime/total-cost-cap-exceeded' })`. Per-phase `maxPromptTokens` from
   * v0.0.2 still applies — both caps independent.
   *
   * Not validated programmatically (a non-positive value trips the cap on
   * the first implement that records any tokens). The CLI flag
   * `--max-total-tokens` does pre-validate for friendlier UX.
   */
  maxTotalTokens?: number;
  /**
   * v0.0.5.2 — Per-phase agent subprocess wall-clock timeout, in
   * milliseconds. Default 600_000 (10 min). Threaded to phases via
   * `PhaseContext.maxAgentTimeoutMs`. Wide-blast-radius specs that touch
   * many files can exceed the default — raise this rather than the
   * per-phase token cap.
   *
   * Not validated programmatically (a non-positive value would fire the
   * timeout immediately on the first spawn). The CLI flag
   * `--max-agent-timeout-ms` does pre-validate for friendlier UX.
   */
  maxAgentTimeoutMs?: number;
}

export interface PhaseInvocationResult {
  phaseName: string;
  phaseRecordId: string;
  status: PhaseStatus;
  outputRecordIds: string[];
  durationMs: number;
}

export interface PhaseIterationResult {
  iteration: number;
  phases: PhaseInvocationResult[];
  status: PhaseStatus;
}

export type RunStatus = 'converged' | 'no-converge' | 'error';

export interface RunReport {
  runId: string;
  specId: string;
  startedAt: string;
  durationMs: number;
  iterationCount: number;
  iterations: PhaseIterationResult[];
  status: RunStatus;
  /**
   * v0.0.7 — sum of `tokens.input + tokens.output` across every
   * `factory-implement-report` produced during this run. Used by the
   * sequence-runner to enforce a cross-spec budget without re-walking the
   * context store. Optional for backward-compat: pre-v0.0.7 callers that
   * construct RunReport themselves don't break.
   */
  totalTokens?: number;
}

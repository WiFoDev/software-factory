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
}

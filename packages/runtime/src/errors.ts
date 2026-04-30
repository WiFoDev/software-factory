export type RuntimeErrorCode =
  | 'runtime/graph-empty'
  | 'runtime/graph-duplicate-phase'
  | 'runtime/graph-unknown-phase'
  | 'runtime/graph-cycle'
  | 'runtime/invalid-max-iterations'
  | 'runtime/io-error'
  // v0.0.2 — implementPhase
  | 'runtime/cost-cap-exceeded'
  | 'runtime/agent-failed'
  | 'runtime/invalid-max-prompt-tokens'
  // v0.0.3 — closed autonomous loop
  | 'runtime/total-cost-cap-exceeded';

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;

  constructor(code: RuntimeErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RuntimeError';
    this.code = code;
  }
}

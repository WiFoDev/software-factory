export type RuntimeErrorCode =
  | 'runtime/graph-empty'
  | 'runtime/graph-duplicate-phase'
  | 'runtime/graph-unknown-phase'
  | 'runtime/graph-cycle'
  | 'runtime/invalid-max-iterations'
  | 'runtime/io-error';

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;

  constructor(code: RuntimeErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RuntimeError';
    this.code = code;
  }
}

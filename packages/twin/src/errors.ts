export type TwinReplayErrorCode =
  | 'twin/unsupported-body'
  | 'twin/recording-not-found'
  | 'twin/parse-error'
  | 'twin/io-error';

export class TwinNoMatchError extends Error {
  readonly code = 'twin/no-match' as const;
  readonly hash: string;
  readonly method: string;
  readonly url: string;

  constructor(args: { hash: string; method: string; url: string }) {
    super(`twin/no-match: no recording for ${args.method} ${args.url} (hash=${args.hash})`);
    this.name = 'TwinNoMatchError';
    this.hash = args.hash;
    this.method = args.method;
    this.url = args.url;
  }
}

export class TwinReplayError extends Error {
  readonly code: TwinReplayErrorCode;

  constructor(code: TwinReplayErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'TwinReplayError';
    this.code = code;
  }
}

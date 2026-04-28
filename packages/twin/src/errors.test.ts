import { describe, expect, test } from 'bun:test';
import { TwinNoMatchError, TwinReplayError } from './errors.js';

describe('TwinNoMatchError', () => {
  test('exposes code, hash, method, url and a descriptive message', () => {
    const err = new TwinNoMatchError({
      hash: 'abc1234567890def',
      method: 'POST',
      url: 'https://api.x/y',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TwinNoMatchError);
    expect(err.code).toBe('twin/no-match');
    expect(err.hash).toBe('abc1234567890def');
    expect(err.method).toBe('POST');
    expect(err.url).toBe('https://api.x/y');
    expect(err.message).toContain('twin/no-match');
    expect(err.message).toContain('POST');
    expect(err.message).toContain('https://api.x/y');
    expect(err.message).toContain('abc1234567890def');
    expect(err.name).toBe('TwinNoMatchError');
  });
});

describe('TwinReplayError', () => {
  test('exposes typed code', () => {
    const err = new TwinReplayError('twin/unsupported-body', 'FormData not supported');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TwinReplayError);
    expect(err.code).toBe('twin/unsupported-body');
    expect(err.message).toContain('twin/unsupported-body');
    expect(err.message).toContain('FormData not supported');
    expect(err.name).toBe('TwinReplayError');
  });

  test('all four codes construct cleanly', () => {
    for (const code of [
      'twin/unsupported-body',
      'twin/recording-not-found',
      'twin/parse-error',
      'twin/io-error',
    ] as const) {
      const err = new TwinReplayError(code, 'm');
      expect(err.code).toBe(code);
    }
  });
});

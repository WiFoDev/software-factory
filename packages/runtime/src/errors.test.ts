import { describe, expect, test } from 'bun:test';
import { RuntimeError, type RuntimeErrorCode } from './errors.js';

describe('RuntimeError', () => {
  test('extends Error and is matchable via instanceof', () => {
    const err = new RuntimeError('runtime/graph-cycle', 'cycle through a, b');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.name).toBe('RuntimeError');
  });

  test('exposes a stable code field separate from the message', () => {
    const err = new RuntimeError('runtime/graph-empty', 'at least one phase required');
    expect(err.code).toBe('runtime/graph-empty');
    // code is also embedded in the message for log/CLI surfaces
    expect(err.message).toBe('runtime/graph-empty: at least one phase required');
  });

  test('discriminates by code for catch-and-handle pattern', () => {
    const codes: RuntimeErrorCode[] = [
      'runtime/graph-empty',
      'runtime/graph-duplicate-phase',
      'runtime/graph-unknown-phase',
      'runtime/graph-cycle',
      'runtime/invalid-max-iterations',
      'runtime/io-error',
    ];
    for (const code of codes) {
      const err = new RuntimeError(code, 'x');
      expect(err.code).toBe(code);
    }
  });
});

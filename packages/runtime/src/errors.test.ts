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
      'runtime/cost-cap-exceeded',
      'runtime/agent-failed',
      'runtime/invalid-max-prompt-tokens',
    ];
    for (const code of codes) {
      const err = new RuntimeError(code, 'x');
      expect(err.code).toBe(code);
    }
  });

  test('v0.0.2 codes (cost-cap, agent-failed, invalid-max-prompt-tokens) are distinct and matchable', () => {
    const costCap = new RuntimeError('runtime/cost-cap-exceeded', 'input_tokens=150000 > maxPromptTokens=100000');
    const agentFailed = new RuntimeError('runtime/agent-failed', 'agent-spawn-failed: ENOENT');
    const invalidCap = new RuntimeError('runtime/invalid-max-prompt-tokens', "must be a positive integer (got '0')");

    expect(costCap.code).toBe('runtime/cost-cap-exceeded');
    expect(agentFailed.code).toBe('runtime/agent-failed');
    expect(invalidCap.code).toBe('runtime/invalid-max-prompt-tokens');

    expect(costCap.message).toContain('cost-cap-exceeded');
    expect(agentFailed.message).toContain('spawn-failed');
    expect(invalidCap.message).toContain('positive integer');
  });
});

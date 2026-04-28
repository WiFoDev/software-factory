import { describe, expect, test } from 'bun:test';
import {
  type JudgeClient,
  type Judgment,
  RECORD_JUDGMENT_TOOL,
  anthropicJudgeClient,
  runJudgeSatisfaction,
} from './judge';

function fakeClient(judgment: Judgment | (() => Judgment | Promise<Judgment>)): JudgeClient {
  return {
    async judge() {
      return typeof judgment === 'function' ? await judgment() : judgment;
    },
  };
}

const SCENARIO_CTX = {
  id: 'S-1',
  given: 'a state',
  when: 'an action',
  then: 'an outcome',
  artifact: 'spec body text',
};

describe('runJudgeSatisfaction', () => {
  test('propagates fake-client judgment when pass=true', async () => {
    const client = fakeClient({ pass: true, score: 0.9, reasoning: 'criterion met' });
    const result = await runJudgeSatisfaction(
      { kind: 'judge', value: 'the output is friendly', line: 12 },
      SCENARIO_CTX,
      { client, model: 'claude-haiku-4-5', timeoutMs: 30_000 },
    );
    expect(result.kind).toBe('judge');
    expect(result.status).toBe('pass');
    expect(result.score).toBe(0.9);
    expect(result.detail).toContain('criterion met');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('returns fail when client says pass=false', async () => {
    const client = fakeClient({ pass: false, score: 0.2, reasoning: 'too literal' });
    const result = await runJudgeSatisfaction(
      { kind: 'judge', value: 'reads naturally', line: 3 },
      SCENARIO_CTX,
      { client, model: 'claude-haiku-4-5', timeoutMs: 30_000 },
    );
    expect(result.status).toBe('fail');
    expect(result.score).toBe(0.2);
    expect(result.detail).toBe('too literal');
  });

  test('returns status=error with judge/malformed-response when client throws that', async () => {
    const client: JudgeClient = {
      async judge() {
        throw new Error('judge/malformed-response: missing pass');
      },
    };
    const result = await runJudgeSatisfaction(
      { kind: 'judge', value: 'criterion', line: 1 },
      SCENARIO_CTX,
      { client, model: 'claude-haiku-4-5', timeoutMs: 30_000 },
    );
    expect(result.status).toBe('error');
    expect(result.detail).toContain('judge/malformed-response');
  });

  test('wraps unknown errors with a judge/error prefix', async () => {
    const client: JudgeClient = {
      async judge() {
        throw new Error('network glitch');
      },
    };
    const result = await runJudgeSatisfaction(
      { kind: 'judge', value: 'criterion', line: 1 },
      SCENARIO_CTX,
      { client, model: 'claude-haiku-4-5', timeoutMs: 30_000 },
    );
    expect(result.status).toBe('error');
    expect(result.detail).toContain('judge/error');
    expect(result.detail).toContain('network glitch');
  });
});

describe('anthropicJudgeClient', () => {
  test('parses a tool_use response and returns the judgment', async () => {
    const fakeAnthropic = {
      messages: {
        async create(_args: unknown) {
          return {
            content: [
              {
                type: 'tool_use' as const,
                name: RECORD_JUDGMENT_TOOL.name,
                input: { pass: true, score: 0.85, reasoning: 'ok' },
              },
            ],
          };
        },
      },
    };
    const client = anthropicJudgeClient(fakeAnthropic);
    const judgment = await client.judge({
      criterion: 'c',
      scenario: { id: 'S-1', given: 'g', when: 'w', then: 't' },
      artifact: 'a',
      model: 'claude-haiku-4-5',
      timeoutMs: 30_000,
    });
    expect(judgment).toEqual({ pass: true, score: 0.85, reasoning: 'ok' });
  });

  test('throws judge/malformed-response when no tool_use block is returned', async () => {
    const fakeAnthropic = {
      messages: {
        async create(_args: unknown) {
          return { content: [{ type: 'text' as const, text: 'plain prose, no tool call' }] };
        },
      },
    };
    const client = anthropicJudgeClient(fakeAnthropic);
    await expect(
      client.judge({
        criterion: 'c',
        scenario: { id: 'S-1', given: 'g', when: 'w', then: 't' },
        artifact: 'a',
        model: 'claude-haiku-4-5',
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow(/judge\/malformed-response/);
  });

  test('throws judge/malformed-response when tool input is missing required fields', async () => {
    const fakeAnthropic = {
      messages: {
        async create(_args: unknown) {
          return {
            content: [
              {
                type: 'tool_use' as const,
                name: RECORD_JUDGMENT_TOOL.name,
                input: { pass: true, score: 1.0 },
              },
            ],
          };
        },
      },
    };
    const client = anthropicJudgeClient(fakeAnthropic);
    await expect(
      client.judge({
        criterion: 'c',
        scenario: { id: 'S-1', given: 'g', when: 'w', then: 't' },
        artifact: 'a',
        model: 'claude-haiku-4-5',
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow(/judge\/malformed-response/);
  });

  test('throws judge/malformed-response on out-of-range score', async () => {
    const fakeAnthropic = {
      messages: {
        async create(_args: unknown) {
          return {
            content: [
              {
                type: 'tool_use' as const,
                name: RECORD_JUDGMENT_TOOL.name,
                input: { pass: true, score: 1.7, reasoning: 'x' },
              },
            ],
          };
        },
      },
    };
    const client = anthropicJudgeClient(fakeAnthropic);
    await expect(
      client.judge({
        criterion: 'c',
        scenario: { id: 'S-1', given: 'g', when: 'w', then: 't' },
        artifact: 'a',
        model: 'claude-haiku-4-5',
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow(/judge\/malformed-response/);
  });
});

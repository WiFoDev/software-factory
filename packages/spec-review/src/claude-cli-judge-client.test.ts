import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { claudeCliJudgeClient, extractJudgment } from './claude-cli-judge-client.js';

const FAKE_JUDGE = resolve(import.meta.dir, '..', 'test-fixtures', 'fake-claude-judge.ts');

const SCENARIO = {
  id: 'review/dod-precision',
  given: 'a spec is reviewed',
  when: 'the dod is judged',
  then: 'precise',
};

describe('extractJudgment — pure parser', () => {
  test('clean strict JSON in result field', () => {
    const j = extractJudgment({
      result: '{"pass":false,"score":0.3,"reasoning":"vague"}',
    });
    expect(j.pass).toBe(false);
    expect(j.score).toBe(0.3);
    expect(j.reasoning).toBe('vague');
  });

  test('JSON with prefix prose: regex-extract fallback succeeds', () => {
    const j = extractJudgment({
      result: 'Sure, here is the judgment: {"pass":true,"score":0.9,"reasoning":"ok"}',
    });
    expect(j.pass).toBe(true);
    expect(j.score).toBe(0.9);
    expect(j.reasoning).toBe('ok');
  });

  test('garbage with no JSON-pass object → throws judge/malformed-response', () => {
    expect(() => extractJudgment({ result: 'I cannot judge this.' })).toThrow(
      /judge\/malformed-response/,
    );
  });

  test('non-string result → throws judge/malformed-response', () => {
    expect(() => extractJudgment({ result: 42 })).toThrow(/judge\/malformed-response/);
    expect(() => extractJudgment({ result: undefined })).toThrow(/judge\/malformed-response/);
  });

  test('JSON object missing `pass` → throws', () => {
    expect(() => extractJudgment({ result: '{"score":0.5}' })).toThrow(/judge\/malformed-response/);
  });

  test('score auto-derives from pass when missing', () => {
    const j = extractJudgment({ result: '{"pass":true,"reasoning":"ok"}' });
    expect(j.score).toBe(1);
    expect(j.pass).toBe(true);
    const k = extractJudgment({ result: '{"pass":false,"reasoning":"nope"}' });
    expect(k.score).toBe(0);
  });

  test('reasoning falls back to "(no reasoning)" when missing', () => {
    const j = extractJudgment({ result: '{"pass":true}' });
    expect(j.reasoning).toBe('(no reasoning)');
  });
});

describe('claudeCliJudgeClient — subprocess via fake-claude-judge', () => {
  test('clean-json mode: judge returns parsed Judgment', async () => {
    const client = claudeCliJudgeClient({ claudeBin: FAKE_JUDGE });
    process.env.FAKE_JUDGE_MODE = 'clean-json';
    const j = await client.judge({
      criterion: 'is the DoD precise?',
      scenario: SCENARIO,
      artifact: '## Definition of Done\n- all tests pass',
      model: 'claude-haiku-4-5',
      timeoutMs: 5_000,
    });
    expect(j.pass).toBe(false);
    expect(j.score).toBe(0.3);
    expect(j.reasoning).toBe('vague DoD');
    process.env.FAKE_JUDGE_MODE = undefined;
  });

  test('prefixed-json mode: regex-extract fallback succeeds', async () => {
    const client = claudeCliJudgeClient({ claudeBin: FAKE_JUDGE });
    process.env.FAKE_JUDGE_MODE = 'prefixed-json';
    const j = await client.judge({
      criterion: 'x',
      scenario: SCENARIO,
      artifact: 'y',
      model: 'claude-haiku-4-5',
      timeoutMs: 5_000,
    });
    expect(j.pass).toBe(false);
    expect(j.reasoning).toBe('vague DoD');
    process.env.FAKE_JUDGE_MODE = undefined;
  });

  test('garbage mode: rejects with judge/malformed-response', async () => {
    const client = claudeCliJudgeClient({ claudeBin: FAKE_JUDGE });
    process.env.FAKE_JUDGE_MODE = 'garbage';
    await expect(
      client.judge({
        criterion: 'x',
        scenario: SCENARIO,
        artifact: 'y',
        model: 'claude-haiku-4-5',
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/judge\/malformed-response/);
    process.env.FAKE_JUDGE_MODE = undefined;
  });

  test('exit-nonzero mode: rejects with judge/exit-nonzero', async () => {
    const client = claudeCliJudgeClient({ claudeBin: FAKE_JUDGE });
    process.env.FAKE_JUDGE_MODE = 'exit-nonzero';
    await expect(
      client.judge({
        criterion: 'x',
        scenario: SCENARIO,
        artifact: 'y',
        model: 'claude-haiku-4-5',
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/judge\/exit-nonzero/);
    process.env.FAKE_JUDGE_MODE = undefined;
  });

  test('hang mode: rejects with judge/timeout after the deadline', async () => {
    const client = claudeCliJudgeClient({ claudeBin: FAKE_JUDGE });
    process.env.FAKE_JUDGE_MODE = 'hang';
    await expect(
      client.judge({
        criterion: 'x',
        scenario: SCENARIO,
        artifact: 'y',
        model: 'claude-haiku-4-5',
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/judge\/timeout/);
    process.env.FAKE_JUDGE_MODE = undefined;
  }, 10_000);
});

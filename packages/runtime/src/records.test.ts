import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextError, createContextStore } from '@wifo/factory-context';
import { z } from 'zod';
import {
  FactoryImplementReportSchema,
  FactoryPhaseSchema,
  FactoryRunSchema,
  FactoryValidateReportSchema,
  tryRegister,
} from './records.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runtime-records-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

describe('FactoryRunSchema', () => {
  test('accepts a well-formed payload', () => {
    const parsed = FactoryRunSchema.safeParse({
      specId: 'foo',
      specPath: 'docs/specs/foo.md',
      graphPhases: ['validate'],
      maxIterations: 1,
      startedAt: '2026-04-30T10:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects non-positive maxIterations', () => {
    const parsed = FactoryRunSchema.safeParse({
      specId: 'foo',
      graphPhases: ['validate'],
      maxIterations: 0,
      startedAt: '2026-04-30T10:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects missing required fields', () => {
    const parsed = FactoryRunSchema.safeParse({ specId: 'foo' });
    expect(parsed.success).toBe(false);
  });
});

describe('FactoryPhaseSchema', () => {
  test('accepts a phase record', () => {
    const parsed = FactoryPhaseSchema.safeParse({
      phaseName: 'validate',
      iteration: 1,
      status: 'pass',
      durationMs: 42,
      outputRecordIds: ['abc1234567890def'],
    });
    expect(parsed.success).toBe(true);
  });

  test('accepts optional failureDetail', () => {
    const parsed = FactoryPhaseSchema.safeParse({
      phaseName: 'validate',
      iteration: 1,
      status: 'error',
      durationMs: 42,
      outputRecordIds: [],
      failureDetail: 'boom',
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects invalid status', () => {
    const parsed = FactoryPhaseSchema.safeParse({
      phaseName: 'validate',
      iteration: 1,
      status: 'unknown',
      durationMs: 42,
      outputRecordIds: [],
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects negative durationMs', () => {
    const parsed = FactoryPhaseSchema.safeParse({
      phaseName: 'validate',
      iteration: 1,
      status: 'pass',
      durationMs: -1,
      outputRecordIds: [],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('FactoryValidateReportSchema', () => {
  test('accepts a HarnessReport-shaped payload with loose scenarios', () => {
    const parsed = FactoryValidateReportSchema.safeParse({
      specId: 'foo',
      startedAt: '2026-04-30T10:00:00.000Z',
      durationMs: 100,
      scenarios: [
        // Deep shape kept loose; envelope-only validation.
        { scenarioId: 'S-1', anything: 'goes' },
      ],
      summary: { pass: 1, fail: 0, error: 0, skipped: 0 },
      status: 'pass',
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects malformed summary', () => {
    const parsed = FactoryValidateReportSchema.safeParse({
      specId: 'foo',
      startedAt: '2026-04-30T10:00:00.000Z',
      durationMs: 100,
      scenarios: [],
      summary: { pass: -1, fail: 0, error: 0, skipped: 0 },
      status: 'pass',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('FactoryImplementReportSchema', () => {
  const baseValid = {
    specId: 'foo',
    specPath: 'docs/specs/foo.md',
    iteration: 1,
    startedAt: '2026-04-30T10:00:00.000Z',
    durationMs: 1234,
    cwd: '/tmp/proj',
    prompt: '# Spec\n...\n',
    allowedTools: 'Read,Edit,Write,Bash',
    claudePath: '/usr/local/bin/claude',
    status: 'pass' as const,
    exitCode: 0,
    result: 'I implemented impl() in src/needs-impl.ts',
    filesChanged: [{ path: 'src/needs-impl.ts', diff: '@@ +export function impl ...' }],
    toolsUsed: ['Read', 'Edit'],
    tokens: { input: 5000, output: 200, total: 5200 },
  };

  test('accepts the success-path payload (status pass, result populated, failureDetail undefined)', () => {
    const parsed = FactoryImplementReportSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
  });

  test('accepts the self-fail payload (status fail, result and failureDetail populated)', () => {
    const parsed = FactoryImplementReportSchema.safeParse({
      ...baseValid,
      status: 'fail',
      result: 'I could not complete the task',
      failureDetail: 'I could not complete the task',
    });
    expect(parsed.success).toBe(true);
  });

  test('accepts the cost-cap payload (status error, result populated, failureDetail starting with cost-cap-exceeded:)', () => {
    const parsed = FactoryImplementReportSchema.safeParse({
      ...baseValid,
      status: 'error',
      result: 'I edited src/needs-impl.ts despite the budget overrun',
      failureDetail: 'cost-cap-exceeded: input_tokens=150000 > maxPromptTokens=100000',
      tokens: { input: 150000, output: 200, total: 150200 },
    });
    expect(parsed.success).toBe(true);
  });

  test('accepts empty result string and signal field', () => {
    const parsed = FactoryImplementReportSchema.safeParse({
      ...baseValid,
      result: '',
      exitCode: null,
      signal: 'SIGTERM',
    });
    expect(parsed.success).toBe(true);
  });

  test('accepts optional cache token fields and computes total flexibly', () => {
    const parsed = FactoryImplementReportSchema.safeParse({
      ...baseValid,
      tokens: { input: 5000, output: 200, cacheCreate: 100, cacheRead: 800, total: 6100 },
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects missing required result', () => {
    const { result: _, ...withoutResult } = baseValid;
    const parsed = FactoryImplementReportSchema.safeParse(withoutResult);
    expect(parsed.success).toBe(false);
  });

  test('rejects negative iteration', () => {
    const parsed = FactoryImplementReportSchema.safeParse({ ...baseValid, iteration: 0 });
    expect(parsed.success).toBe(false);
  });

  test('rejects non-int tokens.input', () => {
    const parsed = FactoryImplementReportSchema.safeParse({
      ...baseValid,
      tokens: { input: 1.5, output: 200, total: 201.5 },
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects unknown status value', () => {
    const parsed = FactoryImplementReportSchema.safeParse({ ...baseValid, status: 'unknown' });
    expect(parsed.success).toBe(false);
  });

  test('accepts payload with priorValidateReportId (v0.0.3 cross-iter threading)', () => {
    const parsed = FactoryImplementReportSchema.safeParse({
      ...baseValid,
      iteration: 2,
      priorValidateReportId: 'a1b2c3d4e5f60718',
    });
    expect(parsed.success).toBe(true);
  });

  test('accepts payload without priorValidateReportId (iteration 1, default)', () => {
    const parsed = FactoryImplementReportSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
    // No priorValidateReportId key on the baseValid; success path covers iter 1.
  });

  test('rejects non-string priorValidateReportId', () => {
    const parsed = FactoryImplementReportSchema.safeParse({
      ...baseValid,
      iteration: 2,
      priorValidateReportId: 12345 as unknown as string,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('tryRegister', () => {
  test('registers a fresh type', () => {
    const store = createContextStore({ dir });
    expect(() => tryRegister(store, 'factory-run', FactoryRunSchema)).not.toThrow();
  });

  test('swallows duplicate-registration silently', () => {
    const store = createContextStore({ dir });
    tryRegister(store, 'factory-run', FactoryRunSchema);
    expect(() => tryRegister(store, 'factory-run', FactoryRunSchema)).not.toThrow();
  });

  test('propagates non-duplicate errors', () => {
    // Build a fake store whose register() throws a non-ContextError.
    const fakeStore = {
      register: () => {
        throw new Error('different error');
      },
    } as unknown as Parameters<typeof tryRegister>[0];
    expect(() => tryRegister(fakeStore, 'foo', z.object({}))).toThrow('different error');
  });

  test('propagates ContextErrors with codes other than duplicate-registration', () => {
    const fakeStore = {
      register: () => {
        throw new ContextError('context/io-error', 'disk full');
      },
    } as unknown as Parameters<typeof tryRegister>[0];
    expect(() => tryRegister(fakeStore, 'foo', z.object({}))).toThrow(ContextError);
  });
});

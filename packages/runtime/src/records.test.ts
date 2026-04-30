import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextError, createContextStore } from '@wifo/factory-context';
import { z } from 'zod';
import {
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

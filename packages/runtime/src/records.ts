import { ContextError, type ContextStore } from '@wifo/factory-context';
import { type ZodType, z } from 'zod';

export const FactoryRunSchema = z.object({
  specId: z.string(),
  specPath: z.string().optional(),
  graphPhases: z.array(z.string()),
  maxIterations: z.number().int().positive(),
  startedAt: z.string(),
});

export const FactoryPhaseSchema = z.object({
  phaseName: z.string(),
  iteration: z.number().int().positive(),
  status: z.enum(['pass', 'fail', 'error']),
  durationMs: z.number().int().nonnegative(),
  outputRecordIds: z.array(z.string()),
  failureDetail: z.string().optional(),
});

export const FactoryValidateReportSchema = z.object({
  specId: z.string(),
  specPath: z.string().optional(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  scenarios: z.array(z.unknown()),
  summary: z.object({
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  status: z.enum(['pass', 'fail', 'error']),
});

export type FactoryRunPayload = z.infer<typeof FactoryRunSchema>;
export type FactoryPhasePayload = z.infer<typeof FactoryPhaseSchema>;
export type FactoryValidateReportPayload = z.infer<typeof FactoryValidateReportSchema>;

/**
 * Register a record type, swallowing only `context/duplicate-registration`.
 * Makes registration safe to call repeatedly across iterations and across
 * multiple `run()` invocations against the same store.
 */
export function tryRegister<T>(store: ContextStore, type: string, schema: ZodType<T>): void {
  try {
    store.register(type, schema);
  } catch (err) {
    if (err instanceof ContextError && err.code === 'context/duplicate-registration') return;
    throw err;
  }
}

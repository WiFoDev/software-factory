import { ContextError, type ContextStore } from '@wifo/factory-context';
import { type ZodType, z } from 'zod';

export const FactoryRunSchema = z.object({
  specId: z.string(),
  specPath: z.string().optional(),
  graphPhases: z.array(z.string()),
  maxIterations: z.number().int().positive(),
  startedAt: z.string(),
});

// v0.0.7 — root record persisted by `runSequence` BEFORE any per-spec run.
// Each per-spec `factory-run.parents` includes the `factorySequenceId` so
// `factory-context tree --direction down <factorySequenceId>` walks the
// entire product DAG.
export const FactorySequenceSchema = z.object({
  specsDir: z.string(),
  topoOrder: z.array(z.string()),
  startedAt: z.string(),
  maxIterations: z.number().int().positive().optional(),
  maxTotalTokens: z.number().int().positive().optional(),
  maxSequenceTokens: z.number().int().positive().optional(),
  continueOnFail: z.boolean(),
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

export const FactoryImplementReportSchema = z.object({
  specId: z.string(),
  specPath: z.string().optional(),
  iteration: z.number().int().positive(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  cwd: z.string(),
  prompt: z.string(),
  allowedTools: z.string(),
  claudePath: z.string(),
  status: z.enum(['pass', 'fail', 'error']),
  exitCode: z.number().int().nullable(),
  signal: z.string().optional(),
  // Always populated when the report is persisted (success or failure path);
  // possibly empty string. Captures the agent's final message text from the
  // JSON envelope independent of `is_error`/`failureDetail` semantics.
  result: z.string(),
  filesChanged: z.array(
    z.object({
      path: z.string(),
      diff: z.string(),
    }),
  ),
  toolsUsed: z.array(z.string()),
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheCreate: z.number().int().nonnegative().optional(),
    cacheRead: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative(),
  }),
  // Populated only on status='fail' (mirrors `result` when the agent self-
  // reports failure) or status='error' (the cost-cap-exceeded line, which
  // overwrites any prior failureDetail). Independent of `result`.
  failureDetail: z.string().optional(),
  // v0.0.3: id of the prior iteration's factory-validate-report when this
  // implement runs as iteration ≥ 2 in an [implement → validate] graph.
  // Undefined on iteration 1 or when ctx.inputs has no validate-report.
  priorValidateReportId: z.string().optional(),
});

// v0.0.10 — DoD-verifier output. Persisted by `dodPhase` once per iteration.
// Per-bullet `kind: 'shell' | 'judge'` mirrors `parseDodBullets`'s
// classification; shell bullets carry `command`/`exitCode`/`stderrTail`,
// judge bullets carry `judgeReasoning`.
export const FactoryDodReportSchema = z.object({
  specId: z.string(),
  specPath: z.string().optional(),
  iteration: z.number().int().positive(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  bullets: z.array(
    z.object({
      kind: z.enum(['shell', 'judge']),
      bullet: z.string(),
      status: z.enum(['pass', 'fail', 'error']),
      command: z.string().optional(),
      exitCode: z.number().int().nullable().optional(),
      stderrTail: z.string().optional(),
      judgeReasoning: z.string().optional(),
      durationMs: z.number().int().nonnegative(),
    }),
  ),
  summary: z.object({
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  status: z.enum(['pass', 'fail', 'error']),
});

export type FactoryRunPayload = z.infer<typeof FactoryRunSchema>;
export type FactorySequencePayload = z.infer<typeof FactorySequenceSchema>;
export type FactoryPhasePayload = z.infer<typeof FactoryPhaseSchema>;
export type FactoryValidateReportPayload = z.infer<typeof FactoryValidateReportSchema>;
export type FactoryImplementReportPayload = z.infer<typeof FactoryImplementReportSchema>;
export type FactoryDodReportPayload = z.infer<typeof FactoryDodReportSchema>;

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

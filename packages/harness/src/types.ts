export type SatisfactionStatus = 'pass' | 'fail' | 'error' | 'skipped';

export type ReportStatus = 'pass' | 'fail' | 'error';

export interface SatisfactionResult {
  kind: 'test' | 'judge';
  value: string;
  line: number;
  status: SatisfactionStatus;
  durationMs: number;
  detail: string;
  exitCode?: number;
  score?: number;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioKind: 'scenario' | 'holdout';
  status: SatisfactionStatus;
  satisfactions: SatisfactionResult[];
  durationMs: number;
}

export interface HarnessReport {
  specId: string;
  specPath?: string;
  startedAt: string;
  durationMs: number;
  scenarios: ScenarioResult[];
  summary: {
    pass: number;
    fail: number;
    error: number;
    skipped: number;
  };
  status: ReportStatus;
}

export interface RunHarnessOptions {
  cwd?: string;
  scenarioIds?: ReadonlySet<string>;
  visibleOnly?: boolean;
  holdoutsOnly?: boolean;
  noJudge?: boolean;
  timeoutMs?: number;
  judge?: {
    model?: string;
    client?: 'default' | JudgeClientLike;
  };
  /** Optional log channel for cost notices. Defaults to process.stderr. */
  log?: (line: string) => void;
}

/**
 * Forward-declared subset of `JudgeClient` used in options to avoid an import
 * cycle with `runners/judge.ts`. The full interface lives there.
 */
export interface JudgeClientLike {
  judge(args: {
    criterion: string;
    scenario: { id: string; given: string; when: string; then: string };
    artifact: string;
    model: string;
    timeoutMs: number;
  }): Promise<{ pass: boolean; score: number; reasoning: string }>;
}

/**
 * Aggregate a list of child satisfaction statuses into a single status using
 * the harness precedence: error > fail > pass > skipped (empty list).
 */
export function aggregateStatus(children: SatisfactionStatus[]): SatisfactionStatus {
  if (children.length === 0) return 'skipped';
  if (children.some((s) => s === 'error')) return 'error';
  if (children.some((s) => s === 'fail')) return 'fail';
  if (children.every((s) => s === 'skipped')) return 'skipped';
  return 'pass';
}

/**
 * Fold satisfaction-level statuses up to a report-level status. `'skipped'` at
 * the report level becomes `'pass'` because skipped work isn't a failure.
 */
export function reportStatusFrom(scenarios: SatisfactionStatus[]): ReportStatus {
  if (scenarios.some((s) => s === 'error')) return 'error';
  if (scenarios.some((s) => s === 'fail')) return 'fail';
  return 'pass';
}

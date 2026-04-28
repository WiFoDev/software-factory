export { runHarness } from './runner.js';

export { runTestSatisfaction } from './runners/test.js';
export type { TestRunnerOptions } from './runners/test.js';

export {
  RECORD_JUDGMENT_TOOL,
  anthropicJudgeClient,
  createDefaultJudgeClient,
  runJudgeSatisfaction,
} from './runners/judge.js';
export type {
  JudgeClient,
  JudgeRunnerOptions,
  Judgment,
  ScenarioContext,
} from './runners/judge.js';

export { parseTestLine } from './parse-test-line.js';
export type { ParsedTestLine } from './parse-test-line.js';

export { formatReport } from './format.js';
export type { ReporterKind } from './format.js';

export type {
  HarnessReport,
  ReportStatus,
  RunHarnessOptions,
  SatisfactionResult,
  SatisfactionStatus,
  ScenarioResult,
} from './types.js';

# Technical Plan — `@wifo/factory-harness` v0.0.1

## 1. Context

- `@wifo/factory-core` is shipped: `parseSpec(source) → Spec` returns each `Scenario` with `satisfaction: ScenarioSatisfaction[]` (`kind: 'test' | 'judge'`, `value: string`, `line: number`). Holdouts are scenarios with `kind: 'holdout'` in a parallel `holdouts` array.
- `packages/harness/` is scaffolded: `package.json` declares `bin.factory-harness → dist/cli.js`, `dependencies: { '@wifo/factory-core': 'workspace:*' }`, ESM module, `bun test`. `tsconfig.json` and `tsconfig.build.json` mirror core's split. No source yet.
- Repo runs `pnpm typecheck` and `pnpm test` recursively. Harness's empty test suite currently fails `pnpm test` because `bun test` exits non-zero when no test files match — v0.0.1 fixes that as a side effect.
- Subprocess pattern is already proven: `packages/core/src/cli.test.ts` spawns the core CLI with `Bun.spawn`.
- CLI pattern to mirror: `packages/core/src/cli.ts` — `node:util` `parseArgs` with manual subcommand dispatch and an injectable `CliIo` for testability.

## 2. Architecture Decisions

### Module layout

```
packages/harness/src/
├── types.ts                 # HarnessReport, ScenarioResult, SatisfactionResult
├── parse-test-line.ts       # parseTestLine(value) → { file?, pattern? }
├── runners/
│   ├── test.ts              # runTestSatisfaction(s, opts) — spawns bun test
│   └── judge.ts             # runJudgeSatisfaction(s, ctx, opts) — Anthropic API
├── runner.ts                # runHarness(spec, opts) — orchestrator
├── format.ts                # formatReport(report, kind: 'text' | 'json')
├── cli.ts                   # `factory-harness run <spec-path>` + flags
└── index.ts                 # public API
```

Tests: `<module>.test.ts` next to source, mirroring `packages/core`.

### Public API

```ts
export { runHarness } from './runner.js';
export { runTestSatisfaction } from './runners/test.js';
export { runJudgeSatisfaction, type JudgeClient } from './runners/judge.js';
export { parseTestLine } from './parse-test-line.js';
export { formatReport } from './format.js';
export type {
  HarnessReport,
  ScenarioResult,
  SatisfactionResult,
  SatisfactionStatus,    // 'pass' | 'fail' | 'error' | 'skipped'
  RunHarnessOptions,
} from './types.js';
```

### Data model

```ts
type SatisfactionStatus = 'pass' | 'fail' | 'error' | 'skipped';

type SatisfactionResult = {
  kind: 'test' | 'judge';
  value: string;            // original satisfaction text
  line: number;
  status: SatisfactionStatus;
  durationMs: number;
  detail: string;           // stderr excerpt, judge reasoning, or skip reason
  exitCode?: number;        // test runner only
  score?: number;           // judge only, 0-1
};

type ScenarioResult = {
  scenarioId: string;       // 'S-1', 'H-2'
  scenarioKind: 'scenario' | 'holdout';
  status: SatisfactionStatus;
  satisfactions: SatisfactionResult[];
  durationMs: number;
};

type HarnessReport = {
  specId: string;
  specPath?: string;
  startedAt: string;        // ISO-8601
  durationMs: number;
  scenarios: ScenarioResult[];
  summary: { pass: number; fail: number; error: number; skipped: number };
  status: 'pass' | 'fail' | 'error';
};
```

Per-scenario status derivation:
- `'error'` if any child satisfaction errored.
- else `'fail'` if any failed.
- else `'pass'` if all passed.
- if `satisfactions.length === 0`, status `'skipped'` (e.g. holdout with no test, judges all skipped).

`report.status` is the same fold across all scenarios.

### `parseTestLine` — accepted formats

| Form | Example | Mapping |
|---|---|---|
| File only | `src/foo.test.ts` | `bun test src/foo.test.ts` |
| File + quoted pattern | `src/foo.test.ts "happy path"` | `bun test src/foo.test.ts -t "happy path"` |
| File + bare pattern | `src/foo.test.ts happy path` | `bun test src/foo.test.ts -t "happy path"` |
| Pattern only | `"happy path"` | `bun test -t "happy path"` |

Heuristic: first whitespace-delimited token. If it has a recognised test extension (`.ts`, `.tsx`, `.js`, `.jsx`) or a path separator, it's the file; otherwise the entire value is treated as a pattern. Surrounding double quotes are stripped from the pattern.

### Test runner

`runTestSatisfaction(satisfaction, { cwd, timeoutMs })`:

- `Bun.spawn(['bun', 'test', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })`.
- `await proc.exited` racing a `setTimeout(timeoutMs)`. On timeout: `proc.kill()`, status `'error'`, detail mentions timeout.
- Status mapping: exit `0 → 'pass'`, non-zero `→ 'fail'`, subprocess spawn failure `→ 'error'`.
- `detail`: tail of stderr, last ~20 lines, ANSI-stripped, capped at **4 KB**; longer output is truncated with a `… [truncated]` marker so a runaway stderr can't balloon a `HarnessReport`.
- Captured `exitCode`; measured `durationMs`.
- **Pattern semantics**: the parsed pattern is passed verbatim to `bun test -t <pattern>`. Bun treats `-t` as a regex, so `( )`, `*`, `+`, `?`, `.` etc. behave as regex metacharacters. Users are responsible for escaping in their `test:` values; this is documented in the harness README.

### Judge runner (Anthropic SDK)

`runJudgeSatisfaction(satisfaction, scenarioCtx, { client, model, timeoutMs })`:

```ts
interface JudgeClient {
  judge(args: {
    criterion: string;
    scenario: { id: string; given: string; when: string; then: string };
    artifact: string;
    model: string;
    timeoutMs: number;
  }): Promise<{ pass: boolean; score: number; reasoning: string }>;
}
```

The interface lets tests inject a fake. Default implementation lazily imports `@anthropic-ai/sdk`, reads `ANTHROPIC_API_KEY`, and uses **tool-use** for structured output with a single tool:

```ts
{
  name: 'record_judgment',
  description: 'Record a structured judgment of whether the criterion is met.',
  input_schema: {
    type: 'object',
    properties: {
      pass: { type: 'boolean' },
      score: { type: 'number', minimum: 0, maximum: 1 },
      reasoning: { type: 'string' },
    },
    required: ['pass', 'score', 'reasoning'],
  },
}
```

Tool-use forces structured output reliably; we do not parse free-form JSON.

Prompt-caching enabled on the system prompt (it is identical across calls). Default model: `claude-haiku-4-5`. Configurable per call AND globally via `RunHarnessOptions.judge.model`.

**Judge artifact for v0.0.1**: scenario text (`Given/When/Then` joined) + the spec body (everything after the frontmatter). Decided in §1 of the open questions; richer artifacts (running code, generated text) come later with the twin layer.

### Orchestrator

`runHarness(spec: Spec, opts: RunHarnessOptions): Promise<HarnessReport>`:

1. **Filter** scenarios via `opts.scenarioIds` (set), `opts.visibleOnly`, `opts.holdoutsOnly`.
2. **Prerequisite check**: if any selected scenario has `kind: 'judge'` satisfactions and `opts.judge.client === 'default'` and `ANTHROPIC_API_KEY` is unset, *return* a report with `status: 'error'`, zero scenarios executed, and a `runner/missing-api-key` detail. **Never throws.** The CLI maps `report.status === 'error'` to exit 3.
3. **Cost guardrail**: count selected judge satisfactions. If >5, log `"<N> judge calls planned"` to stderr and proceed.
4. **Serial execution**: scenarios in array order; satisfactions within a scenario in array order.
5. Per scenario, accumulate `SatisfactionResult[]`, derive `ScenarioResult.status` per the rules above.
6. Build `HarnessReport`. `status = 'pass' | 'fail' | 'error'` aggregating across all scenarios with the same precedence.

`runHarness` never throws on operational state — every recoverable failure (missing API key, spawn failure, timeout, malformed judge output) becomes a `'error'`-status `SatisfactionResult` or, in fail-fast cases, a top-level `'error'` report. This keeps the programmatic API safe to embed and gives the CLI a single mapping point (`report.status → exit code`).

Concurrency: serial in v0.0.1. Parallelisation is an optimisation, not a correctness concern; defer.

### CLI

```
factory-harness run <spec-path> [flags]

Flags:
  --scenario <ids>       Comma-separated scenario ids to run (e.g. S-1,S-2,H-1)
  --visible              Run only visible scenarios (default: visible + holdouts)
  --holdouts             Run only holdout scenarios
  --no-judge             Skip judge satisfaction lines (status=skipped)
  --model <name>         Override judge model (default: claude-haiku-4-5)
  --timeout-ms <n>       Per-satisfaction timeout (default: 30000)
  --reporter <text|json> Output format (default: text)
```

`--visible` and `--holdouts` are mutually exclusive — passing both exits 2 with usage. `--scenario` takes a comma-separated list (`S-1,S-2`); whitespace trimmed. Manual subcommand dispatch on `argv[0] === 'run'`; `parseArgs` consumes the remainder.

`--reporter` selects the output writer: `text` (default) prints a human-readable summary to stdout; `json` prints a single valid JSON document matching the `HarnessReport` shape (and only that — notices, planning logs, and progress lines stay on stderr so JSON output is pipe-safe).

Exit codes:
- `0` — `report.status === 'pass'`
- `1` — `report.status === 'fail'`
- `2` — usage error (mutually exclusive flags, missing path, unknown subcommand)
- `3` — `report.status === 'error'` (operational failure: missing API key, subprocess died, file not found)

### Dependency choices

| Dependency | Range | Why |
|---|---|---|
| `@wifo/factory-core` | `workspace:*` | Already declared. |
| `@anthropic-ai/sdk` | `^0.40.0` | Official SDK; backs default `JudgeClient`. |

No CLI library, no test-runner abstraction, no concurrency library. Bun is the test runner — `bun` must be on PATH (documented in README).

## 3. Risk Assessment

- **Blast radius**: contained to `packages/harness/`. Doesn't touch `factory-core`. `pnpm test` becomes green again as a side effect.
- **Anthropic API flakiness / rate limits**: real network. Harness tests use an injected fake `JudgeClient` and never hit the real API. An optional integration test gated on `ANTHROPIC_API_KEY` being present can exercise the default client; CI without the key skips it.
- **Bun-version drift**: harness depends on `bun` being on PATH. Documented as a prerequisite in `packages/harness/README.md`. Spawn failure is reported with status `'error'` and `runner/spawn-failed` code in `detail`.
- **Cost surprise**: judge calls cost money. Mitigations: `--no-judge` flag, default cheapest reasonable model (`claude-haiku-4-5`), prompt caching, and the `>5 judge calls planned` notice.
- **Test runner timeouts**: a runaway test must not hang the harness forever. Default 30s per satisfaction; configurable via `--timeout-ms`.
- **Tool-use response parsing**: malformed tool input from the model surfaces as status `'error'` with a clear `judge/malformed-response` detail, not a thrown exception. Holdout H-2 pins this.

## 4. Subtask outline

Eight subtasks, ~1010 LOC of source plus tests. Full breakdown with test pointers in `docs/specs/factory-harness-v0-0-1.md`.

- T1 [config] Deps + scaffold
- T2 [feature] types
- T3 [feature] parseTestLine
- T4 [feature] test runner
- T5 [feature] judge runner + JudgeClient interface
- T6 [feature] orchestrator (depends on T2, T4, T5)
- T7 [feature] reporters (depends on T2)
- T8 [feature] CLI + public exports (depends on T6, T7)

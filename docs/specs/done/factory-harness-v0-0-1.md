---
id: factory-harness-v0-0-1
classification: deep
type: feat
status: ready
exemplars:
  - path: packages/core/src/cli.ts
    why: CLI pattern — manual subcommand dispatch, injectable CliIo, parseArgs per subcommand, exit-code mapping.
  - path: packages/core/src/lint.ts
    why: Result-aggregation pattern — typed structured records collected from sub-routines into a single report.
  - path: packages/core/src/cli.test.ts
    why: Subprocess-driven tests with `Bun.spawn` for end-to-end CLI verification.
---

# factory-harness-v0-0-1 — Implement scenario runner with Bun test execution and Anthropic judge

## Intent

Layer-1 of the factory: make specs *executable*. `@wifo/factory-harness` consumes a `Spec` parsed by `@wifo/factory-core` and produces a typed `HarnessReport` by running each scenario's `Satisfaction:` lines — dispatching `test:` lines to `bun test <file> -t <pattern>` subprocesses and `judge:` lines to the Anthropic API (`claude-haiku-4-5` default, structured tool-use output). Ships a `factory-harness run <spec-path>` CLI with scenario filtering, visible/holdouts selection, and a `--no-judge` opt-out for offline/CI runs.

## Scenarios

**S-1** — `parseTestLine` handles every accepted format
  Given the four documented `test:` value formats (file only; file + quoted pattern; file + bare pattern; pattern only)
  When `parseTestLine(value)` is called on each
  Then it returns the correct `{ file?, pattern? }` mapping with surrounding double quotes stripped from the pattern
  Satisfaction:
    - test: `src/parse-test-line.test.ts` "handles every accepted format"

**S-2** — Test satisfaction reports `pass` with exit code, duration, and detail
  Given a fixture test file that exits 0
  When `runTestSatisfaction({ kind: 'test', value: '<fixture>', line: 1 }, { cwd, timeoutMs: 30000 })` is called
  Then the returned `SatisfactionResult` has `status: 'pass'`, `exitCode: 0`, `durationMs > 0`, and `detail` contains the test runner's tail output
  Satisfaction:
    - test: `src/runners/test.test.ts` "passes when fixture exits 0"

**S-3** — Test satisfaction reports `fail` and surfaces failing assertion text
  Given a fixture test file that exits non-zero with a clear assertion message
  When `runTestSatisfaction(...)` is called
  Then `status: 'fail'`, `exitCode` matches the subprocess, and `detail` contains the assertion message verbatim
  Satisfaction:
    - test: `src/runners/test.test.ts` "fails when fixture exits non-zero"
    - judge: "the failure detail makes the assertion immediately diagnosable without re-running the test"

**S-4** — Judge satisfaction propagates pass / score / reasoning from the client
  Given an injected fake `JudgeClient` that returns `{ pass: true, score: 0.9, reasoning: 'criterion met' }`
  When `runJudgeSatisfaction(satisfaction, scenarioCtx, { client, model: 'claude-haiku-4-5', timeoutMs: 30000 })` is called
  Then the returned `SatisfactionResult` has `status: 'pass'`, `score: 0.9`, `detail` containing `'criterion met'`, and `kind: 'judge'`
  Satisfaction:
    - test: `src/runners/judge.test.ts` "propagates fake-client judgment"

**S-5** — Missing `ANTHROPIC_API_KEY` with judge lines present fails fast
  Given a spec with at least one `judge:` satisfaction line and no `ANTHROPIC_API_KEY` in the environment, using the default `JudgeClient`
  When `runHarness(spec, opts)` is called
  Then it returns (does not throw) a report with `status: 'error'`, a `runner/missing-api-key` detail, and zero scenarios executed (no test subprocesses spawned, no judge calls made)
  Satisfaction:
    - test: `src/runner.test.ts` "fail-fast on missing api key — returns error report, never throws"

**S-6** — `runHarness` aggregates a mixed-success spec into a correct `HarnessReport`
  Given a spec with three scenarios — one all-pass, one with a failing test, one with judge-only satisfaction (fake client returning fail)
  When `runHarness(spec, opts)` is called
  Then the report's `summary` shows `pass: 1, fail: 2, error: 0, skipped: 0`, `report.status === 'fail'`, and per-scenario statuses match expectations
  Satisfaction:
    - test: `src/runner.test.ts` "aggregates mixed results"

**S-7** — CLI exit codes, filters, and reporters behave correctly
  Given fixture specs (all-pass, contains-fail) and a built CLI binary
  When `factory-harness run <spec> [--scenario S-1,S-2] [--no-judge] [--reporter json|text]` is invoked via `Bun.spawn`
  Then exit codes are `0` for all-pass, `1` for any-fail, `3` for operational error; `--scenario S-1,S-2` runs only those ids; `--no-judge` marks judge satisfactions as `skipped`; `--visible` and `--holdouts` together exit `2`; default reporter writes a human-readable summary to stdout, `--reporter json` writes a single valid JSON document matching the `HarnessReport` shape
  Satisfaction:
    - test: `src/cli.test.ts` "exit codes, scenario filter, no-judge, mutually exclusive flags, reporters"
    - judge: "stderr output is grep-friendly: file:line, status, code, message"

## Holdout Scenarios

**H-1** — Test runner times out cleanly without crashing the harness
  Given a fixture test that runs longer than `timeoutMs`
  When `runTestSatisfaction(..., { timeoutMs: 200 })` is called
  Then the satisfaction result has `status: 'error'`, `detail` mentions "timeout", the subprocess is killed, and a subsequent `runTestSatisfaction` call in the same process completes normally

**H-2** — Judge returns malformed tool-use output
  Given a fake `JudgeClient` that throws or returns a payload missing required fields
  When `runJudgeSatisfaction` is called
  Then the satisfaction result has `status: 'error'`, `detail` contains `judge/malformed-response`, and the orchestrator continues to the next scenario without crashing

**H-3** — Spec with no test or judge satisfaction lines
  Given a spec where every selected scenario's satisfaction list is empty (or all judges and `--no-judge` is set)
  When `runHarness` runs
  Then every scenario is `'skipped'`, `report.status === 'pass'` (no failures), and the CLI exits 0 with a summary line indicating zero tests / zero judges executed

## Constraints / Decisions

- Dependencies pinned: `@anthropic-ai/sdk@^0.40.0`. No other new runtime deps.
- Bun is the only supported test runner in v0.0.1; harness shells out to `bun test`. `bun` must be on PATH.
- Default judge model: `claude-haiku-4-5`. Configurable per-call and via `--model` CLI flag and `RunHarnessOptions.judge.model`.
- Judge artifact for v0.0.1: scenario `Given/When/Then` text + the spec body (everything after frontmatter). Richer artifacts (source files, generated output) are out of scope.
- Judge structured output uses Anthropic tool-use with a `record_judgment` tool — never free-form JSON parsing.
- Prompt caching enabled on the judge system prompt.
- Cost guardrail: when >5 judge calls are queued for a run, the CLI logs `"<N> judge calls planned"` to stderr and proceeds (no opt-in flag).
- Missing `ANTHROPIC_API_KEY` while judge lines are present and the default client is used → fail-fast operational error (exit 3). `--no-judge` is the supported way to run without the key.
- Concurrency: serial across scenarios and within scenarios. Parallelisation is deferred.
- `--scenario` takes a comma-separated list (`--scenario S-1,S-2`); whitespace around ids is trimmed; ids are matched exactly.
- `--visible` and `--holdouts` are mutually exclusive; passing both is a usage error (exit 2).
- Default per-satisfaction timeout: 30000 ms. Configurable via `--timeout-ms`.
- Default reporter: `text` (human-readable summary to stdout). `--reporter json` writes a single JSON document matching the `HarnessReport` shape; nothing else goes to stdout in JSON mode (logs/notices stay on stderr).
- Test patterns are passed verbatim to `bun test -t <pattern>`. Bun treats `-t` as a regex; users are responsible for escaping regex metacharacters in their `test:` values. Documented in `packages/harness/README.md`.
- `runTestSatisfaction` caps the captured stderr tail at 4 KB after ANSI stripping; longer output is truncated with a marker.
- `runHarness` never throws on operational state. Missing API key, spawn failure, malformed judge output, etc. are surfaced as `SatisfactionResult.status === 'error'` (or scenario/report status `'error'` when fail-fast applies). The CLI maps `report.status === 'error'` to exit 3.
- Exit codes: `0` pass, `1` fail, `2` usage error, `3` operational error.
- CLI binary stays separate (`factory-harness`); not folded into `factory`.
- `JudgeClient` is an interface so tests can inject a fake; the default Anthropic-backed client lives behind it.
- All type imports use `import type` (`verbatimModuleSyntax`); every array index access is guarded (`noUncheckedIndexedAccess`).

## Subtasks

- **T1** [config] — Add `@anthropic-ai/sdk@^0.40.0` to `packages/harness/package.json`; create empty source files (`types.ts`, `parse-test-line.ts`, `runners/test.ts`, `runners/judge.ts`, `runner.ts`, `format.ts`, `cli.ts`); ensure `tsconfig.build.json` excludes test files. ~30 LOC.
- **T2** [feature] — `src/types.ts`: `HarnessReport`, `ScenarioResult`, `SatisfactionResult`, `SatisfactionStatus` union, `RunHarnessOptions`. ~80 LOC.
- **T3** [feature] — `src/parse-test-line.ts` + tests: parse the four formats, strip surrounding double quotes, return `{ file?, pattern? }`. ~80 LOC.
- **T4** [feature] — `src/runners/test.ts` + tests: `Bun.spawn(['bun','test', ...])` with timeout, ANSI-stripped stderr tail, status mapping (`0 → pass`, non-zero `→ fail`, spawn failure `→ error`). Tests use real fixture test files. **depends on T2, T3**. ~150 LOC.
- **T5** [feature] — `src/runners/judge.ts` + tests: `JudgeClient` interface, default Anthropic-backed implementation with tool-use `record_judgment`, prompt caching, lazy SDK import; tests inject a fake client. **depends on T2**. ~200 LOC.
- **T6** [feature] — `src/runner.ts` + tests: `runHarness(spec, opts)` — filtering, prerequisite check (missing API key + judge lines), cost-guardrail notice, serial execution, status aggregation. **depends on T2, T4, T5**. ~150 LOC.
- **T7** [feature] — `src/format.ts` + tests: `formatReport(report, kind: 'text' | 'json')` — text output with file:line, status, code, message; json output stable for piping. **depends on T2**. ~120 LOC.
- **T8** [feature] — `src/cli.ts` + `src/index.ts` + tests + smoke fixtures: `factory-harness run <spec-path>`, flag parsing (`--scenario`, `--visible`, `--holdouts`, `--no-judge`, `--model`, `--timeout-ms`, `--reporter`), exit-code mapping; manual subcommand dispatch on `argv[0] === 'run'`; public re-exports. Also creates `packages/harness/test-fixtures/all-pass.md` (a runnable spec) and any referenced `*.test.ts` fixtures so the DoD smoke test can pass. **depends on T6, T7**. ~250 LOC.

## Definition of Done

- All visible scenarios pass (tests green; judge criteria met).
- All holdout scenarios pass at end-of-task review.
- `pnpm -C packages/harness typecheck` clean.
- `pnpm -C packages/harness test` green (`bun test`); `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/harness build` produces a working `dist/cli.js`.
- `node packages/harness/dist/cli.js run packages/harness/test-fixtures/all-pass.md --no-judge` exits 0 against the runnable harness fixture (created by T8). `docs/example-spec.md` remains a `factory spec lint` fixture and is intentionally not the smoke target — its `test:` paths reference files that don't exist in this repo.
- Public API surface from `src/index.ts` matches the technical plan §2.
- README in `packages/harness/` documents the `bun` PATH prerequisite and the `ANTHROPIC_API_KEY` requirement for judge runs.

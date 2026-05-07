---
id: factory-harness-v0-0-13-coverage-trip-detect
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/harness/src/runners/test.ts
    why: "test runner — invokes `bun test --test-name-pattern <name>` per scenario. v0.0.13 parses bun's stdout to detect '0 fail + nonzero exit' as a coverage-threshold trip rather than a real test failure. v0.0.12's option (a) (--coverage=false) was descoped because bun rejects the flag; v0.0.13 ships option (b)."
  - path: BACKLOG.md
    why: "v0.0.13 entry 'Per-scenario test runs short-circuit coverage gates — re-shaped via option (b)'. Closes the CORE-836 friction the v0.0.12 cluster shipped a half-fix for."
depends-on:
  - factory-core-v0-0-13-init-ergonomics
---

# factory-harness-v0-0-13-coverage-trip-detect — parse `0 fail + nonzero exit` as coverage trip

## Intent

The CORE-836 dogfood (v0.0.11 era) flagged: per-scenario `bun test --test-name-pattern <name>` runs trip a host repo's coverage threshold (host's bun exits 1 → harness reports validate-fail → agent iterates trying to fix non-broken code). v0.0.12 attempted to fix via `--coverage=false`; the agent caught that bun 1.3.x rejects the flag (`The argument '--coverage' does not take a value.`) and the carve-out was descoped to v0.0.13.

v0.0.13 ships option (b) from the original BACKLOG: parse bun's stdout. When bun exits non-zero AND the parsed output contains `0 fail`, classify the result as `pass` with a `coverage-threshold-tripped` detail prefix rather than `fail`. The actual test scenarios passed (0 failures); the nonzero exit is a host-config concern handled at DoD-time, not validate-time.

## Scenarios

**S-1** — Coverage trip detection: `0 fail` + nonzero exit → status `pass` with detail prefix
  Given a host repo with `bunfig.toml: [test] coverageThreshold = 0.8` AND a per-scenario invocation where the actual scenario's assertions all pass but coverage drops below threshold (the scenario only exercises a slice of the file)
  When `runTestSatisfaction({ kind: 'test', value: 'src/foo.test.ts "matches one"', ... })` runs
  Then the runner parses bun's stdout, finds `0 fail` (or equivalent — see Constraints for exact regex), recognizes the nonzero exit as a coverage trip, and returns `{ status: 'pass', detail: 'harness/coverage-threshold-tripped: <bun's coverage line>; <test count summary>' }`. The harness's overall validate phase records the satisfaction as passing.
  And given a real test failure (bun output has `1 fail` or higher), the existing fail-detection path is unchanged: status `fail` with the existing detail.
  Satisfaction:
    - test: packages/harness/src/runners/test.test.ts "0 fail + nonzero exit classified as pass with coverage-threshold-tripped detail"
    - test: packages/harness/src/runners/test.test.ts "real test failures still classified as fail (regression-pin)"

**S-2** — Coverage trip recognized via fake-bun stdout shape
  Given a fake-bun script that emits `1 pass\n0 fail\ncoverage threshold of 0.8 not met (lines: 0.20)` and exits 1
  When the harness invokes the fake-bun via `bunPath` override
  Then the satisfaction reports `status: 'pass'` and the detail string CONTAINS `harness/coverage-threshold-tripped`. The `1 pass` part of bun's output is preserved in the detail tail (so a later debugger can see the real test results).
  And given fake-bun emits `0 fail` AND exit 0 (no coverage trip — clean pass), the existing pass path is unchanged.
  Satisfaction:
    - test: packages/harness/src/runners/test.test.ts "fake-bun coverage-threshold output shape recognized via stdout parse"
    - test: packages/harness/src/runners/test.test.ts "fake-bun 0 fail + exit 0 still pass with no coverage-trip prefix"

**S-3** — Edge case: `0 fail` AND nonzero exit AND no coverage-threshold marker → still `fail`
  Given fake-bun emits `0 fail` and exits 1 BUT no coverage-threshold marker is present in stdout (e.g., bun encountered an internal error or some other nonzero-exit cause that's not coverage)
  When the harness parses
  Then the satisfaction reports `status: 'fail'` (NOT pass) — the coverage-trip classification requires BOTH `0 fail` AND a recognizable coverage-threshold marker in the stdout. Conservative: don't auto-pass on nonzero exit unless we're sure it's a coverage trip.
  Satisfaction:
    - test: packages/harness/src/runners/test.test.ts "0 fail + nonzero exit without coverage marker still classified as fail"

## Constraints / Decisions

- **Coverage-threshold marker detection (locked):** the harness scans stdout for `/coverage threshold of \d+(\.\d+)? not met/` (bun's canonical message format). If matched AND `0 fail` is also present in stdout AND exit code is nonzero, classify as `pass` with detail prefix `harness/coverage-threshold-tripped:`.
- **Detail prefix shape (locked):** `harness/coverage-threshold-tripped: <one-line summary from bun stdout>; <existing tail-detail>`. Mirrors the existing `runner/timeout:` and `runner/spawn-failed:` prefix conventions in the harness.
- **`0 fail` regex (locked):** `/\b0 fail\b/` — word-boundary-anchored to avoid false matches on "10 fail" or "fail0". Bun's standard output prints `<N> pass` and `<N> fail` lines; the count is what we key on.
- **No new exit-code semantics.** The runner still returns `SatisfactionResult` with `status: 'pass' | 'fail' | 'error' | 'skipped'`. Coverage trip is `pass` (not a new status) — keeps the existing API stable.
- **No public API surface change in `@wifo/factory-harness`.** Changes are internal to the runner's stdout-parse logic. Public export count unchanged at ~16.
- **DoD-time coverage is unchanged.** This spec only carves out PER-SCENARIO behavior. Holistic test runs (DoD's `bun test src` without `--test-name-pattern`) still respect the host's coverage configuration — coverage IS enforced at DoD-time, where it makes sense.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.13 explicitly does NOT ship in this spec:** vitest/jest equivalents (deferred — bun-only for v0.0.13); auto-config of `bunfig.toml` to disable coverage on per-scenario runs (deferred — no clean way to do per-invocation override in bun); LLM-judged "is this really a coverage trip" judge (overkill).

## Subtasks

- **T1** [feature] — Add `parseCoverageTrip(stdout: string): { tripped: boolean, marker?: string }` helper in `packages/harness/src/runners/test.ts` (or a new `coverage-trip.ts` for testability). Returns `{ tripped: true, marker: <matched line> }` if both regex matches fire. ~30 LOC. **depends on nothing.**
- **T2** [feature] — Wire `parseCoverageTrip` into `runTestSatisfaction`'s exit-code-handling block: when exit code is nonzero AND `parseCoverageTrip(stdout).tripped`, return `{ status: 'pass', detail: 'harness/coverage-threshold-tripped: <marker>; <existing tail>' }`. ~25 LOC. **depends on T1.**
- **T3** [test] — `packages/harness/src/runners/test.test.ts` covers S-1 + S-2 + S-3 via fake-bun scripts (5 tests). ~120 LOC fake-bun + assertions. **depends on T1, T2.**
- **T4** [chore] — Update `packages/harness/README.md`: brief subsection "Coverage trip detection (v0.0.13+)" documenting the carve-out. ~25 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/harness typecheck`).
- tests green (`pnpm -C packages/harness test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.13 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/harness build`).
- A test verifies that real test failures (e.g., `1 fail` in stdout) still classify as `fail` (regression-pin).
- A test verifies that nonzero exit WITHOUT a coverage-threshold marker still classifies as `fail` (conservative — don't auto-pass arbitrary nonzero exits).
- Public API surface from `@wifo/factory-harness/src/index.ts` strictly equal to v0.0.12's count (~16).
- README in `packages/harness/` documents v0.0.13 coverage trip detection.
- v0.0.13 explicitly does NOT ship in this spec: vitest/jest equivalents; bunfig.toml auto-override; LLM-judged trip detection. Deferred per Constraints.

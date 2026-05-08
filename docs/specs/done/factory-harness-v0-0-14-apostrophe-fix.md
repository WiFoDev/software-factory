---
id: factory-harness-v0-0-14-apostrophe-fix
classification: light
type: fix
status: ready
exemplars:
  - path: packages/harness/src/parse-test-line.ts
    why: "v0.0.12's normalizeTestNamePattern strips apostrophes from BOTH spec-side patterns AND the harvested test name. The original motivation (agent stylizes apostrophes out of `it()` names) doesn't manifest in modern Claude — the BASELINE click-tracking spec used `\"slug's log\"` correctly in source, but the harness stripped the apostrophe before passing to bun's regex matcher → 5 phantom no-converge iterations. v0.0.14 drops apostrophe stripping; keeps curly-quote → ASCII normalization."
  - path: packages/harness/src/runners/test.ts
    why: "test runner. v0.0.14 also adds a safety net: detect `regex matched 0 tests` + nonzero exit → classify as `error` with detail prefix `harness/test-name-regex-no-match: <pattern> matched 0 tests in <file>`. Mirrors v0.0.13's coverage-trip detection shape."
  - path: BACKLOG.md
    why: "v0.0.14 entry 'Validator strips apostrophes from `bun test -t <pattern>` — phantom no-converge'. MUST-FIX, lead candidate of the recovery cluster."
depends-on: []
---

# factory-harness-v0-0-14-apostrophe-fix — restore validator soundness for apostrophe-bearing test names

## Intent

v0.0.13's URL-shortener BASELINE caught a regression of v0.0.12's `normalizeTestNamePattern`. The function strips apostrophes from both the spec's `test:` line pattern AND the harvested test name from `bun test --json`, on the theory that the agent might "stylize" out apostrophes when writing `it()` calls. In practice modern Claude preserves apostrophes; the strip-on-both-sides causes the OPPOSITE bug: a spec that genuinely uses `"slug's log"` strips to `"slugs log"` before passing to `bun -t`, but the actual test in the file STILL has the apostrophe → bun's regex matches 0 tests → validate-fail every iteration.

Fix shape: drop apostrophes (and curly-apostrophe `‘'`) from the strip set. Keep curly double-quote → ASCII-double-quote normalization (still useful for spec authors who paste from rich-text editors). Add a safety net: when bun reports `regex matched 0 tests` + exits nonzero, classify the satisfaction as `error` with a clear diagnostic — distinct from `fail` so the runtime's iteration loop doesn't treat tooling mismatches as implementation errors.

This is the v0.0.14 cluster's lead candidate; closes the soundness bug that wasted 5 iterations + ~11k tokens in the v0.0.13 BASELINE.

## Scenarios

**S-1** — Apostrophe-bearing test names match end-to-end
  Given a spec line `test: src/foo.test.ts "v0.0.10's hash"` AND an actual test in src/foo.test.ts whose `it()` name is `"v0.0.10's hash"` (apostrophe preserved on both sides)
  When the harness invokes `bun test src/foo.test.ts -t <escaped-pattern>` with the pattern derived from the spec line
  Then the regex passed to bun contains the apostrophe (via `\\'` or literal — bun's regex treats apostrophe as literal). The test matches, runs, and the satisfaction reports `pass`. The pattern derived by `normalizeTestNamePattern("v0.0.10's hash")` equals `"v0.0.10's hash"` (apostrophe preserved); the curly-double-quote path is unchanged.
  And given a spec line with curly double-quotes (`"smart quotes"`), the normalization still converts them to ASCII for substring comparison.
  Satisfaction:
    - test: packages/harness/src/parse-test-line.test.ts "normalizeTestNamePattern preserves apostrophes (v0.0.14 fix)"
    - test: packages/harness/src/parse-test-line.test.ts "normalizeTestNamePattern still converts curly double-quotes to ASCII"

**S-2** — Safety net: `regex matched 0 tests` + nonzero exit → `error`, not `fail`
  Given a fake-bun script that prints `regex "<pattern>" matched 0 tests` to stdout (or stderr — bun's actual format) and exits 1
  When `runTestSatisfaction` runs against the fake-bun
  Then the satisfaction returns `{ status: 'error', detail: 'harness/test-name-regex-no-match: <pattern> matched 0 tests in <file>; ...' }`. NOT `status: 'fail'`. The runtime's iteration loop treats `error` as "tooling mismatch needs human attention," not "implementation broken — re-implement."
  And given fake-bun emits `0 fail` + nonzero exit but DOES find tests (e.g., 1 pass + 0 fail + nonzero exit due to coverage trip from v0.0.13), the v0.0.13 coverage-trip path is unchanged — that's a pass-with-coverage-trip-prefix, not the new error code.
  Satisfaction:
    - test: packages/harness/src/runners/test.test.ts "regex matched 0 tests + nonzero exit classified as error with harness/test-name-regex-no-match prefix"
    - test: packages/harness/src/runners/test.test.ts "regex matched 0 tests path does not collide with v0.0.13 coverage-trip path"

**S-3** — Real test failures still classify as `fail` (regression-pin)
  Given fake-bun reports `1 pass`, `1 fail`, and exits 1 (a genuine test failure — assertion missed)
  When the harness parses the output
  Then the satisfaction returns `status: 'fail'` (the existing fail-detection path is unchanged). The new safety net (S-2) only fires when the parsed output indicates a regex/test-discovery problem, not a substantive test failure.
  Satisfaction:
    - test: packages/harness/src/runners/test.test.ts "real test failures still classify as fail (v0.0.14 regression-pin)"

## Constraints / Decisions

- **`normalizeTestNamePattern`'s strip set (locked):** removes ASCII apostrophe `'` and curly apostrophes `‘'` from the strip set entirely. Retains: curly double-quotes `"`/`"` → `"` (helpful for paste-from-rich-text); backticks → none (existing behavior). Apostrophes are now treated as literal characters on both sides of the comparison.
- **Safety-net detection regex (locked):** `/regex .+ matched 0 tests/` matched against bun's stdout (case-insensitive). When matched AND exit code is nonzero, the result becomes `status: 'error'`. The `harness/test-name-regex-no-match` detail prefix mirrors v0.0.13's `harness/coverage-threshold-tripped` shape.
- **`status: 'error'` vs `'fail'` semantics:** `fail` = "the test ran and an assertion was wrong"; `error` = "the test never ran due to a tooling problem." The runtime treats `error` as a halting condition (or surfaces it as a clear diagnostic) — it does NOT re-run the implement phase trying to fix non-existent assertion failures. This is the soundness fix.
- **No public API surface change in `@wifo/factory-harness`.** Both fixes are internal to the runner's logic. Public exports stay at ~16.
- **Cross-cutting v0.0.14 cluster constraints (referenced by specs B-H):**
  - All packages bumped 0.0.13 → 0.0.14 in lockstep at release time.
  - Cluster ships via `--include-drafting --skip-dod-phase --max-agent-timeout-ms 1800000` (DoD-judge dispatch needs ANTHROPIC_API_KEY which we don't have; pre-flight `factory spec lint` + `factory spec review` gates quality).
  - DoD precision: literal backtick commands paired with prose ("tests green", "lint clean") satisfy the v0.0.11 calibration; v0.0.13's `dod.template` auto-emit handles this for new scope-project calls.
  - The 3 MUST-FIX entries (this spec, the publish-pipeline fix, the spec-review subprocess fix) are independent of each other; all polish entries (D-H) depend on this spec for cluster ordering only.
- **v0.0.14 explicitly does NOT ship in this spec:** vitest/jest equivalents for the safety-net detector (deferred — bun-only); fuzzy test-name matching beyond the existing curly-quote normalization; auto-suggesting a corrected `test:` line when the regex fails.
- **Tests use bare paths in `test:` lines (no backticks).**

## Subtasks

- **T1** [fix] — Update `packages/harness/src/parse-test-line.ts`'s `normalizeTestNamePattern` strip set: remove apostrophe + curly apostrophe characters. Keep curly-double-quote-to-ASCII conversion. ~10 LOC. **depends on nothing.**
- **T2** [feature] — Update `packages/harness/src/runners/test.ts` to detect `regex .+ matched 0 tests` in bun stdout/stderr at exit-nonzero time → return `status: 'error'` with detail prefix `harness/test-name-regex-no-match`. Mirrors the v0.0.13 coverage-trip detection helper's shape. ~30 LOC. **depends on nothing.**
- **T3** [test] — `packages/harness/src/parse-test-line.test.ts`: 2 tests for S-1 (apostrophe preserved; curly double-quote still converted). `packages/harness/src/runners/test.test.ts`: 3 tests for S-2 + S-3 via fake-bun (regex-no-match → error; coverage-trip path unchanged; real fail still fail). ~80 LOC. **depends on T1, T2.**
- **T4** [chore] — Update `packages/harness/README.md`: brief subsection "Test-name regex matching (v0.0.14)" documenting the strip-set carve-out + the new error code. ~25 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/harness typecheck`).
- tests green (`pnpm -C packages/harness test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.14 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/harness build`).
- A regression-pin test verifies that `normalizeTestNamePattern("v0.0.10's hash") === "v0.0.10's hash"` (apostrophe preserved, NOT stripped to `"v0.0.10s hash"`).
- A test verifies the safety-net detector classifies `regex matched 0 tests + nonzero exit` as `error` with the canonical detail prefix.
- Public API surface from `@wifo/factory-harness/src/index.ts` strictly equal to v0.0.13's count.
- README in `packages/harness/` documents v0.0.14 strip-set change + safety-net error code.
- v0.0.14 explicitly does NOT ship in this spec: vitest/jest safety-net equivalents; fuzzy test-name matching; auto-suggested test-line corrections. Deferred per Constraints.

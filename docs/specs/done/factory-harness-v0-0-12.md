---
id: factory-harness-v0-0-12
classification: light
type: feat
status: ready
exemplars:
  - path: packages/harness/src/parse-test-line.ts
    why: "test-line parser. v0.0.6 stripped surrounding backticks. v0.0.12 normalizes quote characters in the substring-match pattern (apostrophes, smart quotes, backticks) so a stylistic apostrophe drop doesn't cause `bun test -t <pattern>` to no-match correct work."
  - path: packages/harness/src/runner.ts
    why: "harness invokes `bun test --test-name-pattern <name>` per scenario. v0.0.12 passes `--coverage=false` so per-scenario filtered runs don't trip a host repo's coverage threshold (false validate-fail discovered in the v0.0.11 OLH dogfood)."
  - path: packages/core/src/lint.ts
    why: "lint codes registry. v0.0.12 adds `spec/test-name-quote-chars` (warning) — catches scope-time pitfalls where a `test:` line's pattern uses smart quotes / apostrophes that the agent will likely rewrite to ASCII."
  - path: BACKLOG.md
    why: "v0.0.12 entries 'Per-scenario test runs short-circuit coverage gates' (CORE-836 friction #1) and 'Harness bun test -t <pattern> should normalize quote chars when matching test names' (v0.0.11 ship friction). This spec closes both."
depends-on: []
---

# factory-harness-v0-0-12 — per-scenario test runs trustworthy in any host repo

## Intent

One friction fix in `packages/harness/`: a stylistic apostrophe-vs-smart-quote drop between the spec's `test:` line and the test's actual `it()` name causes substring match to no-match correct work — agent iterates trying to fix non-broken code. v0.0.12 normalizes quote characters on both sides of the substring comparison, plus a scoping-time lint warning that catches the friction before it leaks to run time. Small, internal, and turns the validate phase from "depends on the host repo's idiosyncrasies" into "robust against common toolchain pitfalls." This spec ships first in the v0.0.12 cluster — every downstream spec's test phase benefits.

**Coverage carve-out descoped to v0.0.13:** the original BACKLOG option (a) called for `--coverage=false` on per-scenario `bun test` invocations. The v0.0.12 implement run found that bun 1.3.x rejects this flag (`error: The argument '--coverage' does not take a value.`) — bun has no CLI override for coverage; bunfig is the only configuration surface. A correct fix needs option (b) from BACKLOG — parse exit-code semantics + treat `0 fail + nonzero exit` as a coverage trip — which is a different shape and reopens for v0.0.13 calibration.

## Scenarios

**S-2** — Quote-char normalization in test-name pattern matching
  Given a `test:` line `test: src/foo.test.ts "v0.0.10's hash"` (with apostrophe) AND an actual test in src/foo.test.ts whose `it()` name reads `'v0.0.10s hash'` (without apostrophe — auto-stylized during implementation)
  When `parseTestLine` parses the `test:` line and the harness invokes `bun test -t <pattern>` against the actual test
  Then the substring match operates on a normalized form (apostrophes, smart quotes `' '`, double smart quotes `" "`, and backticks `` ` `` are all stripped or collapsed to ASCII equivalents on BOTH sides) — the test matches and runs; status `pass`. Substring still strict on alphanumerics + spacing.
  Satisfaction:
    - test: packages/harness/src/parse-test-line.test.ts "normalizes apostrophes vs smart quotes in pattern"
    - test: packages/harness/src/runner.test.ts "test name with apostrophe matches it() name without apostrophe under normalization"

**S-3** — `factory spec lint` warns on smart quotes in `test:` patterns at scoping time
  Given a spec containing `test: src/foo.test.ts "user's flow"` (with curly apostrophe `'` instead of `'`) somewhere in its `## Scenarios`
  When `factory spec lint <path>` runs
  Then it emits a `spec/test-name-quote-chars` warning at the offending line: `<file>:<line>  warning  spec/test-name-quote-chars  test name pattern uses non-ASCII quote characters; normalize to ' or " before run-time`. Lint exit code remains 0 (warnings don't fail). The lint catches the bomb at scoping time so the agent rewrites without it; if it leaks to runtime, S-2's normalization is the safety net.
  Satisfaction:
    - test: packages/core/src/lint.test.ts "spec/test-name-quote-chars fires on curly apostrophes in test: pattern"
    - test: packages/core/src/lint.test.ts "spec/test-name-quote-chars does not fire on plain ASCII apostrophe"

## Constraints / Decisions

- **Quote normalization shape (locked):** strip `‘` `’` (curly single) → `'`; strip `“` `”` (curly double) → `"`; backticks `` ` `` map to `'` for the substring comparison only. Both sides of the comparison are normalized identically in `parseTestLine`'s output AND in the runner before calling `bun test -t`.
- **Lint warning, not error.** `spec/test-name-quote-chars` is severity `warning` (does not fail `factory spec lint`'s exit code 0). Catches the friction at scoping time but doesn't block ship.
- **No public API surface change in `@wifo/factory-harness`.** Both fixes are internal to the runner's invocation logic.
- **Public API surface delta in `@wifo/factory-core`:** `LintCode` union gains `'spec/test-name-quote-chars'` (existing pattern; no new exports needed).
- **Tests use bare paths in `test:` lines (no backticks).**
- **Per-scenario coverage carve-out descoped to v0.0.13.** Reason: bun 1.3.x rejects `--coverage=false` (`The argument '--coverage' does not take a value.`). The fix shape that actually works needs option (b) from the v0.0.12 BACKLOG entry — parse `0 fail + nonzero exit` as a coverage trip — which is deeper than option (a). Re-opens for v0.0.13 calibration once we have a non-fake-bun reproduction.
- **v0.0.12 explicitly does NOT ship in this spec:** the per-scenario coverage carve-out (descoped above); vitest/jest coverage-flag detection (deferred); harness-side test-name-similarity beyond quote-normalization (deferred — would need fuzzy matching).

## Subtasks

- **T1** [feature] — Update `packages/harness/src/parse-test-line.ts` to normalize curly quotes/apostrophes/backticks in the parsed pattern field. Add `normalizeTestNamePattern(s: string): string` helper (exported from same file for runner reuse). ~15 LOC. **depends on nothing.**
- **T2** [feature] — Update the runner site under `packages/harness/src/runners/test.ts` that invokes `bun test -t <pattern>` to apply `normalizeTestNamePattern` to the pattern before passing to bun. ~5 LOC. **depends on T1.**
- **T3** [feature] — Add `spec/test-name-quote-chars` lint code in `packages/core/src/lint.ts`: scan each parsed `test:` line's pattern for `‘` `’` `“` `”` and emit a warning at the offending line. ~25 LOC. **depends on nothing.**
- **T4** [test] — `packages/harness/src/runner.test.ts` + `parse-test-line.test.ts` cover S-2 (2 tests). `packages/core/src/lint.test.ts` covers S-3 (2 tests). ~50 LOC. **depends on T1-T3.**
- **T5** [chore] — Update `packages/harness/README.md` (quote normalization) and `packages/core/README.md` (lint code list gains `spec/test-name-quote-chars`). ~20 LOC. **depends on T4.**

## Definition of Done

- All scenarios (S-2, S-3) pass.
- typecheck clean (`pnpm -C packages/harness typecheck` and `pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/harness test` and `pnpm -C packages/core test`).
- biome clean (`pnpm check`).
- lint clean against the v0.0.12 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/harness build` and `pnpm -C packages/core build` produce working dist).
- Public API surface unchanged in `@wifo/factory-harness`; `@wifo/factory-core` adds `'spec/test-name-quote-chars'` to the existing `LintCode` union.
- v0.0.12 explicitly does NOT ship in this spec: per-scenario coverage carve-out (descoped to v0.0.13); vitest/jest coverage flag handling; fuzzy test-name matching beyond quote normalization. Deferred per Constraints.

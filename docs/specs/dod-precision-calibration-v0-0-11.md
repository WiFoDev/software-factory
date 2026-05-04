---
id: dod-precision-calibration-v0-0-11
classification: light
type: fix
status: drafting
exemplars:
  - path: packages/spec-review/src/judges/dod-precision.ts
    why: "The judge that fires false positives on color-word DoD bullets ('green', 'clean'). v0.0.11 tightens its CRITERION text to recognize <command> green / <command> clean as canonical idioms when paired with a recognizable command name (pnpm/bun/etc)."
  - path: BASELINE.md
    why: "v0.0.10 entry, friction #3 'review/dod-precision judge fires on color words.' Source of truth for the calibration. The canonical baseline prompt itself uses these exact phrasings — the judge is producing false positives on the toolchain's own canonical wording."
  - path: docs/specs/done/factory-spec-review-v0-0-9.md
    why: "Reference shape: a single-judge calibration spec (dep-aware internal-consistency in v0.0.9). Minimal pattern: one judge file edit + one test file + ruleSetHash invalidation."
depends-on: []
---

# dod-precision-calibration-v0-0-11 — `review/dod-precision` recognizes "green" / "clean" as canonical idioms

## Intent

Close the v0.0.10 BASELINE friction #3: the `review/dod-precision` reviewer judge fires false positives on canonical idiomatic DoD phrasings ("tests pass green", "lint clean", "typecheck clean"). The canonical baseline prompt itself uses these exact phrases — the judge is producing findings on the toolchain's own promoted wording. Tighten the CRITERION text to instruct the LLM judge that `<command> green` / `<command> clean` paired with a recognizable command name (`pnpm`, `bun`, `npm`, `tsc`, `biome`, `lint`, `typecheck`, `test`, `check`, `build`) is precise enough to NOT flag.

CRITERION update only; `ruleSetHash` automatically flips → cache invalidates correctly on next `factory spec review` run. Field-level prompt edit + a regression test pinning the new behavior.

## Scenarios

**S-1** — `dod-precision` judge does NOT fire on `<command> green` / `<command> clean` idioms paired with allowlisted command names
  Given a spec with `## Definition of Done` containing the bullets `- tests pass green`, `- pnpm typecheck clean`, `- biome clean`, `- pnpm test green`
  When `runReview` invokes the `dod-precision` judge against this spec
  Then the judge returns `pass: true` (no findings emitted). The CRITERION text now contains explicit positive examples telling the LLM that these phrasings ARE precise enough.
  And given a spec whose DoD says `- tests pass green; coverage above 80%` (combining a canonical idiom WITH another bullet that's vague), the judge MAY still fire on the second clause (coverage threshold ambiguity) — the calibration is for `<command> <green|clean>` specifically, not a blanket pass.
  Satisfaction:
    - test: packages/spec-review/src/judges/dod-precision.test.ts "dod-precision passes on tests pass green / lint clean idioms"
    - test: packages/spec-review/src/judges/dod-precision.test.ts "dod-precision passes on every command in the allowlist (pnpm/bun/tsc/biome/lint/typecheck/test/check/build) paired with green or clean"

**S-2** — `dod-precision` judge STILL fires on genuinely vague DoD bullets (regression guard)
  Given a spec with `## Definition of Done` containing genuinely vague bullets like `- The implementation is good`, `- All edge cases handled`, `- Performance is acceptable`
  When `runReview` invokes the judge
  Then the judge returns `pass: false` with reasoning naming the imprecision (e.g., "Bullet 'The implementation is good' has no measurable criterion. What constitutes 'good'?"). The calibration tightens for canonical idioms ONLY — it does NOT relax the judge for genuinely vague phrasings.
  And given a spec with mixed bullets (some canonical idioms, some vague), the judge fires findings on the vague ones; passes on the canonical ones.
  Satisfaction:
    - test: packages/spec-review/src/judges/dod-precision.test.ts "dod-precision still fires on genuinely vague bullets"
    - test: packages/spec-review/src/judges/dod-precision.test.ts "dod-precision fires only on the imprecise subset of mixed-bullet specs"

**S-3** — `ruleSetHash` invalidates the v0.0.10 cache for this judge
  Given the v0.0.11 build with the updated CRITERION
  When `ruleSetHash()` is computed
  Then the returned hex string differs from the v0.0.10 hash. Existing v0.0.10 cache entries for `dod-precision` will miss correctly on first run after upgrade — the judge re-runs against the new prompt rather than returning cached findings from the old one.
  Satisfaction:
    - test: packages/spec-review/src/judges/dod-precision.test.ts "v0.0.11 ruleSetHash differs from v0.0.10's hash"

## Constraints / Decisions

- **CRITERION text update (locked structure):** the existing CRITERION instructs the LLM to flag bullets that lack a measurable criterion. v0.0.11 prepends a "POSITIVE EXAMPLES — these phrasings ARE precise enough; do NOT flag them" block listing:
  - `tests pass green`, `tests green`, `<command> tests green` (where `<command>` is `pnpm` / `bun` / `npm`)
  - `lint clean`, `<command> lint clean`, `biome clean`, `<command> check clean`, `<command> typecheck clean`
  - `<command> typecheck` / `<command> test` / `<command> check` / `<command> build` followed by `green` or `clean` or `passes` or `succeeds`
  - The phrase "no errors" or "exit code 0" paired with any allowlisted command
  Locked allowlist of commands: `pnpm`, `bun`, `npm`, `node`, `tsc`, `git`, `npx`, `bash`, `sh`, `make`, `biome`, `eslint`, `prettier`, `vitest`, `jest`, `lint`, `typecheck`, `test`, `check`, `build`. Mirrors the runtime's `parseDodBullets` shell allowlist + a few common test-runner names (the judge has a slightly broader allowlist than the runtime since the judge is just describing intent — it doesn't execute the bullets).
- **CRITERION delta is the prompt edit only.** No code changes to `applies()` or `buildPrompt()`'s artifact composition. The judge still applies on every spec with a `## Definition of Done` section; still composes the artifact from the spec body's DoD slice.
- **`ruleSetHash` invalidation behavior is automatic.** `ruleSetHash()` probes each judge's `buildPrompt` against a stub spec and hashes the criterion text. Editing CRITERION → hash changes → existing v0.0.10 cache entries for `dod-precision` miss on first re-run. **Expected and correct.**
- **Severity unchanged: `'warning'`.** No promotion to `'error'`; calibration is about reducing false-positive frequency, not making the judge more aggressive.
- **Default-enabled list unchanged.** `dod-precision` was in the default-enabled list since v0.0.4; stays.
- **Test fixtures** for the new tests use the same VALID_SPEC pattern from `dod-precision.test.ts`. Mock judge client simulates the LLM's classification by inspecting the artifact for the canonical idioms. v0.0.11's regression test asserts the BUILDPROMPT artifact contains the positive-examples block (proxy for "the LLM has the context"); the integration with a real `claude -p` is exercised by the existing CLI tests + the v0.0.11 BASELINE re-run.
- **Public API surface from `@wifo/factory-spec-review/src/index.ts` strictly equal to v0.0.10's surface (10 names; 11 ReviewCode union members from v0.0.10).** The new criterion text is internal to the judge file.
- **Coordinated package version bump deferred to spec 6** (`worktree-sandbox-v0-0-11`'s chore subtask).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.11 explicitly does NOT ship in this spec:** broadening the allowlist to support custom user-defined commands (locked at the canonical set; new commands require a point release); turning the calibration into a runtime opt-out flag (always-on); editing OTHER judges' CRITERIONs (this spec touches only `dod-precision`).

## Subtasks

- **T1** [feature] — Update `packages/spec-review/src/judges/dod-precision.ts`'s CRITERION constant. Prepend the "POSITIVE EXAMPLES" block per Constraints. ~25 LOC. **depends on nothing.**
- **T2** [test] — `packages/spec-review/src/judges/dod-precision.test.ts`: 4 tests covering S-1 + S-2 (canonical idioms pass; vague phrasings fail; mixed specs scored partially) + S-3 (ruleSetHash invalidates). Mock judge client; inspect the buildPrompt artifact for the new positive-examples block. ~80 LOC. **depends on T1.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/spec-review typecheck` clean.
- `pnpm -C packages/spec-review test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.11 cluster.
- `pnpm -C packages/spec-review build` produces a working build.
- `ruleSetHash()` differs from v0.0.10 (cache invalidation works correctly).
- Public API surface from `@wifo/factory-spec-review/src/index.ts` strictly equal to v0.0.10's 10 names.
- v0.0.11 explicitly does NOT ship in this spec: user-defined command allowlist; runtime opt-out; calibration of other judges. Deferred per Constraints.

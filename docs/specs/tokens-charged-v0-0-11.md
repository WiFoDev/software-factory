---
id: tokens-charged-v0-0-11
classification: light
type: fix
status: drafting
exemplars:
  - path: packages/runtime/src/records.ts
    why: "FactoryImplementReportSchema's tokens object: { input, output, cacheCreate, cacheRead, total }. The Anthropic SDK's `total_tokens` value lands in `total` and INCLUDES cache reads + creates — making reports look like they blew the budget when they didn't. v0.0.11 adds tokens.charged: number = input + output (the budget-relevant value)."
  - path: packages/runtime/src/runtime.ts
    why: "sumImplementTokens (line ~30) — already sums input + output (NOT total). The runtime's budget enforcement is correct; the schema's `total` is what's misleading. v0.0.11 surfaces `charged` directly so reports + telemetry match what the runtime enforces."
  - path: BASELINE.md
    why: "v0.0.10 entry, friction #2: 'tokens.total includes cache reads but the budget excludes them — same field, two meanings.' The fix is field-level + telemetry-cleanup."
depends-on: []
---

# tokens-charged-v0-0-11 — `FactoryImplementReportSchema.tokens.charged` field for budget-relevant token count

## Intent

Close v0.0.10 BASELINE friction #2: the SDK's `usage.total_tokens` (which lands in our schema's `tokens.total`) INCLUDES cache reads + cache creates + input + output. The runtime's `--max-total-tokens` budget enforcement uses `input + output` only (cache is free per Anthropic's pricing). Reports surface `tokens.total` which makes runs LOOK like they blew the budget when they didn't.

Fix: add an optional `tokens.charged?: number = input + output` field to `FactoryImplementReportSchema`. CLI output displays `tokens charged: <charged> / <budget>` instead of `tokens.total`. `RunReport.totalTokens` already excludes cache (sums input + output) — rename it `chargedTokens` for symmetry; keep a deprecated alias on the type for back-compat.

Pure telemetry/UX cleanup. Schema field-level addition + back-compat. The runtime's enforcement logic is unchanged (still uses input + output).

## Scenarios

**S-1** — `FactoryImplementReportSchema` accepts `tokens.charged`; `implementPhase` populates it
  Given an `implementPhase` invocation that produces a `factory-implement-report`
  When the persisted record's `payload.tokens` is read
  Then it contains `charged: number` field; `charged === input + output`. Existing fields preserved: `input`, `output`, `cacheCreate?`, `cacheRead?`, `total`. The schema's `tokens` shape becomes `{ input, output, charged, cacheCreate?, cacheRead?, total }` — `charged` is required when persisting; legacy reports without it parse as `charged: undefined` (Zod `.optional()` for back-compat with v0.0.10 records).
  And given an example with `input: 1000`, `output: 500`, `cacheRead: 5000`, `cacheCreate: 200`: `charged === 1500` (input + output only); `total === 6700` (SDK's number including cache).
  Satisfaction:
    - test: packages/runtime/src/records.test.ts "FactoryImplementReportSchema.tokens accepts charged field"
    - test: packages/runtime/src/phases/implement.test.ts "implementPhase populates tokens.charged = input + output"

**S-2** — `RunReport.chargedTokens` replaces / aliases `totalTokens`; CLI output uses charged values
  Given a converged `run()` against a spec that consumed 8000 input + 2000 output + 30000 cache-read tokens
  When the returned `RunReport` is read
  Then `report.chargedTokens === 10000` (input + output across iterations). The deprecated `report.totalTokens` field still exists with the same value (back-compat for existing programmatic callers; deprecated via JSDoc `@deprecated`). Stdout output of `factory-runtime run <spec>` shows: `factory-runtime: converged in N iteration(s) (run=<id>, charged=10000 / 1000000, <ms>ms)` instead of `... <ms>ms` alone.
  And given a `factory-runtime run-sequence` invocation, the per-spec stdout summary mentions `charged: <n>` per spec; the final summary shows `charged: <total>` for the sequence.
  Satisfaction:
    - test: packages/runtime/src/runtime.test.ts "RunReport.chargedTokens is the budget-relevant total"
    - test: packages/runtime/src/runtime.test.ts "RunReport.totalTokens still exists as deprecated alias for back-compat"
    - test: packages/runtime/src/cli.test.ts "factory-runtime run output shows tokens charged + budget"

**S-3** — Whole-run cost cap enforcement uses `charged`; reports CONFIRM the budget
  Given a `RunOptions.maxTotalTokens: 10000` cap + a spec that consumes 8000 input + 2000 output + 30000 cache-read in iter 1
  When `run()` is invoked
  Then it converges (charged = 10_000 ≤ 10_000 cap; cap inclusive). The persisted `factory-implement-report.tokens.charged === 10_000` and `tokens.total === 40_000` (SDK aware of cache). The runtime does NOT throw `runtime/total-cost-cap-exceeded` because the budget-relevant value (`charged`) is at-or-below the cap.
  And given the same setup but charged exceeds the cap (e.g., 11_000 charged), the runtime throws `runtime/total-cost-cap-exceeded` with message naming the charged value (not the total) — `running_charged=11000 > maxTotalTokens=10000`. v0.0.11 documents this in the error message format.
  Satisfaction:
    - test: packages/runtime/src/runtime.test.ts "cost cap enforcement uses tokens.charged not tokens.total"
    - test: packages/runtime/src/runtime.test.ts "cost-cap-exceeded message names charged value"

## Constraints / Decisions

- **Schema field name (locked):** `tokens.charged: number`. Required when persisting (set by implementPhase); optional in the Zod schema for back-compat with v0.0.10 records.
- **`charged` value definition (locked):** `charged === input + output`. Cache reads + cache creates are FREE per Anthropic's pricing; budget enforcement excludes them. The schema's `total` field continues to hold the SDK's `usage.total_tokens` (cache-aware) for telemetry / debugging.
- **`RunReport.chargedTokens: number`** — new field on the existing `RunReport` interface. Sums `factory-implement-report.tokens.charged` across all iterations.
- **`RunReport.totalTokens: number`** — kept as a deprecated alias (returns the same value as `chargedTokens` since the runtime's existing `sumImplementTokens` already used input + output). The deprecation is on the field's intent (the name "total" is misleading); the value is unchanged. JSDoc `@deprecated Use \`chargedTokens\` for the budget-relevant total. \`totalTokens\` is the same value but the name is misleading.`
- **CLI output format (locked):**
  - `factory-runtime run`: `factory-runtime: converged in <N> iteration(s) (run=<id>, charged=<charged>/<budget>, <ms>ms)`. Budget is `RunOptions.maxTotalTokens` (or its default 500_000).
  - `factory-runtime run-sequence`: per-spec line `<id>: converged (charged=<charged>)`; final summary `factory-runtime: sequence converged (<m>/<n> specs, charged=<total>, factorySequenceId=<id>, <ms>ms)`.
- **Cost-cap-exceeded message format (locked):** `running_charged=<charged> > maxTotalTokens=<cap>`. Mirrors the existing `running_total=...` format but with the budget-relevant variable.
- **Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.10's 23 names** (zero new exports — all changes are field-level on existing types).
- **Coordinated package version bump deferred to spec 6** (`worktree-sandbox-v0-0-11`'s chore subtask).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.11 explicitly does NOT ship in this spec:** removing `tokens.total` from the schema (back-compat); removing `RunReport.totalTokens` deprecated alias (3-version arc — v0.0.11 deprecates, v0.0.12 emits warning, v0.1.0 removes); per-iteration charged display in CLI (only summary); cache-aware budget option (always excludes cache).

## Subtasks

- **T1** [feature] — `packages/runtime/src/records.ts`: extend `FactoryImplementReportSchema.tokens` with `charged: z.number().int().nonnegative().optional()` field. ~5 LOC. **depends on nothing.**
- **T2** [feature] — `packages/runtime/src/phases/implement.ts`: populate `tokens.charged = input + output` when persisting the report. ~5 LOC. **depends on T1.**
- **T3** [feature] — `packages/runtime/src/runtime.ts`: add `chargedTokens: number` to RunReport (already returned via existing `sumImplementTokens` logic; just rename + add alias). Update `factory-runtime: converged...` log to include `charged=<n>/<budget>`. ~15 LOC. **depends on T1, T2.**
- **T4** [feature] — `packages/runtime/src/types.ts`: add `RunReport.chargedTokens: number` + JSDoc-deprecated `totalTokens: number` (alias). ~10 LOC. **depends on T3.**
- **T5** [feature] — `packages/runtime/src/cli.ts`: update `factory-runtime: converged...` and `factory-runtime: sequence converged...` output formatting to show charged values. ~10 LOC. **depends on T3.**
- **T6** [feature] — `packages/runtime/src/runtime.ts`: update `runtime/total-cost-cap-exceeded` error message format to `running_charged=<n> > maxTotalTokens=<cap>`. ~5 LOC. **depends on T1.**
- **T7** [test] — `packages/runtime/src/records.test.ts`: 1 test covering S-1 schema. `packages/runtime/src/phases/implement.test.ts`: 1 test covering populated charged. `packages/runtime/src/runtime.test.ts`: 3 tests covering S-2 (chargedTokens; deprecated alias; cost-cap-exceeded message). `packages/runtime/src/cli.test.ts`: 1 test covering S-2 stdout format. ~80 LOC. **depends on T1..T6.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.11 cluster.
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`.
- `factory-runtime: converged...` stdout includes `charged=<n>/<budget>` and the budget value is `RunOptions.maxTotalTokens`.
- A run that consumes 1k input + 500 output + 5k cache-reads reports `tokens.charged === 1500`, `tokens.total === 6500`.
- Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.10's 23 names. `RunReport` gains 1 new field (`chargedTokens`); the deprecated `totalTokens` stays for back-compat.
- v0.0.11 explicitly does NOT ship in this spec: removal of `tokens.total`; removal of deprecated `totalTokens` alias; per-iteration display; cache-aware budget mode. Deferred per Constraints.

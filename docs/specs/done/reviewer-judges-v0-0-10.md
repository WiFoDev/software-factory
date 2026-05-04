---
id: reviewer-judges-v0-0-10
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/spec-review/src/judges/cross-doc-consistency.ts
    why: "Reference shape for adding a new JudgeDef: code, defaultSeverity, applies(), buildPrompt(spec, sliced, ctx). v0.0.10 adds three new judges following this exact pattern. Each becomes its own file under packages/spec-review/src/judges/."
  - path: packages/spec-review/src/judges/index.ts
    why: "ALL_JUDGES registry — v0.0.10 adds three entries here. defaultEnabledJudges() includes them by default. ruleSetHash() picks them up automatically (their CRITERION text becomes part of the cache key). Field-level addition to existing registry."
  - path: packages/spec-review/src/findings.ts
    why: "ReviewCode union (current 8 codes since v0.0.7's review/dep-not-found). v0.0.10 adds three new codes: review/api-surface-drift, review/feasibility, review/scope-creep. Field-level addition to already-exported union."
  - path: BACKLOG.md
    why: "v0.0.4's reviewer roadmap promised 9 judges; shipped 5 + 1 (review/section-missing) + 1 (review/judge-failed) + 1 (review/dep-not-found from v0.0.7) = 8 codes. The remaining 3 (api-surface-drift, feasibility, scope-creep) round out the original plan."
depends-on: []
---

# reviewer-judges-v0-0-10 — three deferred reviewer judges (`review/api-surface-drift`, `review/feasibility`, `review/scope-creep`)

## Intent

Round out the `@wifo/factory-spec-review` package's original v0.0.4 plan by adding the three deferred judges that have been on BACKLOG since v0.0.4 ship. Each catches a different spec-quality failure mode that's repeatedly surfaced in reviews of real specs (including the v0.0.7+v0.0.8+v0.0.9 self-builds). All three are LLM-judged via the existing `claude -p` subprocess path; each ships at `severity: 'warning'` (default for v0.0.4-style judges); each is added to the default-enabled list.

Field-level extension of `JudgeDef` registry + 3-entry extension of `ReviewCode` union. Zero new public exports beyond the union members. Pairs naturally with the v0.0.6 + v0.0.7's `cross-doc-consistency` work; reuses the same `JudgePromptCtx.deps` plumbing for cross-doc reasoning where applicable.

## Scenarios

**S-1** — `review/api-surface-drift`: flags spec-vs-tech-plan public-API name divergence
  Given a DEEP spec at `docs/specs/foo-deep.md` that names `myFunction` and `MyType` in its `## Constraints / Decisions` block, paired with a technical-plan at `docs/technical-plans/foo-deep.md` whose `## 4. Public API surface deltas` section lists `myFunction` only (NOT `MyType`)
  When `factory spec review docs/specs/foo-deep.md` is invoked
  Then the findings include one with `code: 'review/api-surface-drift'`, `severity: 'warning'`, message naming the divergence (e.g., "Spec names `MyType` in Constraints; not enumerated in technical-plan §4. Names mentioned in one but not the other suggest the surface is not fully agreed.").
  And given a spec WITHOUT a paired technical-plan, `review/api-surface-drift` does NOT fire (judge applies only when `ctx.hasTechnicalPlan === true`).
  And given a spec + tech-plan that agree on every name, the judge passes (no finding emitted).
  Satisfaction:
    - test: packages/spec-review/src/judges/api-surface-drift.test.ts "applies returns true when paired technical-plan present"
    - test: packages/spec-review/src/judges/api-surface-drift.test.ts "applies returns false when no technical-plan"
    - test: packages/spec-review/src/judges/api-surface-drift.test.ts "criterion mentions name divergence between spec Constraints and tech-plan §4"

**S-2** — `review/feasibility`: flags subtask LOC estimates that look unrealistic given file count
  Given a spec whose `## Subtasks` section has T1 estimating "~30 LOC" but referencing 12 distinct file paths (e.g., 6 package.json + 4 docs + 2 test files)
  When the reviewer runs
  Then the findings include one with `code: 'review/feasibility'`, `severity: 'warning'`, message naming the mismatch (e.g., "T1 claims ~30 LOC but references 12 distinct file paths in its body; ~3 LOC per file is below the typical 15-30 LOC/file ratio for real edits. Consider re-estimating or splitting.").
  And given a spec whose subtasks have realistic LOC-per-path ratios (e.g., "~80 LOC" referencing 4 files = 20 LOC/file), the judge passes.
  And given a spec without LOC estimates in its subtasks, the judge passes (cannot detect drift without numbers; declines to fire).
  Satisfaction:
    - test: packages/spec-review/src/judges/feasibility.test.ts "applies returns true when Subtasks section has LOC estimates"
    - test: packages/spec-review/src/judges/feasibility.test.ts "applies returns false when Subtasks has no LOC estimates"
    - test: packages/spec-review/src/judges/feasibility.test.ts "criterion mentions LOC-vs-path-count ratio for subtasks"

**S-3** — `review/scope-creep`: flags subtasks claiming future-version work; flags missing `## Anti-goals`/`Defer` sections in DEEP specs
  Given a spec whose Subtasks include "T5 [feature] — Add the future X feature in v0.0.11" (literal mention of a future version) OR whose Constraints block doesn't have a "v0.0.10 explicitly does NOT ship" or "Deferred per Constraints" line
  When the reviewer runs
  Then for the future-mention case: findings include one with `code: 'review/scope-creep'`, `severity: 'warning'`, message naming the offending subtask (e.g., "T5 references work for v0.0.11 — split this work into a separate spec for that release.").
  And for the missing-defer case (DEEP specs only): findings include one suggesting the spec add an explicit "v0.0.10 does NOT ship X" anti-goal block (LIGHT specs are exempt — they're allowed to be focused without an anti-goals block).
  And given a spec whose subtasks stay in-version + has a clear anti-goals/defer block, the judge passes.
  Satisfaction:
    - test: packages/spec-review/src/judges/scope-creep.test.ts "criterion mentions future-version work and anti-goals coverage"
    - test: packages/spec-review/src/judges/scope-creep.test.ts "applies returns true on every spec (no preconditions)"

**S-4** — All three judges register cleanly + appear in `defaultEnabledJudges()`; `ruleSetHash` reflects their CRITERION text
  Given the v0.0.10 build
  When `loadJudgeRegistry()` is invoked
  Then the returned registry has 8 entries (5 v0.0.4 + cross-doc + 3 NEW v0.0.10 = 8). `defaultEnabledJudges()` returns the 8 codes in registry-order. `ruleSetHash()` is different from v0.0.9's hash (because the new CRITERION strings are part of the hash input). v0.0.9 cache entries miss correctly on first run after upgrade.
  And given the `ReviewCode` union, the 3 new codes type-check as valid `ReviewCode` values; existing `ReviewFinding.code` consumers don't break.
  Satisfaction:
    - test: packages/spec-review/src/judges/index.test.ts "registry has 8 entries after v0.0.10 (5 v0.0.4 + 3 v0.0.10)"
    - test: packages/spec-review/src/judges/index.test.ts "ruleSetHash is different between v0.0.9 and v0.0.10"
    - test: packages/spec-review/src/judges/index.test.ts "defaultEnabledJudges includes all 3 new codes"

## Constraints / Decisions

- **Three new files:** `packages/spec-review/src/judges/api-surface-drift.ts`, `feasibility.ts`, `scope-creep.ts`. Each follows the existing `JudgeDef` shape (`code`, `defaultSeverity`, `applies`, `buildPrompt`).
- **All three at `severity: 'warning'` by default** — matches the v0.0.4 invariant that all reviewer judges ship at warning until per-judge calibration warrants escalation. Promotion to `'error'` is per-judge in point releases, post-evidence.
- **`review/api-surface-drift` applicability:** `ctx.hasTechnicalPlan === true`. Without a tech-plan, there's nothing to drift FROM. Mirrors `cross-doc-consistency`'s applicability gate.
- **`review/feasibility` applicability:** the spec's `## Subtasks` section contains at least one bullet with a recognizable LOC estimate (regex: `~?\d+\s*LOC`). Without estimates, there's nothing to score; the judge declines.
- **`review/scope-creep` applicability:** always. The judge fires on every spec; the prompt instructs the LLM to look for future-version mentions + missing anti-goals.
- **Each judge's CRITERION text is the LOCKED prompt for the LLM judge.** Values are designed once and not edited per-spec. Changes to CRITERION between versions invalidate the rule-set hash (cache miss correctly).
- **`buildPrompt` artifacts:** each judge slices the relevant section(s) via `findSection` from `@wifo/factory-core` (`Constraints / Decisions`, `Subtasks`, `Definition of Done`). Section slicer reuse — no new helper code needed.
- **`api-surface-drift` reuses `JudgePromptCtx.deps`** when the spec has a paired technical-plan AND deps. Pairs cleanly with v0.0.7's plumbing.
- **`scope-creep` LIGHT-vs-DEEP awareness:** the judge knows that LIGHT specs may not have explicit anti-goals — only DEEP specs are flagged for missing anti-goals. The judge reads `spec.frontmatter.classification` to decide.
- **`ReviewCode` union extension:** 8 → **11** values. New codes: `'review/api-surface-drift'`, `'review/feasibility'`, `'review/scope-creep'`.
- **`ALL_JUDGES` registry order:** existing 5 v0.0.4 judges + `cross-doc-consistency` (v0.0.7) + 3 NEW v0.0.10 judges, in this canonical order:
  ```
  internal-consistency → judge-parity → dod-precision → holdout-distinctness → cross-doc-consistency → api-surface-drift → feasibility → scope-creep
  ```
  The 3 new judges land at the END of the order, matching the v0.0.4 convention.
- **`ruleSetHash` invariant:** the function probes each judge's `buildPrompt` against a stub spec and hashes the criterion text. Adding 3 new judges changes the hash output. Existing v0.0.9 cache entries miss correctly on first run after upgrade — expected behavior.
- **Public API surface from `@wifo/factory-spec-review/src/index.ts` strictly equal to v0.0.9's 10 names** (zero new exports — judges register internally; `ReviewCode` is field-level on already-exported union; the new code values type-check transparently).
- **Coordinated package version bump deferred to spec 5** (`wide-blast-calibration-v0-0-10`'s chore subtask).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.10 explicitly does NOT ship in this spec:** judge severity escalation (all 3 stay at `warning`); user-configurable judge thresholds; per-codebase judge calibration via `factory.config.json`; deferred judges beyond these 3 (any future judges ship in their own version).

## Subtasks

- **T1** [feature] — Author `packages/spec-review/src/judges/api-surface-drift.ts` with `JudgeDef` for `review/api-surface-drift`. CRITERION text per Constraints. `applies` checks `ctx.hasTechnicalPlan`. `buildPrompt` slices spec's Constraints + tech-plan's `§4. Public API surface deltas` section + (optionally) deps' Constraints. ~70 LOC. **depends on nothing.**
- **T2** [feature] — Author `packages/spec-review/src/judges/feasibility.ts` with `JudgeDef` for `review/feasibility`. CRITERION text per Constraints. `applies` checks for LOC-estimate regex matches in Subtasks. `buildPrompt` slices Subtasks. ~70 LOC. **depends on nothing.**
- **T3** [feature] — Author `packages/spec-review/src/judges/scope-creep.ts` with `JudgeDef` for `review/scope-creep`. CRITERION text per Constraints. `applies` returns true unconditionally. `buildPrompt` slices spec body + Constraints (looks for "Defer" / "explicitly does NOT ship" markers + future-version mentions). LIGHT-vs-DEEP awareness via `spec.frontmatter.classification`. ~70 LOC. **depends on nothing.**
- **T4** [feature] — Update `packages/spec-review/src/judges/index.ts`: add the 3 new judges to `ALL_JUDGES` array; verify `loadJudgeRegistry()` + `defaultEnabledJudges()` pick them up automatically. ~10 LOC. **depends on T1, T2, T3.**
- **T5** [feature] — Update `packages/spec-review/src/findings.ts`: extend `ReviewCode` union with the 3 new codes. ~5 LOC. **depends on nothing (parallel with T1-T3).**
- **T6** [test] — Per-judge test files: `api-surface-drift.test.ts`, `feasibility.test.ts`, `scope-creep.test.ts` — 2-3 tests each (applies + buildPrompt + criterion content). Plus `packages/spec-review/src/judges/index.test.ts`: registry-extension tests covering S-4. ~250 LOC across all test files. **depends on T1, T2, T3, T4, T5.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/spec-review typecheck` clean.
- `pnpm -C packages/spec-review test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `pnpm typecheck` workspace-wide clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.10 cluster.
- `pnpm -C packages/spec-review build` produces a working build.
- `factory spec review docs/specs/done/dod-verifier-v0-0-10.md` (the DEEP spec from this cluster) runs against a live or fake-judge-fixture client without errors; the 3 new judges fire or pass cleanly. Verified via the existing CLI-test harness pattern.
- `loadJudgeRegistry()` returns 8 entries (5 v0.0.4 + cross-doc + 3 v0.0.10).
- `ruleSetHash()` differs from v0.0.9's hash (cache invalidation works correctly).
- Public API surface from `@wifo/factory-spec-review/src/index.ts` strictly equal to v0.0.9's 10 names. The new codes are field-level on the already-exported `ReviewCode` union.
- v0.0.10 explicitly does NOT ship in this spec: severity escalation; threshold tuning via config; additional new judges. Deferred per Constraints.

---
id: holdout-aware-convergence-v0-0-11
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/runtime/src/phases/validate.ts
    why: "validatePhase iterates spec.scenarios. v0.0.11 adds optional iteration over spec.holdouts at end of each iteration when --check-holdouts is set. The holdout iteration is silent (no agent visibility) and its pass/fail flows into convergence semantics."
  - path: packages/runtime/src/phases/implement.ts
    why: "buildPrompt's # Prior validate report section. v0.0.11 adds a parallel # Prior holdout fail section listing failed holdout IDs ONLY (not their criteria — preserves the v0.0.4 overfit guard invariant)."
  - path: docs/specs/done/factory-runtime-v0-0-3.md
    why: "Reference shape for cross-iteration prompt threading + a new convergence gate. v0.0.3 added the # Prior validate report section + iteration loop; v0.0.11 mirrors that pattern for holdouts."
depends-on: []
---

# holdout-aware-convergence-v0-0-11 — `--check-holdouts` flag: holdouts validated each iteration; convergence requires both visible AND holdouts pass

## Intent

Add a new `--check-holdouts` opt-in flag to `factory-runtime run` and `run-sequence`. When set, the validate phase runs BOTH visible scenarios AND `## Holdout Scenarios` at the end of EACH iteration; convergence requires both pass. Holdouts are NOT shared with the implementing agent (existing v0.0.4 invariant preserved) — they're checked silently at iteration end.

Failed holdouts surface in iteration N+1's prompt under a new `# Prior holdout fail` section listing **only the failed holdout IDs** (not their criteria — preserves the overfit guard). The agent sees that holdouts failed; doesn't see what they checked. Iterates to fix until both visible AND holdouts pass.

The flag is opt-in; default behavior (no flag) is unchanged from v0.0.10. Field-level addition; one new entry on the `RunOptions` type. Pairs with v0.0.10's DoD-verifier as the second "trust contract" gate — holdouts close the visible-only-overfit gap.

## Scenarios

**S-1** — `--check-holdouts` runs holdouts at end of each iteration; both must pass for convergence
  Given a spec with 2 visible scenarios + 2 holdout scenarios
  When `factory-runtime run <spec> --check-holdouts --no-judge --no-implement` is invoked (the agent isn't asked to implement; this tests the validate phase wiring)
  Then validatePhase runs both visible AND holdouts in iteration 1. If both pass, the iteration's status is `'pass'` → converged. The persisted `factory-validate-report` records BOTH scenario sets, with `payload.scenarios` containing visible entries and a NEW `payload.holdouts` array containing holdout entries (kind: 'holdout').
  And given the same setup but holdouts fail (visible pass), the iteration's status is `'fail'`; the run does NOT converge in iter 1.
  And given `--check-holdouts` is NOT set (default), holdouts are NOT run; convergence depends only on visible scenarios + DoD (v0.0.10 behavior).
  Satisfaction:
    - test: packages/runtime/src/phases/validate.test.ts "--check-holdouts runs visible AND holdouts each iteration"
    - test: packages/runtime/src/phases/validate.test.ts "factory-validate-report has separate scenarios + holdouts arrays when --check-holdouts is set"
    - test: packages/runtime/src/phases/validate.test.ts "absent --check-holdouts leaves holdouts unrun (default v0.0.10 behavior)"

**S-2** — Failed holdouts surface in iteration N+1's prompt as IDs only (not criteria)
  Given a 2-iteration run where iteration 1's visible scenarios pass but holdouts H-1 and H-2 fail (with full criterion text and given/when/then in the holdout records)
  When `implementPhase`'s `buildPrompt` is invoked for iteration 2 with `ctx.inputs` containing the prior validate-report
  Then the produced prompt contains a `# Prior holdout fail` section listing the failed holdout IDs in the locked format `**H-1**`, `**H-2**` — one bullet per failed holdout. The section explicitly mentions "do not look up these holdouts; they are intentionally hidden — fix the underlying behavior so they pass." NO holdout criterion text or scenario body is included. The section appears AFTER `# Prior validate report` (or where that would appear) and BEFORE `# Working directory`.
  And given iteration 1's holdouts ALL pass (no holdout fails), iteration 2's prompt has NO `# Prior holdout fail` section.
  And given the section's per-line cap (1 KB) and section-total cap (10 KB — tighter than the validate section's 50 KB cap, since IDs are short), longer holdout-ID lists are truncated with the marker `[runtime] truncated prior-holdouts section`.
  Satisfaction:
    - test: packages/runtime/src/phases/implement.test.ts "buildPrompt emits Prior holdout fail section listing IDs only"
    - test: packages/runtime/src/phases/implement.test.ts "buildPrompt does not emit holdout criterion text"
    - test: packages/runtime/src/phases/implement.test.ts "Prior holdout fail section absent when no holdout fails"

**S-3** — `factory.config.json runtime.checkHoldouts: true` mirrors the CLI flag
  Given a tmp cwd with `factory.config.json` containing `{ "runtime": { "checkHoldouts": true } }` and a spec with holdouts
  When `factory-runtime run <spec> --no-judge --no-implement --context-dir <ctx>` is invoked (no CLI flag)
  Then holdouts ARE checked (config opts in). Convergence requires both pass.
  And given the CLI passes `--check-holdouts` regardless of config, behavior matches: holdouts checked.
  And given a cwd WITHOUT `factory.config.json`, holdouts are NOT checked (built-in default `false`).
  Satisfaction:
    - test: packages/runtime/src/cli.test.ts "factory.config.json runtime.checkHoldouts=true runs holdouts even without --check-holdouts flag"
    - test: packages/runtime/src/cli.test.ts "absent factory.config.json + no flag leaves holdouts unrun (default)"

## Constraints / Decisions

- **`RunOptions.checkHoldouts?: boolean` — field-level addition.** Default `false`. Programmatic callers building their own graph aren't affected unless they read this field.
- **`ValidatePhaseOptions.checkHoldouts?: boolean` — field-level addition.** When the runtime constructs the default graph, it threads the option through.
- **`factory.config.json runtime.checkHoldouts?: boolean`** — extends the existing partial schema. Precedence: CLI flag > config > built-in default `false` (mirrors `noJudge`, `includeDrafting`, `skipDodPhase`).
- **Holdouts run at end of each iteration, NOT once at end of the whole run.** Per-iteration check ensures every iteration's convergence semantics are honest. Holdout-fail in iter N triggers iter N+1 (the agent fixes; iterates).
- **The prior-holdouts prompt section format (locked):**
  ```
  # Prior holdout fail

  Iteration N's visible scenarios passed but the following holdouts failed:

  - **H-1**
  - **H-2**

  These holdouts are intentionally hidden — their content is NOT shown to you.
  Fix the underlying behavior so they pass without looking them up.
  ```
  IDs only; no criterion text. Per-line cap 1 KB; section-total cap 10 KB (tight; IDs are short). Byte-stable across iterations of the same failure (cache-friendly).
- **Section position in `buildPrompt`:** AFTER `# Prior validate report` (when present); BEFORE `# Working directory`. AFTER `# Prior DoD report` (v0.0.10) if both present.
- **Holdouts are validated using the same `validatePhase` infrastructure as visible scenarios.** Same harness, same judge runner. The difference is provenance (kind: 'holdout' on the persisted record) and visibility (NOT shared in agent prompt).
- **`factory-validate-report.payload`** gains an optional `holdouts?: ScenarioResult[]` field (mirrors `scenarios`). Field-level addition to the schema; existing reports without holdouts have an empty or absent array.
- **No new context record type.** Holdout results live inside the existing `factory-validate-report` (one record per iteration). Provenance walks via `factory-context tree --direction down <runId>` show holdout pass/fail in the validate-report's payload.
- **`--check-holdouts` flag (boolean) on both `factory-runtime run` and `run-sequence` CLI subcommands.** Mirrors `--no-judge` / `--no-implement` / `--include-drafting`'s shape.
- **No new RuntimeErrorCode.** Holdout failures land as `'fail'` (iteration retries) or `'error'` (mirrors validate's existing error path).
- **Agent visibility invariant (locked):** the agent sees ONLY the IDs of failed holdouts, never the criteria, never the body, never the full scenarios array. This invariant is testable: search the buildPrompt output for any holdout's body text → MUST NOT find it.
- **Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.10's 23 names** (zero new exports — field-level on `RunOptions` and `ValidatePhaseOptions`).
- **Coordinated package version bump deferred to spec 6** (`worktree-sandbox-v0-0-11`'s chore subtask).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.11 explicitly does NOT ship in this spec:** holdout severity escalation (failed holdouts always trigger iter N+1; never "warn-only"); per-spec holdout count limits; partial holdout pass (all-or-nothing convergence gate); revealing the holdout criteria when the agent self-reports stuck.

## Subtasks

- **T1** [feature] — `packages/runtime/src/phases/validate.ts`: extend `validatePhase` to accept `checkHoldouts: boolean` option. When true, iterate `spec.holdouts` after `spec.scenarios`; persist as `payload.holdouts: ScenarioResult[]`. Aggregate phase status across both arrays. ~50 LOC. **depends on nothing.**
- **T2** [feature] — `packages/runtime/src/types.ts`: add `RunOptions.checkHoldouts?: boolean`. `packages/runtime/src/runtime.ts`: thread through to validatePhase. `packages/runtime/src/cli.ts`: add `--check-holdouts` flag; extend `FactoryConfigRuntimeSchema` with `checkHoldouts?: boolean`. ~30 LOC. **depends on T1.**
- **T3** [feature] — `packages/runtime/src/phases/implement.ts`: extend `buildPrompt` to emit `# Prior holdout fail` section when `ctx.inputs` contains a `factory-validate-report` with non-empty `holdouts[].status === 'fail'`. Locked format from Constraints. ~30 LOC. **depends on T1.**
- **T4** [test] — `packages/runtime/src/phases/validate.test.ts`: 3 tests covering S-1. `packages/runtime/src/phases/implement.test.ts`: 3 tests covering S-2 (Prior holdout fail section: present, absent, IDs-only invariant). `packages/runtime/src/cli.test.ts`: 2 tests covering S-3 (config + flag). ~150 LOC. **depends on T1, T2, T3.**
- **T5** [chore] — Update `packages/runtime/README.md`: add a `## Holdout-aware convergence (v0.0.11+)` subsection documenting the new flag + the IDs-only invariant + the `factory.config.json` opt-in. ~25 LOC. **depends on T1, T2, T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.11 cluster.
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`; `--check-holdouts` flag accepts cleanly.
- The agent-visibility invariant test passes — `buildPrompt` output for a 2-holdout-fail iteration does NOT contain any holdout's criterion text, only the IDs.
- Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.10's 23 names.
- README in `packages/runtime/` documents the v0.0.11+ holdout-aware convergence + the IDs-only invariant.
- v0.0.11 explicitly does NOT ship in this spec: severity escalation; partial-pass; criterion reveal. Deferred per Constraints.

---
id: factory-spec-review-v0-0-9
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/spec-review/src/judges/internal-consistency.ts
    why: "The judge that fires the false-positive in v0.0.8 BASELINE — flags the first spec's shared constraints as unreferenced because it doesn't follow depends-on edges. v0.0.9 extends applies() and buildPrompt() to consume JudgePromptCtx.deps (already plumbed through in v0.0.7 by cross-doc-consistency)."
  - path: packages/spec-review/src/judges/cross-doc-consistency.ts
    why: "Reference for the dep-aware judge pattern. v0.0.7 added JudgeApplicabilityCtx.depsCount + JudgePromptCtx.deps and wired them through. internal-consistency v0.0.9 reuses the EXACT same plumbing — no new ctx fields, no new RunReviewOptions — just the judge's applies/buildPrompt opt into the existing deps context."
  - path: docs/specs/done/factory-core-v0-0-7.md
    why: "Reference shape: v0.0.7's spec for the depends-on field + cross-doc-consistency dep-loading. v0.0.9's internal-consistency extension is a strictly smaller change (one judge file + one judge test file)."
depends-on: []
---

# factory-spec-review-v0-0-9 — `internal-consistency` judge gains `depends-on`-awareness

## Intent

Close the v0.0.8 BASELINE friction where the `internal-consistency` reviewer judge fires false positives on shared constraints in multi-spec products. `/scope-project`'s decomposition discipline puts cross-spec decisions in the FIRST spec's `## Constraints / Decisions` block; later specs reference them via `depends-on`. The `internal-consistency` judge today scores each spec in isolation and flags those shared constraints as unreferenced (because it doesn't follow `depends-on` edges to see how downstream specs use them). The v0.0.7 `cross-doc-consistency` judge already has dep-loading machinery via `JudgePromptCtx.deps`; this spec wires `internal-consistency` into the same path so dep-context is available when scoring.

This spec also coordinates the v0.0.9 cluster's lockstep version bump (closing chore subtask). All six `@wifo/factory-*` packages bump from `0.0.8` to `0.0.9`; scaffold dep refs bump from `^0.0.8` to `^0.0.9`; CHANGELOG/ROADMAP/README updated.

## Scenarios

**S-1** — `internal-consistency` judge applies when `depsCount > 0` regardless of other ctx
  Given a spec under review with non-empty `depends-on` (so `JudgeApplicabilityCtx.depsCount > 0`)
  When the judge's `applies()` is called
  Then it returns `true`. Given a spec with `depends-on: []` (empty), `applies()` returns `true` (the existing v0.0.4 behavior — judge runs on every spec regardless of deps; the change is in how it scores, not whether it fires).
  Satisfaction:
    - test: packages/spec-review/src/judges/internal-consistency.test.ts "applies returns true for spec with non-empty depends-on"
    - test: packages/spec-review/src/judges/internal-consistency.test.ts "applies returns true for spec with empty depends-on (existing behavior preserved)"

**S-2** — `internal-consistency` judge's `buildPrompt` includes deps' Constraints sections in the artifact
  Given a spec under review whose body has scenarios referencing identifiers declared in a `depends-on` parent's `## Constraints / Decisions` (NOT in this spec's own Constraints)
  When `buildPrompt()` is called with `JudgePromptCtx.deps: [{ id: 'parent-spec', body: '<parent body>' }]`
  Then the artifact contains the spec body AND a `## Deps Constraints (referenced via depends-on)` section listing each dep's Constraints block (sliced via `findSection`). The criterion text is updated to instruct the LLM judge: "constraints declared in any depends-on parent count as available context — references to them in this spec's scenarios do NOT need to be locally declared."
  And given a spec with `JudgePromptCtx.deps: undefined` (no deps loaded), the buildPrompt's artifact does NOT contain the `## Deps Constraints` heading; the judge reverts to v0.0.8 behavior (scores the spec in isolation).
  Satisfaction:
    - test: packages/spec-review/src/judges/internal-consistency.test.ts "buildPrompt includes Deps Constraints section when deps are provided"
    - test: packages/spec-review/src/judges/internal-consistency.test.ts "buildPrompt artifact does not emit Deps Constraints section when deps is undefined"
    - test: packages/spec-review/src/judges/internal-consistency.test.ts "criterion text mentions depends-on context when deps are provided"

**S-3** — End-to-end: a multi-spec product no longer triggers false-positive `review/internal-consistency` warnings on shared constraints
  Given the URL-shortener fixture set under `docs/baselines/scope-project-fixtures/url-shortener/` (4 LIGHT specs, 1 ready + 3 drafting, linear depends-on chain)
  When `factory spec review docs/baselines/scope-project-fixtures/url-shortener/url-shortener-redirect.md` is invoked (the second spec; depends-on `url-shortener-core`)
  Then the review's findings array does NOT include `review/internal-consistency` warnings about constraints declared in `url-shortener-core` that `url-shortener-redirect`'s scenarios reference. (Background: the fixture set's later specs declare scenarios that USE the data shapes + error codes from `url-shortener-core`'s Constraints — exactly the shared-constraints pattern.) Other warnings (judge-parity, dod-precision) may still fire if applicable; the assertion is specifically that the dep-aware judge no longer fires the false positive.
  Note: this scenario uses the existing v0.0.7 fixtures because they already have the right shape; no new fixtures need to be authored.
  Satisfaction:
    - test: packages/spec-review/src/judges/internal-consistency.test.ts "URL-shortener fixture: redirect spec passes internal-consistency when run with deps loaded"

**S-4** — Coordinated v0.0.9 lockstep version bump across all six packages
  Given the post-implementation `packages/<name>/package.json` for every workspace package
  When their `version` fields are read
  Then every one is `"0.0.9"` (lockstep — context, core, harness, runtime, spec-review, twin all match). `init-templates.ts`'s `PACKAGE_JSON_TEMPLATE.dependencies` references `^0.0.9` for every `@wifo/factory-*` dep. `publish-meta.test.ts`'s version regex updated to `/^0\.0\.9$/`. `init.test.ts` and `init-templates.test.ts` version-string assertions updated to `^0.0.9`.
  Satisfaction:
    - test: packages/core/src/publish-meta.test.ts "every workspace package has v0.0.9 + publishConfig + npm metadata fields"
    - test: packages/core/src/init.test.ts "scaffold dependencies pin @wifo/factory-* at ^0.0.9"
    - test: packages/core/src/init-templates.test.ts "PACKAGE_JSON_TEMPLATE pins @wifo/factory-* deps at ^0.0.9"

## Constraints / Decisions

- **Judge change is field-level on existing types — zero new exports.** `JudgeApplicabilityCtx.depsCount` and `JudgePromptCtx.deps` already exist (added in v0.0.7 for `cross-doc-consistency`). v0.0.9 just teaches `internal-consistency` to consume them.
- **`applies()` change (locked):** the existing logic returns `true` unconditionally (judge runs on every spec). v0.0.9 keeps that — the dep-awareness affects scoring, not applicability. A spec without deps still gets scored; the judge just doesn't have dep-context to bring in.
- **`buildPrompt()` change (locked, structural):**
  - Compose the artifact as: spec body + (when `ctx.deps !== undefined && ctx.deps.length > 0`) a new `## Deps Constraints (referenced via depends-on)` section listing each dep's `## Constraints / Decisions` section sliced via the existing `findSection` helper from `@wifo/factory-core`.
  - When a dep's body has no `## Constraints / Decisions` section, the dep is skipped silently (one-line note in the artifact: `### <dep-id>\n(no constraints section in this dep)`).
  - The criterion text gains a sentence: "Constraints declared in any depends-on parent count as available context — references to them in this spec's scenarios do NOT need to be locally declared. Score against the union of this spec's Constraints + every dep's Constraints reachable via depends-on."
  - Existing artifact cap (100 KB via `capBytes`) reused — combined spec + deps trimmed if it exceeds.
- **Dep loading is the CLI's responsibility, not the judge's.** The CLI (`packages/spec-review/src/cli.ts`) already auto-loads each declared dep from `docs/specs/<id>.md` or `docs/specs/done/<id>.md` and threads them through `runReview`'s `deps` option (added in v0.0.7). v0.0.9 doesn't change the CLI; the judge just opts into the existing data flow.
- **Backward-compat:** programmatic callers passing `JudgePromptCtx` without `deps` still get the v0.0.8 behavior (judge scores the spec in isolation). No breaking changes.
- **`ruleSetHash` invariant:** the criterion text is changed (one-sentence addition), so the rule-set hash flips and the cache invalidates correctly. Existing v0.0.8 cache entries for `internal-consistency` will miss on first run after upgrade — expected and correct.
- **Public API surface from `@wifo/factory-spec-review/src/index.ts` strictly equal to v0.0.8's 10 names** (zero new exports — field-level changes only).
- **Coordinated package version bump (chore subtask, T6 below):**
  - `packages/{context,core,harness,runtime,spec-review,twin}/package.json` version: `0.0.8` → `0.0.9`.
  - `packages/core/src/init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies`: every `@wifo/factory-*` dep `^0.0.8` → `^0.0.9`.
  - `packages/core/src/init-templates.test.ts` version assertions: `^0.0.8` → `^0.0.9`.
  - `packages/core/src/init.test.ts` version assertions: `^0.0.8` → `^0.0.9`.
  - `packages/core/src/publish-meta.test.ts` version regex: `/^0\.0\.8$/` → `/^0\.0\.9$/`.
- **CHANGELOG / ROADMAP / top-level README** updates summarize the v0.0.9 cluster (this spec + the three sibling specs).
- **v0.0.9 explicitly does NOT ship in this spec:** dep-awareness for OTHER judges (only `internal-consistency`); transitive dep loading (the CLI loads direct deps only, per v0.0.7 behavior — transitive deps require the dep's own `depends-on` chain to be walked, deferred to a future release); custom criterion overrides per-judge.

## Subtasks

- **T1** [feature] — Update `packages/spec-review/src/judges/internal-consistency.ts`: extend `buildPrompt(spec, sliced, ctx)` to consume `ctx.deps`. Compose the artifact with the new `## Deps Constraints` section when `ctx.deps?.length > 0`. Update CRITERION text to mention depends-on context. ~30 LOC. **depends on nothing.**
- **T2** [test] — `packages/spec-review/src/judges/internal-consistency.test.ts` (NEW FILE; mirrors `cross-doc-consistency.test.ts`): tests covering S-1, S-2, S-3 — applies behavior, buildPrompt artifact composition with/without deps, end-to-end against the URL-shortener fixture set. ~120 LOC. **depends on T1.**
- **T3** [chore] — Bump version field in all six `packages/<name>/package.json` files from `0.0.8` to `0.0.9`. Bump `init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies` from `^0.0.8` to `^0.0.9` for all four `@wifo/factory-*` deps. ~10 LOC. **depends on nothing (parallel with T1).**
- **T4** [test] — Update `packages/core/src/publish-meta.test.ts` version regex (`^0\.0\.8$` → `^0\.0\.9$`); update `packages/core/src/init.test.ts` and `packages/core/src/init-templates.test.ts` version-string assertions (`^0.0.8` → `^0.0.9`). ~10 LOC. **depends on T3.**
- **T5** [chore] — Update `CHANGELOG.md` with v0.0.9 entry (Added: status-aware run-sequence + per-spec agent-timeout + scaffold scripts + internal-consistency dep-awareness; Changed: lockstep bump; Public API: unchanged). Update `ROADMAP.md` (mark v0.0.9 shipped; promote v0.1.0+ candidates). Update top-level `README.md` v0.0.9 banner. ~80-120 LOC. **depends on T1..T4.**
- **T6** [chore] — Update `packages/spec-review/README.md`: document the `internal-consistency` judge's new dep-awareness behavior. ~10 LOC. **depends on T1.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/spec-review typecheck` clean.
- `pnpm -C packages/spec-review test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.9 cluster.
- `pnpm -C packages/spec-review build` produces a working build.
- `pnpm pack --dry-run` against every `packages/<name>/` produces clean tarballs at version `0.0.9`.
- All six `@wifo/factory-*` `package.json` files at `0.0.9`.
- `CHANGELOG.md`, `ROADMAP.md`, top-level `README.md` reflect v0.0.9 ship state.
- Public API surface from every `@wifo/factory-*` package strictly equal to v0.0.8's surface (zero new exports across the v0.0.9 cluster).
- v0.0.9 explicitly does NOT ship: dep-awareness for other judges; transitive dep loading; custom per-judge criterion overrides. Deferred per Constraints.

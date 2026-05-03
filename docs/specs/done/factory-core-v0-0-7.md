---
id: factory-core-v0-0-7
classification: light
type: feat
status: ready
exemplars:
  - path: packages/core/src/schema.ts
    why: "SpecFrontmatterSchema (lines 20-29). v0.0.7 adds one optional field (`'depends-on': z.array(z.string()).default([])`) field-level on the existing exported type. Mirrors v0.0.3 / v0.0.5's 'add a field on an existing exported type' pattern: zero new exports, strict-equality public surface count."
  - path: docs/specs/done/factory-context-v0-0-4.md
    why: "Reference shape for a LIGHT spec extending an exported type field-level without changing surface count. Public API surface from `packages/context/src/index.ts` was strictly equal to v0.0.1's 18 names; the new internal helper `buildDescendantTree` was internal-only. v0.0.7's `depends-on` field is the same pattern at schema level."
  - path: packages/core/src/lint.ts
    why: "lintSpec (lines 20-133). v0.0.7 adds depends-on validation: (a) per-entry id format check via a new `KEBAB_ID_REGEX` constant; (b) optional file-existence check (relative to a new `cwd` LintOption) emitting `spec/depends-on-missing` warnings. Field-level addition to LintOptions; LintError shape unchanged."
  - path: packages/spec-review/src/judges/cross-doc-consistency.ts
    why: "CROSS_DOC_CONSISTENCY_JUDGE (lines 27-42). Today applies only when `ctx.hasTechnicalPlan === true` and packs spec.body + technicalPlan into a single artifact under a 100 KB cap. v0.0.7 extends: applies when hasTechnicalPlan OR depends-on is non-empty; buildPrompt receives an optional `deps?: { id: string; body: string }[]` and concatenates each dep's body into the artifact under a `## Deps` section. Reuses the existing `capBytes` truncation."
  - path: packages/spec-review/src/review.ts
    why: "runReview's JudgeApplicabilityCtx + JudgePromptCtx threading (lines 16-57, 96). v0.0.7 extends both contexts with `depsCount` (applicability) + `deps?: {id, body}[]` (prompt). The CLI loads dep specs from disk and threads them through; programmatic callers pass them explicitly."
---

# factory-core-v0-0-7 — `depends-on` frontmatter field

## Intent

Add an optional `depends-on: [<spec-id>, ...]` array to `SpecFrontmatter`. The field declares that the spec assumes the named prior specs have shipped (their tests pass + their public exports exist). `factory spec lint` validates that each entry matches the canonical kebab-case spec id pattern, AND (when invoked with `--cwd <dir>`) validates that each declared dep resolves to a file under `docs/specs/` or `docs/specs/done/`. The `cross-doc-consistency` reviewer judge is taught to read declared deps' bodies and factor them into its scoring.

Pairs with `scope-project-v0-0-7` (the slash command writes the field) and `factory-runtime-v0-0-7` (the sequence-runner reads it). Field-level addition: zero new public exports across `@wifo/factory-core` or `@wifo/factory-spec-review`. Mirrors the v0.0.3 / v0.0.5 / v0.0.6 pattern of "field on existing exported type."

## Scenarios

**S-1** — `parseSpec` accepts `depends-on: [<id>, ...]`; defaults to `[]` when absent
  Given a spec source with frontmatter containing `depends-on:\n  - foo-bar\n  - baz-qux\n`
  When `parseSpec(source)` is invoked
  Then `spec.frontmatter['depends-on']` equals `['foo-bar', 'baz-qux']`; field type is `readonly string[]`; the rest of the frontmatter is unchanged.
  And given a spec source with NO `depends-on:` line in frontmatter, `parseSpec(source).frontmatter['depends-on']` equals `[]` (default applied by Zod).
  And given `depends-on: []` (empty array literal), `spec.frontmatter['depends-on']` equals `[]` (no error).
  Satisfaction:
    - test: packages/core/src/schema.test.ts "SpecFrontmatterSchema accepts depends-on with kebab-case ids"
    - test: packages/core/src/schema.test.ts "SpecFrontmatterSchema defaults depends-on to empty array when absent"
    - test: packages/core/src/parser.test.ts "parseSpec exposes depends-on on frontmatter"

**S-2** — `factory spec lint` validates id format on each `depends-on` entry; bad pattern → `spec/invalid-depends-on` error
  Given a spec source with `depends-on:\n  - GoodId\n` (uppercase letters; violates kebab-case)
  When `lintSpec(source)` is invoked
  Then the returned errors include one with `code: 'spec/invalid-depends-on'`, `severity: 'error'`, `message: "depends-on[0]: 'GoodId' does not match kebab-case id pattern (^[a-z][a-z0-9-]*$)"`. The spec is otherwise valid (no other errors).
  And given `depends-on:\n  - 1starts-with-digit\n`, the same error fires (digit-leading is also invalid).
  And given `depends-on: []`, no error fires.
  And given `depends-on:\n  - good-id\n  - also-good\n`, no `spec/invalid-depends-on` errors fire.
  Satisfaction:
    - test: packages/core/src/lint.test.ts "lintSpec emits spec/invalid-depends-on for non-kebab-case entries"
    - test: packages/core/src/lint.test.ts "lintSpec accepts kebab-case depends-on entries without error"

**S-3** — `factory spec lint --cwd <dir>` warns when a declared dep file is missing on disk
  Given a tmp `docs/specs/` directory containing `parent.md` (with `depends-on: [child]`) and `docs/specs/done/child.md` (the dep file lives under done/)
  When `lintSpecFile(tmpDir/docs/specs/parent.md, { cwd: tmpDir })` is invoked
  Then no `spec/depends-on-missing` warning fires (the dep was found under `docs/specs/done/`).
  And given the same parent spec but no `child.md` exists anywhere under `docs/specs/` or `docs/specs/done/`, exactly one `spec/depends-on-missing` warning fires with `severity: 'warning'`, `message: "depends-on: 'child' not found under docs/specs/ or docs/specs/done/"`.
  And given `lintSpec(source)` (no `cwd` option), no `spec/depends-on-missing` warning fires regardless of whether the dep exists — the file-existence check is gated on the `cwd` option.
  Satisfaction:
    - test: packages/core/src/lint.test.ts "lintSpec with cwd option warns when depends-on entry has no matching file"
    - test: packages/core/src/lint.test.ts "lintSpec with cwd option finds dep under docs/specs/done/ subdirectory"
    - test: packages/core/src/lint.test.ts "lintSpec without cwd option does not check file existence"

**S-4** — `cross-doc-consistency` judge reads declared deps' bodies and factors them into the prompt artifact
  Given a spec with `depends-on: [helper]` and a paired technical-plan
  When `runReview` is invoked with `technicalPlan` set AND `deps: [{ id: 'helper', body: '<helper spec body>' }]`
  Then the judge `applies()` returns true (existing `hasTechnicalPlan` path); the buildPrompt artifact contains the spec body, the technical plan, AND a `## Deps` section listing each dep id followed by its body. Each dep's contribution is bytewise-truncated under the existing 100 KB artifact cap (the cap is shared across spec body + technical plan + deps).
  And given a spec with `depends-on: [helper]` and NO technical-plan, the judge `applies()` returns true via the new `depsCount > 0` path; buildPrompt artifact contains spec body + `## Deps` section (no `## Technical Plan` heading emitted).
  And given a spec with `depends-on: []` and no technical-plan, the judge `applies()` returns false (no cross-doc context to score).
  Satisfaction:
    - test: packages/spec-review/src/judges/cross-doc-consistency.test.ts "applies returns true when depends-on is non-empty even without technical-plan"
    - test: packages/spec-review/src/judges/cross-doc-consistency.test.ts "buildPrompt artifact includes Deps section when deps are provided"
    - test: packages/spec-review/src/judges/cross-doc-consistency.test.ts "buildPrompt artifact respects 100 KB cap when deps push total over limit"

## Constraints / Decisions

- **Schema field name:** `'depends-on'` (kebab-case, matches existing frontmatter idiom: lowercase keys, dashes for word separation). NOT `dependsOn` (camelCase) — frontmatter is YAML, not JS object syntax. Accessed in TypeScript as `spec.frontmatter['depends-on']` (bracket-notation).
- **Schema type:** `z.array(z.string()).default([])`. Optional input; default empty array. Each entry is `z.string()` at the schema level — id-format validation lives in `lintSpec`, not in the Zod schema, so programmatic callers can construct frontmatter objects with any string entries (they fail lint, not parse).
- **Canonical id pattern (NEW constant):** `KEBAB_ID_REGEX = /^[a-z][a-z0-9-]*$/`. Exported as `KEBAB_ID_REGEX` from `packages/core/src/schema.ts` for consumers (the lint module and the runtime sequence-runner from spec 3). Adds **one new public export** to `@wifo/factory-core/src/index.ts`. Public API surface count goes from v0.0.6's 27 → 28 names.
- **`SpecFrontmatter.id` is NOT retroactively tightened** to match `KEBAB_ID_REGEX`. Existing specs (and existing third-party specs) may not match. v0.0.7 documents the pattern as the canonical convention but enforces it ONLY for `depends-on` entries. A future v0.0.8+ may add an `id-format` lint warning for existing-spec ids.
- **`LintOptions` gains an optional `cwd?: string` field.** When provided, `lintSpec` walks `<cwd>/docs/specs/` and `<cwd>/docs/specs/done/` to validate each `depends-on` entry resolves to a file. When absent, file-existence checks are skipped (id-format checks always run). Used by the CLI; programmatic callers can opt out.
- **New helper export:** `lintSpecFile(filePath: string, opts?: LintOptions): LintError[]` — wraps `readFileSync` + `lintSpec` with `cwd` defaulted to the spec's parent's parent (i.e., `<file>/../..` so `docs/specs/foo.md` resolves cwd to the project root). Adds **one more new public export** (28 → 29 names). The CLI uses this; existing callers can keep using `lintSpec` directly.
- **Lint error codes:**
  - `spec/invalid-depends-on` (severity: error) — entry doesn't match `KEBAB_ID_REGEX`. Emitted from `lintSpec`.
  - `spec/depends-on-missing` (severity: warning) — entry doesn't resolve to a file under `<cwd>/docs/specs/` or `<cwd>/docs/specs/done/`. Emitted only when `LintOptions.cwd` is set.
  - Both follow the existing lint error format (`file:line  severity  code  message`); `line` is the frontmatter's start line (same as other frontmatter errors).
- **Backward-compat:** `frontmatter/unknown-field` warning (already in lint.ts at line 91) does NOT fire for `depends-on` — it's now a known field. Pre-v0.0.7 schema's `.strict()` mode rejects unknown keys, so `depends-on` MUST be added to the schema (not just to the lint module) to avoid `frontmatter/unknown-field` warnings on existing specs that use it.
- **`cross-doc-consistency` judge changes:**
  - `JudgeApplicabilityCtx` gains `depsCount: number` (count of resolved deps loaded by the caller). Existing callers passing only `hasTechnicalPlan` + `hasDod` continue to work — `depsCount` defaults to `0`.
  - `applies(spec, ctx)` becomes `ctx.hasTechnicalPlan || ctx.depsCount > 0` (was `ctx.hasTechnicalPlan`).
  - `JudgePromptCtx` gains `deps?: ReadonlyArray<{ id: string; body: string }>`. Existing callers passing only `technicalPlan` continue to work.
  - `buildPrompt`: artifact composition becomes `## Spec\n${body}\n\n## Technical Plan\n${plan ?? '(none)'}\n\n## Deps\n${depsBody}`. The `## Technical Plan` heading is only emitted when `technicalPlan` is non-empty; the `## Deps` heading is only emitted when `deps` is non-empty.
  - `capBytes` truncation: the existing 100 KB cap applies to the combined artifact (spec + plan + deps). Truncation marker unchanged.
- **`runReview` changes (`packages/spec-review/src/review.ts`):**
  - `RunReviewOptions` gains `deps?: ReadonlyArray<{ id: string; body: string }>`.
  - `JudgeApplicabilityCtx`'s `depsCount` is set from `opts.deps?.length ?? 0`.
  - `JudgePromptCtx` threads `deps` through to `buildPrompt`.
- **`factory spec review` CLI loads deps from disk:**
  - When the spec being reviewed has non-empty `depends-on`, the CLI reads each dep id by walking `<cwd>/docs/specs/<id>.md` then `<cwd>/docs/specs/done/<id>.md`. Found → push `{ id, body }` to `deps[]`. Missing → emit `review/dep-not-found` warning (parallel to the lint warning) and skip that entry.
  - The CLI's behavior matches the lint behavior: missing-dep is a warning, not an error.
- **`ruleSetHash` invariant:** the `cross-doc-consistency` judge's CRITERION text is unchanged in v0.0.7. The ruleSetHash therefore stays equal to v0.0.6's hash (cache entries from v0.0.6 remain valid for unchanged specs). If CRITERION changes in a future version, the hash flips and the cache invalidates correctly.
- **Public API surface deltas (locked):**
  - `@wifo/factory-core/src/index.ts`: 27 → **29** names. Two new exports: `KEBAB_ID_REGEX` (constant) and `lintSpecFile` (function). All other names unchanged.
  - `@wifo/factory-spec-review/src/index.ts`: unchanged (10 names). The `JudgeApplicabilityCtx` and `JudgePromptCtx` field additions are field-level on already-exported types; `RunReviewOptions.deps` is field-level on an already-exported type.
  - `@wifo/factory-context/src/index.ts`, `@wifo/factory-harness/src/index.ts`, `@wifo/factory-runtime/src/index.ts`, `@wifo/factory-twin/src/index.ts`: unchanged.
- **Coordinated package version bumps:** all six `@wifo/factory-*` packages bump to `0.0.7` (lockstep, matches v0.0.5 / v0.0.6 pattern). Even packages untouched by this spec bump alongside the v0.0.7 cluster's other specs.
- **Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere.**
- **v0.0.7 explicitly does NOT ship:** retroactive id-format tightening on `SpecFrontmatter.id`; transitive depends-on resolution (a dep's deps are not auto-loaded by the reviewer); diamond / cycle detection in the lint module (the runtime sequence-runner from spec 3 owns DAG validation); a `--strict-deps` lint flag that escalates `spec/depends-on-missing` to error.

## Subtasks

- **T1** [feature] — `packages/core/src/schema.ts`: add the `'depends-on'` field to `SpecFrontmatterSchema` (`z.array(z.string()).default([])`). Export `KEBAB_ID_REGEX = /^[a-z][a-z0-9-]*$/` constant. Re-export from `packages/core/src/index.ts`. ~10 LOC. **depends on nothing.**
- **T2** [feature] — `packages/core/src/lint.ts`: add depends-on validation. (a) After the SpecFrontmatterSchema parse step, iterate `parsed.data['depends-on']` and emit `spec/invalid-depends-on` for any entry that fails `KEBAB_ID_REGEX.test(entry)`. (b) Add `cwd?: string` to `LintOptions`; when set, walk `<cwd>/docs/specs/<entry>.md` then `<cwd>/docs/specs/done/<entry>.md` (using `existsSync`); emit `spec/depends-on-missing` warning for any entry that doesn't resolve. (c) Add a new exported helper `lintSpecFile(filePath, opts?)` that wraps `readFileSync` + `lintSpec({...opts, cwd: opts?.cwd ?? path.resolve(filePath, '..', '..', '..')})` and re-exports from `packages/core/src/index.ts`. ~80 LOC. **depends on T1.**
- **T3** [test] — `packages/core/src/schema.test.ts`: 3 tests covering S-1. `packages/core/src/parser.test.ts`: 1 test asserting `parseSpec` exposes `depends-on` on frontmatter. `packages/core/src/lint.test.ts`: tests covering S-2 (id-format, both bad-cases and good-cases) and S-3 (file-existence with mkdtempSync fixtures: a parent spec referencing a dep under `docs/specs/done/`, a parent referencing a missing dep, a parent linted without `cwd`). ~150 LOC across all three test files. **depends on T1, T2.**
- **T4** [feature] — `packages/spec-review/src/judges/cross-doc-consistency.ts`: extend `applies()` to `ctx.hasTechnicalPlan || ctx.depsCount > 0`; extend `buildPrompt` to read `ctx.deps?: ReadonlyArray<{id, body}>` and append a `## Deps` section. The artifact composition becomes `${specSection}${planSection}${depsSection}` where each section is conditionally emitted. ~40 LOC. **depends on nothing (no schema dep — types come from `@wifo/factory-core`).**
- **T5** [feature] — `packages/spec-review/src/judges/index.ts`: extend `JudgeApplicabilityCtx` with `depsCount: number` (default 0 if absent for backward-compat callers); extend `JudgePromptCtx` with optional `deps?: ReadonlyArray<{id, body}>`. `packages/spec-review/src/review.ts`: extend `RunReviewOptions` with `deps?: ReadonlyArray<{id, body}>`; thread `deps` into `JudgeApplicabilityCtx.depsCount` and `JudgePromptCtx.deps`. ~30 LOC. **depends on T4.**
- **T6** [feature] — `packages/spec-review/src/cli.ts`: when reviewing a spec with non-empty `depends-on`, walk `<cwd>/docs/specs/<id>.md` then `<cwd>/docs/specs/done/<id>.md` to load each dep's source; push `{ id, body }` to `deps[]` and pass to `runReview`. Missing dep → emit `review/dep-not-found` warning to stdout (parallel to the lint warning) and skip. ~40 LOC. **depends on T5.**
- **T7** [test] — `packages/spec-review/src/judges/cross-doc-consistency.test.ts`: tests covering S-4 (applies behavior under all combinations of hasTechnicalPlan + depsCount; buildPrompt artifact composition with various deps; 100 KB cap respected with overflow deps). `packages/spec-review/src/review.test.ts`: 1 test asserting `runReview` threads `deps` through to the judge. `packages/spec-review/src/cli.test.ts`: 2 tests asserting CLI loads deps from disk + emits `review/dep-not-found` for missing deps. ~150 LOC across the three test files. **depends on T4, T5, T6.**
- **T8** [chore] — Update `packages/core/README.md` documenting the `depends-on` field with one example. Update `packages/spec-review/README.md` documenting the cross-doc judge's deps-aware behavior. Update top-level `README.md` v0.0.7 release notes. Bump all six `@wifo/factory-*` package.json versions to `0.0.7`. ~80 LOC. **depends on T1..T7.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/core typecheck`, `pnpm -C packages/spec-review typecheck` clean.
- `pnpm -C packages/core test`, `pnpm -C packages/spec-review test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.7 cluster (this spec + the cluster's other two specs).
- Public API surface from `@wifo/factory-core/src/index.ts` is **29 names** (was 27 in v0.0.6; +2 new exports: `KEBAB_ID_REGEX` + `lintSpecFile`). Surface-lock test enforces this.
- Public API surface from `@wifo/factory-spec-review/src/index.ts` is strictly equal to v0.0.6's 10 names (zero new exports — field-level additions only).
- Public API surface from `@wifo/factory-context/src/index.ts`, `@wifo/factory-harness/src/index.ts`, `@wifo/factory-twin/src/index.ts` is strictly equal to v0.0.6.
- All six package.json files at `0.0.7`.
- README in `packages/core/` documents the `depends-on` field with an example; `packages/spec-review/README.md` documents the cross-doc judge's deps-aware behavior; top-level `README.md` v0.0.7 release notes mention `depends-on`.
- v0.0.7 explicitly does NOT ship: retroactive id-format tightening on `SpecFrontmatter.id`; transitive depends-on resolution; diamond / cycle detection in lint; `--strict-deps` lint flag. Deferred per Constraints.

---
id: factory-core-v0-0-8-1
classification: light
type: chore
status: drafting
exemplars:
  - path: packages/core/src/init-templates.ts
    why: "README_TEMPLATE constant — multi-line template literal that becomes the scaffolded project's README.md. v0.0.8-1 adds a 'Multi-spec products' section to it. Mirrors the v0.0.5.1 GITIGNORE_TEMPLATE pattern (in-place addition to an existing template constant)."
  - path: packages/core/src/init-templates.test.ts
    why: "Tests assert specific substrings appear in the rendered templates (e.g., '@wifo/factory-spec-review' in PACKAGE_JSON_TEMPLATE). v0.0.8-1 adds 1-2 tests asserting the new README section's content."
  - path: docs/specs/done/factory-runtime-v0-0-5.md
    why: "Reference shape for a LIGHT chore spec coordinating doc updates + version bumps. v0.0.7 + v0.0.8-1 both share this pattern: small content addition + the 6-package lockstep version bump in the chore subtask."
depends-on:
  - factory-core-v0-0-8
---

# factory-core-v0-0-8-1 — scaffold README documents `/scope-project` + `run-sequence`; coordinated v0.0.8 version bump

## Intent

Update `init-templates.ts`'s `README_TEMPLATE` to add a "Multi-spec products" section that documents the canonical v0.0.7+ flow: `/scope-project <description>` → `factory spec lint docs/specs/` → `factory-runtime run-sequence docs/specs/`. The section explicitly mentions that `factory init` (per spec `factory-core-v0-0-8`) auto-installs the `/scope-project` slash command into `.claude/commands/`, so a fresh-repo agent reading the scaffold's README has all the signal it needs to use the new flow.

This is the closing spec of the v0.0.8 cluster. Its chore subtask coordinates the lockstep version bump across all six `@wifo/factory-*` packages from `0.0.7` to `0.0.8`, bumps `init-templates.ts`'s scaffold deps from `^0.0.7` to `^0.0.8`, and updates the version assertions in `init.test.ts`, `init-templates.test.ts`, and `publish-meta.test.ts`.

## Scenarios

**S-1** — Scaffolded README contains a "Multi-spec products" section that names `/scope-project` + `run-sequence` and the `factory init` auto-install
  Given a fresh `factory init --name test-foo` invocation
  When `<cwd>/README.md` is read
  Then it contains a section heading `## Multi-spec products` (or equivalent — the exact heading text is locked in Constraints below); the section contains the literal `/scope-project` (with the leading slash); contains the literal `factory-runtime run-sequence`; contains a sentence noting that `factory init` writes `.claude/commands/scope-project.md` automatically (so the maintainer does not need to copy it manually); contains a one-line example invocation showing the canonical flow end-to-end. The section's prose stays under ~30 lines (concise, scannable, NOT a tutorial).
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "README_TEMPLATE includes Multi-spec products section"
    - test: packages/core/src/init-templates.test.ts "README_TEMPLATE Multi-spec section names /scope-project, run-sequence, and the auto-installed slash command"
    - test: packages/core/src/init.test.ts "scaffold README contains Multi-spec products section"

**S-2** — All six `@wifo/factory-*` packages published at version `0.0.8`
  Given the post-implementation `packages/<name>/package.json` for every workspace package
  When their `version` fields are read
  Then every one is `"0.0.8"` (lockstep — context, core, harness, runtime, spec-review, twin all match). `init-templates.ts`'s `PACKAGE_JSON_TEMPLATE.dependencies` references `^0.0.8` for every `@wifo/factory-*` dep. `publish-meta.test.ts`'s version assertion is updated to `/^0\.0\.8$/`. `init.test.ts` and `init-templates.test.ts` version-string assertions are updated to `^0.0.8`.
  Satisfaction:
    - test: packages/core/src/publish-meta.test.ts "every workspace package has v0.0.8 + publishConfig + npm metadata fields"
    - test: packages/core/src/init.test.ts "scaffold dependencies pin @wifo/factory-* at ^0.0.8"
    - test: packages/core/src/init-templates.test.ts "PACKAGE_JSON_TEMPLATE pins @wifo/factory-* deps at ^0.0.8"

**S-3** — Scaffold's `factory init` output is self-contained for the v0.0.7+ flow
  Given a fresh `factory init --name foo` invocation against the v0.0.8 toolchain
  When the scaffold completes
  Then `<cwd>/.claude/commands/scope-project.md` exists (from spec 2 `factory-core-v0-0-8`); `<cwd>/README.md` documents the flow that uses it; `<cwd>/factory.config.json` provides defaults (from v0.0.5.1); `<cwd>/package.json`'s deps are at `^0.0.8`. A maintainer reading just `<cwd>/README.md` can run `/scope-project <description>` → `factory-runtime run-sequence docs/specs/` without referring to any external docs. **The scaffold is the documentation.**
  Satisfaction:
    - test: packages/core/src/init.test.ts "scaffold is self-contained: README + slash command + config + deps all at v0.0.8"

## Constraints / Decisions

- **Section heading (locked):** `## Multi-spec products`. Reasoning: the existing scaffold README already has `## What you get`, `## Workflow`, `## Where to read more` — `## Multi-spec products` slots in alongside `## Workflow` as a parallel-shape section.
- **Section content (locked outline; exact prose flexible during implementation):**
  - One-sentence intro: real products are sequences of 4-6 specs in dependency order; `/scope-project` decomposes a product description, `run-sequence` walks the resulting DAG.
  - Code block showing the canonical flow:
    ```sh
    # Decompose a product description into 4-6 ordered specs:
    /scope-project A URL shortener with click tracking. JSON-over-HTTP, in-memory.

    # Lint + review the first spec:
    pnpm exec factory spec lint docs/specs/
    pnpm exec factory spec review docs/specs/<first-id>.md

    # Walk the dependency DAG:
    pnpm exec factory-runtime run-sequence docs/specs/ --no-judge
    ```
  - One-sentence note: `factory init` writes `.claude/commands/scope-project.md` automatically — the slash command is available in any Claude Code session opened in this project, with no user-level install required.
  - One-sentence pointer: for per-spec workflow (a single feature, not a product), use `/scope-task` (which lives in the user's `~/.claude/commands/` and applies to all projects).
- **Section length cap:** ~30 lines of markdown including the code block. The scaffold README is meant to be skimmed, not a tutorial.
- **`README_TEMPLATE` placement:** the new section is inserted AFTER `## Workflow` and BEFORE `## Where to read more` (or whatever the current trailing-pointer section is named). Order discipline: `## What you get` → `## Workflow` → `## Multi-spec products` (NEW) → `## Where to read more`.
- **No backwards-compat edits to existing README sections** — every existing section's content is preserved verbatim. Only the new section is added.
- **Coordinated package version bump:** all six `@wifo/factory-*` packages bump from `0.0.7` to `0.0.8` in lockstep (matches the v0.0.5 / v0.0.6 / v0.0.7 publish-coordination pattern).
  - `packages/{context,core,harness,runtime,spec-review,twin}/package.json` version field: `0.0.7` → `0.0.8`.
  - `packages/core/src/init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies`: every `@wifo/factory-*` dep `^0.0.7` → `^0.0.8`.
  - `packages/core/src/init-templates.test.ts` version assertions: `^0.0.7` → `^0.0.8`.
  - `packages/core/src/init.test.ts` version assertions: `^0.0.7` → `^0.0.8`.
  - `packages/core/src/publish-meta.test.ts` version regex: `/^0\.0\.7$/` → `/^0\.0\.8$/`.
- **Public API surface from every `@wifo/factory-*` package strictly equal to v0.0.7's surface** (zero new exports — all changes are field-level on existing constants/templates + version metadata).
- **CHANGELOG.md update:** add a v0.0.8 entry summarizing the discoverability cluster (this spec + spec 2 + spec 1's baseline reset). Mirror the v0.0.7 entry's shape (Added / Changed / Public API / Test surface / Reconciliations).
- **ROADMAP.md update:** mark v0.0.8 shipped; bump the "v0.0.9+ — future" section's leading candidate(s).
- **README.md (top-level) update:** v0.0.8 banner + flow diagram updated to mention the auto-installed slash command.
- **v0.0.8-1 explicitly does NOT ship:** retroactive README backports for projects scaffolded before v0.0.8 (those users re-run `factory init` or copy the new section by hand); a `factory init --upgrade` flag (separate v0.0.9+ candidate); changes to existing scaffold sections (only addition).

## Subtasks

- **T1** [feature] — Update `packages/core/src/init-templates.ts`'s `README_TEMPLATE` to add the `## Multi-spec products` section per the locked outline. ~30-50 LOC of template content. **depends on nothing.**
- **T2** [test] — `packages/core/src/init-templates.test.ts`: 2 tests asserting the new section's structural elements (heading present, key strings present). `packages/core/src/init.test.ts`: 1-2 tests asserting the rendered scaffold README contains the new section + the self-contained-scaffold check. ~50 LOC. **depends on T1.**
- **T3** [chore] — Bump version field in all six `packages/<name>/package.json` files from `0.0.7` to `0.0.8`. Bump `init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies` from `^0.0.7` to `^0.0.8` for all four `@wifo/factory-*` deps. ~10 LOC. **depends on nothing (parallel with T1).**
- **T4** [test] — Update `packages/core/src/publish-meta.test.ts` version regex (`^0\.0\.7$` → `^0\.0\.8$`); update `packages/core/src/init.test.ts` and `packages/core/src/init-templates.test.ts` version-string assertions (`^0.0.7` → `^0.0.8`). ~10 LOC. **depends on T3.**
- **T5** [chore] — Update `CHANGELOG.md` with v0.0.8 entry (Added: scaffold drops slash command + scaffold README documents it + baseline reset; Changed: lockstep bump; Public API: unchanged; Reconciliations: discoverability gap closed). Update `ROADMAP.md` (mark v0.0.8 shipped; promote v0.0.9+ candidates). Update top-level `README.md` v0.0.8 banner. Update `packages/core/README.md` to remove the now-stale "manual cp snippet" framing if any (already partially handled in spec 2's T6 — coordinate). ~80-120 LOC. **depends on T1, T3, T4.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.8 cluster.
- `pnpm -C packages/core build` produces a working `dist/cli.js`.
- `pnpm pack --dry-run` against every `packages/<name>/` produces clean tarballs at version `0.0.8`.
- A fresh `factory init --name test-foo` produces a project where: `.claude/commands/scope-project.md` exists (per spec 2); `README.md` contains the `## Multi-spec products` section naming `/scope-project` + `run-sequence`; `package.json` deps are at `^0.0.8`; `factory.config.json` defaults are present (per v0.0.5.1).
- All six `@wifo/factory-*` `package.json` files at `0.0.8`.
- `CHANGELOG.md`, `ROADMAP.md`, top-level `README.md`, `packages/core/README.md` all reflect v0.0.8 ship state.
- Public API surface from every `@wifo/factory-*` package strictly equal to v0.0.7's surface (zero new exports).
- v0.0.8-1 explicitly does NOT ship: retroactive README backports; `factory init --upgrade`; changes to existing scaffold sections beyond addition. Deferred per Constraints.

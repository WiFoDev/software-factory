---
id: factory-core-v0-0-9-1
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/core/src/init-templates.ts
    why: "PACKAGE_JSON_TEMPLATE — the scaffold's package.json. Today its `scripts` field is `{}` (empty). v0.0.9 adds `typecheck`, `test`, `check`, `build` matching the monorepo's conventions so a fresh `factory init` project can actually run the gates its DoD claims."
  - path: package.json
    why: "Top-level monorepo package.json — reference for the canonical `scripts` shape. The scaffold's scripts mirror these exactly so a maintainer reading the generated project gets the same commands they'd find in any factory-* package."
  - path: docs/specs/done/factory-core-v0-0-5-1.md
    why: "Reference shape for a LIGHT feat spec adding fields to PACKAGE_JSON_TEMPLATE / GITIGNORE_TEMPLATE. v0.0.5.1 added factory.config.json + spec-review devDep; v0.0.9 adds scripts. Same pattern: in-place addition to an existing template constant + matching tests."
depends-on: []
---

# factory-core-v0-0-9-1 — scaffold ships `scripts: { typecheck, test, check, build }` matching DoD claims

## Intent

Close the v0.0.8 BASELINE finding that `factory init`'s scaffold ships `package.json` with `scripts: {}` (empty), even though every spec template's default DoD claims "typecheck + lint + tests green." Today only `bun test src` works in a fresh scaffold; `pnpm typecheck`, `pnpm check`, and `pnpm build` are aspirational. This spec adds the four canonical scripts to `PACKAGE_JSON_TEMPLATE` matching the monorepo's own conventions, so a fresh `factory init` project's DoD claims are immediately runnable.

Pairs with the v0.1.0+ DoD-verifier work (which would automate running these gates) — this spec ships the commands; the runtime-side enforcement comes later.

## Scenarios

**S-1** — Scaffolded `package.json` has the four canonical scripts pinned exactly
  Given a fresh `factory init --name test-foo` invocation
  When `<cwd>/package.json`'s `scripts` field is read
  Then it contains exactly: `typecheck: "tsc --noEmit"`, `test: "bun test src"`, `check: "biome check"`, `build: "tsc -p tsconfig.build.json"`. The `scripts` object has these four keys + no others (no `start`, no `dev`, no `lint` — keep the floor minimal). Ordering of keys is `typecheck` → `test` → `check` → `build` (matches the natural CI sequence).
  Satisfaction:
    - test: packages/core/src/init.test.ts "scaffold package.json includes typecheck/test/check/build scripts"
    - test: packages/core/src/init-templates.test.ts "PACKAGE_JSON_TEMPLATE.scripts has the four canonical entries"

**S-2** — `pnpm exec` against each scaffolded script resolves a real binary
  Given a fresh `factory init --name test-foo` followed by `pnpm install` (against npm)
  When `pnpm exec tsc --version`, `pnpm exec biome --version`, `pnpm exec bun --version` are invoked from the scaffold root
  Then each command prints a version string and exits 0 (tsc + biome resolve via the scaffolded devDependencies; bun is a peer requirement of the scaffold's harness usage and is assumed installed). For `pnpm exec tsc --noEmit` (the `typecheck` script's body) to work, the scaffold's `devDependencies` MUST include `typescript` (already present since v0.0.6.x) and `@biomejs/biome` (NEW in v0.0.9 — added to PACKAGE_JSON_TEMPLATE.devDependencies).
  And given `pnpm typecheck` is invoked, it runs `tsc --noEmit` and exits 0 against the empty `src/` directory (no .ts files → tsc is a no-op).
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "PACKAGE_JSON_TEMPLATE.devDependencies includes @biomejs/biome at the canonical version range"
    - test: packages/core/src/init.test.ts "scaffolded package.json devDependencies include typescript + @biomejs/biome"

**S-3** — Scaffold ships a minimal `biome.json` so `pnpm check` doesn't fail on missing config
  Given a fresh `factory init` invocation
  When `<cwd>/biome.json` is read
  Then it exists; its content is JSON-parseable; it contains a minimal config: `$schema` pointing at biome's published schema, `linter.enabled: true`, `formatter.enabled: true`, plus an `include` glob covering `src/**/*.ts`. Mirrors the monorepo's own `biome.json` shape (without project-specific overrides).
  Satisfaction:
    - test: packages/core/src/init.test.ts "scaffold writes biome.json with minimal valid config"
    - test: packages/core/src/init-templates.test.ts "BIOME_CONFIG_TEMPLATE has the minimal canonical shape"

## Constraints / Decisions

- **Script set (locked, exact text):**
  - `typecheck: "tsc --noEmit"` — pure TS check, no emit.
  - `test: "bun test src"` — runs Bun's test runner against the `src/` directory only (matches the harness's existing convention; isolates from `dist/` after a build).
  - `check: "biome check"` — biome lint+format check (recovers `pnpm check` as a single command for both axes; matches monorepo conventions).
  - `build: "tsc -p tsconfig.build.json"` — uses the `tsconfig.build.json` already shipped by `factory init` since v0.0.4.
- **NO `lint` script.** The factory's convention is `pnpm check` (biome) — adding a separate `lint` would duplicate. The spec template's existing DoD wording ("typecheck + lint + tests green") is interpreted as `typecheck + check + test`; an editorial pass on the spec template (in a future point release, NOT this spec) may rename "lint" → "check" for precision.
- **NO `start` / `dev` scripts.** The factory is project-agnostic; user code dictates how it starts. Adding speculative scripts would force opinions.
- **`@biomejs/biome` is added to `PACKAGE_JSON_TEMPLATE.devDependencies`** at version `^2.4.4` (matches the monorepo's lockfile-pinned version). Already-pinned `typescript: ^5.6.0` from v0.0.6.x is preserved.
- **New `BIOME_CONFIG_TEMPLATE` constant in `init-templates.ts`** — JSON-serialized with 2-space indent. Shape (locked):
  ```json
  {
    "$schema": "https://biomejs.dev/schemas/2.4.4/schema.json",
    "linter": { "enabled": true, "rules": { "recommended": true } },
    "formatter": { "enabled": true, "indentWidth": 2, "lineWidth": 100 },
    "files": { "include": ["src/**/*.ts", "src/**/*.tsx"] }
  }
  ```
  Mirrors the monorepo's `biome.json` keys but uses minimal defaults appropriate for a fresh project.
- **`planFiles` in `init.ts`** adds an entry: `{ relPath: 'biome.json', contents: BIOME_CONFIG_TEMPLATE }`. Order: after `factory.config.json`, before `.claude/commands/scope-project.md`.
- **Existing scaffold tests update:** `init.test.ts`'s assertions about generated files extend to include `biome.json` + the new scripts. The existing assertion that the scaffold's `package.json` parses cleanly is unchanged.
- **No changes to `tsconfig.json` or `tsconfig.build.json`** — those already ship since v0.0.4 and the new scripts reference them as-is.
- **Spec template's default DoD wording** (in `docs/SPEC_TEMPLATE.md` and the slash command sources) is NOT touched in this spec. The phrase "typecheck + lint + tests green" stays — its meaning becomes accurate (because `pnpm check` now exists), even if the word `lint` is informal. Renaming the wording is a future cleanup pass.
- **Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.8's surface (29 names).** `BIOME_CONFIG_TEMPLATE` is internal-only (NOT exported from `index.ts`) — mirrors `FACTORY_CONFIG_TEMPLATE` and `README_TEMPLATE`'s pattern.
- **Coordinated package version bump deferred to spec 4** (`factory-spec-review-v0-0-9`'s chore subtask).
- **v0.0.9 explicitly does NOT ship in this spec:** automatic running of the scripts during `factory init` (no `pnpm typecheck` post-install); per-project script overrides via `factory.config.json`; renaming the spec template's DoD wording.

## Subtasks

- **T1** [feature] — Update `packages/core/src/init-templates.ts`: add `scripts` field to `PACKAGE_JSON_TEMPLATE` with the four locked entries; add `@biomejs/biome: ^2.4.4` to `PACKAGE_JSON_TEMPLATE.devDependencies`; add `BIOME_CONFIG_TEMPLATE` constant. ~25 LOC. **depends on nothing.**
- **T2** [feature] — Update `packages/core/src/init.ts`'s `planFiles` to add `{ relPath: 'biome.json', contents: BIOME_CONFIG_TEMPLATE }` entry. ~5 LOC. **depends on T1.**
- **T3** [test] — `packages/core/src/init-templates.test.ts`: 2 tests asserting the new scripts + biome dep. `packages/core/src/init.test.ts`: 2 tests asserting the scaffold's package.json scripts + the biome.json file. ~50 LOC. **depends on T1, T2.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.9 cluster.
- A fresh `factory init --name test-foo` (in a tmp dir) produces a project where `pnpm install && pnpm typecheck` exits 0 against an empty `src/` directory (verifying the scripts and devDeps resolve correctly).
- Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.8's 29 names.
- v0.0.9 explicitly does NOT ship in this spec: automated post-install gate runs; per-project script overrides; DoD wording rename. Deferred per Constraints.

---
id: factory-core-v0-0-4
classification: light
type: feat
status: ready
exemplars:
  - path: packages/core/src/cli.ts
    why: "Manual subcommand dispatch + `parseArgs(strict: true)` + injectable `CliIo`. `factory init` is a NEW top-level domain (sibling of `spec`, not under it) — adds an `if (domain === 'init') return runInit(rest, io);` branch above the `spec` branch, plus a `runInit` function with its own parseArgs block."
  - path: examples/slugify/package.json
    why: "Canonical scaffold's package.json — `factory init` emits a workspace-stripped variant: same shape, but deps use semver (`^0.0.4`) instead of `workspace:*` and the name comes from `--name` flag or basename(cwd)."
  - path: examples/slugify/tsconfig.json
    why: "The example's tsconfig `extends: ../../tsconfig.json` only works inside this monorepo. `factory init`'s scaffold tsconfig is SELF-CONTAINED — inlines the strict + ES2022 + verbatimModuleSyntax + noUncheckedIndexedAccess + types:[bun] settings the examples rely on."
  - path: examples/slugify/.gitignore
    why: "Verbatim copy: `node_modules`, `.factory`, `*.log`, `.DS_Store`."
  - path: examples/slugify/README.md
    why: "The 7-step loop walkthrough that the scaffolded README mirrors (setup → /scope-task → factory spec lint → factory-runtime run → implement → run again → factory-context tree → /finish-task)."
  - path: docs/specs/done/factory-core-v0-0-1.md
    why: "Original `@wifo/factory-core` spec. v0.0.4 adds an `init` subcommand without changing v0.0.1's public surface (still 27 names from `src/index.ts`)."
---

# factory-core-v0-0-4 — `factory init`: zero-to-first-iteration scaffold for a new repo in under 5 minutes

## Intent

Close the bootstrap gap. Today, "use the factory in a new repo" requires copying configs from `examples/slugify`, manually creating `docs/specs/` directories, and editing `workspace:*` deps to npm semver. ~20-30 minutes of yak shaving per project. v0.0.4 ships `factory init` — a new top-level CLI subcommand on `@wifo/factory-core` that drops a minimal, self-contained TypeScript scaffold into the cwd: `package.json` (npm-semver deps), self-contained `tsconfig.json`, `.gitignore`, `README.md`, and the `docs/specs/done/`, `docs/technical-plans/done/`, `src/` directories with `.gitkeep`s. Idempotent and safe by default — fails fast if any target file already exists; no `--force`, no silent overwrites. Public API surface of `@wifo/factory-core` stays at 27 names (the new subcommand is internal-only). Documented constraint: scaffolded repos run against the v0.0.4 packages once they're published to npm — until then (v0.0.5 deliverable), `factory init` produces a scaffold that's monorepo-only.

## Scenarios

**S-1** — `factory init` in an empty cwd creates the canonical scaffold + prints next-steps checklist
  Given a fresh empty directory `<tmp>` and `factory init` invoked from `<tmp>` (no flags)
  When the command runs to completion
  Then `<tmp>` contains exactly: `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, `src/.gitkeep`, `docs/specs/done/.gitkeep`, `docs/technical-plans/done/.gitkeep`. Exit code `0`. Stdout includes a "Next steps:" checklist with at least: `pnpm install`, `pnpm exec factory spec lint docs/specs/`, `# write your first spec under docs/specs/`. The `package.json` `name` field equals `basename(<tmp>)`. The `package.json` `dependencies` block uses npm semver (`"@wifo/factory-core": "^0.0.4"`, `"@wifo/factory-runtime": "^0.0.4"`, `"@wifo/factory-context": "^0.0.4"`) — NOT `workspace:*`. The `tsconfig.json` is self-contained (does NOT contain `"extends": "../../tsconfig.json"`); inlines `strict: true`, `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`, `types: ["bun"]`, `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "Bundler"`. The `.gitignore` matches `examples/slugify/.gitignore` byte-for-byte (`node_modules`, `.factory`, `*.log`, `.DS_Store`).
  Satisfaction:
    - test: `src/init.test.ts` "init in empty dir: scaffold structure correct + package.json semver deps + tsconfig self-contained"
    - test: `src/cli.test.ts` "factory init in empty dir → exit 0 + stdout next-steps checklist"
    - judge: "the next-steps checklist reads naturally — a developer who has never used the factory before knows the next 3 commands to run without consulting the README"

**S-2** — `factory init --name my-thing` overrides the package name; everything else identical to S-1
  Given a fresh `<tmp>` and `factory init --name my-thing` invoked from `<tmp>`
  When the command runs
  Then `<tmp>/package.json`'s `name` field equals `"my-thing"` (not `basename(<tmp>)`); every other file is byte-identical to S-1's output. Exit code `0`.
  And given `factory init --name "Bad Name With Spaces"`, exit code `2` with stderr label `init/invalid-name: --name must match /^[a-z0-9][a-z0-9-_]*$/ (got 'Bad Name With Spaces')`. (npm package name validation pattern.)
  Satisfaction:
    - test: `src/init.test.ts` "--name overrides package.json name; default is basename(cwd)"
    - test: `src/cli.test.ts` "--name with invalid chars → exit 2 with stderr label init/invalid-name"

**S-3** — `factory init` in a non-empty cwd fails fast (no `--force`, no silent overwrites)
  Given a `<tmp>` containing a single existing file (`package.json` only — anything else absent), `factory init` invoked from `<tmp>`
  When the command runs
  Then exit code `2`; stderr contains `init/path-exists: refusing to write — these targets already exist:` followed by `  package.json` on its own line; the `<tmp>` directory is unchanged (no new files created — verify by listing `<tmp>` before and after; the listing is identical).
  And given `<tmp>` containing only `docs/specs/done/.gitkeep`, exit code `2`; stderr lists `  docs/specs/done/.gitkeep` (the existing path is enumerated; no new files written).
  And given a fully-populated `<tmp>` (every target already present), exit code `2`; stderr lists ALL existing targets (each on its own line); cwd unchanged.
  And given a `<tmp>` with a directory `src/` (empty, no `.gitkeep`), exit code `2`; stderr includes `  src/` (the `init` check considers the directory present — the gate is "any target path exists", not just files).
  Satisfaction:
    - test: `src/init.test.ts` "non-empty cwd: any preexisting target → exit 2 + stderr label init/path-exists + zero writes"
    - test: `src/init.test.ts` "preexisting directory at target path → exit 2 (directory existence counts)"

**S-4** — Scaffold contents are byte-equivalent to embedded templates (no template drift)
  Given the embedded template constants in `src/init-templates.ts` (or wherever templates live) and a fresh `factory init` run in `<tmp>`
  When the scaffold is generated
  Then `<tmp>/package.json` parses to JSON equal to the template object with `name` substituted; `<tmp>/tsconfig.json` parses to JSON equal to the template tsconfig (no substitutions); `<tmp>/.gitignore` is exactly the template `.gitignore` string; `<tmp>/README.md` is exactly the template README string with the package name substituted in any `# <name>` heading; `.gitkeep` files are zero bytes.
  Satisfaction:
    - test: `src/init.test.ts` "scaffold byte-equivalence: every generated file matches its template after substitutions"

## Constraints / Decisions

- New subcommand `factory init` is a **top-level domain**, NOT under `spec`. Invocation form: `factory init [--name <pkg-name>]`. CLI dispatch in `packages/core/src/cli.ts:33-52` gains a new `if (domain === 'init') return runInit(rest, io);` branch ABOVE the `domain === 'spec'` branch (alphabetical-ish; init comes first).
- Scaffold contents are **fixed** in v0.0.4 (no `--template` flag yet). Files written:
  - `package.json` — `name` from `--name` or `basename(cwd)`; `version: "0.0.0"`; `private: true`; `type: "module"`; `description: ""`; `scripts: {}`; `dependencies: { "@wifo/factory-context": "^0.0.4", "@wifo/factory-core": "^0.0.4", "@wifo/factory-runtime": "^0.0.4" }`; `devDependencies: { "@types/bun": "^1.1.14" }`.
  - `tsconfig.json` — SELF-CONTAINED (no `extends`); inlines `compilerOptions`: `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `strict: true`, `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`, `types: ["bun"]`. `include: ["src/**/*"]`. `exclude: ["node_modules", ".factory"]`.
  - `.gitignore` — verbatim copy of `examples/slugify/.gitignore`: `node_modules\n.factory\n*.log\n.DS_Store\n`.
  - `README.md` — short walkthrough mirroring `examples/slugify/README.md`'s 7-step loop (setup → /scope-task → factory spec lint → factory-runtime run → implement → run again → factory-context tree → /finish-task). The package name from `--name` or basename appears in the top heading.
  - `src/.gitkeep` — zero bytes.
  - `docs/specs/done/.gitkeep` — zero bytes.
  - `docs/technical-plans/done/.gitkeep` — zero bytes.
- **No `biome.json`** — examples don't ship it; users add their own or inherit from a parent. Avoids opinionated formatter coupling.
- **No `bunfig.toml`** — Bun runs without it; the example confirms.
- **No `factory.config.json`** — does not exist anywhere in the repo today (`find . -name 'factory.config.json'` returns zero). The roadmap mentions it as a deliverable but the shape is undefined; introducing an empty placeholder file silently invites scope-creep. Defer until a real consumer needs a config knob (custom spec dir, custom claude-bin path, etc.).
- **Idempotency = fail-fast**: if **any** target path already exists (file OR directory), `factory init` exits `2` with stderr label `init/path-exists: refusing to write — these targets already exist:` followed by one path per line. No `--force` flag in v0.0.4; no silent overwrites; zero writes on failure (atomic check-then-write — perform all existence checks BEFORE any write).
- `--name <pkg-name>` validation: must match `/^[a-z0-9][a-z0-9-_]*$/` (npm package-name basics). Bad value → exit `2` with stderr label `init/invalid-name: --name must match /^[a-z0-9][a-z0-9-_]*$/ (got '<raw>')`. Stderr label is a string format only, NOT a `RuntimeErrorCode`-style value.
- **Workspace vs published deps**: scaffold always emits npm semver (`^0.0.4`). No monorepo-context detection. Documented constraint: until `@wifo/factory-*` packages are published to npm (a v0.0.5 deliverable), `factory init`-generated scaffolds work only inside this monorepo (where `pnpm-workspace.yaml` resolves the package names locally). Documented in this repo's README and in the scaffolded README's "Setup" section ("Until v0.0.5, `pnpm install` against this scaffold requires the workspace; standalone use requires npm publishing first").
- **Scaffolded README content**: a short markdown file with the package name as the top heading, then a "Setup" section, then a "Workflow" section walking the 7-step loop. ~30 lines total. Embedded as a template constant; the only substitution is the package name.
- Public API surface of `@wifo/factory-core` from `src/index.ts` is **strictly equal** to v0.0.3's 27 names. The new `runInit` function and `INIT_TEMPLATES` constant are internal-only — NOT exported from `index.ts`. v0.0.4's only `core` surface change is `cli.ts` (internal).
- USAGE string in `cli.ts` updates to list `init [--name <pkg-name>]` as a new top-level subcommand alongside `spec lint`, `spec schema`, `spec review`.
- `factory init` exits `0` on success, `2` on bad CLI args / preexisting targets / invalid `--name`. Never exits `1` (no "lint failed" semantics here).
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere.
- v0.0.4 explicitly does **not** ship: `--force` flag, `--template <name>` flag, `factory.config.json` placeholder, npm-publish of any `@wifo/factory-*` package, `biome.json`/`bunfig.toml` in the scaffold, monorepo-context detection. Deferred to v0.0.5+ as appropriate.

## Subtasks

- **T1** [feature] — `packages/core/src/init-templates.ts`: embedded template constants — `PACKAGE_JSON_TEMPLATE` (an object literal that gets `name` substituted at runtime), `TSCONFIG_TEMPLATE` (a JSON object literal), `GITIGNORE_TEMPLATE` (a string), `README_TEMPLATE` (a string with `{{name}}` substitution). Tests in `src/init-templates.test.ts`: each template parses correctly (JSON-valid where applicable); README has exactly one `{{name}}` placeholder; gitignore matches `examples/slugify/.gitignore` byte-for-byte (read the file from disk, compare). **depends on nothing**. ~120 LOC.
- **T2** [feature] — `packages/core/src/init.ts`: exports `runInit(args: string[], io: CliIo): Promise<void>`. Parses `--name` via `parseArgs(strict: true)`. Validates name regex. Computes target paths (relative to cwd). Runs all-paths-exist check via `Bun.file(p).exists()` — collects ALL preexisting paths; if any → emit stderr label + each path on its own line + exit 2. Otherwise: write each file via `Bun.write` (handles parent-directory creation); zero-byte `.gitkeep` files via empty-string write; emit "Next steps:" checklist to stdout; exit 0.
  Tests in `src/init.test.ts`:
  - empty cwd → all 7 paths created (package.json, tsconfig.json, .gitignore, README.md, src/.gitkeep, docs/specs/done/.gitkeep, docs/technical-plans/done/.gitkeep); package.json parses to expected shape with `name = basename(cwd)`; tsconfig.json parses to expected shape; .gitignore byte-equal to template; README contains the package name in its first heading; `.gitkeep` files are zero bytes.
  - `--name my-thing` → package.json name is `"my-thing"`; everything else identical.
  - `--name "Bad Name"` → exit 2 with stderr label `init/invalid-name:`.
  - cwd containing `package.json` (only) → exit 2 with stderr listing exactly `  package.json`; no new files written (count files before and after).
  - cwd containing `src/` directory (empty) → exit 2 with stderr listing `  src/`; no writes.
  - fully-populated cwd → exit 2 with stderr listing all 7 targets.
  - tmp dirs created via `mkdtempSync`, cleaned up in `afterEach`.
  **depends on T1**. ~280 LOC including tests.
- **T3** [feature + chore] — `packages/core/src/cli.ts`: add `if (domain === 'init') return runInit(rest, io);` branch above the `spec` branch in `runCli`. Update `USAGE` constant to list `init [--name <pkg-name>]` (placement: between the program-name line and the `spec` lines). One new test in `src/cli.test.ts`: `runCli(['init'], io)` in a fresh tmp cwd dispatches to `runInit` (mock or use the real path with a `process.chdir` to tmp). One additional test: `runCli([], io)` USAGE output includes `init [--name`.
  README updates: `packages/core/README.md` adds a top-level "Bootstrap a new project" section with a one-line example (`mkdir my-thing && cd my-thing && pnpm exec factory init`) and the workspace-only caveat for v0.0.4. Top-level `README.md` v0.0.4 release notes mention `factory init` alongside the reviewer.
  **depends on T2**. ~120 LOC including README touches.

## Definition of Done

- All scenarios (S-1..S-4) pass (tests green; judge criterion in S-1 met by manual eyeball before tagging).
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green (`bun test`); `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/core build` produces a working `dist/cli.js`.
- **Deterministic CI smoke**: a Bun test that creates a tmp dir, `process.chdir`s to it, calls `runInit([], io)` (or `runInit(['--name', 'demo'], io)`), and asserts the 7 expected files exist with the expected contents. Cleanup in `afterEach`.
- **Manual smoke (release-gated)**: in a fresh tmp dir outside the monorepo, run `pnpm exec factory init --name demo`, then `pnpm install` — confirm pnpm-install fails with a clear "package not found" error for `@wifo/factory-*` (since they're not published yet — this is the documented v0.0.5 gap). Then in a fresh tmp dir INSIDE the monorepo (or with workspace overrides linking to the local packages), `pnpm install` succeeds and `pnpm exec factory spec lint docs/specs/` exits 0 (against the empty docs/specs/done/ dir). Documents the workspace-only caveat with a real reproduction.
- Public API surface from `@wifo/factory-core/src/index.ts` is **strictly equal** to v0.0.3's 27 names. `runInit` and `INIT_TEMPLATES` are internal-only.
- Scaffold byte-equivalence verified per T1's tests (templates parse correctly; .gitignore byte-equal to `examples/slugify/.gitignore`).
- README in `packages/core/` documents `factory init` with the workspace-only caveat for v0.0.4.
- Top-level `README.md` v0.0.4 release notes mention `factory init` (alongside the spec reviewer + tree --direction down).
- v0.0.4 explicitly does **not** ship: `--force`, `--template`, `factory.config.json`, npm publishing, monorepo-context detection. Deferred to v0.0.5+.

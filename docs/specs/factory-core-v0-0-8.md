---
id: factory-core-v0-0-8
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/core/src/init-templates.ts
    why: "PACKAGE_JSON_TEMPLATE + GITIGNORE_TEMPLATE + README_TEMPLATE + FACTORY_CONFIG_TEMPLATE constants. v0.0.8 adds a runtime helper (NOT a constant) `readScopeProjectCommandTemplate()` that reads the bundled markdown via `import.meta.url` + relative path. Mirrors the v0.0.5.1 FACTORY_CONFIG_TEMPLATE pattern but reads from disk instead of inlining a string — keeps single source of truth at packages/core/commands/scope-project.md."
  - path: packages/core/src/init.ts
    why: "planFiles function — v0.0.8 adds an entry for `<cwd>/.claude/commands/scope-project.md` written from the bundled template. Mirrors the v0.0.5.1 factory.config.json addition (one entry in planFiles, content from a template helper)."
  - path: packages/core/package.json
    why: "Existing `files` glob ships dist/ + LICENSE + README.md. v0.0.8 extends with `commands` so the bundled markdown lives in the npm tarball at `<package-root>/commands/scope-project.md`."
  - path: docs/specs/done/factory-core-v0-0-5-1.md
    why: "Reference shape for a LIGHT spec touching init-templates.ts + init.ts + a new template constant + tests. v0.0.8 follows the same pattern but the template is FILE-backed rather than string-inlined."
depends-on: []
---

# factory-core-v0-0-8 — `factory init` bundles `/scope-project` into scaffolded `.claude/commands/`

## Intent

Move the canonical `/scope-project` slash command source from `docs/commands/scope-project.md` to `packages/core/commands/scope-project.md` so it ships in the published npm tarball (via the `files` glob extension). Update the in-repo `.claude/commands/scope-project.md` symlink to point at the new location. Extend `factory init`'s scaffold to write `<cwd>/.claude/commands/scope-project.md` from the bundled source — every fresh `factory init` project picks up the slash command zero-config, closing the discoverability gap surfaced by v0.0.7's BASELINE.

The bundled file is read at install time via `import.meta.url` + relative path resolution; the canonical source remains a single file (no string inlining, no copy-on-build). Public API surface unchanged: zero new exports. Field-level addition to `init-templates.ts`'s template family + one new entry in `planFiles`.

## Scenarios

**S-1** — Canonical slash command source lives at `packages/core/commands/scope-project.md` and the in-repo symlink resolves
  Given a fresh checkout of the software-factory repo
  When `packages/core/commands/scope-project.md` is read
  Then it exists; its content is plain markdown (no frontmatter); contains the literal `Scope the following product description: $ARGUMENTS` (top-line invocation); contains `## Step 1: Decompose`, `## Step 2: Generate specs`, `## Step 3: Self-check`, `## Step 4: Report` headings (preserved verbatim from the v0.0.7 source). The previously-canonical `docs/commands/scope-project.md` does NOT exist (the directory may exist or not — implementation choice). The in-repo `.claude/commands/scope-project.md` symlink resolves to the new location: `readlinkSync('.claude/commands/scope-project.md')` ends with `packages/core/commands/scope-project.md`.
  Satisfaction:
    - test: packages/core/src/scope-project-source.test.ts "canonical slash command source lives at packages/core/commands/scope-project.md"
    - test: packages/core/src/scope-project-source.test.ts "in-repo .claude/commands/scope-project.md symlink resolves to packages/core/commands/"
    - test: packages/core/src/scope-project-source.test.ts "docs/commands/scope-project.md no longer exists"

**S-2** — `packages/core/package.json`'s `files` glob includes `commands` so the npm tarball ships the bundled source
  Given the published `packages/core/package.json`
  When the `files` array is read
  Then it contains the literal string `"commands"` alongside the existing entries (`dist`, `LICENSE`, `README.md`); `pnpm pack --dry-run` against `packages/core/` lists `commands/scope-project.md` in the tarball contents.
  Satisfaction:
    - test: packages/core/src/scope-project-source.test.ts "packages/core/package.json files glob includes commands"
    - test: packages/core/src/publish-meta.test.ts "pnpm pack --dry-run for factory-core includes commands/scope-project.md"

**S-3** — `factory init` writes `<cwd>/.claude/commands/scope-project.md` from the bundled source byte-for-byte
  Given a fresh empty `<cwd>` (mkdtempSync) and the test runs `factory init --name test-init`
  When the scaffold completes
  Then `<cwd>/.claude/commands/scope-project.md` exists; its content is byte-identical to `packages/core/commands/scope-project.md` (the canonical source); the file is a regular file (NOT a symlink — symlinks don't survive `npm pack` reliably across platforms); the file's parent directory `<cwd>/.claude/commands/` was created by `factory init` (didn't pre-exist).
  Satisfaction:
    - test: packages/core/src/init.test.ts "scaffold writes .claude/commands/scope-project.md byte-identical to bundled source"
    - test: packages/core/src/init.test.ts "scaffold .claude/commands/scope-project.md is a regular file, not a symlink"

**S-4** — The bundled-source helper resolves correctly in both source-tree (bun test src) and built (dist) contexts
  Given the helper `readScopeProjectCommandTemplate()` in `init-templates.ts`
  When the helper is called from `init.ts`'s `planFiles`
  Then it returns the contents of `packages/core/commands/scope-project.md` regardless of whether the calling code runs from `packages/core/src/init.ts` (Bun test, source) or from `packages/core/dist/init.js` (post-build / installed package). The path resolution uses `new URL('../commands/scope-project.md', import.meta.url)` (or the equivalent `dirname(fileURLToPath(import.meta.url)) + '/../commands/scope-project.md'`) — relative to the calling module's location, so it works in both contexts.
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "readScopeProjectCommandTemplate resolves the bundled markdown source"
    - test: packages/core/src/init-templates.test.ts "readScopeProjectCommandTemplate returns content matching the canonical packages/core/commands/scope-project.md"

## Constraints / Decisions

- **Canonical source location (locked):** `packages/core/commands/scope-project.md`. The repo-root `docs/commands/` directory is REMOVED (or left empty if simpler) — the canonical lives inside the package that ships it.
- **In-repo symlink update:** `.claude/commands/scope-project.md` symlink target updated from `../../docs/commands/scope-project.md` to `../../packages/core/commands/scope-project.md`. Resolves the same content with one less indirection.
- **`packages/core/package.json` `files` glob extends with `"commands"`** alongside the existing `["dist", "LICENSE", "README.md"]`. npm tarball now ships `commands/scope-project.md` at the package root.
- **Helper lives in `init-templates.ts`, not exported** — internal to the package. Called only from `init.ts`'s `planFiles`. Mirrors the existing `FACTORY_CONFIG_TEMPLATE` pattern but reads from disk instead of inlining (to keep single source of truth).
- **Helper signature:** `function readScopeProjectCommandTemplate(): string` — synchronous, throws if the bundled file is missing (which would be a packaging bug; surface it loudly rather than silently).
- **Path resolution:** `new URL('../commands/scope-project.md', import.meta.url)` then `readFileSync(url, 'utf8')`. Works in both source-tree (init-templates.ts at `packages/core/src/init-templates.ts` resolves `../commands/scope-project.md` to `packages/core/commands/scope-project.md` ✓) and post-build (init-templates.js at `packages/core/dist/init-templates.js` resolves `../commands/scope-project.md` to `packages/core/commands/scope-project.md` ✓; in the published tarball, init-templates.js is at `dist/init-templates.js` and resolves to `commands/scope-project.md` ✓).
- **`planFiles` entry:** new `{ relPath: '.claude/commands/scope-project.md', contents: readScopeProjectCommandTemplate() }`. Order in the planFiles array: after `factory.config.json`, before any other entries (group with the rest of the `factory init` scaffold output).
- **Scaffold writes a REGULAR FILE, not a symlink** — symlinks don't survive `npm pack` reliably across platforms (Windows + some CI tarball tools), and a fresh `factory init` in a user's project should produce real files. The in-repo `.claude/commands/scope-project.md` IS still a symlink (dev-only, dogfooding); the user-facing scaffold output is a regular file with the bundled content inlined at install time.
- **Backwards-compat for v0.0.7 users:** users who manually `cp docs/commands/scope-project.md ~/.claude/commands/` before v0.0.8 are unaffected — their copy at `~/.claude/commands/` is independent of where the canonical lives in the repo. v0.0.8 makes `factory init` automatic; manual copy still works.
- **`packages/core/README.md` updates:** the existing "Slash commands → /scope-project" section's install snippet (`cp docs/commands/scope-project.md ~/.claude/commands/scope-project.md`) is updated to (a) note `factory init` now installs to project-level `.claude/commands/` automatically, and (b) keep the user-level `cp` snippet for users who want it everywhere (the snippet's source path becomes `packages/core/commands/scope-project.md` — but practically users would `cp node_modules/@wifo/factory-core/commands/scope-project.md ~/.claude/commands/` from a consumer project).
- **Tests in `init.test.ts` use `mkdtempSync` + `factory init` invocation** mirroring the existing `factory.config.json` test from v0.0.5.1.
- **Tests in `scope-project-source.test.ts` and `scope-project-fixture.test.ts`** updated where they reference `docs/commands/scope-project.md` to point at the new location. Behavior preserved; only paths change.
- **Public API surface** from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.7's 29 names (zero new exports — `readScopeProjectCommandTemplate` is internal-only).
- **Coordinated package version bump deferred to spec 3** (`factory-core-v0-0-8-1`).
- **v0.0.8 explicitly does NOT ship in this spec:** auto-symlink mode (regular file always); a `factory commands install` retrofit subcommand for existing projects; bundling other slash commands (only scope-project for now); per-project opt-out flag (always installed).

## Subtasks

- **T1** [chore] — `git mv docs/commands/scope-project.md packages/core/commands/scope-project.md`. Update the in-repo `.claude/commands/scope-project.md` symlink to target `../../packages/core/commands/scope-project.md` (delete + recreate the symlink with `ln -sfn`). If `docs/commands/` is now empty, remove the directory. ~5 LOC. **depends on nothing.**
- **T2** [chore] — Update `packages/core/package.json`'s `files` glob to include `"commands"`. ~1 LOC. **depends on T1.**
- **T3** [feature] — Add `readScopeProjectCommandTemplate()` to `packages/core/src/init-templates.ts`. Synchronous fs read via `new URL('../commands/scope-project.md', import.meta.url)` + `readFileSync`. NOT exported from `index.ts`. ~10 LOC. **depends on T1.**
- **T4** [feature] — Update `packages/core/src/init.ts`'s `planFiles` to include the new entry: `{ relPath: '.claude/commands/scope-project.md', contents: readScopeProjectCommandTemplate() }`. The `writePlannedFiles` step must `mkdirSync(parentDir, { recursive: true })` before writing — verify the existing implementation already does this (it does, per the factory.config.json precedent). ~5 LOC. **depends on T3.**
- **T5** [test] — `packages/core/src/init-templates.test.ts`: add 2 tests for `readScopeProjectCommandTemplate` (resolves file; content matches canonical). `packages/core/src/init.test.ts`: add 2 tests for the scaffold's `.claude/commands/scope-project.md` (file exists, content byte-identical to canonical). `packages/core/src/scope-project-source.test.ts`: update existing tests to reference the new canonical path; add the new symlink-resolution test + the docs/commands-removed test. `packages/core/src/scope-project-fixture.test.ts`: no changes (fixture set is unchanged). `packages/core/src/publish-meta.test.ts`: extend the existing `pnpm pack --dry-run` test to assert `commands/scope-project.md` appears in the factory-core tarball listing. ~120 LOC across all test files. **depends on T1, T2, T3, T4.**
- **T6** [chore] — Update `packages/core/README.md`'s `## Slash commands → /scope-project` subsection: note that `factory init` now drops the file into project-level `.claude/commands/` automatically; keep the user-level `cp` snippet for users who want it across all projects (with the source path updated to `node_modules/@wifo/factory-core/commands/scope-project.md` for the consumer-side reference). ~15 LOC. **depends on T1.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.8 cluster.
- `pnpm -C packages/core build` produces a working `dist/cli.js`; `pnpm pack --dry-run` against `packages/core/` lists `commands/scope-project.md` in the tarball.
- `factory init --name test-foo` (in a tmp dir) produces `.claude/commands/scope-project.md` byte-identical to `packages/core/commands/scope-project.md`. Verified by the test in T5.
- The in-repo `.claude/commands/scope-project.md` symlink resolves; `cat .claude/commands/scope-project.md` returns the canonical content.
- `docs/commands/scope-project.md` no longer exists.
- Public API surface from `@wifo/factory-core/src/index.ts` is **strictly equal** to v0.0.7's 29 names. `readScopeProjectCommandTemplate` is internal-only.
- README updates landed (factory init auto-install documented; user-level cp snippet preserved with new source path).
- v0.0.8 explicitly does NOT ship in this spec: auto-symlink mode; retrofit CLI subcommand; bundling other slash commands. Deferred per Constraints.

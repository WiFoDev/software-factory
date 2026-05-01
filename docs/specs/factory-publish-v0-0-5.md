---
id: factory-publish-v0-0-5
classification: light
type: chore
status: ready
exemplars:
  - path: packages/core/package.json
    why: "current package.json shape — `name`, `version`, `type: module`, `bin`, `exports`, `files`. v0.0.5 adds `publishConfig`, `repository`, `homepage`, `bugs`, `keywords`, `author` to the same shape across every workspace package; doesn't restructure existing fields."
  - path: packages/core/src/init-templates.ts
    why: "the scaffold's PACKAGE_JSON_TEMPLATE pins `^0.0.4` semver for every @wifo/factory-* dep. v0.0.5 bumps these to `^0.0.5` and the test asserts the bump."
  - path: docs/specs/done/factory-runtime-v0-0-3.md
    why: "v0.0.3 spec — pattern for cross-package coordinated version work, multi-file mechanical changes, and DoD framing that includes both deterministic CI and a release-gate manual smoke."
---

# factory-publish-v0-0-5 — npm publish: bump every `@wifo/factory-*` to 0.0.5, ship to the registry, remove the monorepo-only caveat

## Intent

Publish every `@wifo/factory-*` package to the public npm registry under v0.0.5 so that `factory init`-generated scaffolds work **outside** this monorepo (`pnpm install` against a fresh repo's `^0.0.5` deps actually resolves). v0.0.4 shipped `factory init` with semver deps but the packages weren't published, leaving a documented "monorepo-only" caveat in every `factory init` consumer doc. v0.0.5 closes that gap.

Mechanical work: bump every workspace package's `version` to `0.0.5`, add the npm metadata each scoped package needs (`publishConfig.access: public`, `repository`, `homepage`, `bugs`, `keywords`, `author`, `license`), add a top-level `release` script that runs `pnpm publish -r`, and sweep the "monorepo-only" caveat from every README + template that mentions it.

No public API changes. No new exports. No new packages.

## Scenarios

**S-1** — every workspace package has v0.0.5 metadata
  Given the six packages under `packages/*` (core, context, harness, runtime, spec-review, twin)
  When their `package.json` files are read
  Then each has `"version": "0.0.5"`, `"publishConfig": {"access": "public"}`, `"repository"` pointing at the GitHub repo with the `directory` subpath set, `"homepage"`, `"bugs"`, `"keywords"` (at minimum `["software-factory", "agents", "spec-driven", ...package-specific]`), `"author": "Luis (WiFoDev)"`, `"license": "MIT"`. The existing `name`, `type`, `main`, `types`, `bin`, `exports`, `files`, `scripts`, `dependencies`, `devDependencies` fields are unchanged.
  Satisfaction:
    - test: packages/core/src/publish-meta.test.ts "every workspace package has v0.0.5 + publishConfig + npm metadata fields"

**S-2** — `pnpm publish -r --dry-run` succeeds across the whole workspace
  Given the workspace at HEAD with every package built
  When `pnpm -r exec npm pack --dry-run --json` is invoked from the repo root (or `pnpm publish -r --dry-run --no-git-checks` if available)
  Then every package's dry-run output is `success`; the published-file list for each contains exactly `dist/**`, `README.md`, `LICENSE` (no `src/**`, no `*.test.*`, no `tsconfig*`, no `test-fixtures/**`, no `node_modules`); the `package.json` in each tarball reports `"version": "0.0.5"` and `"publishConfig": {"access": "public"}`.
  Satisfaction:
    - test: packages/core/src/publish-meta.test.ts "pnpm pack --dry-run produces clean tarballs across all packages"
    - judge: "the published file list per package contains only the artifacts a downstream consumer needs — no test fixtures, no source TS, no scaffolding files leaked"

**S-3** — scaffold semver matches the published version
  Given `packages/core/src/init-templates.ts`'s `PACKAGE_JSON_TEMPLATE`
  When the template is inspected
  Then every `@wifo/factory-*` dependency entry uses `^0.0.5` (not `^0.0.4`); the existing init-templates tests pass with the bumped version.
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "PACKAGE_JSON_TEMPLATE has the expected keys + workspace-stripped semver deps" (asserts ^0.0.5 after the v0.0.5 bump)
    - test: packages/core/src/init.test.ts "init in empty cwd creates the canonical scaffold + prints next-steps" (asserts the scaffold's package.json has ^0.0.5)

**S-4** — every README + scaffold README + scaffold template lacks the v0.0.4 monorepo-only caveat
  Given the current docs surface (`README.md`, `packages/core/README.md`, `packages/spec-review/README.md`, `examples/slugify/README.md`, `examples/gh-stars/README.md`, `examples/parse-size/README.md`, `packages/core/src/init-templates.ts` README_TEMPLATE)
  When their contents are read
  Then NONE of them contain the substring `monorepo-only` OR the substring `v0.0.4 caveat` OR the substring `not yet published to npm`. Where the caveat used to live, the docs now describe the standard `pnpm install` flow against published packages.
  Satisfaction:
    - test: packages/core/src/publish-meta.test.ts "no doc references the v0.0.4 monorepo-only caveat after v0.0.5 publish"

**S-5** — top-level `pnpm release` script publishes every package
  Given the top-level `package.json`
  When the `scripts` block is read
  Then a `"release"` script exists that runs (in order): typecheck → test → biome check → build (per package) → `pnpm publish -r --access public`. The script aborts on any failing gate. (The actual publish is a manual release-gate; the script makes a clean run reproducible.)
  Satisfaction:
    - test: packages/core/src/publish-meta.test.ts "top-level package.json has a release script that gates on typecheck/test/check before publish"

## Constraints / Decisions

- Bump every workspace package's `version` to `0.0.5` in lockstep — even the ones that didn't change in v0.0.4 (`harness` was `0.0.0`, `twin` was `0.0.1`). Coordinated versioning makes the dep-bump in `init-templates` correct for all six.
- Add to **every** workspace package's `package.json`:
  - `"publishConfig": {"access": "public"}` (required for scoped `@wifo/*` packages on npm).
  - `"repository": {"type": "git", "url": "git+https://github.com/WiFoDev/software-factory.git", "directory": "packages/<name>"}`.
  - `"homepage": "https://github.com/WiFoDev/software-factory/tree/main/packages/<name>#readme"`.
  - `"bugs": {"url": "https://github.com/WiFoDev/software-factory/issues"}`.
  - `"author": "Luis (WiFoDev)"`.
  - `"license": "MIT"` (where missing — most already have it).
  - `"keywords"` — package-specific list; minimum `["software-factory", "agents", "spec-driven"]`.
- The top-level `package.json` adds `"release": "pnpm typecheck && pnpm test && pnpm check && pnpm -r build && pnpm publish -r --access public"`. Each package's existing `build` script is the publish input.
- `init-templates.ts`'s `PACKAGE_JSON_TEMPLATE.dependencies` bumps every `@wifo/factory-*` entry from `^0.0.4` to `^0.0.5`. Existing tests in `init-templates.test.ts` and `init.test.ts` are updated to match.
- README/template caveat sweep — the v0.0.4 "monorepo-only" caveat is removed from:
  - `README.md` (top-level)
  - `packages/core/README.md`
  - `packages/spec-review/README.md` (Install section)
  - `examples/slugify/README.md` (final tip)
  - `examples/gh-stars/README.md` (Setup section, if present)
  - `examples/parse-size/README.md` (Setup section)
  - `packages/core/src/init-templates.ts` `README_TEMPLATE` ("v0.0.4 caveat" callout block)
- Scaffold tsconfig stays self-contained (does NOT extend a relative path). Scaffold `package.json` continues to use npm semver (`^0.0.5`), NOT `workspace:*`. No monorepo-context detection.
- `pnpm publish -r` is **manually triggered** — NOT run from CI in v0.0.5. CI integration is deferred to v0.0.5+ once the manual release flow has been exercised at least once.
- v0.0.5 explicitly does **not** ship: CI publish workflow (manual release for now), `--access restricted` private packages, package-level changelogs (release notes live in commit messages + ROADMAP), domain packs, `factory init --template <name>`. Deferred to v0.0.5+ as appropriate.
- `LICENSE` file present at the repo root — every published package's npm metadata declares MIT; `files` includes `dist` and `README.md` but NOT a per-package `LICENSE` copy (npm picks up the root `LICENSE` from the publishConfig + monorepo conventions; verify in S-2's tarball check that `LICENSE` is present in each tarball, copying it if not).

## Subtasks

- **T1** [config] — Update every workspace `package.json` (six packages):
  - Bump `version` to `0.0.5`.
  - Add `publishConfig.access: public`.
  - Add `repository`, `homepage`, `bugs`, `author`, `license`, `keywords` per Constraints.
  - Add `LICENSE` to each package's `files` field if missing (and copy/symlink the root LICENSE into each package dir if `npm pack` doesn't pick it up).
  Top-level `package.json` gets the `release` script. **depends on nothing**. ~80 LOC across six files (mostly JSON).
- **T2** [config] — Bump `init-templates.ts`'s `PACKAGE_JSON_TEMPLATE` deps from `^0.0.4` to `^0.0.5`. Update `init-templates.test.ts` and `init.test.ts` assertions to match. **depends on T1**. ~10 LOC.
- **T3** [test] — New `packages/core/src/publish-meta.test.ts`:
  - "every workspace package has v0.0.5 + publishConfig + npm metadata fields" — read each `packages/*/package.json`, assert the v0.0.5 metadata (per S-1).
  - "pnpm pack --dry-run produces clean tarballs across all packages" — invoke `pnpm -r exec npm pack --dry-run --json` (or fallback to `npm pack --dry-run --json` per-package), assert tarball contents (per S-2).
  - "no doc references the v0.0.4 monorepo-only caveat after v0.0.5 publish" — readFileSync each doc in the caveat-sweep list, assert no occurrences (per S-4).
  - "top-level package.json has a release script that gates on typecheck/test/check before publish" (per S-5).
  **depends on T1, T2 + T4**. ~150 LOC.
- **T4** [chore] — Doc + template caveat sweep across every file in Constraints. README copy revisions: replace the "v0.0.4 caveat" callout block in `README_TEMPLATE` with a plain "Install with `pnpm install`" line; remove the "monorepo-only" notes from the example READMEs and top README. The `examples/parse-size/README.md` Setup section gets the simplest update — drop the caveat block. **depends on T1**. ~80 LOC across 7 files.
- **T5** [chore] — `ROADMAP.md` v0.0.5 entry → "shipped" (move v0.0.5 above the v0.0.4 entry; reconciliations summary; cadence note). README "What you get today" header bumps from "v0.0.4" to "v0.0.5"; the recommended-flow diagram is unchanged (the surfaces didn't change — only their installability did). **depends on T1..T4**. ~40 LOC.

## Definition of Done

- All scenarios (S-1..S-5) pass (tests green; judge criterion in S-2 met by manual eyeball before tagging).
- `pnpm typecheck` clean across all six packages.
- `pnpm test` workspace-wide green; `pnpm -C packages/core test` includes the new `publish-meta.test.ts`.
- `pnpm check` (biome) clean.
- `pnpm -r build` produces working `dist/` artifacts for every package.
- **Deterministic CI smoke**: from the repo root, the `publish-meta.test.ts` suite passes — verifying every package's metadata + the tarball contents + the doc sweep without actually publishing.
- **Manual release-gate smoke**: before tagging v0.0.5, `pnpm release` runs to completion locally; the maintainer eyeballs `pnpm publish -r --dry-run` output for every package; if all six pass, the maintainer runs `pnpm publish -r --access public` for real, then verifies one of the published versions resolves: in a fresh tmp dir outside the monorepo, `pnpm dlx @wifo/factory-core@0.0.5 spec lint --help` succeeds (or equivalent). Documented as a checklist in the v0.0.5 release notes.
- Public API surface unchanged across every package (zero new exports in v0.0.5; metadata-only changes).
- `init-templates.ts`'s `PACKAGE_JSON_TEMPLATE` deps are exactly `^0.0.5` (verified in S-3).
- Every README + `init-templates.ts` README_TEMPLATE lacks the strings `monorepo-only`, `v0.0.4 caveat`, `not yet published to npm` (verified in S-4).
- `ROADMAP.md` v0.0.5 marked "shipped" with a one-paragraph summary; v0.0.6 entry created listing the next theme (worktree sandbox + holdout-aware convergence).
- v0.0.5 explicitly does **not** ship: CI publish workflow, package changelogs, domain packs, `--template` flag for init. Deferred per Constraints.

---
id: factory-publish-pipeline-v0-0-14
classification: light
type: fix
status: drafting
exemplars:
  - path: .github/workflows/publish.yml
    why: "v0.0.13's CI publish switched from pnpm publish to npm publish (for OIDC handshake). The switch lost pnpm's automatic workspace:* → ^<version> rewrite. v0.0.14 splits the two concerns: `pnpm pack` rewrites manifests + produces tarballs; `npm publish <tarball>` uploads via OIDC. Each tool does what it's purpose-built for."
  - path: packages/core/src/ci-publish.test.ts
    why: "test pins for the workflow's publish step shape. v0.0.14 updates buildIdx + publishIdx matchers to accept `pnpm pack` + `npm publish <tarball>` shape; adds a new test asserting the post-publish verification step."
  - path: BACKLOG.md
    why: "v0.0.14 entry 'workspace:* shipped to npm — npx @wifo/factory-core init fails for fresh users'. MUST-FIX. Every greenfield user pays this tax on first contact."
depends-on:
  - factory-harness-v0-0-14-apostrophe-fix
---

# factory-publish-pipeline-v0-0-14 — `pnpm pack` rewrites + `npm publish <tarball>` uploads

## Intent

v0.0.13.x's CI publish switched to `npx -y npm@latest publish` for OIDC compatibility, but lost pnpm's automatic `workspace:*` → `^<currentVersion>` rewrite. The published v0.0.13 manifests for spec-review, runtime, harness, twin, and core all carry `"@wifo/factory-*": "workspace:*"` — npm consumers (`npx @wifo/factory-core init`) fail with `EUNSUPPORTEDPROTOCOL`. Workaround via `pnpm.overrides` exists; every fresh user pays it.

v0.0.14 splits the two responsibilities: **`pnpm pack`** does the manifest rewrite + produces a `<name>-<version>.tgz` (purpose-built for this exact transformation). **`npm publish <tarball>`** uploads the rewritten tarball via OIDC (purpose-built for the auth handshake). The skip-if-already-published guard stays: `npm view <name> version` gates the publish per package.

This spec is the v0.0.14 publish-pipeline must-fix. Closes the highest-volume friction in v0.0.13 (every adopter hits it).

## Scenarios

**S-1** — `pnpm pack` rewrites `workspace:*` to real semver
  Given a fresh CI checkout where `packages/core/package.json` has `"@wifo/factory-spec-review": "workspace:*"` in `peerDependencies`
  When the workflow runs `pnpm pack --pack-destination /tmp/factory-tarballs --filter @wifo/factory-core`
  Then the resulting tarball at `/tmp/factory-tarballs/wifo-factory-core-0.0.14.tgz` has its `package.json`'s `peerDependencies['@wifo/factory-spec-review']` rewritten to `^0.0.14` (NOT `workspace:*`). All other workspace dep references (`workspace:*`) are similarly rewritten. The tarball is consumable by npm + npx without `pnpm.overrides`.
  And given a manifest with NO `workspace:*` references, the rewrite is a no-op.
  Satisfaction:
    - test: packages/core/src/ci-publish.test.ts "pnpm pack rewrites workspace:* to ^<version> in published manifests"

**S-2** — Workflow uses `pnpm pack` + `npm publish <tarball>` two-step
  Given the workflow YAML at `.github/workflows/publish.yml`
  When the publish step is parsed
  Then it runs `pnpm pack --pack-destination <tmpdir> --filter <name>` followed by `npx -y npm@latest publish <tmpdir>/<tarball>.tgz --access public --provenance` per package whose local version differs from npm's. The skip-if-already-published guard (`npm view <name> version`) is preserved. The two-step flow runs inside the existing per-package loop.
  Satisfaction:
    - test: packages/core/src/ci-publish.test.ts "publish step uses pnpm pack + npm publish <tarball> two-step"
    - test: packages/core/src/ci-publish.test.ts "publish step preserves skip-if-already-published guard"

**S-3** — Post-publish verification asserts no `workspace:*` in published manifests
  Given the workflow YAML
  When the publish step's verification phase runs (after each successful publish)
  Then it executes `npm view @wifo/factory-<name>@<version> dependencies peerDependencies --json` for each newly-published package and asserts that NO value contains the substring `workspace:`. If found, the workflow exits nonzero (regression-pin against future shape regressions).
  Satisfaction:
    - test: packages/core/src/ci-publish.test.ts "workflow contains post-publish workspace:* verification step"

## Constraints / Decisions

- **Two-step publish flow (locked):** `pnpm pack --pack-destination <tmpdir> --filter <name>` (rewrites) + `npx -y npm@latest publish <tmpdir>/<tarball>.tgz --access public --provenance` (uploads). The two steps are run sequentially per package inside the existing per-package skip-if-published loop.
- **`/tmp/factory-tarballs` (or equivalent) is the tmpdir.** Created once at the start of the publish step (`mkdir -p /tmp/factory-tarballs`); cleaned up by GitHub Actions runner teardown automatically.
- **`pnpm pack` filename pattern (locked):** `<scope>-<name>-<version>.tgz` for scoped packages (e.g., `wifo-factory-core-0.0.14.tgz`). The publish loop reads the version from `package.json` and constructs the path accordingly.
- **Post-publish verification format (locked):** for each package whose publish ran (skipped packages don't need re-verification), run `npm view <name>@<version> dependencies peerDependencies --json | jq` and grep the JSON for `workspace:`. If found, fail. ~15 LOC of bash inside the publish step.
- **`--provenance` flag is preserved.** OIDC-based Trusted Publishing still produces sigstore attestations; the two-step flow doesn't break that (`npm publish <tarball>` supports `--provenance` the same way `npm publish` (no arg) does).
- **No public API surface change.** Workflow + test changes only.
- **Tests use bare paths in `test:` lines (no backticks).**
- **References v0.0.14 cross-cutting Constraints from `factory-harness-v0-0-14-apostrophe-fix`** for cluster ordering, DoD format, and ship flags.
- **v0.0.14 explicitly does NOT ship in this spec:** custom `pnpm publish` patches (deferred — pnpm-pack-then-npm is enough); workspace:dependencies in non-major-bump scenarios (out of scope — every release bumps in lockstep).

## Subtasks

- **T1** [fix] — Replace the `pnpm publish -r --filter "$name" ...` invocation in `.github/workflows/publish.yml`'s publish step with `pnpm pack --pack-destination /tmp/factory-tarballs --filter "$name"` + `npx -y npm@latest publish /tmp/factory-tarballs/<scope>-<name>-<version>.tgz --access public --provenance`. The skip-if-already-published guard stays. ~25 LOC of YAML/bash. **depends on nothing.**
- **T2** [feature] — Add post-publish verification step in the same workflow file: for each package that was just published (collected in a bash array as we iterate), run `npm view <name>@<version> dependencies peerDependencies --json` and grep for `workspace:`. Fail the workflow if any package's manifest contains it. ~15 LOC. **depends on T1.**
- **T3** [test] — Update `packages/core/src/ci-publish.test.ts`'s buildIdx + publishIdx matchers to accept `pnpm pack ... && npx ... npm publish <tarball>` shape. Add S-1 verification (script-level, can use a tmpdir + `pnpm pack` invocation), S-2 (workflow YAML structure), S-3 (verification step exists). ~80 LOC. **depends on T1, T2.**
- **T4** [chore] — Update `RELEASING.md` to document the two-step flow + the verification step. Add a one-liner to README about the post-v0.0.13 publish-pipeline fix. ~25 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.14 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- A test verifies that `pnpm pack` rewrites `workspace:*` → `^<version>` in the produced tarball's `package.json` (S-1).
- A test verifies the workflow's publish step uses `pnpm pack` + `npx -y npm@latest publish <tarball>` (S-2).
- A test verifies the workflow contains the post-publish verification step (S-3).
- The skip-if-already-published guard from v0.0.13.x is preserved (regression-pin existing test passes unchanged).
- RELEASING.md documents the two-step flow.
- v0.0.14 explicitly does NOT ship in this spec: custom pnpm publish patches; non-lockstep version bumps. Deferred per Constraints.

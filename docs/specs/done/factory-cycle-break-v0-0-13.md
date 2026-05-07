---
id: factory-cycle-break-v0-0-13
classification: light
type: refactor
status: drafting
exemplars:
  - path: packages/core/package.json
    why: "v0.0.12's brownfield spec moved @wifo/factory-spec-review to dependencies of @wifo/factory-core. Since spec-review already depends on core, this introduced a workspace cycle. v0.0.13 moves spec-review to peerDependencies (with auto-install on pnpm 8+ / npm 7+) — preserves the zero-config goal, eliminates the cycle."
  - path: packages/core/src/cli.ts
    why: "v0.0.12 worked around the cycle via createRequire(import.meta.url). v0.0.13 reverts to a static import once the cycle is broken at the package.json layer."
  - path: .github/workflows/publish.yml
    why: "v0.0.12 worked around the cycle via explicit per-package build sequence. v0.0.13 reverts to `pnpm -r build` once the cycle is gone."
  - path: BACKLOG.md
    why: "v0.0.13 entry 'Break the core ↔ spec-review workspace cycle architecturally'. Closes the architectural smell the v0.0.12 tag-fire surfaced over 5 retry commits."
depends-on:
  - factory-core-v0-0-13-init-ergonomics
---

# factory-cycle-break-v0-0-13 — move `@wifo/factory-spec-review` to `peerDependencies` of core

## Intent

v0.0.12's `factory-core-v0-0-12-brownfield` spec moved `@wifo/factory-spec-review` from a lazy dynamic import to a hard `dependencies` entry of `@wifo/factory-core`. spec-review already depends on core; this created a workspace cycle that bit hard during the v0.0.12 tag-fire — the publish workflow needed (a) explicit per-package build sequence and (b) `createRequire` in `core/cli.ts` to defer the spec-review type lookup. Both are pragmatic workarounds masking the architectural smell.

v0.0.13 ships the clean fix: move spec-review to `peerDependencies` with `peerDependenciesMeta.<name>.optional: false`. pnpm 8+ and npm 7+ auto-install peer deps, so the v0.0.12 zero-config goal is preserved for the major package managers. The build-graph cycle disappears: peer deps don't form build-time edges. Both v0.0.12 workarounds (per-package build, createRequire) revert.

This spec is a refactor — net code reduction.

## Scenarios

**S-1** — `@wifo/factory-spec-review` is a `peerDependency` of `@wifo/factory-core`
  Given `packages/core/package.json` is parsed
  When the JSON is read
  Then `dependencies['@wifo/factory-spec-review']` is ABSENT. `peerDependencies['@wifo/factory-spec-review']` is PRESENT, set to `workspace:*` (workspace-internal) — published-tarball resolution converts this to `^0.0.13` per pnpm's publish-time substitution (existing behavior). `peerDependenciesMeta['@wifo/factory-spec-review'].optional` is `false` (locked: it's NOT optional; the documented happy path requires it).
  Satisfaction:
    - test: packages/core/src/publish-meta.test.ts "factory-core declares @wifo/factory-spec-review as a non-optional peer dependency"
    - test: packages/core/src/publish-meta.test.ts "factory-core does NOT declare @wifo/factory-spec-review under dependencies"

**S-2** — Static `import { runReviewCli }` works after cycle break
  Given `packages/core/src/cli.ts` source is read
  When the imports are inspected
  Then line 6 (or the equivalent) is `import { runReviewCli } from '@wifo/factory-spec-review/cli';` — a static import. The `createRequire(import.meta.url)` block from v0.0.12 is REMOVED. The `'node:module'` import is also removed (it was only for createRequire).
  And given `pnpm typecheck` runs against `packages/core` from a fresh `pnpm install`, it succeeds — workspace symlinks resolve cleanly because the build graph no longer has a cycle. The test inspects the file content + asserts the workspace `pnpm typecheck` exit code is 0.
  Satisfaction:
    - test: packages/core/src/cli.test.ts "core/cli.ts uses static import for runReviewCli (v0.0.13 cycle-break)"
    - test: packages/core/src/cli.test.ts "core/cli.ts no longer imports createRequire from node:module"

**S-3** — `.github/workflows/publish.yml` reverts to `pnpm -r build`
  Given the workflow YAML is parsed
  When the build step is inspected
  Then it has a single line: `run: pnpm -r build` (NOT the v0.0.12 explicit per-package list, NOT the `--workspace-concurrency=1` flag). The build step still runs BEFORE typecheck/test/check (the v0.0.12 reorder is preserved — that's an independent constraint about cross-package types). The setup-bun step stays (test-time bun is independent).
  And given `packages/core/src/ci-publish.test.ts`'s `buildIdx` matcher: it's simplified back to `s.run === 'pnpm -r build'` (or a tight regex that allows minor whitespace variation). The complex multi-shape regex from v0.0.12 is removed.
  Satisfaction:
    - test: packages/core/src/ci-publish.test.ts "publish.yml build step uses pnpm -r build (cycle removed in v0.0.13)"
    - test: packages/core/src/ci-publish.test.ts "buildIdx matcher accepts pnpm -r build canonical shape"

## Constraints / Decisions

- **Peer-dep semantic (locked):** `peerDependenciesMeta['@wifo/factory-spec-review'].optional: false`. spec-review is NOT optional — the documented happy path (`factory spec review`) requires it. The peer-dep declaration says "core requires spec-review at runtime; install it alongside core."
- **pnpm 8+ / npm 7+ auto-install behavior is the assumption.** Document the legacy npm caveat in `packages/core/README.md` + top-level README: "If you're on npm < 7, install both packages explicitly: `npm i @wifo/factory-core @wifo/factory-spec-review`." For modern pnpm/npm, peer deps auto-install.
- **`workspace:*` peer-dep resolution at publish-time:** pnpm's publish-time replacement converts `workspace:*` peer-dep specifiers to `^<currentVersion>` automatically (existing behavior, no special config needed). v0.0.13 publishes `peerDependencies['@wifo/factory-spec-review']: '^0.0.13'`.
- **`packages/core/src/cli.ts` revert (locked):** the v0.0.12 createRequire workaround AND the `import { createRequire } from 'node:module'` import are both removed. Static `import { runReviewCli } from '@wifo/factory-spec-review/cli'` returns to line 6.
- **`.github/workflows/publish.yml` revert (locked):** the v0.0.12 explicit per-package build list reverts to `pnpm -r build` (single line). The `--workspace-concurrency=1` flag is also removed (no longer needed without the cycle). The build-before-typecheck order is PRESERVED — that's an independent constraint about cross-package type resolution from a fresh checkout.
- **`ci-publish.test.ts` buildIdx matcher simplification:** v0.0.12 had a complex multi-shape regex accepting both `pnpm -r build` and per-package `--filter` lists. v0.0.13 simplifies back to the canonical shape. The test gets shorter.
- **Lockfile refresh required.** `pnpm install` after the package.json edit refreshes `pnpm-lock.yaml` to reflect the dep movement (peer deps DO appear in the lockfile, just under a different key). The v0.0.13 release-prep step includes the refresh.
- **Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.12's 34 names.** No exports change; only the dep-declaration + import-style changes.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.13 explicitly does NOT ship in this spec:** introducing a `@wifo/factory-cli` umbrella package (option (b) from BACKLOG — bigger blast radius, deferred); a separate "factory-cli-thin" bin (deferred); changing spec-review's deps on core (out of scope; that direction of the cycle was always present, only the new direction is being broken).

## Subtasks

- **T1** [refactor] — Move `@wifo/factory-spec-review` from `packages/core/package.json`'s `dependencies` to `peerDependencies` (with `peerDependenciesMeta` set to `optional: false`). ~10 LOC of JSON edit. **depends on nothing.**
- **T2** [refactor] — Revert `packages/core/src/cli.ts`: remove the `createRequire(import.meta.url)` block at the spec-review call site; remove the `import { createRequire } from 'node:module'` line; restore the static `import { runReviewCli } from '@wifo/factory-spec-review/cli'`. ~15 LOC of revert (net deletion). **depends on T1.**
- **T3** [refactor] — Revert `.github/workflows/publish.yml`'s build step to `pnpm -r build` (single line). Remove the `--workspace-concurrency=1` flag and the explicit per-package list. Build still runs BEFORE typecheck. ~10 LOC of YAML edit (net deletion). **depends on T1.**
- **T4** [refactor] — Simplify `packages/core/src/ci-publish.test.ts`'s `buildIdx` matcher to the canonical `pnpm -r build` shape. Remove the v0.0.12 multi-shape regex. ~10 LOC. **depends on T3.**
- **T5** [test] — `packages/core/src/publish-meta.test.ts` covers S-1 (2 tests pinning the peer-dep shape). `packages/core/src/cli.test.ts` covers S-2 (2 tests on import shape). `packages/core/src/ci-publish.test.ts` covers S-3 (existing test simplifies; no NEW tests needed). ~50 LOC. **depends on T1-T4.**
- **T6** [chore] — Update `packages/core/README.md` + top-level `README.md`: add a "Peer dependency note" — pnpm/npm 7+ auto-install; legacy npm requires explicit `npm i @wifo/factory-core @wifo/factory-spec-review`. ~25 LOC. **depends on T5.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`; `pnpm typecheck` workspace-wide).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.13 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -r build` exits 0 — the workspace cycle is gone, so the canonical recursive build works without --workspace-concurrency or per-package sequencing).
- A test verifies that `core/cli.ts` no longer imports `createRequire` (the workaround is gone).
- A test verifies that `peerDependencies['@wifo/factory-spec-review']` is present in `packages/core/package.json` AND `dependencies['@wifo/factory-spec-review']` is ABSENT.
- Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.12's 34 names.
- v0.0.13 explicitly does NOT ship in this spec: factory-cli umbrella package; thin bin re-route; spec-review deps changes. Deferred per Constraints.

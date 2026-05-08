---
id: factory-core-v0-0-14-spec-review-subprocess
classification: light
type: fix
status: drafting
exemplars:
  - path: packages/core/src/cli.ts
    why: "v0.0.13's createRequire(import.meta.url) workaround for the workspace cycle hits CJS resolution against factory-spec-review's ESM-only exports map. v0.0.14 replaces it with child_process.spawn of the factory-spec-review bin — process boundary eliminates the type-resolution cycle AND the CJS/ESM mismatch in one move."
  - path: packages/spec-review/package.json
    why: "spec-review already declares a bin (factory-spec-review). npm/pnpm install both auto-link bins onto the consumer's PATH (or node_modules/.bin). Spawn the bin; pipe stdio."
  - path: BACKLOG.md
    why: "v0.0.14 entry 'factory spec review broken on published packages — createRequire hits CJS resolution against ESM-only exports map'. MUST-FIX. The reviewer can't review on the published artifact today."
depends-on:
  - factory-harness-v0-0-14-apostrophe-fix
---

# factory-core-v0-0-14-spec-review-subprocess — replace `createRequire` with `child_process.spawn`

## Intent

v0.0.13's "cycle-break" spec moved `@wifo/factory-spec-review` to peerDependencies of factory-core but kept the `createRequire(import.meta.url)` workaround inherited from v0.0.12 — which resolves CJS-style. The workspace works (symlinks bypass exports-map enforcement), but on the npm-published artifact, factory-spec-review's `exports['./cli']` declares only `import` + `types` conditions (no `require`) → createRequire fails silently, the catch swallows the error, exit 0. The reviewer cannot review on the published package.

v0.0.14 replaces the in-process import with `child_process.spawn('factory-spec-review', rest, { stdio: 'inherit' })`. The bin already exists; npm/pnpm auto-link it. Process boundary eliminates the type-resolution cycle AND the CJS/ESM mismatch — core no longer reaches inside spec-review's package; it just invokes the bin.

This is the v0.0.14 third must-fix. Closes the most-hidden of the three correctness bugs (silent exit 0 → users discover the brokenness only when they realize their reviews never produced output).

## Scenarios

**S-1** — `factory spec review <path>` spawns the factory-spec-review bin
  Given core/cli.ts source AND `factory-spec-review` is on PATH (auto-linked by npm/pnpm install)
  When `factory spec review docs/specs/foo.md` is invoked
  Then the dispatcher in core/cli.ts uses `child_process.spawn('factory-spec-review', ['docs/specs/foo.md', ...rest], { stdio: 'inherit' })` (or equivalent — pipe stdout/stderr through io.stdout/io.stderr if io is overridden). The exit code propagates: child exit 0 → io.exit(0); child exit nonzero → io.exit(child.exitCode). The createRequire(import.meta.url) block is REMOVED. The `'node:module'` import is REMOVED.
  And given the bin is NOT on PATH (e.g., factory-spec-review wasn't installed), the spawn fails with ENOENT → io.stderr emits a clear message: `factory: factory-spec-review not found on PATH. Install with: npm install @wifo/factory-spec-review` (peerDependencies should auto-install on pnpm 8+/npm 7+; but the message helps legacy npm users).
  Satisfaction:
    - test: packages/core/src/cli.test.ts "factory spec review spawns factory-spec-review bin (v0.0.14 — subprocess transition)"
    - test: packages/core/src/cli.test.ts "factory spec review surfaces ENOENT cleanly when bin is not on PATH"

**S-2** — `core/cli.ts` no longer imports `createRequire` from `node:module`
  Given core/cli.ts source
  When read
  Then it does NOT contain `import { createRequire } from 'node:module'` AND does NOT contain `createRequire(import.meta.url)`. The file uses `import { spawn } from 'node:child_process'` instead. The v0.0.13 cycle-break tests pin the createRequire shape — those flip to pin the spawn shape.
  Satisfaction:
    - test: packages/core/src/cli.test.ts "core/cli.ts no longer imports createRequire"
    - test: packages/core/src/cli.test.ts "core/cli.ts uses node:child_process.spawn for the spec-review dispatcher"

**S-3** — Subprocess exit code propagates correctly
  Given a fake `factory-spec-review` script (`#!/usr/bin/env bash; echo '...'; exit 1`) on PATH AND `factory spec review <path>` is invoked
  When the subprocess runs and exits with code 1
  Then the parent CLI exits with code 1 (NOT 0). The child's stdout/stderr pass through to the parent's. No CJS/ESM resolution friction; the bin is just a separate process.
  Satisfaction:
    - test: packages/core/src/cli.test.ts "factory spec review exit code propagates from spawned bin"

## Constraints / Decisions

- **Spawn options (locked):** `child_process.spawn('factory-spec-review', argv, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env })`. stdout/stderr pipe through to the parent's `io.stdout` / `io.stderr` (so test harnesses can capture); stdin inherits (in case the bin reads from stdin). Env propagates so subscription auth + ANTHROPIC_API_KEY (when set) reach the child.
- **ENOENT handling:** when the bin is not on PATH (`spawn.error.code === 'ENOENT'`), surface a clear message + exit 2: `factory: factory-spec-review not found on PATH. With pnpm 8+/npm 7+ it should auto-install as a peer dep of factory-core. For legacy npm: npm install @wifo/factory-spec-review`. Mirrors the existing v0.0.13 install-docs caveat in core/README.md.
- **Exit code propagation (locked):** child exit code maps directly to parent exit code. Signal exits (e.g., SIGTERM) → parent exits 130 (or matches signal-to-exit-code conventions).
- **No `'node:module'` import in core/cli.ts.** The createRequire workaround is fully removed; no need for the import. Smaller surface; clearer dependency story.
- **Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.13's 34 names.** The change is internal to cli.ts.
- **Test harness compatibility:** the existing `runCli({ stdout, stderr, exit })` test harness in cli.test.ts captures io output. Subprocess spawn pipes through; tests can mock the bin via a fake script on PATH (test-fixtures pattern).
- **References v0.0.14 cross-cutting Constraints from `factory-harness-v0-0-14-apostrophe-fix`** for cluster ordering and ship flags.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.14 explicitly does NOT ship in this spec:** the factory-cli umbrella package (deferred to v1.0.0); rewriting spec-review's bin to also accept programmatic invocation; auto-installing factory-spec-review when ENOENT (would need network access; out of scope).

## Subtasks

- **T1** [fix] — Replace the createRequire block in `packages/core/src/cli.ts`'s spec-review dispatcher (around line 75-86) with `child_process.spawn('factory-spec-review', rest, { stdio: ... })`. Pipe stdout/stderr through io. Map child exit code to parent exit code. Handle ENOENT with a clear stderr message. Drop the `import { createRequire } from 'node:module'` line. Add `import { spawn } from 'node:child_process'` if not already present. ~40 LOC. **depends on nothing.**
- **T2** [test] — Update `packages/core/src/cli.test.ts`'s v0.0.13 cycle-break tests: flip the createRequire-pinning assertions to spawn-pinning. Add new tests for S-1 (spawn invocation + ENOENT path), S-2 (no createRequire / no node:module), S-3 (exit code propagation). Use a fake-bin script in a tmpdir on PATH for spawn tests. ~120 LOC. **depends on T1.**
- **T3** [chore] — Update `packages/core/README.md`: document the v0.0.14 subprocess transition + the lower coupling (core no longer imports from spec-review). Update the legacy npm caveat to match. ~25 LOC. **depends on T2.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.14 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/core build`).
- A test verifies `core/cli.ts` does NOT contain `createRequire` (regression-pin against re-introduction).
- A test verifies the subprocess exit code propagates from the spawned bin to the parent CLI.
- A test verifies ENOENT surfaces a clear stderr message and exits 2.
- Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.13's 34 names.
- README in `packages/core/` documents the subprocess transition.
- v0.0.14 explicitly does NOT ship in this spec: factory-cli umbrella package; programmatic spec-review invocation; auto-install on ENOENT. Deferred per Constraints.

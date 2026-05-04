---
id: dynamic-dag-walk-v0-0-11
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/runtime/src/sequence.ts
    why: "runSequence's execution loop. Today walks the topo-sorted ready set; v0.0.11 walks the topo-sorted ready set AND, after each spec converges, in-memory promotes any direct dependent whose deps are NOW all converged + re-enters the loop. Implementation: build an inverse-deps map at start; track convergedSet; on convergence walk inverse-deps and check eligibility."
  - path: BASELINE.md
    why: "v0.0.10 entry, friction #1: 'run-sequence doesn't walk the DAG dynamically — 4 specs = 4 manual invocations + 3 manual status flips.' v0.0.11 closes this — the maintainer's intervention count drops from 7 to ~1-2."
  - path: docs/specs/done/factory-runtime-v0-0-9.md
    why: "Reference shape for extending runSequence's status-aware logic. v0.0.9 added drafting filter; v0.0.11 extends with dynamic promotion."
depends-on: []
---

# dynamic-dag-walk-v0-0-11 — `run-sequence` auto-promotes direct dependents on convergence

## Intent

Close v0.0.10 BASELINE friction #1: `run-sequence` walks the DAG dynamically. After a spec converges, the runtime in-memory promotes any direct dependent whose deps are now ALL converged from `status: drafting` → `status: ready` AND re-enters the execution loop with the newly-promoted set. The maintainer no longer needs to flip statuses by hand or re-invoke `run-sequence` per spec. v0.0.10's measured 4 invocations + 3 manual flips collapses to a single invocation. Default behavior change with `--include-drafting` preserving the legacy "walk everything from start" semantic for back-compat.

The runtime mutation is in-memory only — `<dir>/<spec>.md`'s `status:` field is NOT edited on disk. Persistent flips remain a maintainer choice (the maintainer can still choose to commit `drafting → ready` flips manually for documentation purposes).

## Scenarios

**S-1** — Linear chain: 4 specs (1 ready + 3 drafting) ship in one invocation
  Given a tmp `<dir>` with 4 specs: `a.md` (ready, depends-on=[]), `b.md` (drafting, depends-on=[a]), `c.md` (drafting, depends-on=[b]), `d.md` (drafting, depends-on=[c])
  When `factory-runtime run-sequence <dir> --no-implement --context-dir <ctx>` is invoked (no `--include-drafting`)
  Then exit code 0; the sequence converges with all 4 specs run in topological order. Stdout shows: `factory-runtime: a converged → promoting b`, `factory-runtime: b converged → promoting c`, `factory-runtime: c converged → promoting d`, `factory-runtime: sequence converged (4/4 specs, ...)`. The `SequenceReport.specs[]` array has 4 entries, all `status: 'converged'`. Single CLI invocation; zero manual `drafting → ready` flips needed.
  And given the same setup but spec `b` fails (the runtime exits with no-converge or error mid-walk), `c` and `d` are NOT promoted (they're still drafting; their deps weren't all converged). Exit code 1; `SequenceReport.specs[]` has `[a: converged, b: no-converge]` only — `c` and `d` are absent (mirrors v0.0.9 default-skip-drafting behavior).
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "run-sequence dynamically promotes direct dependents on convergence in linear chain"
    - test: packages/runtime/src/sequence.test.ts "failed prior spec stops promotion of its dependents"

**S-2** — Diamond DAG: a spec with multiple deps is promoted only when ALL deps converge
  Given a tmp `<dir>` with 4 specs: `a.md` (ready, depends-on=[]), `b.md` (drafting, depends-on=[a]), `c.md` (drafting, depends-on=[a]), `d.md` (drafting, depends-on=[b, c])
  When `factory-runtime run-sequence <dir> --no-implement --context-dir <ctx>` is invoked
  Then `a` runs first; converges → promote `b` AND `c` (both newly eligible). `b` runs; converges → check if `d`'s deps are all converged: `b` is, but `c` isn't yet (or already is, depending on order); if not all → `d` stays drafting. `c` runs; converges → now `d`'s deps (`b`+`c`) are all converged → promote `d`. `d` runs; converges. Final report has 4 specs converged in this exact order: `[a, b, c, d]` (alphabetic tie-break for `b` vs `c` at the same depth from v0.0.7's Kahn's logic).
  And given a spec with 3 deps where only 2 have converged, the spec stays drafting until ALL 3 converge.
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "diamond DAG: dependent promoted only when all deps converged"
    - test: packages/runtime/src/sequence.test.ts "spec with 3 deps stays drafting until all 3 converge"

**S-3** — `--include-drafting` preserves the v0.0.10 "walk everything from start" semantic
  Given a tmp `<dir>` with 3 specs (1 ready + 2 drafting; linear chain)
  When `factory-runtime run-sequence <dir> --include-drafting --no-implement --context-dir <ctx>` is invoked
  Then ALL 3 specs are walked from the start (the v0.0.10 behavior preserved as opt-in). Topological order: same as before. Auto-promotion is a no-op when every spec is already eligible from start.
  And given `factory.config.json` has `runtime.includeDrafting: true`, behavior matches the CLI flag (legacy walk-everything mode).
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "--include-drafting flag walks every spec from start; auto-promotion is a no-op"
    - test: packages/runtime/src/cli.test.ts "factory.config.json runtime.includeDrafting=true preserves legacy semantic"

**S-4** — Already-converged dedup (v0.0.10) composes cleanly with dynamic promotion
  Given a context dir already containing a converged `factory-run` for spec `a` (rooted at the current sequence's `specsDir`) AND a tmp `<dir>` with 3 specs (`a` ready + `b` drafting deps=[a] + `c` drafting deps=[b])
  When `factory-runtime run-sequence <dir> --context-dir <ctx>` is invoked
  Then `a` is detected as already-converged; the runtime skips its `run()` (v0.0.10 dedup) AND promotes `b` immediately (since `a`'s convergence is recognized). `b` runs; converges; `c` is promoted; `c` runs; converges. Single invocation; one spec actually re-runs (b only — `a` was prior; `c` is newly run).
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "already-converged dedup + dynamic promotion compose: prior-converged specs trigger downstream promotion"

## Constraints / Decisions

- **Default behavior change (locked):** `runSequence` walks the DAG dynamically — `status: drafting` becomes "blocked on a dep that hasn't converged yet" (semantically) rather than "skipped indefinitely." When a spec converges, the runtime walks `inverseDepends[convergedSpec]` and promotes each dependent whose deps are ALL converged, then re-enters the execution loop with the newly-promoted set.
- **In-memory promotion only.** The runtime does NOT edit `<dir>/<spec>.md`'s `status:` field on disk. The promotion is only in-memory for this invocation. Maintainers can choose to commit `drafting → ready` flips manually after the sequence converges (some prefer that for documentation; others prefer to leave specs as drafting in `done/` since they were always-going-to-converge after the first spec shipped).
- **`--include-drafting` semantics (locked):** preserves the v0.0.9-v0.0.10 "walk every spec from the start, regardless of status" behavior. With this flag, dynamic promotion is a no-op (every spec is already in the walk-set). Back-compat preserved for the cluster-atomic shipping pattern that's documented in v0.0.9 BACKLOG.
- **`factory.config.json runtime.includeDrafting?: boolean`** continues to work (CLI flag > config > built-in default `false`). The semantic change in v0.0.11 is what `--include-drafting` defaults to (now matters more, since the default is dynamic-walk).
- **Failure cascade interaction:** when a spec FAILS (no-converge or error), the runtime does NOT promote its dependents — they stay drafting. The maintainer fixes the failed spec or aborts. With `--continue-on-fail` (v0.0.7), independent specs (whose deps DID converge or whose deps DON'T include the failed spec) continue to be promoted. Failed-spec dependents go to `'skipped'` status (existing v0.0.7 behavior).
- **`SequenceReport.specs[]` ordering:** reflects the ACTUAL execution order (which is now dynamic). The `topoOrder` field reflects the static topological sort (unchanged from v0.0.7). The `specs[]` array's order is "as the dynamic walk executed them" — typically matches `topoOrder` exactly when no failures occur.
- **Stdout log format (locked):** `factory-runtime: <converged-id> converged → promoting <dependent-id>` — emitted to stdout as each promotion happens. Order: top-level summary at end (existing v0.0.7 format), promotion logs interleaved during the walk.
- **Inverse-deps map** is built once at sequence start from `loadedSpecs`. Map<dep-id, dependent-ids[]>. After each spec converges, walk the convergedSpec's entry, check each dependent's `deps[]` against the convergedSet, promote eligible ones.
- **Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.10's 23 names** — changes are internal to `runSequence`'s implementation; field-level on existing types and logic.
- **Coordinated package version bump deferred to spec 6** (`worktree-sandbox-v0-0-11`'s chore subtask).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.11 explicitly does NOT ship in this spec:** auto-promotion of `status: blocked` specs (only `drafting` → `ready` promotion); auto-flip of status on disk via `git mv` or `--auto-promote-on-disk` flag (in-memory only); per-spec promotion-blocking via a frontmatter field (the field is `status:`, not new fields).

## Subtasks

- **T1** [feature] — Extend `packages/runtime/src/sequence.ts`'s `runSequence` execution loop. Build inverse-deps map at start. After each `run()` returns, if `'converged'`, walk inverse-deps and re-evaluate eligibility for each dependent. Promote eligible specs (in-memory) and continue the walk. ~80 LOC. **depends on nothing.**
- **T2** [feature] — Update CLI's `runRunSequence` log output: emit `factory-runtime: <id> converged → promoting <dep-id>` per promotion. ~10 LOC. **depends on T1.**
- **T3** [test] — `packages/runtime/src/sequence.test.ts`: 6 tests covering S-1 (linear chain + failure cascade), S-2 (diamond DAG + 3-dep wait), S-3 (--include-drafting back-compat), S-4 (already-converged dedup composition). ~150 LOC. **depends on T1, T2.**
- **T4** [chore] — Update `packages/runtime/README.md`: add a "Dynamic DAG walk (v0.0.11+)" subsection documenting the default behavior change + the `--include-drafting` back-compat path. ~25 LOC. **depends on T1, T2, T3.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.11 cluster.
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`.
- A 4-spec linear chain (1 ready + 3 drafting) ships in ONE `factory-runtime run-sequence` invocation (verified by the new test in T3).
- Public API surface from `@wifo/factory-runtime/src/index.ts` is strictly equal to v0.0.10's 23 names.
- README in `packages/runtime/` documents the v0.0.11+ dynamic DAG walk.
- v0.0.11 explicitly does NOT ship in this spec: blocked-status auto-promotion; on-disk status flips; per-spec promotion blocking. Deferred per Constraints.

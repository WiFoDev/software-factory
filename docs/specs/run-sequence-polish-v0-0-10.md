---
id: run-sequence-polish-v0-0-10
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/runtime/src/sequence.ts
    why: "loadSpecs (lines ~98-127) — v0.0.10 extends to also walk <dir>/done/ when validating depends-on edges (but NOT include done/ specs in the topological execution order). buildDag's dep-id existence check expands to ids ∪ done-ids."
  - path: packages/runtime/src/runtime.ts
    why: "run() — no changes here. The dedup happens in runSequence, not in run(). runSequence queries factory-run records via contextStore.list({ type: 'factory-run' }) before each spec's run() call."
  - path: packages/context/src/cli.ts
    why: "factory-context CLI — v0.0.10 adds --context-dir as a synonym flag for --dir. Three-version deprecation arc: v0.0.10 adds synonym; v0.0.11 emits one-line deprecation warning on --dir; v0.1.0 removes --dir."
  - path: BASELINE.md
    why: "v0.0.9 entry's friction points #1, #2, #3 are the source of truth for what this spec closes (move-to-done dep break + N² re-run + CLI flag fragmentation)."
depends-on: []
---

# run-sequence-polish-v0-0-10 — close v0.0.9 BASELINE friction list (already-converged dedup + done/ dep resolution + --context-dir harmonization)

## Intent

Close the three concrete frictions surfaced by the v0.0.9 URL-shortener BASELINE:
1. **`run-sequence` re-runs already-shipped specs** — the v0.0.9 BASELINE measured 6 wasted no-op spawns out of 10 (cost grows N² across multi-pass workflows).
2. **Moving a shipped spec to `<dir>/done/` breaks `depends-on` resolution** — the runtime errors with `runtime/sequence-dep-not-found` when the next spec references a dep that's been moved to `done/`.
3. **`factory-context tree --dir` and `factory-runtime --context-dir` use different flag names** for the same path.

Each fix is small + independent; combined into one spec because they share `runSequence` + CLI surface and ship together cleanly. Field-level additions; zero new public exports.

## Scenarios

**S-1** — `runSequence` skips specs with a converged `factory-run` already rooted under the current `factorySequenceId`'s specsDir
  Given a tmp `<dir>` with 2 specs (`a.md` ready + `b.md` ready, depends-on=[a]) and a context dir containing a converged `factory-run` for spec `a` whose own parents include a `factory-sequence` record with `payload.specsDir === <dir>`
  When `runSequence` is invoked against `<dir>`
  Then spec `a` is detected as already-converged; the runtime emits a one-line log to stdout: `factory-runtime: a already converged in run <runId> — skipping`. Spec `a` does NOT trigger a fresh `run()` invocation. Spec `b` runs as normal. The persisted `factorySequenceId` is the NEW sequence's id (not the prior); spec `a`'s skipped status is reflected in `SequenceReport.specs[]` with `status: 'converged'` AND a new field `runReport.runId` pointing at the PRE-EXISTING factory-run (not a new one).
  And given the same `<dir>` + a context dir whose `factory-run` for spec `a` was rooted under a DIFFERENT `factorySequenceId.specsDir` (e.g., a prior different project), `a` is NOT skipped — it runs fresh. The dedup is scoped to the current sequence's specsDir, not global.
  And given a context dir without any `factory-run` for spec `a`, `a` runs fresh (default v0.0.9 behavior).
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "runSequence skips already-converged specs scoped to specsDir"
    - test: packages/runtime/src/sequence.test.ts "runSequence does not skip when prior factory-run was for a different specsDir"
    - test: packages/runtime/src/sequence.test.ts "runSequence runs all specs fresh on first invocation against an empty context dir"

**S-2** — `runSequence`'s `buildDag` resolves `depends-on` against `<dir>/done/` in addition to `<dir>`
  Given a tmp `<dir>` containing `b.md` (status: ready, depends-on=[a]) and `<dir>/done/a.md` (status: ready — already shipped + moved to done)
  When `runSequence` is invoked against `<dir>`
  Then `buildDag` validates that `a` is a known spec (resolved via `<dir>/done/a.md`); the topological sort produces `topoOrder = ['b']` (only `b` is in the execution order; `a` is dep-context, not executed). `runSequence` runs spec `b` cleanly; no `runtime/sequence-dep-not-found` error.
  And given `<dir>` + `<dir>/done/` with a true cycle (e.g., `<dir>/x.md` depends-on=[y], `<dir>/done/y.md` depends-on=[x]), `runtime/sequence-cycle` fires correctly — done/ specs participate in cycle detection but not execution.
  And given `<dir>` whose `b.md` references a dep `<ghost>` that doesn't exist in EITHER `<dir>` OR `<dir>/done/`, `runtime/sequence-dep-not-found` fires with the same message format as v0.0.9.
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "buildDag resolves depends-on against <dir>/done/ for already-shipped deps"
    - test: packages/runtime/src/sequence.test.ts "done/ specs are excluded from topological execution order"
    - test: packages/runtime/src/sequence.test.ts "missing-dep error fires when dep is in neither <dir> nor <dir>/done/"

**S-3** — `factory-context tree --context-dir <path>` works as a synonym for `--dir <path>`; `--dir` emits a one-line deprecation notice
  Given a tmp context dir
  When `factory-context tree <id> --context-dir <path>` is invoked
  Then the command runs identically to `factory-context tree <id> --dir <path>` (same exit code; same stdout). NO deprecation notice on the new flag.
  And given `factory-context tree <id> --dir <path>`, the command runs (back-compat) AND emits a one-line stderr notice: `context/deprecated-flag: --dir is deprecated; use --context-dir (will be removed in v0.1.0)`.
  And given BOTH flags passed (`--dir <p1> --context-dir <p2>`), `--context-dir` wins (later-mentioned-on-CLI semantics — the two flags are aliases; the canonical takes precedence). The deprecation notice for `--dir` still fires.
  Satisfaction:
    - test: packages/context/src/cli.test.ts "--context-dir is a synonym for --dir on factory-context tree"
    - test: packages/context/src/cli.test.ts "--dir emits one-line deprecation notice"
    - test: packages/context/src/cli.test.ts "factory-context list also accepts --context-dir as a synonym"

## Constraints / Decisions

- **Already-converged dedup (locked semantics):** a spec is "already converged" when, BEFORE the current `runSequence` invocation, the context store contains a `factory-run` record where:
  - `payload.specId === <spec.id>`, AND
  - The `factory-run.parents[]` includes a `factory-sequence` record whose `payload.specsDir` matches the CURRENT sequence's `specsDir` (case-sensitive string compare; absolute path normalized via `path.resolve`).
  Both conditions must hold. The dedup is scoped to the current sequence's directory — re-running the same spec set in a different `<dir>` runs all specs fresh.
- **Status reflected in `SequenceReport.specs[]`:** for a skipped-because-already-converged spec, the entry has `status: 'converged'` AND `runReport: { ...preExistingRunReport }`. The `runReport.runId` points at the PRE-EXISTING `factory-run`, not a new one. The new `factory-sequence` record's `parents[]` does NOT include skipped-spec runs (they were rooted under prior sequences). Maintainer can `factory-context tree --direction down <oldRunId>` to inspect prior shipping.
- **`done/` dep resolution (locked semantics):** `loadSpecs` returns two lists: `included` (executed) and `donePool` (dep-context only). `buildDag` validates dep ids against `included ∪ donePool`. Topological sort runs over `included` only. Cycle detection runs over the union (a cycle in done/ would be a real bug). `runSequence`'s execution loop only iterates `topoOrder` (which is `included`); `donePool` specs are never run.
- **`done/` walk is non-recursive** — `<dir>/done/*.md` only, NOT `<dir>/done/<subdir>/*.md`. Mirrors the existing `<dir>` non-recursive walk.
- **`<dir>/done/` is OPTIONAL** — if it doesn't exist, the dep resolution behaves as v0.0.9 (only `<dir>` walk).
- **`--context-dir` synonym (locked):** added to `factory-context tree`, `factory-context get`, `factory-context list` — every subcommand that currently accepts `--dir`. Mutual exclusivity NOT enforced (both can be passed; canonical `--context-dir` takes precedence).
- **Deprecation notice (locked exact text):** `context/deprecated-flag: --dir is deprecated; use --context-dir (will be removed in v0.1.0)\n` written to stderr exactly once per invocation.
- **Three-version deprecation arc:** v0.0.10 adds synonym + warning; v0.0.11 keeps synonym + warning; v0.1.0 removes `--dir`. Documented in the v0.0.10 CHANGELOG + `packages/context/README.md`.
- **`factory.config.json` does NOT change.** The flag harmonization is CLI-only; the existing `runtime.contextDir` config key (if/when it lands — currently no config key for context-dir; that's a separate v0.0.11 candidate) would use the canonical `--context-dir` name.
- **Public API surface from every `@wifo/factory-*` package strictly equal to v0.0.9's surface** (zero new exports — all changes are internal to `runSequence` + CLI flag handling). `RuntimeErrorCode`: unchanged (no new codes).
- **No changes to `factory-runtime` CLI flag names** — `--context-dir` is already canonical there. The harmonization brings `factory-context` into alignment.
- **Coordinated package version bump deferred to spec 5** (`wide-blast-calibration-v0-0-10`'s chore subtask).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.10 explicitly does NOT ship in this spec:** transitive done/ resolution beyond direct `depends-on` edges (only direct deps look in done/); auto-recovery from a partial sequence (where some specs are shipped and others timed out — the maintainer manually moves shipped specs to done/ before re-invoking); `factory-context` flag rename for any other flag than `--dir`.

## Subtasks

- **T1** [feature] — `packages/runtime/src/sequence.ts`: extend `loadSpecs` to also walk `<specsDir>/done/` when it exists; return `{ included, donePool }`. Update `buildDag` to validate dep ids against the union; topological order excludes donePool. ~40 LOC. **depends on nothing.**
- **T2** [feature] — `packages/runtime/src/sequence.ts`: insert pre-`run()` already-converged check in `runSequence`'s execution loop. Query `contextStore.list({ type: 'factory-run' })` once at start; build a `Map<specId, ExistingRun>` keyed on specs whose parent `factory-sequence` has matching specsDir. Per-spec, lookup → if hit, emit skip log + populate `SequenceReport.specs[]` entry from existing run + skip `run()` invocation. ~50 LOC. **depends on nothing (parallel with T1).**
- **T3** [feature] — `packages/context/src/cli.ts`: add `--context-dir` synonym for `--dir` on every subcommand (tree, get, list). When both passed, `--context-dir` wins. When `--dir` passed (with or without `--context-dir`), emit deprecation notice to stderr. ~25 LOC. **depends on nothing.**
- **T4** [test] — `packages/runtime/src/sequence.test.ts`: 6 tests covering S-1 (3 already-converged dedup cases) + S-2 (3 done/ dep resolution cases). ~150 LOC. **depends on T1, T2.**
- **T5** [test] — `packages/context/src/cli.test.ts`: 3 tests covering S-3 (synonym + deprecation + both-flags-precedence). ~50 LOC. **depends on T3.**
- **T6** [chore] — Update `packages/runtime/README.md` (already-converged dedup behavior) + `packages/context/README.md` (--context-dir synonym + deprecation arc). ~30 LOC. **depends on T1, T2, T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/runtime typecheck` and `pnpm -C packages/context typecheck` clean.
- `pnpm -C packages/runtime test` and `pnpm -C packages/context test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.10 cluster.
- `pnpm -C packages/runtime build` and `pnpm -C packages/context build` produce working builds.
- Public API surface from every `@wifo/factory-*` package strictly equal to v0.0.9's surface (zero new exports).
- READMEs in `packages/runtime/` and `packages/context/` document the new behavior.
- v0.0.10 explicitly does NOT ship in this spec: transitive done/ resolution; partial-sequence auto-recovery; flag harmonization beyond `--dir`. Deferred per Constraints.

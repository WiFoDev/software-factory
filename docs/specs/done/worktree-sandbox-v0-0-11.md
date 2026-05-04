---
id: worktree-sandbox-v0-0-11
classification: deep
type: feat
status: drafting
agent-timeout-ms: 2400000
exemplars:
  - path: packages/runtime/src/runtime.ts
    why: "run() builds the phase graph + invokes phases with cwd. v0.0.11 inserts a worktree-creation step BEFORE the graph builds when opts.worktree is set; threads the worktree path as cwd to all phases; persists a factory-worktree record."
  - path: packages/runtime/src/phases/implement.ts
    why: "implementPhase already accepts opts.cwd. v0.0.11 reuses this — no API change. The CLI threads worktree.path as the cwd."
  - path: packages/runtime/src/records.ts
    why: "FactorySequenceSchema (v0.0.7) is the template for the new FactoryWorktreeSchema. Same pattern: registered via tryRegister; persisted with parents=[runId]."
  - path: packages/runtime/src/cli.ts
    why: "runRun + runRunSequence — v0.0.11 adds --worktree flag + a NEW worktree subcommand (worktree clean / worktree list)."
  - path: docs/technical-plans/worktree-sandbox-v0-0-11.md
    why: "Paired technical-plan — context, architecture decisions, blast radius, public API surface deltas, locked decisions (worktree root, branch naming, cleanup semantics, maintainer review flow). Spec body references decisions there rather than restating them."
depends-on:
  - ci-publish-v0-0-11
  - dod-precision-calibration-v0-0-11
  - dynamic-dag-walk-v0-0-11
  - holdout-aware-convergence-v0-0-11
  - tokens-charged-v0-0-11
---

# worktree-sandbox-v0-0-11 — `factory-runtime run --worktree` isolates each run in a git worktree; closing chore subtask handles the v0.0.11 lockstep version bump

<!-- NOQA: spec/wide-blast-radius -->

## Intent

Close the long-deferred worktree-sandbox candidate (BACKLOG since the original ROADMAP's v0.1.0 list). Each `factory-runtime run` invocation creates an isolated `git worktree` rooted under `.factory/worktrees/<runId>/`; the implement phase's `claude -p` subprocess runs inside the worktree (cwd switched); validate + dod phases run their tests + Bash gates from inside the worktree. **The maintainer's main tree is never touched by the agent.** Strong undo by construction; enables parallel runs (different specs in different worktrees with no contention).

DEEP because: introduces a new subprocess execution model (cwd swap + git worktree creation/cleanup), a new context record type (`factory-worktree`), a new CLI subcommand (`factory-runtime worktree clean | list`), 3 new public exports, AND new failure modes (git not on PATH; worktree creation conflicts; orphaned worktrees from aborted runs).

This is also the closing spec of the v0.0.11 cluster — its chore subtask coordinates the lockstep version bump from `0.0.10` to `0.0.11` across all six packages, scaffold dep refs, version-string assertions in 3 test files, and CHANGELOG/ROADMAP/top-level README updates.

`agent-timeout-ms: 2400000` (40 minutes) declared in frontmatter — wide-blast architectural change (multiple files; new subcommand; chore subtask) needs more headroom than the 600s default. Uses the v0.0.9 per-spec timeout override field.

## Scenarios

**S-1** — `factory-runtime run --worktree <spec>` creates an isolated worktree; phases run from inside it; `factory-worktree` record persists
  Given a tmp git-initialized project + a spec at `<projectRoot>/docs/specs/foo.md`
  When `factory-runtime run --worktree --no-implement --no-judge <spec> --context-dir <ctx>` is invoked
  Then before the run starts, the runtime calls `git worktree add <projectRoot>/.factory/worktrees/<runId>/ -b factory-run/<runId>`. The `factory-worktree` record persists with `runId === <runId>`, `worktreePath === <abs path>`, `branch === 'factory-run/<runId>'`, `baseSha === <git rev-parse HEAD>`, `status: 'active'`. The validate phase runs its tests from `<worktreePath>` (so `bun test`-style invocations resolve test files in the worktree's checkout). On run completion (converged or no-converge), the `factory-worktree` record is updated with the final status. The maintainer's main tree (`<projectRoot>`) is untouched.
  And given a `factory-runtime run` invocation WITHOUT `--worktree`, behavior is unchanged from v0.0.10 — phases run from `process.cwd()`.
  And given the project is NOT a git repo, the runtime fails-fast with `RuntimeError({ code: 'runtime/worktree-failed', message: '...not a git repository' })` on `--worktree` invocation.
  Satisfaction:
    - test: packages/runtime/src/worktree.test.ts "createWorktree creates a git worktree at .factory/worktrees/<runId>/"
    - test: packages/runtime/src/worktree.test.ts "factory-runtime run --worktree threads cwd through all phases"
    - test: packages/runtime/src/worktree.test.ts "factory-worktree record persists with runId/path/branch/baseSha/status"
    - test: packages/runtime/src/worktree.test.ts "non-git project + --worktree → runtime/worktree-failed"

**S-2** — Worktree is preserved on convergence + on failure for forensic inspection; cleanup via `factory-runtime worktree clean`
  Given a tmp git project with 2 worktrees from prior runs: one converged (status: 'converged' on its `factory-worktree` record); one failed (status: 'no-converge')
  When `factory-runtime worktree clean --context-dir <ctx>` is invoked
  Then the converged worktree is removed via `git worktree remove`; its `factory-worktree` record's status updates to `'removed'`. The failed worktree is preserved (its dir exists; `git worktree list` still shows it). Stdout: `factory-runtime worktree clean: removed 1 converged worktree(s); kept 1 failed worktree(s)`.
  And given `--all` flag, BOTH worktrees are removed (destructive; explicit).
  And given `--keep-failed` flag, behavior matches the default (only converged removed).
  Satisfaction:
    - test: packages/runtime/src/cli.test.ts "factory-runtime worktree clean removes converged worktrees by default"
    - test: packages/runtime/src/cli.test.ts "factory-runtime worktree clean --all removes failed worktrees too"
    - test: packages/runtime/src/cli.test.ts "factory-runtime worktree list shows status per worktree"

**S-3** — `RunOptions.worktree` field-level addition; programmatic callers can opt in
  Given a programmatic `run()` invocation with `options.worktree: true` (boolean shorthand)
  When the runtime executes
  Then it creates a worktree at `<projectRoot>/.factory/worktrees/<runId>/` using default options (defaults from `WorktreeOptions`).
  And given `options.worktree: { rootDir: '/tmp/wt' }`, the worktree is created at `/tmp/wt/<runId>/`.
  And given `options.worktree: undefined` (default; v0.0.10 behavior), no worktree is created — phases run from the cwd.
  Satisfaction:
    - test: packages/runtime/src/runtime.test.ts "RunOptions.worktree=true creates worktree at default root"
    - test: packages/runtime/src/runtime.test.ts "RunOptions.worktree.rootDir overrides default root"
    - test: packages/runtime/src/runtime.test.ts "RunOptions.worktree=undefined preserves v0.0.10 behavior"

**S-4** — `factory-context tree --direction down <runId>` walks `factory-worktree` as a run descendant
  Given a converged 1-iteration `--worktree` run
  When `factory-context tree <runId> --direction down --context-dir <ctx>` is invoked
  Then the printed tree shows `factory-run` at the top → `factory-worktree` as a sibling of `factory-phase` records (parents=[runId] for both) → per-phase outputs as descendants of `factory-phase`. The `factory-worktree` record's payload is human-readable.
  Satisfaction:
    - test: packages/runtime/src/runtime.test.ts "factory-worktree is reachable via factory-context tree --direction down <runId>"

## Holdout Scenarios

**H-1** — Parallel `--worktree` invocations don't conflict (each run gets its own worktree path)
  Given two simultaneous `factory-runtime run --worktree <spec1>` + `factory-runtime run --worktree <spec2>` invocations from the same project root
  When both runs execute
  Then each gets its own worktree at `<projectRoot>/.factory/worktrees/<runId-N>/` with distinct branch names (`factory-run/<runId-1>` vs `factory-run/<runId-2>`). No `git worktree add` failures; no shared filesystem state mutations between the two runs.

**H-2** — Worktree creation atomic: failure mid-create leaves no orphan
  Given a project where `git worktree add` fails partway (e.g., disk full; permission denied; corrupted git index)
  When the runtime calls `createWorktree`
  Then the runtime catches the failure, attempts to clean up any partial state (the worktree dir if created; the branch if created), and throws `RuntimeError({ code: 'runtime/worktree-failed' })`. NO `factory-worktree` record persists for the failed creation. NO `factory-run` record persists (the run never started).

**H-3** — Worktree subcommand handles `git worktree list` parse errors gracefully
  Given a `git worktree list` output that's malformed or empty (edge case: corrupted repo; never-used worktree feature)
  When `factory-runtime worktree clean` or `factory-runtime worktree list` is invoked
  Then the subcommand emits a clear error to stderr (`runtime/worktree-failed: failed to enumerate git worktrees: <git's stderr>`) and exits 3. The user is not left in a broken state — the maintainer can `git worktree prune` manually if needed.

## Constraints / Decisions

- **Architecture decisions live in `docs/technical-plans/worktree-sandbox-v0-0-11.md`** — paired technical-plan covers context, blast radius, default-graph wiring, public API surface deltas, locked decisions (worktree root, branch naming, cleanup semantics, maintainer review flow). The spec body references that document rather than restating it.
- **Default worktree root (locked):** `<projectRoot>/.factory/worktrees/<runId>/`. Configurable via `WorktreeOptions.rootDir`.
- **Branch naming (locked):** `factory-run/<runId>`. Throwaway branches under the `factory-run/` namespace.
- **`--worktree` is opt-in for v0.0.11.** Default `false`. Becomes opt-out post-v0.1.0 once soaked.
- **One worktree per `run()` invocation** — implement, validate, dod phases all share the same worktree for that run.
- **Cleanup via `factory-runtime worktree clean`** — opt-in, default removes only converged worktrees. `--all` is destructive (explicit). NEVER auto-cleanup on run end (preserves forensic value of failed runs).
- **`RuntimeErrorCode` gains `'runtime/worktree-failed'`** — 15 → 15... wait, 14 in v0.0.10; v0.0.11 adds 1 → 15. Used for: git not on PATH, worktree creation failure, non-git project + --worktree, malformed `git worktree list` output.
- **`factory-worktree` record schema (locked structure):** `{ runId, worktreePath, branch, baseSha, baseRef, createdAt, status }`. Status values: `'active'` | `'converged'` | `'no-converge'` | `'error'` | `'removed'`. Registered via `tryRegister` in `runtime.ts`.
- **New CLI subcommand `factory-runtime worktree`:**
  - `factory-runtime worktree list [--context-dir <path>]` — list worktrees with their `factory-worktree` record status.
  - `factory-runtime worktree clean [--all] [--keep-failed] [--context-dir <path>]` — prune converged worktrees by default; `--all` prunes failed too.
- **Public API surface deltas (locked):**
  - `@wifo/factory-runtime/src/index.ts`: 23 → **26** names. Three new exports: `createWorktree` (function), `WorktreeOptions` (type), `CreatedWorktree` (type). `removeWorktree` and `listWorktrees` stay internal.
  - `RunOptions.worktree?: boolean | WorktreeOptions` — field-level addition on already-exported type.
  - `RuntimeErrorCode` enum: 14 → **15** values. New: `'runtime/worktree-failed'`.
  - New context record `factory-worktree` registered in `packages/runtime/src/records.ts`.
- **Coordinated v0.0.11 lockstep version bump (chore subtask, T7 below):**
  - `packages/{context,core,harness,runtime,spec-review,twin}/package.json` version: `0.0.10` → `0.0.11`.
  - `packages/core/src/init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies`: every `@wifo/factory-*` dep `^0.0.10` → `^0.0.11`.
  - `packages/core/src/init-templates.test.ts` version assertions: `^0.0.10` → `^0.0.11`.
  - `packages/core/src/init.test.ts` version assertions: `^0.0.10` → `^0.0.11`.
  - `packages/core/src/publish-meta.test.ts` version regex: `/^0\.0\.10$/` → `/^0\.0\.11$/`.
- **CHANGELOG / ROADMAP / top-level README** updates summarize the v0.0.11 cluster (this spec + the five sibling specs).
- **Tests use bare paths in `test:` lines (no backticks).**
- **`<!-- NOQA: spec/wide-blast-radius -->` declared at the top of the spec body** — this spec is intentionally wide-blast (DEEP centerpiece + chore-coordinator subtask). The lint warning would fire at threshold 12; NOQA suppresses it explicitly.
- **v0.0.11 explicitly does NOT ship in this spec:** parallel agent execution within a single sequence (separate v0.0.12+ candidate); auto-cleanup of converged worktrees on run end (always opt-in via `worktree clean`); worktree GC after N days (manual maintenance); auto-merge of converged worktrees back into the main branch (the maintainer reviews + merges manually); per-spec worktree options in the spec frontmatter (only `RunOptions.worktree` for now); cross-platform Windows worktree handling (best-effort; tested on macOS/Linux).

## Subtasks

- **T1** [feature] — `packages/runtime/src/worktree.ts` (NEW FILE): `createWorktree(runId, opts)` function — shells out to `git worktree add`; captures `baseSha` via `git rev-parse HEAD`. `removeWorktree(path)` — shells out to `git worktree remove`. `listWorktrees(rootDir)` — parses `git worktree list --porcelain`. Internal helpers; only `createWorktree` + types are exported. ~150 LOC. **depends on nothing.**
- **T2** [feature] — `packages/runtime/src/records.ts`: add `FactoryWorktreeSchema` + `FactoryWorktreePayload` type. Register via `tryRegister` in `runtime.ts`. ~40 LOC. **depends on nothing.**
- **T3** [feature] — `packages/runtime/src/runtime.ts`: extend `run()` to read `args.options?.worktree`; when set, call `createWorktree` BEFORE phase graph runs; thread `worktree.path` as cwd into all phases (override `cwd` field of phase invocations); persist `factory-worktree` record with `parents=[runId]`; update record status post-run. Add `'runtime/worktree-failed'` to `RuntimeErrorCode`. ~80 LOC. **depends on T1, T2.**
- **T4** [feature] — `packages/runtime/src/cli.ts`: add `--worktree` flag to `runRun` and `runRunSequence`. Add new `runWorktreeClean` and `runWorktreeList` subcommand handlers. ~80 LOC. **depends on T3.**
- **T5** [feature] — `packages/runtime/src/index.ts`: re-export `createWorktree`, `WorktreeOptions`, `CreatedWorktree`. Surface count goes 23 → 26. ~3 LOC. **depends on T1.**
- **T6** [test] — `packages/runtime/src/worktree.test.ts` (NEW FILE): 5 tests covering S-1 + H-1 + H-2 (createWorktree behavior + parallel + atomic creation). `packages/runtime/src/cli.test.ts`: 5 tests covering S-2 + H-3 (worktree subcommand semantics). `packages/runtime/src/runtime.test.ts`: 4 tests covering S-3 + S-4 (RunOptions.worktree + factory-context tree). ~300 LOC across files. **depends on T1, T2, T3, T4, T5.**
- **T7** [chore] — Bump version field in all six `packages/<name>/package.json` files from `0.0.10` to `0.0.11`. Bump `init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies` from `^0.0.10` to `^0.0.11`. Update `init-templates.test.ts`, `init.test.ts`, `publish-meta.test.ts` version assertions. Update `CHANGELOG.md` with v0.0.11 entry covering all 6 specs. Update `ROADMAP.md` (mark v0.0.11 shipped; promote v0.1.0+ candidates). Update top-level `README.md` v0.0.11 banner. Update `packages/runtime/README.md` with worktree-sandbox docs. ~200 LOC. **depends on T1..T6.**

## Definition of Done

- All scenarios (S-1..S-4) AND holdouts (H-1..H-3) pass.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.11 cluster (this spec's NOQA suppresses the wide-blast warning that would otherwise fire on the chore-coordinator pattern).
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`. `factory-runtime worktree clean` and `factory-runtime worktree list` are wired in the CLI dispatch.
- `pnpm pack --dry-run` against every `packages/<name>/` produces clean tarballs at version `0.0.11`.
- A fresh `factory init --name test-foo` produces a project where `package.json` deps are at `^0.0.11`.
- All six `@wifo/factory-*` `package.json` files at `0.0.11`.
- Public API surface from `@wifo/factory-runtime/src/index.ts` is **26 names** (was 23; +3: `createWorktree` + `WorktreeOptions` + `CreatedWorktree`).
- `RuntimeErrorCode` enum has 15 values (was 14; +1: `runtime/worktree-failed`).
- `CHANGELOG.md`, `ROADMAP.md`, top-level `README.md`, `packages/runtime/README.md` reflect v0.0.11 ship state.
- v0.0.11 explicitly does NOT ship in this spec: parallel agent exec; auto-cleanup; worktree GC; auto-merge; per-spec frontmatter; full Windows support. Deferred per Constraints.

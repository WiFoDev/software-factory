---
id: factory-core-v0-0-14-finish-task-status-aggregator
classification: light
type: fix
status: drafting
exemplars:
  - path: packages/core/src/finish-task.ts
    why: "v0.0.12 shipped factory finish-task --all-converged. v0.0.13 BASELINE found it ships specs that run-sequence called `no-converge` (definitional drift). Two parts of the toolchain disagree on 'converged' — finish-task likely just checks for record existence + implement-phase pass; run-sequence requires validate-phase pass. v0.0.14 reuses v0.0.12's status-aggregator helper to align them."
  - path: packages/runtime/src/sequence.ts
    why: "v0.0.12's run-sequence dedup-status-correctness fix wrote a helper that walks factory-phase records and verifies all iterations' terminal phase has status: 'pass'. finish-task --all-converged should call the same helper (or duplicate the logic with a comment pointing at the canonical implementation if separation isn't clean)."
  - path: BACKLOG.md
    why: "v0.0.14 entry 'finish-task --all-converged ships specs that run-sequence called no-converge'. Closes the definitional drift surfaced in the v0.0.13 BASELINE."
depends-on:
  - factory-harness-v0-0-14-apostrophe-fix
---

# factory-core-v0-0-14-finish-task-status-aggregator — align finish-task's "converged" predicate with run-sequence's

## Intent

v0.0.12's `factory finish-task --all-converged` was meant to walk the most recent factory-sequence and ship every converged spec to `done/`. The v0.0.13 BASELINE caught a real bug: it ships specs whose run-sequence verdict was explicitly `no-converge`. The dogfooder had to manually `mv` `click-tracking` back out of `done/` after the apostrophe-strip phantom no-converge.

Root cause: finish-task's "converged" predicate is broader than run-sequence's. v0.0.12's run-sequence dedup-status-correctness spec (`factory-runtime-v0-0-12-correctness`) wrote a helper that walks factory-phase records per iteration and verifies all terminal phases are `'pass'`. finish-task should call the same predicate.

This spec aligns the two by reusing the helper (or duplicating with a comment if the cross-package import isn't clean).

## Scenarios

**S-1** — `--all-converged` skips specs whose factory-run had no-converge verdict
  Given a context dir contains a `factory-sequence` with two factory-runs: spec-A's run has all phases `'pass'` (converged); spec-B's run has at least one iteration whose terminal phase is `'fail'` or `'error'` (no-converge)
  When `factory finish-task --all-converged --since <seqId> --dir <dir> --context-dir <ctx>` is invoked
  Then the command exits 0. ONLY spec-A is moved to `<dir>/done/`. spec-B stays at `<dir>/spec-B.md`. Stdout: `factory: shipped spec-A → done/ (run <runId-short>)` AND `factory: skipped spec-B (run <runId-short> did not converge — last phase: fail)`. Summary: `factory: shipped 1 spec from sequence <seqId-short> (1 skipped)`.
  And given a sequence where ALL specs are no-converge, the command exits 0, moves nothing, and prints `factory: shipped 0 specs from sequence <seqId-short> (N skipped)`. (Idempotent — no-converge is a safe state.)
  Satisfaction:
    - test: packages/core/src/finish-task.test.ts "--all-converged skips specs whose factory-run terminal phase was fail/error"
    - test: packages/core/src/finish-task.test.ts "--all-converged with all-no-converge sequence is a safe no-op"

**S-2** — Status-aggregator helper walks factory-phase records correctly
  Given a factory-run with 3 iterations: iter 1 implement: pass / validate: fail; iter 2 implement: pass / validate: fail; iter 3 implement: pass / validate: pass / dod: pass
  When the status-aggregator helper is called with the run id
  Then it returns `{ converged: true, terminalPhase: 'pass' }` (the FINAL iteration's terminal phase is what counts; earlier failures are part of the iteration loop, not a verdict).
  And given a run whose final iteration's terminal phase is `'fail'` (no-converge), the helper returns `{ converged: false, terminalPhase: 'fail' }`.
  Satisfaction:
    - test: packages/core/src/finish-task.test.ts "status-aggregator helper recognizes converged run via final iteration's terminal phase"
    - test: packages/core/src/finish-task.test.ts "status-aggregator helper recognizes no-converge run via final iteration's terminal-phase status"

**S-3** — Per-spec `factory finish-task <id>` (existing v0.0.12 behavior) is unchanged
  Given a converged spec id AND `factory finish-task my-spec` is invoked (positional, not --all-converged)
  When the command runs
  Then the existing v0.0.12 behavior is preserved: the spec is moved to `done/`, a `factory-spec-shipped` record is emitted, exit code 0. The status-aggregator only fires on the `--all-converged` path. (The positional path was always status-checking via a different code path; v0.0.14 doesn't change it.)
  Satisfaction:
    - test: packages/core/src/finish-task.test.ts "positional finish-task <id> behavior unchanged from v0.0.12"

## Constraints / Decisions

- **Status-aggregator helper location (locked):** lives in `packages/core/src/finish-task.ts` as a small private function `getRunConvergenceStatus(contextStore, runId): Promise<{ converged: boolean; terminalPhase: string }>`. Walks factory-phase records via `contextStore.list({ type: 'factory-phase', parents: [runId] })`, groups by iteration, finds the LAST iteration's terminal phase, returns its status. ~30 LOC. Comment points at the canonical implementation in factory-runtime's `sequence.ts` (v0.0.12). Duplicating is fine — small helper, no shared exports.
- **Convergence predicate (locked):** `terminalPhase === 'pass'` for the FINAL iteration. Earlier iterations' failures are part of the implement-validate-iterate loop; only the final iteration's verdict counts.
- **Skip log format (locked):** `factory: skipped <id> (run <runId-short> did not converge — last phase: <status>)` per skipped spec. Summary line: `factory: shipped <N> specs from sequence <seqId-short> (<M> skipped)`. Mirrors v0.0.12's existing log shape.
- **Idempotent semantic (locked):** all-no-converge sequence → exit 0 with `shipped=0`. No error; the maintainer hasn't shipped anything intentionally.
- **`finishTask` library helper signature unchanged.** The `--all-converged` overload's return type may gain a `skipped: Array<{ specId, runId, terminalPhase }>` field for callers; existing fields are unchanged.
- **References v0.0.14 cross-cutting Constraints from `factory-harness-v0-0-14-apostrophe-fix`** for cluster ordering and ship flags.
- **Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.13's 34 names** unless `getRunConvergenceStatus` is exported (it shouldn't be — internal helper).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.14 explicitly does NOT ship in this spec:** importing the helper from factory-runtime (cross-package coupling deferred); a separate `factory finish-task --re-validate` flag (deferred — out of scope); `--dry-run` preview (deferred).

## Subtasks

- **T1** [fix] — Add the `getRunConvergenceStatus(contextStore, runId)` helper in `packages/core/src/finish-task.ts`. Walks factory-phase records, groups by iteration, returns the final iteration's terminal phase status. ~30 LOC. **depends on nothing.**
- **T2** [fix] — Update `finishTask({ allConverged: true, ... })`'s walker to call the helper before adding each spec to the move-list. Skip specs whose `terminalPhase !== 'pass'` and accumulate them into `result.skipped[]`. ~25 LOC. **depends on T1.**
- **T3** [feature] — Update the CLI's `runFinishTask` in `packages/core/src/cli.ts` to format skip logs + summary per Constraints. ~15 LOC. **depends on T2.**
- **T4** [test] — `packages/core/src/finish-task.test.ts`: 5 tests covering S-1 (skip path; all-no-converge no-op), S-2 (helper unit tests for converged + no-converge), S-3 (positional path unchanged). Use the existing test fixtures for fake factory-phase records. ~140 LOC. **depends on T1-T3.**
- **T5** [chore] — Update `packages/core/README.md`'s `factory finish-task` section: document the v0.0.14 status-aggregator semantic + the skip log format. ~20 LOC. **depends on T4.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.14 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/core build`).
- A regression-pin verifies that `--all-converged` skips a no-converge factory-run (the exact bug from the v0.0.13 BASELINE).
- The all-no-converge sequence case is verified as a safe no-op (exit 0, shipped=0).
- The positional `factory finish-task <id>` path's v0.0.12 behavior is unchanged (regression-pin).
- Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.13's 34 names.
- README in `packages/core/` documents the v0.0.14 status-aggregator + skip log format.
- v0.0.14 explicitly does NOT ship in this spec: factory-runtime helper import; --re-validate flag; --dry-run mode. Deferred per Constraints.

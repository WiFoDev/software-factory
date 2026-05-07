---
id: factory-core-v0-0-13-finish-task-batch
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/core/src/finish-task.ts
    why: "v0.0.12 shipped per-spec factory finish-task <spec-id>. v0.0.13 adds --all-converged [--since <factorySequenceId>] for batch ship-cycle move-to-done. The runtime already knows which specs converged in the most recent factory-sequence; --all-converged walks them."
  - path: packages/core/src/cli.ts
    why: "CLI surface — adds --all-converged + --since flags to the existing finish-task subcommand. Mutually exclusive with positional <spec-id>."
  - path: BACKLOG.md
    why: "v0.0.13 entry 'factory finish-task --all-converged batch ship-cycle move-to-done' (v0.0.12 BASELINE honorable mention #1). Closes the only step that doesn't auto-progress with the rest of run-sequence."
depends-on:
  - factory-core-v0-0-13-init-ergonomics
---

# factory-core-v0-0-13-finish-task-batch — `factory finish-task --all-converged`

## Intent

v0.0.12 shipped per-spec `factory finish-task <spec-id>` — but the maintainer's natural workflow ships an entire cluster (4-6 specs in one `run-sequence` invocation) and then wants to move ALL shipped specs in one go. The runtime already persists `factory-sequence` records with the converged factory-runs underneath; `--all-converged` walks the most recent (or named) sequence and moves each converged spec to `<dir>/done/`.

This closes the v0.0.12 BASELINE's honorable mention #1: "the move-to-done step is the only step of the workflow that doesn't auto-progress."

## Scenarios

**S-1** — `--all-converged` walks the most recent factory-sequence and moves every converged spec
  Given a context dir contains a `factory-sequence` record `<seqId>` whose descendant `factory-run` records show 4 specs converged: `core-store-and-slug`, `shorten-endpoint`, `redirect-with-click-tracking`, `stats-endpoint`. The `<dir>/<id>.md` files exist for all 4 (no `done/` move yet).
  When `factory finish-task --all-converged --dir <dir> --context-dir <ctx>` is invoked WITHOUT `--since`
  Then the command exits 0. Each spec is moved from `<dir>/<id>.md` to `<dir>/done/<id>.md`. One `factory-spec-shipped` record is persisted per moved spec, with `parents: [<runId>]` (the spec's converged factory-run) and `payload: { specId, shippedAt, fromPath, toPath }`. Stdout contains: `factory: shipped <id> → done/ (run <runId-short>)` per spec, then a summary `factory: shipped 4 specs from sequence <seqId-short>`.
  And given the most recent factory-sequence has fewer converged specs (e.g., 2/4 converged, 2 errored), only the converged ones are moved. The errored specs stay at `<dir>/<id>.md` for the maintainer to retry.
  Satisfaction:
    - test: packages/core/src/finish-task.test.ts "--all-converged moves every converged spec from the most recent factory-sequence"
    - test: packages/core/src/finish-task.test.ts "--all-converged skips non-converged specs in the same sequence"

**S-2** — `--since <factorySequenceId>` overrides the "most recent" default
  Given a context dir contains TWO factory-sequence records: `seq-old` (older, 3 converged specs) and `seq-new` (newer, 4 converged specs). The maintainer wants to retroactively ship specs from `seq-old`.
  When `factory finish-task --all-converged --since seq-old --dir <dir> --context-dir <ctx>` is invoked
  Then only the 3 specs from `seq-old` are moved (not the 4 from `seq-new`). The `--since` value matches against the factory-sequence's full id; partial-id matching is NOT supported (locked: keep the resolution unambiguous).
  And given `--since <unknown-id>`, the command exits 1 with stderr `factory: no factory-sequence found with id <unknown-id>`. No specs are moved.
  Satisfaction:
    - test: packages/core/src/finish-task.test.ts "--since <id> targets a specific factory-sequence"
    - test: packages/core/src/finish-task.test.ts "--since with unknown id refuses gracefully"

**S-3** — `--all-converged` refuses gracefully when no factory-sequence exists
  Given a context dir with no `factory-sequence` records (e.g., a fresh project that only ran single-spec `factory-runtime run` invocations, never `run-sequence`)
  When `factory finish-task --all-converged --dir <dir> --context-dir <ctx>` is invoked
  Then the command exits 1 with stderr `factory: no factory-sequence found in context dir; --all-converged requires at least one run-sequence invocation. Use 'factory finish-task <spec-id>' for individual specs.`. No specs are moved.
  And given the positional `<spec-id>` form (existing v0.0.12 behavior) is invoked alongside `--all-converged` (e.g., `factory finish-task my-spec --all-converged`), the command exits 2 with stderr `factory: --all-converged is mutually exclusive with positional <spec-id>`.
  Satisfaction:
    - test: packages/core/src/finish-task.test.ts "--all-converged refuses when no factory-sequence exists"
    - test: packages/core/src/cli.test.ts "factory finish-task rejects positional id + --all-converged combination"

## Constraints / Decisions

- **CLI surface (locked):** `factory finish-task <spec-id>` (existing) OR `factory finish-task --all-converged [--since <factorySequenceId>]` (new). Mutually exclusive — passing both errors with exit 2.
- **"Most recent" resolution (locked):** the factory-sequence with the largest `recordedAt` timestamp. If multiple sequences share the exact timestamp (unlikely; ms-resolution), pick the lex-larger id (deterministic tie-break).
- **`--since` matches FULL id only.** No partial-id matching, no prefix-match, no fuzzy-match. Keeps resolution unambiguous; pairs cleanly with the `factory-context list` output that prints full ids.
- **Per-spec move semantics inherit from v0.0.12.** Each spec move writes a `factory-spec-shipped` record (existing schema, defined in v0.0.12 spec E). Refuses if the spec already lives in `<dir>/done/<id>.md` (don't double-move).
- **Public API surface delta in `@wifo/factory-core`:** the existing `finishTask` library helper gains an overload to accept `{ allConverged: true, since?: string, dir, contextDir }` instead of `{ specId, dir, contextDir }`. No new exports — the function signature widens; counted as a field-level addition to existing surface. Public exports stay at 34.
- **Stdout format (locked):** per-spec line `factory: shipped <id> → done/ (run <runId-short-8-chars>)`; trailing summary line `factory: shipped <N> specs from sequence <seqId-short-8-chars>`. The short ids are 8-char prefixes for readability.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.13 explicitly does NOT ship in this spec:** auto-fire from runtime on convergence (still opt-in, same as v0.0.12); `--dry-run` preview mode (deferred); `--continue-on-error` (per-spec move failures abort the batch — that's the desired behavior for the move-to-done lifecycle).

## Subtasks

- **T1** [feature] — Extend `packages/core/src/finish-task.ts`'s `finishTask` helper to accept the `--all-converged` shape. Add a new overload signature `{ allConverged: true, since?: string, dir, contextDir }`. Walk factory-sequence + descendant factory-run records to find converged specs. ~80 LOC. **depends on nothing.**
- **T2** [feature] — Update `packages/core/src/cli.ts` to parse `--all-converged` and `--since <id>` flags. Reject the mutually-exclusive case (positional + flag). Dispatch to the new `finishTask` overload. ~30 LOC. **depends on T1.**
- **T3** [test] — `packages/core/src/finish-task.test.ts` covers S-1 + S-2 + S-3 (5 tests). `packages/core/src/cli.test.ts` covers the mutual-exclusion check (1 test). ~110 LOC. **depends on T1, T2.**
- **T4** [chore] — Update `packages/core/README.md`'s `factory finish-task` subsection: document the v0.0.13 batch mode + worked example. ~20 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.13 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/core build`).
- A test verifies that `--all-converged` is mutually exclusive with the positional `<spec-id>` form (exit 2 + clear stderr).
- A test verifies that `--since <unknown-id>` refuses gracefully (exit 1 + stderr) without moving any specs.
- Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.12's 34 names.
- README in `packages/core/` documents v0.0.13 batch mode.
- v0.0.13 explicitly does NOT ship in this spec: auto-fire on convergence; `--dry-run`; `--continue-on-error`. Deferred per Constraints.

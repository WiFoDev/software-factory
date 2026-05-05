---
id: factory-runtime-v0-0-12-correctness
classification: light
type: fix
status: drafting
exemplars:
  - path: packages/runtime/src/sequence.ts
    why: "v0.0.10's run-sequence already-converged dedup currently uses `convergedBySpecId` keyed only on factory-run record existence. v0.0.12 verifies actual convergence status by aggregating descendant factory-phase records — closes the v0.0.11 ship's bug where a no-converge run was incorrectly skipped on retry."
  - path: packages/runtime/src/phases/implement.ts
    why: "implement phase's filesChanged audit (v0.0.6 pre/post snapshot). v0.0.11 short-url BASELINE found the field reports 0 on edits to existing files. v0.0.12 ships telemetry-first — captures raw pre + post snapshots alongside the computed value so the next reproduction is trivially diagnosable."
  - path: packages/runtime/src/records.ts
    why: "FactoryImplementReportSchema. v0.0.12 adds optional `filesChangedDebug: { preSnapshot, postSnapshot }` field. Optional addition — v0.0.11 records remain valid."
  - path: BACKLOG.md
    why: "v0.0.12 entries 'factory-run already-converged dedup must verify actual convergence status' (v0.0.11 ship bug), 'factory-implement-report.filesChanged undercount on edits to existing files' (short-url BASELINE friction #3), 'Investigate agent-exit-nonzero (code=1) at end of iteration' (v0.0.11 ship). All three close in this spec."
depends-on:
  - factory-harness-v0-0-12
---

# factory-runtime-v0-0-12-correctness — close audit-trust gaps from v0.0.11 ship + short-url BASELINE

## Intent

Three correctness/audit-reliability fixes that close v0.0.11-surfaced gaps. (1) The v0.0.10 already-converged dedup in `run-sequence` was found to silently skip prior NO-CONVERGE runs because it keyed only on factory-run record existence — v0.0.12 aggregates descendant `factory-phase` records to verify actual convergence before adding to the skip-map. (2) The v0.0.6 `filesChanged` pre/post snapshot was found to undercount edits to existing files in the v0.0.11 short-url BASELINE — v0.0.12 ships telemetry-first: persist the raw pre + post lists alongside the computed `filesChanged` so the next reproduction is trivially diagnosable. (3) `agent-exit-nonzero (code=1)` events from the v0.0.11 worktree-sandbox spec landed work successfully but classified as `'error'` — v0.0.12 captures the last 10 KB of agent stderr to enable root-cause investigation.

All three are READ-ONLY signal additions: no new behavior, just better data for future fixes.

## Scenarios

**S-1** — Already-converged dedup verifies status before skipping
  Given a context dir contains a prior `factory-run` for spec `a` rooted at the current sequence's `specsDir` AND that run's terminal `factory-phase` records show iter 3's last phase has `status: 'fail'` (no-converge)
  When `factory-runtime run-sequence <dir>` is invoked on a sequence including spec `a`
  Then the dedup logic checks the candidate factory-run by listing its descendant factory-phase records, walks the iterations, and confirms `every iteration's terminal phase status === 'pass'`. The check fails for the no-converge run → spec `a` is NOT added to the skip-map → run-sequence runs spec `a` normally. Logs: `factory-runtime: <id> prior factory-run found but status=no-converge — re-running` to stdout (replaces silent-skip).
  And given the prior run's terminal phases ARE all pass (genuine prior convergence), the dedup map adds the spec → existing v0.0.10 skip behavior preserved.
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "dedup re-runs spec when prior factory-run terminal phase status is fail/error"
    - test: packages/runtime/src/sequence.test.ts "dedup preserves skip when prior factory-run actually converged"

**S-2** — `filesChanged` telemetry capture
  Given an implement phase runs and modifies 3 existing files (`src/server.ts`, `src/store.ts`, `src/types.ts`) without creating new files
  When the phase persists its `factory-implement-report`
  Then the report's `payload.filesChangedDebug` field is present and equals `{ preSnapshot: ['<list of pre-snapshot relative paths>'], postSnapshot: ['<list of post-snapshot relative paths>'] }`. The existing `payload.filesChanged` field is unchanged in computation but now diagnosable: if the field reports 0 while the file list shows differences, the bug is reproducible from the persisted record. v0.0.12 does NOT change the snapshot algorithm — only adds the telemetry side-channel.
  And given the report is consumed by older clients (v0.0.11 schema), the new field is optional — backward-compat is preserved.
  Satisfaction:
    - test: packages/runtime/src/phases/implement.test.ts "factory-implement-report.payload.filesChangedDebug captures raw pre + post snapshots"
    - test: packages/runtime/src/records.test.ts "FactoryImplementReportSchema accepts records with and without filesChangedDebug"

**S-3** — `agent-exit-nonzero` captures last 10 KB of agent stderr in failureDetail
  Given an implement phase invokes `claude -p` and the agent exits with code 1 AFTER having written substantial stderr (e.g., a stack trace from claude itself, or a "message-too-long" error envelope)
  When the runtime captures the failure
  Then the persisted `factory-implement-report.payload.failureDetail` includes (in addition to the existing fields) a `stderrTail: string` field containing up to the last 10 KB of stderr, byte-truncated with a leading `... [truncated, original size N bytes]` marker if oversize. If stderr was empty/short, `stderrTail` contains the full stderr. The runtime's classification of the run as `'error'` is unchanged — telemetry only.
  Satisfaction:
    - test: packages/runtime/src/phases/implement.test.ts "agent-exit-nonzero captures last 10KB of stderr in failureDetail.stderrTail"
    - test: packages/runtime/src/phases/implement.test.ts "stderr smaller than 10KB stored in full"

## Constraints / Decisions

- **All three fixes are signal-only.** No behavior changes; no schema-breaking changes. The dedup status check is a read-only walk; the filesChangedDebug field is optional; the stderrTail field is optional. Older context-store records remain valid; older readers ignore unknown fields per zod schema permissiveness rules.
- **Status verification: aggregate `factory-phase` records.** `convergedBySpecId` is rebuilt as: for each candidate `factory-run`, list `factory-phase` records via `contextStore.list({ type: 'factory-phase', parents: [factoryRunId] })`, group by `iteration`, check that the LAST phase of each iteration has `status: 'pass'`. If yes → add to skip-map. If no → omit. ~30 LOC.
- **`filesChangedDebug` field shape (locked):** `{ preSnapshot: string[]; postSnapshot: string[] }` where each array is sorted relative paths from the working tree. v0.0.6's snapshot logic stays as-is; the field exposes the inputs to the comparison. NO new schema-required field; optional.
- **`stderrTail` byte-truncated, NOT line-truncated.** UTF-8 safety: truncate at the byte boundary; the leading marker `... [truncated, original size <N> bytes]\n` indicates if truncation happened. Leading newline if a multi-byte char gets cut.
- **Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.11's 26 names.** All changes are: (a) internal logic in `sequence.ts`, (b) field-level addition to `FactoryImplementReportSchema` in `records.ts`. No new exports.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.12 explicitly does NOT ship in this spec:** the actual `filesChanged` algorithm replacement (deferred — telemetry first; v0.0.13 candidate); the `agent-exit-nonzero` retry/treat-as-fail decision (deferred — telemetry first; data-dependent); `factory-context iter-cause` subcommand (deferred to v0.0.13 — paired with the per-iteration cause-line ship in factory-runtime-v0-0-12-observability).

## Subtasks

- **T1** [fix] — Update `packages/runtime/src/sequence.ts`'s `convergedBySpecId` builder. For each candidate factory-run, list descendant `factory-phase` records, group by iteration, verify all iterations' last phases are `status: 'pass'` before adding to the skip-map. Add log line on dedup-omission. ~40 LOC. **depends on nothing.**
- **T2** [feature] — Extend `FactoryImplementReportSchema` in `packages/runtime/src/records.ts` with optional `filesChangedDebug: { preSnapshot: string[], postSnapshot: string[] }`. Update `packages/runtime/src/phases/implement.ts` to capture the snapshots (already computed; just persist them). ~25 LOC. **depends on nothing.**
- **T3** [feature] — Extend `factory-implement-report.payload.failureDetail` with optional `stderrTail: string` (10 KB max byte-truncated). Capture in implement.ts when `claude -p` exits non-zero. ~30 LOC. **depends on nothing.**
- **T4** [test] — `packages/runtime/src/sequence.test.ts`: 2 tests covering S-1. `packages/runtime/src/phases/implement.test.ts`: 4 tests covering S-2 + S-3. `packages/runtime/src/records.test.ts`: 1 test for backward-compat. ~110 LOC. **depends on T1-T3.**
- **T5** [chore] — Update `packages/runtime/README.md`: brief note on the v0.0.12 telemetry additions + dedup correctness fix. ~20 LOC. **depends on T4.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/runtime typecheck`).
- tests green (`pnpm -C packages/runtime test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.12 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/runtime build`).
- The dedup test verifies that a prior NO-CONVERGE run does NOT get skipped on retry (regression-pin for the v0.0.11 ship bug).
- The records test verifies backward-compat: a v0.0.11-shaped record (no `filesChangedDebug`) still parses cleanly under the v0.0.12 schema.
- Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.11's 26 names.
- v0.0.12 explicitly does NOT ship in this spec: filesChanged algorithm replacement; agent-exit retry decision; factory-context iter-cause subcommand. Deferred per Constraints.

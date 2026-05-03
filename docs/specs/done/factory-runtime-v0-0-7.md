---
id: factory-runtime-v0-0-7
classification: deep
type: feat
status: ready
exemplars:
  - path: packages/runtime/src/runtime.ts
    why: "The existing per-spec `run()` orchestrator (lines 91-286). v0.0.7 adds a sibling `runSequence()` that walks a DAG and calls `run()` per spec in topological order. `run()` itself gains an optional `runParents?: string[]` arg so per-spec `factory-run` records can parent at `[factorySequenceId]` (rather than `[]`). Field-level addition; existing callers unchanged."
  - path: packages/runtime/src/cli.ts
    why: "The existing `factory-runtime run <spec>` CLI (lines 86-405). v0.0.7 adds a sibling `run-sequence <dir>/` subcommand. Mirrors `runRun`'s shape: parseArgs → validate flags → load + parse → execute → exit-code mapping. Reuses the v0.0.5.1 factory.config.json read path; gains two new optional config keys (`runtime.maxSequenceTokens`, `runtime.continueOnFail`)."
  - path: packages/runtime/src/records.ts
    why: "Existing `FactoryRunSchema` (lines 4-10) + the `tryRegister` helper. v0.0.7 adds `FactorySequenceSchema` alongside; persisted at sequence start before any per-spec `run()`; parents `[]` (root); every per-spec `factory-run` inherits this id via the new `runParents` arg."
  - path: docs/specs/done/factory-runtime-v0-0-3.md
    why: "Reference: the v0.0.3 spec that added `RunOptions.maxTotalTokens` (whole-run cap on summed agent tokens) + one new `RuntimeErrorCode`. v0.0.7's `RunSequenceOptions.maxSequenceTokens` mirrors that pattern at one level higher: per-spec cap (existing) + sequence cap (new). v0.0.3's pre-loop validation pattern is copied for the new `--max-sequence-tokens` flag."
  - path: packages/context/src/tree.ts
    why: "v0.0.4's `buildDescendantTree` (called by `tree --direction down`). Walks `record.parents[]` generically across record types. v0.0.7 introduces a new `factory-sequence` record type whose descendants include every per-spec `factory-run` (which now parents at `[factorySequenceId]`). H-3 pins this end-to-end: `tree --direction down <factorySequenceId>` walks every spec's run + every iteration's reports."
  - path: docs/baselines/url-shortener-prompt.md
    why: "The 4-spec canonical product. The v0.0.7 release-gate smoke test runs `factory-runtime run-sequence` against a v0.0.7-scoped URL-shortener spec set (with `depends-on:` populated by `/scope-project`). Expected: one CLI invocation produces all 4 spec runs in topological order; `factory-context tree --direction down <factorySequenceId>` walks the entire product DAG. The 32-interventions friction quantified in v0.0.6 BASELINE collapses to ~8."
  - path: BACKLOG.md
    why: "Section 'factory-runtime: spec-sequence runner' under 'Real-product workflow.' Source of truth for the Why and the design questions. Promoted from v0.0.8 to v0.0.7 by the v0.0.6 BASELINE evidence (32 manual interventions per 4-spec product)."
---

# factory-runtime-v0-0-7 — `factory-runtime run-sequence`: spec-sequence runner

## Intent

Add a new `factory-runtime run-sequence <dir>/` CLI subcommand that walks every `*.md` spec under `<dir>`, builds a DAG from each spec's `depends-on` field (added in `factory-core-v0-0-7`), and runs each spec via the existing per-spec `run()` path in topological order. Stops on the first non-converging spec by default; `--continue-on-fail` continues with independent specs; transitive dependents of any failed spec are marked `'skipped'` (never run). Persists a new `factory-sequence` context record at the start of the sequence; every per-spec `factory-run` parents to it via a new optional `runParents?: string[]` arg on the existing `run()` function. Result: `factory-context tree --direction down <factorySequenceId>` walks the entire product DAG (sequence → run → phase → reports), per spec.

Closes the manual handoff between specs that v0.0.6's BASELINE quantified at 32 maintainer interventions per 4-spec product. With `run-sequence`, that drops to ~8: lint + review the slash-command output once, then run-sequence walks the whole DAG.

Two new public exports from `@wifo/factory-runtime`: `runSequence` (function) + `SequenceReport` (type). Three new `RuntimeErrorCode` values: `runtime/sequence-cycle`, `runtime/sequence-dep-not-found`, `runtime/sequence-cost-cap-exceeded`. One new context record type: `factory-sequence`. Field-level addition to `RunArgs` (optional `runParents?: string[]`) so existing callers don't break.

The technical plan is at `docs/technical-plans/factory-runtime-v0-0-7.md`.

## Scenarios

**S-1** — `factory-runtime run-sequence <dir>/` runs every spec in topological order; converged sequence exits 0
  Given a tmp `<dir>` containing 3 spec files: `a.md` (id=a, depends-on=[]), `b.md` (id=b, depends-on=[a]), `c.md` (id=c, depends-on=[a, b]). All 3 specs are minimal pass-on-iter-1 fixtures (use the existing `needs-iter2.md`-style harness).
  When `factory-runtime run-sequence <dir> --context-dir <ctx> --no-implement` is invoked
  Then exit code `0`; stdout contains `factory-runtime: sequence converged (3/3 specs, factorySequenceId=<id>, <ms>ms)`. The context dir contains exactly one `factory-sequence` record (root) with `topoOrder = ['a', 'b', 'c']`. The context dir contains 3 `factory-run` records, each with `parents[0] === factorySequenceId`. Each per-spec run's `factory-run.payload.specId` matches the spec's frontmatter id. Topological order is alphabetic on tie (a, b, c — but `c` lists `a, b` so `c` is last).
  And given the same setup but with the depends-on chain `a ← b ← c` (linear), the topological order is `['a', 'b', 'c']` (no ambiguity).
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "run-sequence executes specs in topological order; root sequence record + parented per-spec runs persisted"
    - test: packages/runtime/src/sequence.test.ts "topoOrder ties broken alphabetically by id"

**S-2** — Cycle in `depends-on` → exit 3 with `runtime/sequence-cycle`; missing dep → exit 3 with `runtime/sequence-dep-not-found`
  Given a tmp `<dir>` containing 2 spec files: `a.md` (depends-on=[b]) and `b.md` (depends-on=[a]) — a 2-cycle
  When `factory-runtime run-sequence <dir> --context-dir <ctx>` is invoked
  Then exit code `3`; stderr contains `runtime/sequence-cycle: depends-on cycle: a → b → a`. Zero per-spec `factory-run` records persisted (the sequence aborted before any per-spec call).
  And given a tmp `<dir>` containing only `a.md` with `depends-on=[ghost]` (where `ghost.md` does not exist in `<dir>`), exit code `3`; stderr contains `runtime/sequence-dep-not-found: spec 'a' depends on 'ghost' which is not in <dir>`. Zero per-spec runs.
  And given a 3-cycle (a → b → c → a), the error message names the cycle path; the smallest cycle reported (not just any cycle).
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "run-sequence rejects 2-cycle with runtime/sequence-cycle"
    - test: packages/runtime/src/sequence.test.ts "run-sequence rejects missing depends-on target with runtime/sequence-dep-not-found"
    - test: packages/runtime/src/sequence.test.ts "run-sequence reports smallest cycle in 3-cycle"

**S-3** — `--continue-on-fail` skips dependents of a failed spec but continues with independent roots
  Given a tmp `<dir>` with 4 specs: `a.md` (depends-on=[]), `b.md` (depends-on=[a]) → designed to NOT converge (max-iterations=1, no-converge fixture), `c.md` (depends-on=[b]), `d.md` (depends-on=[]) — independent root.
  When `factory-runtime run-sequence <dir> --context-dir <ctx> --continue-on-fail --max-iterations 1 --no-implement` is invoked
  Then exit code `1` (sequence partial: some specs converged, some didn't). The `SequenceReport.specs` array (returned programmatically; CLI prints summary) contains: `a` status=converged, `b` status=no-converge, `c` status=skipped (blockedBy=b), `d` status=converged. `factory-context tree --direction down <factorySequenceId>` walks 3 per-spec `factory-run` records (a, b, d — c was never run, so no factory-run for it).
  And given the same setup WITHOUT `--continue-on-fail`, the runtime stops after `b`'s no-converge: only `a` (converged) and `b` (no-converge) ran; `c` AND `d` are recorded as skipped (the runtime aborted the loop). Exit code `1`.
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "--continue-on-fail skips transitive dependents but runs independent roots"
    - test: packages/runtime/src/sequence.test.ts "default (no --continue-on-fail) stops after first non-converging spec"

**S-4** — Per-spec `--max-total-tokens` AND new `--max-sequence-tokens` both enforced; sequence-cap trip aborts mid-loop
  Given a tmp `<dir>` with 3 specs (linear chain a → b → c), each fixture-rigged to consume 100k tokens via the fake-claude implement path
  When `factory-runtime run-sequence <dir> --max-sequence-tokens 250000 --context-dir <ctx>` is invoked
  Then `a` runs and consumes 100k (cumulative 100k, under cap). `b` runs and consumes 100k (cumulative 200k, under cap). `c` is about to run; the runtime checks the cumulative total + projected next spec's max would exceed 250k and aborts BEFORE invoking `run()` for `c`. Exit code `3`; stderr contains `runtime/sequence-cost-cap-exceeded: cumulative=200000 + next-spec-cap=500000 > maxSequenceTokens=250000`.
  And given `--max-sequence-tokens 1000000` (above the cumulative + cap), all 3 specs run; sequence converges; exit 0.
  And given NO `--max-sequence-tokens` flag, the per-spec cap still applies but the sequence cap is unbounded (default behavior).
  Note: the cap is enforced PRE-RUN of each spec — comparing `cumulative + nextSpecMaxTotalTokens` against `maxSequenceTokens`. NOT post-hoc on cumulative-after-run, because that would let one spec consume the whole budget before tripping the cap.
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "--max-sequence-tokens trips before invoking next spec when cumulative + next-cap exceeds limit"
    - test: packages/runtime/src/sequence.test.ts "--max-sequence-tokens above cumulative+cap allows all specs to run"
    - test: packages/runtime/src/sequence.test.ts "absent --max-sequence-tokens leaves sequence-level cap unbounded"

**S-5** — Per-spec `factory-run` records parent at `[factorySequenceId]`; existing single-spec `factory-runtime run` unchanged
  Given a tmp `<dir>` with 1 spec (`a.md`, depends-on=[])
  When `factory-runtime run-sequence <dir> --context-dir <ctx> --no-implement` is invoked
  Then the persisted `factory-sequence` record has `parents: []`; the persisted `factory-run` record has `parents: [factorySequenceId]`. `factory-context tree <factorySequenceId> --dir <ctx> --direction down` walks the sequence record + the per-spec run record + the run's phase records (full DAG).
  And given an existing `factory-runtime run <spec>` invocation (single-spec, NOT through run-sequence), the persisted `factory-run.parents` equals `[]` (v0.0.6 root behavior unchanged). NO `factory-sequence` record is persisted.
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "factory-run records from run-sequence have factorySequenceId in parents[]"
    - test: packages/runtime/src/sequence.test.ts "single-spec factory-runtime run still produces factory-run with parents=[]"
    - test: packages/runtime/src/runtime.test.ts "run() with optional runParents arg threads them into factory-run.parents"

## Holdout Scenarios

**H-1** — Diamond DAG: independent paths converge cleanly under topological ordering
  Given a tmp `<dir>` with 4 specs forming a diamond: `core` (depends-on=[]), `redirect` (depends-on=[core]), `tracking` (depends-on=[core]), `stats` (depends-on=[redirect, tracking])
  When `factory-runtime run-sequence <dir> --context-dir <ctx> --no-implement` is invoked
  Then exit 0; topological order is `[core, redirect, tracking, stats]` (alphabetic tie-break between redirect and tracking) OR `[core, tracking, redirect, stats]` (depending on Kahn's queue order — both valid). The test asserts `core` is first, `stats` is last, and both `redirect` and `tracking` come between. All 4 specs converge; `factory-context tree --direction down <factorySequenceId>` shows the full diamond.

**H-2** — A non-converging spec mid-DAG with `--continue-on-fail`: dependents skipped, parallel-non-dependent roots still run, partial status reported
  Given a tmp `<dir>` with 5 specs: `core` (depends-on=[]), `auth` (depends-on=[core], rigged to no-converge), `endpoints` (depends-on=[auth]), `dashboard` (depends-on=[]), `static-assets` (depends-on=[dashboard])
  When `factory-runtime run-sequence <dir> --continue-on-fail --max-iterations 1 --no-implement` is invoked
  Then `core` converges, `auth` no-converges, `endpoints` is `'skipped'` (blockedBy=auth), `dashboard` converges, `static-assets` converges. SequenceReport.status === `'partial'`. Exit code 1. The test asserts: (a) the failed-set after the run contains exactly `auth` + `endpoints`; (b) `static-assets` is NOT in the failed-set despite running after `auth` failed (its parent chain is independent).

**H-3** — `factory-context tree --direction down <factorySequenceId>` walks the full multi-spec DAG including iterations
  Given a tmp `<dir>` with 2 specs (`a.md`, `b.md` with `a` as dep), each rigged to converge in 2 iterations (using the existing `needs-iter2.md` fixture pattern)
  When `factory-runtime run-sequence <dir> --context-dir <ctx>` runs to completion, then `factory-context tree <factorySequenceId> --dir <ctx> --direction down` is invoked
  Then the printed tree shows: `factory-sequence` at the root → 2 `factory-run` records (one per spec) → per-iteration `factory-phase` records → per-phase `factory-implement-report` + `factory-validate-report` records (each iteration's set). Total record count under the sequence: 1 + 2 + (2 specs × 2 iterations × 2 phases) + (per-phase reports) = at least 9. The test asserts the count is ≥ expected and that every per-spec `factory-run` is reachable from `factorySequenceId`.

## Constraints / Decisions

- **CLI subcommand shape (locked):** `factory-runtime run-sequence <dir>/`. Verb-noun, mirrors the existing `run` subcommand. NOT `run --sequence` (different argument shape: directory vs. single file changes the parser semantics). NOT `sequence-run` (verb-noun reads better). NOT `factory-runtime sequence run-all` (over-nested).
- **Source of specs:** `<dir>/*.md` non-recursive. Specs in `<dir>/done/` are NOT picked up — sequence runs ACTIVE specs only. Sequence completion does NOT auto-move specs to `done/` (that's a maintainer task, parallel to the per-spec `/finish-task` flow).
- **DAG construction:** every dep id must reference a spec in `<dir>` (NOT recursing into `done/`). Dep refers to a spec in `done/` → `runtime/sequence-dep-not-found`. Rationale: the sequence-runner is for SHIPPING specs; deps that already shipped are external constraints, not part of the sequence DAG. The `cross-doc-consistency` reviewer judge from spec 2 handles cross-`done/` consistency at review time.
- **Topological sort algorithm:** Kahn's algorithm. Tie-break on alphabetic id ascending (deterministic across platforms). Cycle detection via DFS three-color marking; smallest cycle reported in the error message.
- **`run()` function gains optional `runParents?: string[]` field on `RunArgs`** — field-level addition. When provided, the persisted `factory-run` record uses `parents: runParents`; when absent, parents=`[]` (existing v0.0.6 behavior). `runSequence` passes `[factorySequenceId]`. NOT a new export.
- **New context record type `factory-sequence`** registered in `packages/runtime/src/records.ts` with `FactorySequenceSchema`. Persisted at sequence start (BEFORE any per-spec `run()` call). Parents `[]` (root of the sequence DAG).
- **`factory-sequence` record payload:** `specsDir, topoOrder, startedAt, maxIterations?, maxTotalTokens?, maxSequenceTokens?, continueOnFail`. Mirrors `factory-run.payload`'s shape.
- **Failure handling:**
  - DEFAULT (`--continue-on-fail` absent): stop on first non-converging spec; mark all subsequent specs as `'skipped'` (with `blockedBy: '<first-failed-id>'` for the first skipped spec; subsequent skipped specs also use the FIRST failed dep in their transitive chain).
  - `--continue-on-fail`: continue with independent roots. A spec is `'skipped'` if any of its transitive deps are in the failed-set. The failed-set updates as the loop progresses.
  - `'skipped'` is a status-level value on `SequenceSpecResult.status`. The `SequenceReport.specs` array preserves the topological order; skipped entries have `runReport: undefined`.
  - `'error'` (a `RuntimeError` thrown out of `run()`) — counted as a failure for cascade purposes; `SequenceReport.status === 'error'` if any spec result was `'error'` (regardless of `--continue-on-fail`).
- **`SequenceReport.status` values:**
  - `'converged'` — every spec converged (none failed, none skipped).
  - `'partial'` — some specs converged, some didn't (failed-set non-empty AND non-failed-set non-empty).
  - `'no-converge'` — all specs failed or skipped.
  - `'error'` — any spec result was `'error'` (RuntimeError thrown). Distinct from non-converge.
- **Exit codes:**
  - `0` — `'converged'`.
  - `1` — `'partial'` or `'no-converge'`.
  - `2` — CLI argument error (bad flag, missing positional, bad `<dir>` path).
  - `3` — `'error'` (RuntimeError: cycle, missing dep, sequence-cost-cap, IO failure).
- **New `RuntimeErrorCode` values:** `'runtime/sequence-cycle'`, `'runtime/sequence-dep-not-found'`, `'runtime/sequence-cost-cap-exceeded'`. Enum count: 10 → 13.
- **Cost capping:**
  - Existing per-spec `RunOptions.maxTotalTokens` (default 500_000) applies per-spec — unchanged.
  - New `RunSequenceOptions.maxSequenceTokens?: number` (no built-in default — unbounded when absent). Threaded from CLI flag `--max-sequence-tokens <n>` with positive-integer validation; bad value → exit 2 with stderr label `runtime/invalid-max-sequence-tokens:`.
  - **Pre-run check semantics:** before invoking `run()` for each spec in topological order, the runtime computes `cumulative + nextSpecMaxTotalTokens`. If this exceeds `maxSequenceTokens`, abort with `RuntimeError({ code: 'runtime/sequence-cost-cap-exceeded' })`. Pre-run check (NOT post-hoc) prevents one spec from blowing the entire sequence budget on its own.
  - Cumulative count: sum across all `factory-implement-report.tokens.input + tokens.output` for completed per-spec runs. `RunReport` gains a field `totalTokens?: number` (computed in-memory at the end of `run()` from the report's own iterations) so the sequence accumulator doesn't need to re-walk the context store.
- **`RunReport.totalTokens?: number`** — field-level addition. Existing programmatic callers don't break (optional field). Used by `runSequence` to accumulate sequence totals.
- **`factory.config.json` extensions:** new optional keys `runtime.maxSequenceTokens` (number) and `runtime.continueOnFail` (boolean). Read by the v0.0.5.1 `readFactoryConfig` helper (already partial-schema, so unknown keys are ignored — these are now KNOWN keys but added forward-compat-style). Precedence unchanged: CLI flag > config file > built-in default.
- **Public API surface deltas (locked):**
  - `@wifo/factory-runtime/src/index.ts`: 19 → **21** names. Two new exports:
    - `runSequence` (function from `packages/runtime/src/sequence.ts`)
    - `SequenceReport` (type from `packages/runtime/src/sequence.ts`)
  - `RunSequenceArgs`, `RunSequenceOptions`, `SequenceSpecResult` are NOT re-exported (internal-only — minimum surface for callers).
  - `RuntimeErrorCode`: 10 → 13 values. Enum extension (field-level on already-exported type).
  - `RunReport.totalTokens?: number` — field-level addition on already-exported type.
  - `RunArgs.runParents?: string[]` — field-level addition on already-exported type.
  - All other surfaces unchanged across `@wifo/factory-context`, `@wifo/factory-core`, `@wifo/factory-harness`, `@wifo/factory-spec-review`, `@wifo/factory-twin`.
- **Coordinated package version bumps:** all six `@wifo/factory-*` packages bump to `0.0.7` (lockstep). Matches v0.0.5 / v0.0.6 pattern.
- **Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere.**
- **v0.0.7 explicitly does NOT ship:**
  - **Parallel execution of independent specs at the same DAG depth.** Sequential by design in v0.0.7 — predictable cost, predictable provenance. v0.0.8+ candidate.
  - **`--retry-on-fail <n>` flag.** Failed specs stay failed in v0.0.7; retry semantics deferred.
  - **Auto-flip `status: drafting` → `ready` after each spec converges.** Maintainer-driven status flips remain manual in v0.0.7. Pairs with the eventual scheduler (Layer 5).
  - **`factory-runtime run --sequence` shorthand.** Only `run-sequence` subcommand surface in v0.0.7.

## Subtasks

- **T1** [feature] — `packages/runtime/src/records.ts`: add `FactorySequenceSchema` (Zod) + `FactorySequencePayload` (inferred type) following the `FactoryRunSchema` pattern. Export the type from `packages/runtime/src/index.ts` as an internal type (or NOT — leaning NOT, since callers only need `SequenceReport`). ~30 LOC. **depends on nothing.**
- **T2** [feature] — `packages/runtime/src/runtime.ts`: extend `RunArgs` with `runParents?: string[]`; thread into `putOrWrap(contextStore, 'factory-run', ..., runParents ?? [])`. ~5 LOC. Tests in `packages/runtime/src/runtime.test.ts`: 1 test asserting `runParents=[id1, id2]` produces `factory-run.parents=[id1, id2]`; 1 test asserting `runParents` absent produces `factory-run.parents=[]` (existing v0.0.6 behavior). ~50 LOC test. **depends on nothing (parallel with T1).**
- **T3** [feature] — `packages/runtime/src/sequence.ts` (NEW FILE): main `runSequence(args: RunSequenceArgs): Promise<SequenceReport>` implementation. Sub-helpers: `loadSpecs(specsDir)` walks `<dir>/*.md` and parses each; `buildDag(specs)` validates depends-on edges + detects cycles + topo-sorts via Kahn's; `runSequenceLoop(...)` iterates topo order, calls `run()` per spec with `runParents=[factorySequenceId]`, accumulates `totalTokens`, enforces sequence-cost-cap pre-run, handles failure cascade (stop-on-fail vs --continue-on-fail). New types: `RunSequenceArgs`, `RunSequenceOptions`, `SequenceSpecResult`, `SequenceReport`. ~250 LOC. **depends on T1, T2.**
- **T4** [feature] — `packages/runtime/src/runtime.ts`: extend `RunReport` with `totalTokens?: number`; compute at end of `run()` by summing `factory-implement-report.tokens.input + tokens.output` across all iterations. Field-level addition (no new export). ~10 LOC. **depends on nothing.**
- **T5** [feature] — `packages/runtime/src/errors.ts`: add three new `RuntimeErrorCode` values (`'runtime/sequence-cycle'`, `'runtime/sequence-dep-not-found'`, `'runtime/sequence-cost-cap-exceeded'`). ~5 LOC. **depends on nothing.**
- **T6** [feature] — `packages/runtime/src/cli.ts`: add new `run-sequence` subcommand to the `runCli` dispatch. New `runRunSequence(args, io)` helper: parseArgs (positional `<dir>`, flags `--max-iterations`, `--max-total-tokens`, `--max-sequence-tokens`, `--max-agent-timeout-ms`, `--continue-on-fail`, `--context-dir`, `--max-prompt-tokens`, `--claude-bin`, `--twin-mode`, `--twin-recordings-dir`); positive-integer validation on `--max-sequence-tokens`; load `factory.config.json` (extend the `FactoryConfigRuntimeSchema` partial with `maxSequenceTokens` + `continueOnFail`); compose graph (same as `runRun`); call `runSequence`; format output (`factory-runtime: sequence converged (N/M specs, factorySequenceId=<id>, <ms>ms)` for converged; per-status summary for partial / no-converge / error); exit-code mapping per Constraints. ~250 LOC. **depends on T3, T5.**
- **T7** [feature] — `packages/runtime/src/index.ts`: re-export `runSequence` + `SequenceReport`. Surface count goes 19 → 21. ~3 LOC. **depends on T3.**
- **T8** [test] — `packages/runtime/src/sequence.test.ts` (NEW FILE): Bun tests covering S-1, S-2, S-3, S-4, S-5 + holdouts H-1, H-2, H-3 using mkdtempSync + the existing fixture-spec patterns + fake-claude path under `--no-implement`. ~500 LOC across all scenarios. **depends on T3, T6.**
- **T9** [test] — `packages/runtime/src/cli.test.ts`: extend with run-sequence tests: positive-integer validation on `--max-sequence-tokens` (bad value → exit 2 with `runtime/invalid-max-sequence-tokens:` label); `--continue-on-fail` recognized; subcommand routing (`runCli(['run-sequence', ...])` reaches the right handler); converged-sequence stdout formatting. ~80 LOC. **depends on T6.**
- **T10** [test] — `packages/runtime/src/records.test.ts`: 1 test asserting `factory-sequence` schema validates a representative payload + rejects a payload missing `topoOrder`. ~30 LOC. **depends on T1.**
- **T11** [chore] — Update `packages/runtime/README.md` documenting the `run-sequence` subcommand, the new `factory-sequence` record type, the `factory-context tree --direction down` integration, the failure cascade semantics, the cost-cap layering. Update top-level `README.md` v0.0.7 release notes mentioning `run-sequence` alongside `/scope-project` + `depends-on`. Bump all six `@wifo/factory-*` package.json files to `0.0.7`. ~120 LOC. **depends on T1..T10.**

## Definition of Done

- All scenarios (S-1..S-5) AND holdouts (H-1..H-3) pass.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`. `node packages/runtime/dist/cli.js run-sequence` is wired and exits 2 (missing positional) when called with no args.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.7 cluster (this spec + the cluster's other two specs).
- **Deterministic CI smoke**: a Bun test creates a tmp `<dir>` with 3 minimal pass-on-iter-1 spec files (linear depends-on chain), invokes `runCli(['run-sequence', dir, '--no-implement', '--context-dir', ctxDir])` programmatically, asserts exit 0 + the persisted records form the expected DAG (1 sequence root + 3 per-spec runs + their phases + reports).
- **Manual smoke (release-gate, optional but recommended)**: re-run the canonical URL-shortener prompt against v0.0.7 — `/scope-project` writes 4 specs; `factory-runtime run-sequence docs/specs/` walks all 4 and converges. Compare to v0.0.6 BASELINE (~4½ minutes agent compute, 32 maintainer interventions). v0.0.7 target: same agent compute, ≤ 8 maintainer interventions. Captured in `BASELINE.md` v0.0.7 entry after this spec ships.
- Public API surface from `@wifo/factory-runtime/src/index.ts` is **21 names** (was 19 in v0.0.6; +2 new exports: `runSequence` + `SequenceReport`). Surface-lock test enforces this.
- `RuntimeErrorCode` enum has **13 values** (was 10; +3 new codes).
- Public API surface from all other `@wifo/factory-*` packages strictly equal to v0.0.6's surfaces (the spec 2 surface deltas in `@wifo/factory-core` are scored against THAT spec's DoD, not this one).
- All six package.json files at `0.0.7`.
- README in `packages/runtime/` documents `run-sequence` with examples; top-level `README.md` v0.0.7 release notes mention `run-sequence`.
- v0.0.7 explicitly does NOT ship: parallel spec execution; `--retry-on-fail`; auto-status-flip; `run --sequence` shorthand. Deferred per Constraints.

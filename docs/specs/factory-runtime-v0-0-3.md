---
id: factory-runtime-v0-0-3
classification: deep
type: feat
status: ready
exemplars:
  - path: packages/runtime/src/runtime.ts
    why: "Existing iteration loop. v0.0.3 extends it (default flip 1→5, ctx.inputs population including prior-iteration terminal threading for root phases on iter ≥ 2, whole-run token-cap check inside the per-phase try block). Don't rewrite — extend."
  - path: packages/runtime/src/phases/implement.ts
    why: "v0.0.2 cost-cap chain (persist factory-implement-report with status='error' before throwing RuntimeError). v0.0.3 mirrors this chain at the runtime level for the whole-run cap. Also: buildPrompt gains a priorValidateReport param; payload schema gains priorValidateReportId; parents extend with the prior validate-report id."
  - path: packages/runtime/src/phases/validate.ts
    why: "Reference for the factory-function pattern + tryRegister + parents. v0.0.3 extends parents to include the same-iteration implement-report id (filtered from ctx.inputs)."
  - path: packages/runtime/src/cli.ts
    why: "Manual subcommand dispatch + parseArgs + injectable CliIo. v0.0.3 adds --max-total-tokens with the same positive-integer validation pattern as --max-prompt-tokens; bad flag values exit 2 with a stderr label (string, not a RuntimeErrorCode value)."
  - path: docs/specs/done/factory-runtime-v0-0-2.md
    why: "v0.0.2 spec — the public-API surface (19 names), the cost-cap-exceeded chain, the is_error → 'fail' semantics, the on-disk record set. v0.0.3 keeps strict equality with the v0.0.2 surface (zero new exports) and mirrors the cost-cap chain at the runtime level."
  - path: packages/runtime/test-fixtures/fake-claude.ts
    why: "Existing FAKE_CLAUDE_MODE shape (success / self-fail / cost-overrun / echo-env / etc.). v0.0.3 adds a fail-then-pass mode (driven by a per-process counter file under FAKE_CLAUDE_STATE_DIR) so the runtime test fixture can prove iterationCount > 1 deterministically without real claude."
---

# factory-runtime-v0-0-3 — Closed autonomous iteration loop: cross-iteration record threading, whole-run cost cap, default `--max-iterations 5`

## Intent

Close the human-in-the-loop gap from v0.0.2: `factory-runtime run <spec>` drives `[implement → validate]` repeatedly until convergence (default 5 iterations) with no human intervention between iterations. Three additions only:

1. **`--max-iterations` default flips from 1 to 5.** Same flag.
2. **Cross-iteration record threading.** Iteration N+1's `implementPhase` builds its prompt with a new `# Prior validate report` section populated from iteration N's `factory-validate-report` — only the failed scenarios (id + name + failureDetail). Iter 1 omits the section. The prior validate-report's id is stored on `factory-implement-report.payload.priorValidateReportId`. The DAG parent chain extends: `factory-implement-report.parents = [runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`; `factory-validate-report.parents = [runId, implementReportIdFromSameIteration]`. `factory-context tree <validate-report-id>` walks the full multi-iteration ancestry back to the run.
3. **Whole-run cost cap.** New `RunOptions.maxTotalTokens?: number` (default 500_000), summed across every implement invocation in the run as `tokens.input + tokens.output`. Overrun aborts with `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })` — exactly **one** new `RuntimeErrorCode` (total 10). Per-phase `maxPromptTokens` from v0.0.2 still applies. New CLI flag `--max-total-tokens <n>` (positive integer; CLI-flag-validated like `--max-prompt-tokens`, with a stderr label that is **not** a `RuntimeErrorCode` value).

The threading is implemented via a single addition to `PhaseContext`: `inputs: readonly ContextRecord[]`. The runtime populates it per phase invocation (same-iteration predecessors + prior-iteration terminal outputs for root phases on iter ≥ 2). Both built-in phases consume it by filtering on `record.type`. No new public exports. Public API surface stays at **19 names**.

Demo: a new `examples/gh-stars/docs/specs/gh-stars-v2.md` adds scenarios known to require iteration 2+ (pagination, ETag/conditional caching, retry-with-backoff on transient 5xx). The DoD's `iterationCount > 1` assertion runs against a deterministic runtime test fixture (`needs-iter2.md` + a `fail-then-pass` fake-claude mode), not the real-claude gh-stars-v2 demo (which is a manual smoke documented in the README).

Deferred to v0.0.4+ (do not include): `explorePhase`/`planPhase` separation, holdout-aware automated convergence, worktree sandbox, streaming cost monitoring, scheduler.

## Scenarios

**S-1** — Default `maxIterations` is `5`; existing single-shot pass still converges in iteration 1
  Given a fixture spec at `test-fixtures/all-pass.md` (validate-only graph) and a tmp `ContextStore`
  When `run({ spec, graph: definePhaseGraph([validatePhase()], []), contextStore })` is called with **no** `options.maxIterations` override
  Then `RunReport.iterationCount === 1`, `RunReport.status === 'converged'`; the persisted `factory-run.payload.maxIterations === 5` (the resolved default, not the actual count of iterations the run took)
  And given the CLI `factory-runtime run test-fixtures/all-pass.md --no-judge --no-implement --context-dir <tmp>`, `<tmp>/factory-run/<id>.json`'s payload contains `"maxIterations": 5`; the stdout summary line is `factory-runtime: converged in 1 iteration(s) ...`
  Satisfaction:
    - test: `src/runtime.test.ts` "default maxIterations is 5"
    - test: `src/cli.test.ts` "default --max-iterations is 5; persisted factory-run.payload.maxIterations === 5"

**S-2** — Iteration auto-loop: a spec that fails iter 1 implement converges by iter 2 with cross-iter threading visible on disk
  Given `test-fixtures/needs-iter2.md` (a spec whose validate test asserts `src/needs-iter2.ts` returns a specific value), `fake-claude.ts` in `FAKE_CLAUDE_MODE=fail-then-pass` (driven by a per-process counter file under `FAKE_CLAUDE_STATE_DIR`; first invocation writes a stub that fails the validate test + `is_error: true`; second invocation writes the satisfying impl + `is_error: false`), and `run` invoked with default options (i.e. `maxIterations = 5`)
  When the run completes
  Then `RunReport.iterationCount === 2`, `RunReport.status === 'converged'`; on disk: exactly two `factory-implement-report` records and two `factory-validate-report` records; iter 2's `factory-implement-report.payload.priorValidateReportId` equals iter 1's `factory-validate-report` record id; iter 2's `factory-implement-report.parents` contains exactly `[runId, priorValidateReportId]` (in that order); iter 2's prompt (visible in `payload.prompt`) contains the substring `# Prior validate report` and includes the failed scenario id from iter 1; iter 1's `factory-implement-report.payload.priorValidateReportId === undefined`; iter 1's `factory-implement-report.parents` is `[runId]` (single element); iter 1's prompt does **not** contain `# Prior validate report`
  Satisfaction:
    - test: `src/phases/implement.test.ts` "iter 2 prompt has Prior section + priorValidateReportId; iter 1 omits both"
    - test: `src/runtime.test.ts` "fail-then-pass: iterationCount === 2, status converged, parent chain extended"
    - judge: "the iter-2 prompt's Prior validate report section reads naturally — a developer skimming it knows immediately which scenarios failed in the previous iteration and what the failureDetail said"

**S-3** — DAG parent chain extends correctly across iterations; `factory-context tree` walks the full ancestry
  Given the same setup as S-2 (after the run completes; two iterations of implement + validate on disk)
  When `factory-context tree <iter2-validate-report-id> --dir <ctx-dir>` is invoked
  Then the output walks: `validate-report (iter 2)` → `factory-run` AND `validate-report (iter 2)` → `implement-report (iter 2)` → `factory-run` AND → `validate-report (iter 1)` → `factory-run` AND → `implement-report (iter 1)` → `factory-run` (the runId is reachable via every chain)
  And given the same fixture, the persisted `factory-validate-report` from iter 2 has `parents === [runId, iter2-implement-report-id]` (exactly two entries, in that order); from iter 1 has `parents === [runId, iter1-implement-report-id]`
  Satisfaction:
    - test: `src/runtime.test.ts` "validate-report.parents includes [runId, sameIterImplementReportId] in implement→validate graph"
    - test: `src/runtime.test.ts` "factory-context tree walks multi-iteration ancestry back to runId from any leaf"

**S-4** — Whole-run cost cap: per-iteration tokens accumulate; overrun persists the implement-report (via parents=[runId,...]), persists factory-phase with status='error', sets RunReport.status='error'
  Given a fixture spec where each iteration's implement reports `tokens.input: 200_000, tokens.output: 50_000` (250k per iteration), `RunOptions.maxTotalTokens: 400_000`, `maxIterations: 5`, and `fake-claude` configured to drive multi-iteration runs (e.g., always `is_error: true` so the loop continues; or `fail-then-pass` so iter 2 would converge)
  When the run completes
  Then iter 1 runs to completion (running_total = 250k, within cap); iter 2's implement returns; the runtime sums tokens (running_total = 500k > cap=400k); the runtime throws `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })` from inside the per-phase try block; the catch persists `factory-phase` for iter-2-implement with `status: 'error'`, `failureDetail` starting with `runtime/total-cost-cap-exceeded: running_total=500000 > maxTotalTokens=400000`, `outputRecordIds: []` (the catch resets outputs); iter 2's `factory-implement-report` is **on disk** with `parents` including `runId` (discoverable via `factory-context tree <runId>`), persisted by implementPhase before the runtime checked the cap; `RunReport.status === 'error'`; `RunReport.iterationCount === 2`; iter 2's `factory-validate-report` does **not** exist on disk (validate never ran); the CLI exit code is `3` and the stdout error summary contains the `runtime/total-cost-cap-exceeded:` detail line
  And given a separate run with `RunOptions.maxTotalTokens: 1_000_000` (well above sum), the same multi-iteration spec converges normally without the cap tripping; `RunReport.status === 'converged'` (or `'no-converge'` if the underlying iter-2 wouldn't actually pass — depends on the fake's mode)
  Satisfaction:
    - test: `src/runtime.test.ts` "whole-run cost cap: tokens accumulate across iterations; overrun aborts with runtime/total-cost-cap-exceeded; implement-report on disk via parents=[runId]; factory-phase status='error' with failureDetail; RunReport.status='error'"
    - judge: "the failureDetail and CLI summary tell a developer both numbers (running_total and the cap) so they can decide whether to raise the cap or shrink the prompt without re-running"

**S-5** — `--max-total-tokens` CLI flag: positive-integer validation; bad value → exit 2 with stderr label; valid value plumbs through to `RunOptions.maxTotalTokens`
  Given a built `dist/cli.js` and a tmp context-dir
  When `factory-runtime run <spec> --max-total-tokens 0 --no-judge --context-dir <tmp>` is invoked via `Bun.spawn` (or via the in-process `runCli`)
  Then exit code `2`; stderr contains `runtime/invalid-max-total-tokens: --max-total-tokens must be a positive integer (got '0')`; the `<tmp>` directory is empty (no records created)
  And given `--max-total-tokens abc`, same exit 2 with `(got 'abc')` in stderr
  And given `--max-total-tokens -5`, same exit 2 with `(got '-5')` in stderr
  And given `--max-total-tokens 100` paired with a fake-claude that reports 50_000 input + 50_000 output tokens (sum=100_000 > 100), exit code `3`; stdout contains `factory-runtime: error during phase 'implement' iteration 1`; stdout contains `detail: runtime/total-cost-cap-exceeded: running_total=100000 > maxTotalTokens=100`; the `<tmp>` directory contains a `factory-implement-report` (parents=[runId]) and a `factory-phase` (status='error', failureDetail with `runtime/total-cost-cap-exceeded:` prefix)
  And given the CLI `USAGE` text, the `--max-iterations` line reads `(default: 5)` and a `--max-total-tokens <n>` line is present with `(default: 500000)`
  Satisfaction:
    - test: `src/cli.test.ts` "--max-total-tokens 0 / abc / -5 → exit 2 with stderr label runtime/invalid-max-total-tokens"
    - test: `src/cli.test.ts` "--max-total-tokens 100 with overrunning fake-claude → exit 3 with total-cost-cap-exceeded detail line"
    - test: `src/cli.test.ts` "USAGE text shows --max-iterations default 5 and --max-total-tokens default 500000"

**S-6** — `# Prior validate report` prompt section: only failed scenarios; format is `**<scenarioId> — <scenarioName>**: <failureDetail>`; section omitted on iter 1 and when prior had zero non-pass scenarios
  Given a unit-test invocation of the prompt builder with a synthetic `priorValidateReport` payload containing scenarios `[{scenarioId: 'S-1', status: 'pass', satisfactions: [...]}, {scenarioId: 'S-2', status: 'fail', satisfactions: [{detail: 'expected 42, got undefined'}]}, {scenarioId: 'S-3', status: 'error', satisfactions: [{detail: 'TypeError: x is not a function'}, {detail: ''}]}]`, and a synthetic `Spec` whose `scenarios` includes `{id: 'S-2', name: 'happy path: returns 42'}` and `{id: 'S-3', name: 'error case'}`
  When the prompt is built (with iteration set to 2)
  Then the produced prompt contains the substring `# Prior validate report`; the section appears between `# Spec` and `# Working directory`; the section lists exactly two bullet items (S-2 and S-3, in that order — preserving the validate-report's scenario order); the S-2 line reads `**S-2 — happy path: returns 42**: expected 42, got undefined`; the S-3 line reads `**S-3 — error case**: TypeError: x is not a function` (the empty detail is skipped, joined non-empty details would have used `; ` if there were multiple); S-1 (pass) is **not** included; the `priorValidateReportId` is set to the synthetic record's id
  And given a synthetic priorValidateReport with all-pass scenarios (defensive case — shouldn't occur in practice since the loop wouldn't reach iter N+1, but verified anyway), the prompt does NOT contain a `# Prior validate report` section and `priorValidateReportId` is undefined
  And given iteration === 1 (no prior record in ctx.inputs), the prompt does NOT contain `# Prior validate report` and `payload.priorValidateReportId` is omitted
  And given a scenario with a `failureDetail` exceeding 1 KB, the rendered line truncates the detail with a `… [truncated]` marker (per-line cap); given a section total exceeding 50 KB across all bullets, the whole section truncates with a single `[runtime] truncated prior-validate section` warning written via `ctx.log`
  Satisfaction:
    - test: `src/phases/implement.test.ts` "buildPrompt emits Prior validate report section listing only failed scenarios with id + name + joined non-empty details"
    - test: `src/phases/implement.test.ts` "buildPrompt omits Prior section when iter 1 / no failed scenarios"
    - test: `src/phases/implement.test.ts` "buildPrompt truncates per-line at 1 KB and section-total at 50 KB"

**S-7** — `examples/gh-stars/docs/specs/gh-stars-v2.md`: new spec lints clean and exercises iteration ≥ 2 in the gh-stars walkthrough demo
  Given the new spec at `examples/gh-stars/docs/specs/gh-stars-v2.md` with scenarios for pagination (loop until empty page), ETag/conditional caching (304 short-circuit), and retry-with-backoff on transient 5xx
  When `pnpm exec factory spec lint examples/gh-stars/docs/specs/` is invoked from the repo root
  Then exit code `0`, stdout `OK`
  And the spec is the second active gh-stars spec (alongside `gh-stars-v1.md`); both lint cleanly; v2's `Constraints / Decisions` documents that v2 builds on v1's existing `getStargazers` helper (extends, doesn't replace)
  And the README at `examples/gh-stars/README.md` mentions running v2 via `pnpm exec factory-runtime run docs/specs/gh-stars-v2.md --context-dir ./.factory --max-total-tokens 500000` and notes that v0.0.3 runs the loop autonomously up to `--max-iterations 5` (default)
  Satisfaction:
    - test: `examples/gh-stars/docs/specs/gh-stars-v2.md` exists and lints OK via `pnpm exec factory spec lint examples/gh-stars/docs/specs/`
    - judge: "a developer running `factory-runtime run docs/specs/gh-stars-v2.md` from inside `examples/gh-stars/` after `git pull` + `pnpm install` understands from the README that the run is unattended, may take 2+ iterations, and is bounded by --max-total-tokens"

## Holdout Scenarios

**H-1** — `# Prior validate report` section is invariant to passed scenarios in the prior report
  Given a synthetic priorValidateReport with 100 passed scenarios and 2 failed scenarios
  When the iter-2 prompt is built
  Then the section lists exactly 2 bullets (only the failed ones); the prompt's substring length increase relative to iter 1 is bounded by ~5 KB (not ~250 KB) — the prompt cap is not impacted by passed-scenario count
  And given a priorValidateReport with the failed scenarios appearing AFTER the passed ones in the report's `scenarios` array, the bullets in the prompt section preserve the validate-report's ORIGINAL order (failed bullets at the end of the section, not re-sorted to the top)

**H-2** — Per-phase `maxPromptTokens` (v0.0.2) and whole-run `maxTotalTokens` (v0.0.3) are independent: per-phase trips first when an individual implement is huge; whole-run trips when the SUM crosses the cap even though each iteration is well under the per-phase cap
  Given two sub-cases:
    (a) per-phase trips: `maxPromptTokens: 100_000`, `maxTotalTokens: 1_000_000`, fake-claude reports `tokens.input: 150_000` on iter 1 → `runtime/cost-cap-exceeded` (the v0.0.2 per-phase code) fires from inside `implementPhase`; `factory-implement-report` persisted with `status: 'error'` (per-phase pattern) by implementPhase; `factory-phase.failureDetail` starts with `runtime/cost-cap-exceeded:`; `runtime/total-cost-cap-exceeded` does NOT fire (the per-phase throw beat the runtime's whole-run check)
    (b) whole-run trips: `maxPromptTokens: 100_000`, `maxTotalTokens: 200_000`, fake-claude reports `tokens.input: 50_000, tokens.output: 50_000` on each iteration; iter 1 leaves running_total=100k (within cap); iter 2's implement returns, runtime sums tokens (running_total=200k, NOT > 200k yet) — so the cap doesn't trip after iter 2; iter 3's implement returns (running_total=300k > 200k) → `runtime/total-cost-cap-exceeded` fires from runtime; `factory-implement-report` from iter 3 is on disk via parents=[runId,...] (status whatever implementPhase produced — typically 'pass' or 'fail'); iter 3's `factory-phase.status='error'` with `failureDetail` starting `runtime/total-cost-cap-exceeded:`; iter 3's `factory-validate-report` is NOT on disk
  When each sub-case runs to completion
  Then the two error codes discriminate cleanly; `RunReport.status === 'error'` in both; the on-disk record set in (b) has 3 implement-reports + 2 validate-reports + 1 factory-run + 5 factory-phase records (3 implement-phase, 2 validate-phase) — total 11 records; the on-disk record set in (a) has 1 implement-report + 0 validate-reports + 1 factory-run + 1 factory-phase (the implement one) — total 3 records (no validate ever ran in iter 1)

**H-3** — `--no-implement` mode (`[validate]`-only graph) preserves v0.0.1 / v0.0.2 record-set parity in v0.0.3 — no cross-iter threading on `factory-phase.parents`, no implement-report cross-thread, no whole-run cap accumulation. Pins the `ctx.inputs` ≠ `factory-phase.parents` split.
  Given `factory-runtime run test-fixtures/all-pass.md --no-judge --no-implement --max-iterations 3 --context-dir <tmp>` (note: `--max-iterations 3` to verify multi-iter doesn't leak threading into validate-only mode)
  When the CLI exits
  Then exit code `0` (converged on iter 1, since all-pass); `<tmp>` contains exactly 1 `factory-run` + 1 `factory-phase` (validate, iter 1) + 1 `factory-validate-report` = 3 records; both `factory-phase.parents === [runId]` and `factory-validate-report.parents === [runId]` (single-element — no implement-report to thread); the persisted `factory-run.payload.maxIterations === 3` (the user override; converged on iter 1 so iters 2/3 never ran); zero `factory-implement-report` files on disk; the runtime never accumulates `runningTotalTokens` (no implement-report in any phase output)
  And given the same flow but with a spec that fails validate (`will-fail.md`) and `--max-iterations 3`, exit code `1` (no-converge after 3 iterations); `<tmp>` contains 1 `factory-run` + 3 `factory-phase` (validate, one per iter) + 3 `factory-validate-report` = 7 records; **every** `factory-phase.parents === [runId]` across all 3 iterations (single-element — `ctx.inputs` for iter 2 / iter 3 root validate phases includes the prior validate-report, but that does NOT leak into `factory-phase.parents` because the lists are split — this is the regression test for the aliasing bug); **every** `factory-validate-report.parents === [runId]` across all 3 iterations (validatePhase's `ctx.inputs` filter for `type === 'factory-implement-report'` returns nothing in `--no-implement` mode, so the parents extension is a no-op); zero implement-reports

**H-4** — Cross-iteration threading is *most-recent-only*: iter 3's `priorValidateReportId` points at iter 2's validate-report, NOT iter 1's
  Given a fixture where iter 1 implement returns `is_error: true` (validate runs anyway, fails), iter 2 implement returns `is_error: true` (validate runs anyway, fails again), iter 3 implement passes (validate passes). The fake-claude needs a `fail-fail-then-pass` mode (or the existing `fail-then-pass` extended with a counter that goes 0→1→2). On every iteration, the fake's envelope's `result` field embeds the substring it found for the most recent `# Prior validate report` section in the prompt (or `(none)` if iter 1).
  When the run completes
  Then `RunReport.iterationCount === 3`, `RunReport.status === 'converged'`; on disk: 3 implement-reports + 3 validate-reports (1 of each per iteration); iter 1's implement-report `payload.priorValidateReportId === undefined` (and `parents === [runId]`); iter 2's implement-report `payload.priorValidateReportId === iter-1-validate-report.id` (and `parents === [runId, iter-1-validate-report.id]`); iter 3's implement-report `payload.priorValidateReportId === iter-2-validate-report.id` (NOT iter 1's; **the threading is single-step, not transitive** — iter 3 sees only iter 2's failures, not the entire history) (and `parents === [runId, iter-2-validate-report.id]`); the iter-3 prompt's `# Prior validate report` section quotes iter-2's failed scenarios, not iter-1's; iter-1's validate-report is reachable from iter-3's validate-report only via tree-walk through the chain (iter3-val → iter3-impl → iter2-val → iter2-impl → iter1-val → iter1-impl → runId), not via direct parent edge.

## Constraints / Decisions

- Public API surface from `src/index.ts` stays at **19 names** (5 functions + 1 class + 13 types). v0.0.3 adds **zero** new exports — every change is field-level on already-exported types (`RunOptions`, `PhaseContext`, `RuntimeErrorCode`) or internal-only (`FactoryImplementReportSchema.priorValidateReportId`).
- `RuntimeErrorCode` gains exactly **one** new member: `'runtime/total-cost-cap-exceeded'`. Total 10. The existing 9 are unchanged.
- `RunOptions` gains `maxTotalTokens?: number`. Default `500_000`. The cap sums `tokens.input + tokens.output` from every `factory-implement-report` produced during the run. Per-phase `maxPromptTokens` (default 100_000) from v0.0.2 still applies — both caps independent.
- `PhaseContext` gains `inputs: readonly ContextRecord[]`. The runtime populates it per phase invocation:
  - **Non-root phase** (predecessors in graph): same-iteration predecessor outputs.
  - **Root phase on iteration ≥ 2**: prior iteration's terminal phase outputs (terminal = `topoOrder[topoOrder.length - 1]`).
  - **Root phase on iteration 1**: empty.
  Built-in phases consume by filtering on `record.type` — `implementPhase` looks for `'factory-validate-report'`; `validatePhase` looks for `'factory-implement-report'`. Unknown record types are ignored (graceful degradation for custom user graphs). User-defined phases that don't read `ctx.inputs` are unaffected.
- **`ctx.inputs` and `factory-phase.parents` are NOT the same list.** Both share the same-iteration predecessor outputs, but `ctx.inputs` additionally includes prior-iteration terminal outputs for root phases on iter ≥ 2; `factory-phase.parents` does NOT. Aliasing them would silently extend `factory-phase.parents` across iterations in `--no-implement` mode (every iter ≥ 2 `factory-phase` would gain a back-edge to the prior validate-report) — breaking v0.0.2's record-set parity. `factory-phase.parents` semantics are unchanged from v0.0.2: `[runId, ...sameIterPredecessorIds]`. Pinned by H-3.
- `--max-iterations` default is **5** (was 1). The CLI's `USAGE` string and the runtime's `DEFAULT_MAX_ITERATIONS` constant both reflect this. Programmatic callers passing no `maxIterations` get 5.
- `factory-implement-report.payload.priorValidateReportId?: string` populated only when `ctx.inputs` contains a prior validate-report (i.e., iter ≥ 2 in the `[implement → validate]` graph).
- `factory-implement-report.parents = [ctx.runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`. Iter 1: `[runId]`. Iter ≥ 2 in `[implement → validate]`: `[runId, priorValidateReportId]`.
- `factory-validate-report.parents = [ctx.runId, ...(implementReportIdFromCtxInputs ? [implementReportIdFromCtxInputs] : [])]`. In `[implement → validate]`, the second element is always present. In `--no-implement` `[validate]`-only mode, parents falls back to `[runId]` (preserves v0.0.1 / v0.0.2 record-set parity, pinned by H-3).
- `# Prior validate report` prompt section placement: between `# Spec` and `# Working directory` in the prompt. Format: bullets per failed scenario as `**<scenarioId> — <scenarioName>**: <failureDetail>`. Failed = `status !== 'pass'` (covers `'fail'` and `'error'`; `'skipped'` is NOT a failure). `<scenarioName>` resolved from `ctx.spec.scenarios.find(s => s.id === scenarioId)?.name ?? ctx.spec.holdouts.find(...)?.name ?? '(name not in spec)'`. `<failureDetail>` is the joined non-empty `SatisfactionResult.detail` strings for that scenario, separated by `; `. If every detail is empty, the line ends with `(no detail recorded)`. Iter 1 omits the section entirely. If the prior validate-report has zero non-pass scenarios (defensive — shouldn't occur in practice), the section is also omitted entirely. Per-line cap at 1 KB (truncate detail with `… [truncated]` marker); section-total cap at 50 KB (truncate the whole section and emit one `[runtime] truncated prior-validate section` warning via `ctx.log`).
- Whole-run cost cap (`runtime/total-cost-cap-exceeded`) check happens inside the runtime's per-phase `try` block, after `phase.run` returns. Sum tokens from any `factory-implement-report` in `result.records`; if the cumulative `runningTotalTokens > maxTotalTokens`, throw `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })` with message `running_total=N > maxTotalTokens=M`. The catch persists `factory-phase` with `status: 'error'`, `failureDetail: 'runtime/total-cost-cap-exceeded: running_total=N > maxTotalTokens=M'`, `outputRecordIds: []`. The `factory-implement-report` is on disk (persisted by `implementPhase` itself before returning) with `parents` including `runId` — discoverable via `factory-context tree <runId>`. Mirrors v0.0.2's per-phase cost-cap chain. `RunReport.status: 'error'`. The runtime never re-throws.
- Whole-run cap timing is **post-hoc**: tokens are summed after each implement returns. A single implement that consumes 600k tokens against a 500k cap will overshoot before being detected (same retroactive nature as v0.0.2's per-phase cap). Documented in the README; v0.0.4 may add streaming.
- `maxTotalTokens` is **not** programmatically validated — non-positive values trip the cap on the first implement that records any tokens (because `running_total > maxTotalTokens` becomes true once any positive token count is added). Documented in the README. This avoids a second new `RuntimeErrorCode` (locked: one new code total). The CLI does pre-validate the flag for friendlier UX:
  - CLI flag `--max-total-tokens` (positive integer; non-positive or non-numeric → exit 2 with stderr line `runtime/invalid-max-total-tokens: --max-total-tokens must be a positive integer (got '<raw>')`). The stderr label is a string format only — **NOT** a `RuntimeErrorCode` value.
- CLI exit codes unchanged (0/1/2/3). Cost-cap aborts (per-phase or whole-run) surface as exit 3 via the existing error-summary path.
- Demo: a new `examples/gh-stars/docs/specs/gh-stars-v2.md` adds scenarios for pagination (loop until empty page), ETag/conditional caching (304 short-circuit), and retry-with-backoff on transient 5xx. Builds on v1's existing `getStargazers` helper. The agent fills in the new code.
- `iterationCount > 1` DoD assertion runs against a deterministic runtime test fixture (`test-fixtures/needs-iter2.md` + `fake-claude.ts`'s new `FAKE_CLAUDE_MODE=fail-then-pass` mode driven by a per-process counter file under `FAKE_CLAUDE_STATE_DIR`), NOT against the real-claude gh-stars-v2 demo (which is a manual smoke documented in the README, not a hard CI gate).
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. Every type import uses `import type`. Every array/object index access is guarded.
- v0.0.3 explicitly does **not** ship: `explorePhase`/`planPhase` separation, holdout-aware automated convergence, worktree sandbox, streaming cost monitoring, scheduler. Deferred to v0.0.4+.

## Subtasks

- **T1** [config + feature] — Bump `packages/runtime/package.json` to `0.0.3`. Type/schema/error extensions:
  - `src/errors.ts`: add `'runtime/total-cost-cap-exceeded'` to `RuntimeErrorCode` (one new member; existing 9 unchanged).
  - `src/types.ts`: add `maxTotalTokens?: number` to `RunOptions`; add `inputs: readonly ContextRecord[]` to `PhaseContext`.
  - `src/records.ts`: add `priorValidateReportId: z.string().optional()` to `FactoryImplementReportSchema`.
  Tests: schema accepts payloads with and without `priorValidateReportId`; rejects non-string `priorValidateReportId`; `RuntimeError` `instanceof` + the new code discriminate cleanly. **depends on nothing new**. ~55 LOC.
- **T2** [feature] — `src/runtime.ts` extension:
  - Flip `DEFAULT_MAX_ITERATIONS` from `1` to `5`.
  - Resolve `maxTotalTokens = options.maxTotalTokens ?? 500_000` before the iteration loop.
  - Track `runningTotalTokens: number` (let, init 0) across iterations (NOT reset per iter).
  - Track `priorIterationTerminalOutputs: ContextRecord[]` between iterations (init empty; updated to `outputsByPhase.get(graph.topoOrder[graph.topoOrder.length - 1]) ?? []` at the end of each iteration).
  - **Compute two distinct lists per phase invocation** (do NOT alias):
    - `sameIterInputs` = same-iter predecessor outputs (existing v0.0.2 logic). Flows into `factory-phase.parents = [runId, ...sameIterInputs.map(r => r.id)]` (mirrors v0.0.2 — semantics unchanged).
    - `ctxInputs` = `[...sameIterInputs, ...(rootPhase && iter > 1 ? priorIterationTerminalOutputs : [])]` (deduped by `record.id`). Flows into `PhaseContext.inputs` only.
  - Pass `ctxInputs` to `phase.run()` via `PhaseContext`.
  - Whole-run cost-cap check inside the per-phase `try` block after `phase.run` returns: filter `result.records` for `type === 'factory-implement-report'`, sum `payload.tokens.input + payload.tokens.output`, throw `RuntimeError('runtime/total-cost-cap-exceeded', 'running_total=N > maxTotalTokens=M')` on overrun (caught by the existing handler).
  Tests in `src/runtime.test.ts`: default `maxIterations` is 5 (assert via `factory-run.payload.maxIterations === 5` when no override); `ctxInputs` populated correctly across iterations (root iter 1 → empty; root iter ≥ 2 → prior terminal; non-root → same-iter predecessors); **`factory-phase.parents` regression test**: a 3-iter `--no-implement` run on `will-fail.md` produces 3 `factory-phase` records all with `parents === [runId]` (no aliasing leak); whole-run cap throws + persists factory-phase with `status: 'error'` and `failureDetail` containing `runtime/total-cost-cap-exceeded:`; `runningTotalTokens` accumulates across iterations correctly; existing tests still pass after the API addition (mock `PhaseContext` constructions in tests gain `inputs: []`). **depends on T1**. ~250 LOC including test updates.
- **T3** [feature] — `src/phases/implement.ts` extension:
  - Extract prior validate-report from `ctx.inputs` (filter `record.type === 'factory-validate-report'`; take the first match).
  - Extend `buildPrompt` with optional `priorValidateReport` parameter (the record's payload, NOT the record). Emit the `# Prior validate report` section between `# Spec` and `# Working directory` listing failed scenarios only (status !== 'pass') as `**<scenarioId> — <scenarioName>**: <failureDetail>`. Resolve `<scenarioName>` from `ctx.spec.scenarios` then `ctx.spec.holdouts` then fall back to `'(name not in spec)'`. Compose `<failureDetail>` from joined non-empty `SatisfactionResult.detail` strings (separated by `; `); empty → `(no detail recorded)`. Truncate per-line at 1 KB; truncate section-total at 50 KB (with `[runtime] truncated prior-validate section` warning via `ctx.log`).
  - Set `payload.priorValidateReportId` when the prior record is found; omit otherwise.
  - Extend persisted `parents` to `[ctx.runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`.
  - The existing v0.0.2 cost-cap-exceeded path still persists report with the extended parents.
  Tests in `src/phases/implement.test.ts`: iter 1 prompt has no Prior section + no `priorValidateReportId` field; iter 2 prompt has Prior section listing failed scenarios only + `priorValidateReportId` populated + parents extended; truncation kicks in for huge failureDetails (per-line and section-total); empty/all-pass prior validate-report → section omitted; scenario-name resolution falls through scenarios → holdouts → fallback string. **depends on T1, T2**. ~150 LOC.
- **T4** [feature] — `src/phases/validate.ts` extension: extract same-iter implement-report from `ctx.inputs` (filter `record.type === 'factory-implement-report'`; take the first match); extend persisted parents to `[ctx.runId, ...(sameIterImplementReportId ? [sameIterImplementReportId] : [])]`. Tests: in `[implement → validate]` graph, validate-report parents always `[runId, sameIterImplId]`; in `[validate]`-only graph (`--no-implement`), parents `[runId]` (no implement-report in inputs). **depends on T1**. ~30 LOC.
- **T5** [feature] — Test fixtures + multi-iter integration tests:
  - Extend `test-fixtures/fake-claude.ts` with two new modes:
    - `FAKE_CLAUDE_MODE=fail-then-pass` driven by a per-process counter file at `${FAKE_CLAUDE_STATE_DIR}/counter` (env var; first invocation reads counter=0, writes counter=1, produces `is_error: true` + a stub impl that fails the validate test; second invocation reads counter=1, writes counter=2, produces `is_error: false` + the impl that satisfies the test). Tests `mkdtempSync` the state dir per test and pass it via env.
    - `FAKE_CLAUDE_MODE=fail-fail-then-pass` (extension of the same counter pattern; iter 1+2 fail, iter 3 passes). Used by H-4.
    - Both modes embed into the envelope's `result` field a substring confirming presence/absence of `# Prior validate report` in the prompt (used to assert the prompt is threaded correctly).
  - New `test-fixtures/needs-iter2.md` (spec referencing `needs-iter2.test.ts`).
  - New `test-fixtures/needs-iter2.test.ts` (asserts `src/needs-iter2.ts` exports a function returning a specific value, e.g., `42`).
  - Integration test in `src/runtime.test.ts`: runs `[implement → validate]` against `needs-iter2.md` with default options (`maxIterations = 5`), `fake-claude` in `fail-then-pass` mode, asserts `RunReport.iterationCount === 2`, `RunReport.status === 'converged'`; iter 2's `factory-implement-report.payload.priorValidateReportId === iter-1-validate-report-id`; iter 2's `factory-implement-report.parents === [runId, priorValidateReportId]`; iter 2's `factory-validate-report.parents === [runId, iter-2-implement-report-id]`; iter 2's prompt contains `# Prior validate report`; iter 1's prompt does not; `factory-context tree` walks the chain back to runId from any leaf.
  - Holdout integration test for H-4: runs the same setup with `fail-fail-then-pass` mode, asserts `iterationCount === 3`, iter 3's `priorValidateReportId === iter-2-validate-report.id` (NOT iter 1's), iter 3's prompt's `# Prior validate report` section quotes iter 2's failureDetails (not iter 1's).
  **depends on T2, T3, T4**. ~180 LOC.
- **T6** [feature] — `src/cli.ts` extension:
  - Add `--max-total-tokens <n>` flag with positive-integer validation mirroring `--max-prompt-tokens` (exit 2 on bad value with stderr line `runtime/invalid-max-total-tokens: --max-total-tokens must be a positive integer (got '<raw>')` — string label only, NOT a `RuntimeErrorCode` value).
  - Plumb to `run({ options: { maxTotalTokens } })`.
  - Update `USAGE` string: `--max-iterations` line shows `(default: 5)`; new `--max-total-tokens <n>` line with `(default: 500000)` description.
  Tests in `src/cli.test.ts`: `--max-total-tokens 0 / abc / -5` → exit 2 with stderr label; `--max-total-tokens 100` paired with overrunning fake-claude → exit 3 with `total-cost-cap-exceeded:` detail line; `USAGE` text shows `--max-iterations` default 5 and `--max-total-tokens` default 500000. **depends on T2**. ~80 LOC.
- **T7** [chore] — Demo + READMEs:
  - `examples/gh-stars/docs/specs/gh-stars-v2.md`: new spec with 3 scenarios (pagination — loop until empty page; ETag/conditional caching — 304 short-circuit; retry-with-backoff on transient 5xx). Test scaffolding in `examples/gh-stars/src/gh-stars-v2.test.ts` using injected `fetch` to simulate the network behaviors. The agent's job is to extend `src/gh-stars.ts` to satisfy v2's scenarios — do not pre-implement them in this subtask.
  - Update `examples/gh-stars/README.md` to mention the v2 spec, the v0.0.3 unattended-loop default (`--max-iterations 5`), the `--max-total-tokens` knob, and a **default-budget tightness note** (500_000 default ÷ 5 iterations ≈ 100k/iter ≈ per-phase cap; bump `--max-total-tokens` to ~1_000_000 if your task needs longer prompts).
  - `packages/runtime/README.md` v0.0.3 release notes: default flip 1→5 with rationale and cost implications; cross-iter threading diagram (run → impl₁ → val₁ → impl₂ → val₂ → …); the `# Prior validate report` prompt format with an example; whole-run cost-cap design (post-hoc + hard-stop + report-via-parents pattern); new `RuntimeErrorCode` (`'runtime/total-cost-cap-exceeded'`) with example handling; the `RunOptions.maxTotalTokens` field; the new CLI flag `--max-total-tokens`; the `ctx.inputs` field on `PhaseContext` (with custom-phase consumption pattern + the `ctx.inputs` ≠ `factory-phase.parents` invariant); the **CLI/programmatic asymmetry note for `--max-total-tokens`** (CLI label is not a `RuntimeErrorCode`; programmatic `RunOptions.maxTotalTokens` is unvalidated and trips the cap on first implement); the v0.0.3 → v0.0.4 deferral list (worktree sandbox, holdout-aware convergence, scheduler, streaming cost monitoring). Verify `src/index.ts` surface unchanged (still 19 names — strict-equality DoD gate).
  **depends on T2..T6**. ~270 LOC.

## Definition of Done

- All visible scenarios (S-1..S-7) pass (tests green; judge criteria met).
- All holdout scenarios (H-1..H-4) pass at end-of-task review.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green (`bun test`); `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`.
- **Deterministic smoke (CI-gated, fake-claude)**: from the repo root, `(cd packages/runtime/test-fixtures && node ../dist/cli.js run needs-iter2.md --no-judge --claude-bin "$(pwd)/fake-claude.ts" --twin-mode off --context-dir <tmp>)` (with `FAKE_CLAUDE_MODE=fail-then-pass` and a fresh `FAKE_CLAUDE_STATE_DIR`) exits 0; `factory-context list --dir <tmp>` shows 2 `factory-implement-report`, 2 `factory-validate-report`, 4 `factory-phase`, and 1 `factory-run` records (10 total); `RunReport.iterationCount === 2`. Clean up the leaked `test-fixtures/src/` dir afterward. Proves the wiring deterministically.
- **Moneyball smoke (release-gated, real claude)**: before tagging v0.0.3, manually run `cd examples/gh-stars && pnpm exec factory-runtime run docs/specs/gh-stars-v2.md --max-iterations 5 --max-total-tokens 1000000 --context-dir ./.factory-v2-smoke` against real `claude` (subscription auth, no API key). Assert: exit code `0`; `RunReport.iterationCount > 1` (at least one iteration ≥ 2 needed to converge — the difficulty signal); `factory-context tree <runId>` shows the multi-iteration ancestry; the iter-2+ implement-report's `payload.prompt` contains `# Prior validate report` and the iter-1 failed scenarios are quoted in it; the iter-2+ implement-report's `payload.result` text shows the agent reacted to that section (judge-by-eye). Document the run output (runId, iteration count, total tokens) in the v0.0.3 release notes. Not CI-gated (real-claude is slow + non-deterministic), but a **hard release-gate item**: v0.0.3 does not tag without this passing manually.
- Public API surface from `src/index.ts` matches the technical plan §2 exactly (5 functions + 1 class + 13 types = **19 names**, strictly equal to v0.0.2's surface — zero new exports in v0.0.3).
- `RuntimeErrorCode` union has exactly **one** new member beyond v0.0.2: `'runtime/total-cost-cap-exceeded'`. Total 10. Strict-equality check stays meaningful at 19 public names — the union's membership growing does not change the export count.
- `RunOptions` has `maxTotalTokens?: number` field (new); `PhaseContext` has `inputs: readonly ContextRecord[]` field (new); `FactoryImplementReportSchema` has `priorValidateReportId?: string` field (new). All three additions are field-level on already-exported types — zero new export names.
- `factory-phase.parents` semantics are byte-for-byte equivalent to v0.0.2 in `--no-implement` mode across all iterations (regression gate against the `ctx.inputs` aliasing bug — pinned by H-3).
- `examples/gh-stars/docs/specs/gh-stars-v2.md` exists; `pnpm exec factory spec lint examples/gh-stars/docs/specs/` returns OK; the README mentions running v2 unattended and notes the default-budget tightness (500k cap × 5 iters ≈ per-phase cap).
- README in `packages/runtime/` documents: the v0.0.3 release notes (default flip + cross-iter threading + whole-run cap), the new `RuntimeErrorCode`, the new CLI flag, the `# Prior validate report` prompt format, the parent-chain diagram extending across iterations, the `ctx.inputs` field with example consumption + the `ctx.inputs` ≠ `factory-phase.parents` invariant, the `--max-total-tokens` CLI/programmatic asymmetry note, and the v0.0.3 → v0.0.4 deferral list.
- v0.0.3 explicitly does **not** ship: `explorePhase`, `planPhase`, holdout-aware automated convergence, worktree sandbox, streaming cost monitoring, scheduler. These are deferred to v0.0.4+ and noted in the README.

# Technical Plan — `@wifo/factory-runtime` v0.0.3

## 1. Context

- v0.0.2 shipped the agent-driven `implementPhase` and the default `[implement → validate]` graph, but `--max-iterations` defaulted to `1`: a human still triggered each iteration. The runtime's existing iteration loop (in `packages/runtime/src/runtime.ts`) already handles N iterations correctly — it converges on all-pass, breaks on any-error, continues on any-fail — so v0.0.3 doesn't rewrite the loop. It threads three additions through it.
- Three locked additions (do not relitigate):
  1. `--max-iterations` default `1 → 5`. Same flag.
  2. **Cross-iteration record threading.** Iteration N+1's `implementPhase` builds its prompt with a new `# Prior validate report` section populated from iteration N's `factory-validate-report` — *only the failed scenarios* (id + name + failureDetail). Iter 1 omits the section. The prior validate-report's id is stored on the resulting `factory-implement-report.payload.priorValidateReportId`. Parent chain extends: `factory-implement-report.parents = [runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`; `factory-validate-report.parents = [runId, implementReportIdFromSameIteration]`.
  3. **Whole-run cost cap.** New `RunOptions.maxTotalTokens?: number` (default 500_000), summed across every implement invocation in the run as `tokens.input + tokens.output`. Overrun → `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })`. Per-phase `maxPromptTokens` from v0.0.2 still applies. New CLI flag `--max-total-tokens <n>` (positive int, CLI-flag-validated like `--max-prompt-tokens`).
- One new `RuntimeErrorCode` member: `'runtime/total-cost-cap-exceeded'` (total 10). The existing 9 are unchanged.
- Demo: a new `examples/gh-stars/docs/specs/gh-stars-v2.md` adds scenarios known to require iteration 2+ (pagination, ETag/conditional caching, retry-with-backoff on transient 5xx). The DoD smoke also includes a runtime test fixture using `fake-claude` that asserts `iterationCount > 1` deterministically (since real-claude smokes are slow and non-deterministic).
- Deferred to v0.0.4+ (do not include): `explorePhase`/`planPhase` separation, holdout-aware automated convergence, worktree sandbox, streaming cost monitoring, scheduler.
- Locked exemplars:
  - `packages/runtime/src/runtime.ts` — existing iteration loop; extend, don't rewrite.
  - `packages/runtime/src/phases/implement.ts` — prompt builder gains a `priorValidateReport` parameter; the cost-cap chain (persist before throw) extends to whole-run total-cost-cap; `factory-implement-report` payload gains `priorValidateReportId?: string`.
  - `packages/runtime/src/phases/validate.ts` — read for shape; v0.0.3 extends its persisted parents.
  - `packages/runtime/src/cli.ts` — `--max-total-tokens` slots into the same validation pattern as `--max-prompt-tokens` (manual stderr line, exit 2 on bad value).
- Conventions unchanged from v0.0.2: strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type`, factory-function pattern for built-in phases, manual subcommand dispatch, injectable `CliIo`, Bun tests, public API surface strict equality with §2.

## 2. Architecture Decisions

### Module layout

```
packages/runtime/src/
├── types.ts                   # +RunOptions.maxTotalTokens; +PhaseContext.inputs
├── errors.ts                  # +'runtime/total-cost-cap-exceeded' (one new)
├── records.ts                 # +FactoryImplementReportSchema.priorValidateReportId
├── graph.ts                   # unchanged
├── runtime.ts                 # default maxIterations 1→5; ctx.inputs population (same-iter predecessors + prior-iter terminal); whole-run cost cap
├── phases/
│   ├── validate.ts            # parents extended with same-iter implement-report id (filtered from ctx.inputs)
│   └── implement.ts           # buildPrompt gains priorValidateReport; payload+parents add priorValidateReportId; ctx.inputs consumed
├── cli.ts                     # --max-total-tokens flag; default --max-iterations text updated to "5"
└── index.ts                   # surface unchanged at 19 names
```

Test fixtures grow (see T5):

```
packages/runtime/test-fixtures/
├── fake-claude.ts             # +FAKE_CLAUDE_MODE=fail-then-pass behavior (uses a per-process counter file under FAKE_CLAUDE_STATE_DIR)
└── needs-iter2.md             # NEW — spec whose iter-1 fake fails, iter-2 fake passes (deterministic 2-iter converge fixture)
```

### Public API

The full public surface from `src/index.ts` stays at **19 names** (5 functions + 1 class + 13 types). v0.0.3 adds **zero** new exports — all changes are internal extensions to types already in the surface (`RunOptions`, `PhaseContext`, `RuntimeErrorCode`) or internal-only schemas (`FactoryImplementReportSchema`).

```ts
type RuntimeErrorCode =
  | 'runtime/graph-empty'
  | 'runtime/graph-duplicate-phase'
  | 'runtime/graph-unknown-phase'
  | 'runtime/graph-cycle'
  | 'runtime/invalid-max-iterations'
  | 'runtime/io-error'
  | 'runtime/cost-cap-exceeded'           // v0.0.2
  | 'runtime/agent-failed'                // v0.0.2
  | 'runtime/invalid-max-prompt-tokens'   // v0.0.2
  | 'runtime/total-cost-cap-exceeded';    // NEW — only addition in v0.0.3
```

### `RunOptions` extension

```ts
interface RunOptions {
  maxIterations?: number;
  log?: (line: string) => void;
  maxTotalTokens?: number; // NEW — default 500_000; sum of tokens.input + tokens.output across every factory-implement-report in the run
}
```

`maxIterations` default flips to **`5`** in `runtime.ts` (constant `DEFAULT_MAX_ITERATIONS = 5`). The CLI's `USAGE` string updates accordingly.

`maxTotalTokens` is **not** programmatically validated — non-positive values trip the cap on the first implement that records any tokens (because `running_total > maxTotalTokens` becomes true once any positive token count is added; even `maxTotalTokens: 0` is honest in this regime). Documented in the README. This avoids adding a second new `RuntimeErrorCode` (locked: one new code total). The CLI does pre-validate the flag for friendlier UX.

### `PhaseContext` extension

```ts
interface PhaseContext {
  spec: Spec;
  contextStore: ContextStore;
  log: (line: string) => void;
  runId: string;
  iteration: number;
  inputs: readonly ContextRecord[]; // NEW — records the runtime threads into this phase invocation
}
```

The runtime populates `ctx.inputs` per phase invocation:

- **Non-root phase** (has predecessors in graph): `ctx.inputs = predecessor outputs from this iteration`. Mirrors the existing `inputs` collection that already feeds `factory-phase.parents` (lines 128-136 of runtime.ts) — v0.0.3 just exposes the same list to the phase via `ctx`.
- **Root phase on iteration ≥ 2**: `ctx.inputs = prior iteration's terminal phase outputs`. The terminal phase is `topoOrder[topoOrder.length - 1]`. Stored as `priorIterationTerminalOutputs` between iterations.
- **Root phase on iteration 1**: `ctx.inputs = []`.

This is a one-field public-surface change to an already-exported type. Existing user phases that don't read `ctx.inputs` are unaffected — the field is additive. No new export name.

Each built-in phase consumes `ctx.inputs` by filtering on `record.type`:
- `implementPhase`: `const priorValidate = ctx.inputs.find(r => r.type === 'factory-validate-report')` — used for the prompt section + `priorValidateReportId` payload field + extended parents.
- `validatePhase`: `const sameIterImpl = ctx.inputs.find(r => r.type === 'factory-implement-report')` — used for extended parents.

### `factory-implement-report` schema extension

```ts
const FactoryImplementReportSchema = z.object({
  // ... v0.0.2 fields unchanged ...
  priorValidateReportId: z.string().optional(), // NEW — populated only on iteration ≥ 2 when ctx.inputs contains a prior validate-report
});
```

The DAG gains the new edge `factory-validate-report (iter N) → factory-implement-report (iter N+1)` via `parents`. `factory-context tree <validate-report-id>` walks the chain back to runId via implement → validate → implement → … → run.

### Built-in phase: `implementPhase` changes

Inside the phase closure (factory-call-time validation of `maxPromptTokens` is unchanged from v0.0.2):

1. **Read prior validate-report from `ctx.inputs`**:
   ```ts
   const priorValidateRecord = ctx.inputs.find(
     (r) => r.type === 'factory-validate-report',
   );
   const priorValidateReportId = priorValidateRecord?.id;
   ```
2. **Build prompt** with new optional section. Place the section between `# Spec` and `# Working directory` (so the agent sees the contract first, then the prior failures, then where to work):
   ```
   # Prior validate report
   
   Iteration <N-1> validated and reported the following failed scenarios. Read
   them carefully — your task is to make them pass without breaking the ones
   that already passed.
   
   - **<scenarioId> — <scenarioName>**: <failureDetail>
   - **<scenarioId> — <scenarioName>**: <failureDetail>
   ```
   - `<failureDetail>` is composed by joining each non-pass `SatisfactionResult.detail` (skipping empty strings) with `; ` per scenario, then trimming. If every detail is empty, write `(no detail recorded)`.
   - `<scenarioName>` comes from `ctx.spec.scenarios.find(s => s.id === scenarioId)?.name ?? '(name not in spec)'` (with holdouts also consulted via `ctx.spec.holdouts`).
   - "Failed scenarios" = `scenarios` in the validate-report payload where `status !== 'pass'` (covers `'fail'` and `'error'`). Skipped scenarios are NOT included.
   - If the prior validate-report has zero non-pass scenarios (impossible in practice — wouldn't reach iter N+1 — but defensively handled), the section is omitted entirely.
   - Iter 1: section omitted entirely (no `priorValidateRecord` in inputs).
3. **Persist payload** with `priorValidateReportId` populated when defined; **parents** become `[ctx.runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`.

Other implementPhase behavior unchanged from v0.0.2 (cost-cap-exceeded path still persists report before throwing; status mapping; tools extraction; file-diff capture; twin env-var plumbing).

### Built-in phase: `validatePhase` changes

```ts
const sameIterImpl = ctx.inputs.find(
  (r) => r.type === 'factory-implement-report',
);
const parents = sameIterImpl ? [ctx.runId, sameIterImpl.id] : [ctx.runId];
const id = await ctx.contextStore.put('factory-validate-report', report, { parents });
```

In the default `[implement → validate]` graph, `sameIterImpl` is always defined. In `--no-implement` mode (`[validate]`-only), `ctx.inputs` is empty and `parents` falls back to `[ctx.runId]` — preserving v0.0.1 / v0.0.2 record-set parity (pinned by H-2 in v0.0.2's spec, still pinned in v0.0.3's H-3).

### Runtime: whole-run cost cap

Inside the per-phase `try` block in the iteration loop (so the throw is caught by the same handler that already handles per-phase exceptions), after `phase.run` returns:

```ts
try {
  const result = await phase.run({ /*...*/, inputs });
  status = result.status;
  outputRecords = result.records;
  // Sum tokens from any factory-implement-report in this phase's outputs.
  for (const rec of result.records) {
    if (rec.type !== 'factory-implement-report') continue;
    const t = (rec.payload as { tokens?: { input?: number; output?: number } }).tokens;
    runningTotalTokens += (t?.input ?? 0) + (t?.output ?? 0);
  }
  if (runningTotalTokens > maxTotalTokens) {
    throw new RuntimeError(
      'runtime/total-cost-cap-exceeded',
      `running_total=${runningTotalTokens} > maxTotalTokens=${maxTotalTokens}`,
    );
  }
} catch (err) {
  status = 'error';
  outputRecords = [];
  failureDetail = err instanceof Error ? err.message : String(err);
}
```

`runningTotalTokens` is a `let` declared above the iteration loop, initialized to `0`. Reset is **not** needed across iterations — we want a whole-run total. `maxTotalTokens = options.maxTotalTokens ?? 500_000` is also resolved before the loop.

Behavior parity with v0.0.2's per-phase cost-cap pattern (mirror this exactly):
- The implement-report **is** persisted to disk (by `implementPhase` itself, which returned successfully before the runtime saw the running total). It carries its own status (typically `'pass'` if the cap-trip was a normal completion that just added the wrong straw; `'fail'` if `is_error: true`). Its `parents` include `[runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`.
- The `factory-phase` record for this implement invocation persists with `status: 'error'`, `failureDetail: 'runtime/total-cost-cap-exceeded: running_total=N > maxTotalTokens=M'`, `outputRecordIds: []` (the catch branch resets `outputRecords` — sacrificing this list to keep the v0.0.2 cost-cap pattern uniform; the implement-report is still discoverable via tree walk from runId because its `parents` include runId).
- `RunReport.status === 'error'`. The runtime never re-throws — only persists. Mirrors v0.0.2's per-phase cap.
- The CLI's existing error-summary path (cli.ts lines 290-302) prints the detail line unchanged.

### Runtime: ctx.inputs population (separate from `factory-phase.parents`)

**Critical**: `factory-phase.parents` and `ctx.inputs` are NOT the same list in v0.0.3. They share the same-iteration predecessor outputs, but `ctx.inputs` additionally includes prior-iteration terminal outputs for root phases on iter ≥ 2. Aliasing them would silently extend `factory-phase.parents` across iterations — breaking v0.0.2's record-set parity in `--no-implement` mode (where every iteration's `factory-phase` would gain a back-edge to the prior iteration's validate-report). Pinned by H-3.

```ts
let priorIterationTerminalOutputs: ContextRecord[] = [];

for (let iteration = 1; iteration <= maxIterations; iteration++) {
  const outputsByPhase = new Map<string, ContextRecord[]>();
  // ...

  for (const phaseName of graph.topoOrder) {
    const phase = phaseByName.get(phaseName);
    // ...

    const phasePredecessors = predecessors.get(phaseName) ?? [];

    // Same-iteration predecessor outputs (existing v0.0.2 logic). This
    // list flows into BOTH factory-phase.parents AND ctx.inputs.
    const sameIterInputs: ContextRecord[] = [];
    const seenSameIterIds = new Set<string>();
    for (const predName of phasePredecessors) {
      for (const rec of outputsByPhase.get(predName) ?? []) {
        if (seenSameIterIds.has(rec.id)) continue;
        seenSameIterIds.add(rec.id);
        sameIterInputs.push(rec);
      }
    }

    // Cross-iteration threading (NEW in v0.0.3). For root phases on iter ≥ 2,
    // include the prior iteration's terminal outputs. This flows into
    // ctx.inputs ONLY — NOT into factory-phase.parents (preserves v0.0.2
    // record-set parity).
    const ctxInputs: ContextRecord[] = [...sameIterInputs];
    if (phasePredecessors.length === 0 && iteration > 1) {
      const seen = new Set<string>(sameIterInputs.map((r) => r.id));
      for (const rec of priorIterationTerminalOutputs) {
        if (seen.has(rec.id)) continue;
        seen.add(rec.id);
        ctxInputs.push(rec);
      }
    }

    // ...phase.run({ ..., inputs: ctxInputs })...
    // ...putOrWrap(contextStore, 'factory-phase', phasePayload, [
    //   runId,
    //   ...sameIterInputs.map((r) => r.id),  // NOT ctxInputs — see comment above
    // ])...
  }

  // After the iteration's last phase: stash terminal outputs for next iter.
  const terminalName = graph.topoOrder[graph.topoOrder.length - 1];
  if (terminalName !== undefined) {
    priorIterationTerminalOutputs = outputsByPhase.get(terminalName) ?? [];
  }
}
```

The split is invisible in the default `[implement → validate]` graph for non-root phases (validate's predecessors collapse the two lists to identical content) but matters for root phases on iter ≥ 2 — most visibly in `--no-implement` mode where every iter ≥ 2 validate would otherwise inherit a parent edge to the prior validate-report.

### CLI

```
factory-runtime run <spec-path> [flags]

Flags:
  --max-iterations <n>             Max iterations (default: 5)               # was 1
  --max-total-tokens <n>           Hard cap on summed agent tokens (default: 500000)  # NEW
  ...                              (other flags unchanged)
```

Validation pattern for `--max-total-tokens` mirrors `--max-prompt-tokens`:

```ts
const maxTotalTokensRaw = parsed.values['max-total-tokens'];
let maxTotalTokens: number | undefined;
if (typeof maxTotalTokensRaw === 'string') {
  const n = Number.parseInt(maxTotalTokensRaw, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== maxTotalTokensRaw.trim()) {
    io.stderr(
      `runtime/invalid-max-total-tokens: --max-total-tokens must be a positive integer (got '${maxTotalTokensRaw}')\n${USAGE}`,
    );
    io.exit(2);
    return;
  }
  maxTotalTokens = n;
}
```

The stderr label `runtime/invalid-max-total-tokens` is a string format — **NOT** a `RuntimeErrorCode` value. Locked: only one new code (`'runtime/total-cost-cap-exceeded'`).

`maxTotalTokens` plumbs into `run()` via:

```ts
report = await run({
  spec, graph, contextStore: store,
  options: {
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    ...(maxTotalTokens !== undefined ? { maxTotalTokens } : {}),
  },
});
```

CLI exit codes unchanged (0/1/2/3). Cost-cap aborts (per-phase or whole-run) surface as exit 3 with the runtime/total-cost-cap-exceeded or runtime/cost-cap-exceeded detail line via the existing error-summary path.

### Confirmed constraints

- Public API surface stays at **19 names** (5 functions + 1 class + 13 types). Adding fields to `RunOptions`, `PhaseContext`, `RuntimeErrorCode` does not change export count.
- `RuntimeErrorCode` gains exactly **one** new member: `'runtime/total-cost-cap-exceeded'`. Total 10. Existing 9 unchanged.
- `--max-iterations` default is **5** (was 1). The CLI's `USAGE` string and the runtime's `DEFAULT_MAX_ITERATIONS` constant both reflect this. Programmatic callers passing no `maxIterations` get 5.
- `RunOptions.maxTotalTokens` default is **500_000**. The cap sums `tokens.input + tokens.output` from every `factory-implement-report` produced during the run. Per-phase `maxPromptTokens` (default 100_000) from v0.0.2 still applies — both caps independent.
- Cross-iteration threading via `ctx.inputs`: implement on iter ≥ 2 reads the prior `factory-validate-report`; validate on every iter reads the same-iteration `factory-implement-report`. `ctx.inputs` is populated by the runtime from same-iteration predecessor outputs (existing logic) plus prior-iteration terminal outputs for root phases on iter ≥ 2 (new logic).
- `factory-implement-report.payload.priorValidateReportId?: string` populated only when `ctx.inputs` contains a prior validate-report.
- `factory-implement-report.parents = [runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`.
- `factory-validate-report.parents = [runId, ...(implementReportIdFromCtxInputs ? [implementReportIdFromCtxInputs] : [])]`. In `[implement → validate]`, the second element is always present; in `--no-implement` `[validate]`-only mode, parents falls back to `[runId]` (preserves v0.0.1 record-set parity, still pinned by H-2 / H-3).
- `# Prior validate report` prompt section is placed between `# Spec` and `# Working directory`. Only failed scenarios (`status !== 'pass'`); each line is `**<scenarioId> — <scenarioName>**: <failureDetail>`. Iter 1 omits the section entirely.
- Whole-run cost-cap throws `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })` from inside the runtime's per-phase try block. The catch persists `factory-phase` with `status: 'error'`, `failureDetail: 'runtime/total-cost-cap-exceeded: running_total=N > maxTotalTokens=M'`, `outputRecordIds: []`. The implement-report is on disk via parents=[runId,...]. `RunReport.status: 'error'`. Mirrors v0.0.2 per-phase cost-cap chain.
- `--max-total-tokens` CLI validation: positive integer, exit 2 on bad value with stderr line `runtime/invalid-max-total-tokens: --max-total-tokens must be a positive integer (got '<raw>')` (string label only, not a `RuntimeErrorCode` value). Programmatic `RunOptions.maxTotalTokens` is **not** validated — non-positive values trip the cap immediately on the first implement that records tokens. Documented in the README.
- gh-stars demo: new `examples/gh-stars/docs/specs/gh-stars-v2.md` adds scenarios for pagination, ETag/conditional caching, and retry-with-backoff. v1's `src/gh-stars.ts` and `src/gh-stars.test.ts` already exist (committed via the v0.0.2 agent run); v2 builds on that, adding new tests / updating the impl. The agent fills in the new code.
- Runtime-level test fixture `test-fixtures/needs-iter2.md` + `fake-claude.ts`'s new `fail-then-pass` mode prove `iterationCount > 1` deterministically without needing real claude.
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere.

## 3. Risk Assessment

- **`ctx.inputs` shape change**: adding a required field to `PhaseContext` is a public-surface change. Existing user-defined phases that destructure `PhaseContext` won't break (the new field is just unused). User phases constructing a `PhaseContext` manually (e.g., for tests) will need to pass `inputs: []`. This affects internal tests in `runtime.test.ts` that build mock `PhaseContext`-like objects — they need updating. Documented in T2's test work and in the README's "v0.0.3 changes" section.
- **`ctx.inputs` vs `factory-phase.parents` aliasing**: a tempting "one list, two consumers" implementation would silently extend `factory-phase.parents` across iterations for root phases on iter ≥ 2 (because `ctx.inputs` gains the prior-iter terminal outputs). That would break v0.0.2's `--no-implement` record-set parity (every iter ≥ 2 `factory-phase` would gain a back-edge to the prior validate-report). The split design pinned in §2 keeps `factory-phase.parents = [runId, ...sameIterPredecessorIds]` (v0.0.2 semantics, unchanged) and exposes the cross-iter threading on `ctx.inputs` only. H-3 catches an accidental aliasing regression — it asserts byte-for-byte parity of `factory-phase.parents` across all 3 iterations of a `--no-implement` `will-fail.md` run.
- **`--max-total-tokens` CLI/programmatic asymmetry**: the CLI emits a stderr label `runtime/invalid-max-total-tokens:` on bad flag input, but **no matching `RuntimeErrorCode` exists** (locked: only one new code total — `'runtime/total-cost-cap-exceeded'`). This diverges from `--max-prompt-tokens`, which has both a CLI label AND a matching programmatic code (`runtime/invalid-max-prompt-tokens`). Programmatic `RunOptions.maxTotalTokens: 0` is unvalidated — relies on the cap tripping naturally on first implement (running_total > 0 once any tokens land). Defensible (locked) but worth flagging in the README so callers don't expect symmetric behavior. The stderr label is purely a CLI string format; tests must NOT assert it as a `RuntimeErrorCode` value.
- **Prompt size from `# Prior validate report`**: a spec with 100 failed scenarios × 500-byte failureDetail each = ~50 KB extra prompt. Could trip the per-phase 100k-token cap. Mitigation: cap individual `failureDetail` rendering at 1 KB (truncate with `… [truncated]` marker) and cap section total at 50 KB. If exceeded, log a `[runtime] truncated prior-validate section` warning via `ctx.log` and continue.
- **Whole-run cap timing**: the cap is checked **after** an implement returns. A single implement that consumes 600k tokens with cap=500k will overshoot before being detected. Same retroactive nature as the per-phase cap — the user already paid for tokens by the time we read them. Locked design (post-hoc abort, not preventive). Documented; v0.0.4 may add streaming.
- **Default `maxIterations: 5` blast radius**: existing v0.0.2 callers who omit `--max-iterations` and run real-claude get a 5x cost increase by default. Mitigation: the default whole-run cap (500_000 tokens) bounds total cost; the README's v0.0.3 release notes call this out explicitly with example knob settings.
- **`fail-then-pass` fake-claude mode**: needs cross-process state because each iteration spawns a fresh `fake-claude` subprocess. Use a small file under `FAKE_CLAUDE_STATE_DIR` (env var) that the fake increments per invocation; the test harness `mkdtempSync`s it and cleans up after. Avoids global counters. Pinned by T5.
- **gh-stars-v2 scope creep**: pagination + ETag + retry could turn into a 500-LOC implementation task. Mitigation: keep scenarios surgical — pagination uses a 2-page fixture (page 1 → page 2 empty); ETag tests one round trip with `If-None-Match`; retry tests one 503 → 200 on retry. Total impl ≤ ~150 LOC on top of v1's existing helper.
- **Real-claude smoke nondeterminism**: a real `factory-runtime run gh-stars-v2.md` could fail or converge variably. The DoD's `iterationCount > 1` assertion runs against the **runtime test fixture** (`needs-iter2.md` + fake-claude `fail-then-pass`), not the real-claude gh-stars-v2 demo. The gh-stars-v2 demo is a manual smoke documented in the README, not a hard CI gate.
- **`ctx.inputs` thread for non-implement→validate graphs**: a custom user graph (e.g., 3 phases linear) where iteration 2's root phase isn't `implementPhase` would still receive prior-iteration terminal outputs. Phases that don't recognize the input types just ignore them (no behavioral coupling — the filter-by-type pattern handles graceful-degradation). Pinned by H-3.
- **Records crossing iterations via `parents`**: extending `factory-implement-report.parents` with `priorValidateReportId` means a single record's parent set straddles iteration boundaries. `factory-context tree <validate-report-id>` will walk back through the entire chain. No code change to `factory-context` — the existing tree command already follows `parents`. Verified in S-3.
- **Blast radius**: contained to `packages/runtime/` (additive: one new error code, three type extensions, runtime threading, CLI flag) + `examples/gh-stars/` (new spec + test additions). No changes to `core`/`harness`/`twin`/`context`. `pnpm test` workspace-wide stays green; runtime suite gains the v0.0.3 test surface (~6-8 new tests).

## 4. Subtask Outline

Seven subtasks, ~1000 LOC including tests (the v0.0.2 spec was ~1200 LOC; v0.0.3 is smaller in surface area but the runtime test churn — every existing `PhaseContext` mock needs `inputs: []` — pulls T2's LOC up). Full test pointers in `docs/specs/factory-runtime-v0-0-3.md`.

- **T1** [config + feature] — Bump `packages/runtime/package.json` to `0.0.3`. Type/schema/error extensions:
  - `src/errors.ts`: add `'runtime/total-cost-cap-exceeded'` to `RuntimeErrorCode` (one new member; existing 9 unchanged).
  - `src/types.ts`: add `maxTotalTokens?: number` to `RunOptions`; add `inputs: readonly ContextRecord[]` to `PhaseContext`.
  - `src/records.ts`: add `priorValidateReportId: z.string().optional()` to `FactoryImplementReportSchema`.
  Tests: schema accepts payloads with and without `priorValidateReportId`; rejects non-string `priorValidateReportId`; `RuntimeError` `instanceof` + the new code discriminate cleanly. **depends on nothing new**. ~55 LOC.
- **T2** [feature] — `src/runtime.ts` extension:
  - Flip `DEFAULT_MAX_ITERATIONS` from `1` to `5`.
  - Resolve `maxTotalTokens = options.maxTotalTokens ?? 500_000` before the iteration loop.
  - Track `runningTotalTokens: number` (let, init 0) across iterations (NOT reset per iter).
  - Track `priorIterationTerminalOutputs: ContextRecord[]` between iterations.
  - **Two distinct lists per phase invocation** (do NOT alias):
    - `sameIterInputs` (same-iter predecessor outputs) — flows into `factory-phase.parents` (mirrors v0.0.2; unchanged behavior).
    - `ctxInputs` = `[...sameIterInputs, ...(rootPhase && iter > 1 ? priorIterationTerminalOutputs : [])]` — flows into `PhaseContext.inputs` only.
  - Whole-run cost-cap check inside the per-phase `try` block after `phase.run` returns: filter `result.records` for `type === 'factory-implement-report'`, sum `payload.tokens.input + payload.tokens.output`, throw `RuntimeError('runtime/total-cost-cap-exceeded', 'running_total=N > maxTotalTokens=M')` on overrun (caught by the existing handler).
  Tests in `src/runtime.test.ts`: default `maxIterations` is 5; `ctxInputs` populated correctly across iterations (root iter 1 → empty; root iter ≥ 2 → prior terminal; non-root → same-iter predecessors); **`factory-phase.parents` does NOT change semantics** (regression test: a 3-iter `--no-implement` run produces 3 factory-phase records all with `parents === [runId]`, byte-for-byte except hash-derived ids); whole-run cap throws + persists factory-phase with `status: 'error'` and `failureDetail` containing `runtime/total-cost-cap-exceeded:`; existing tests still pass after the API addition (mock `PhaseContext` constructions in tests gain `inputs: []`). **depends on T1**. ~250 LOC including test updates.
- **T3** [feature] — `src/phases/implement.ts` extension:
  - Extract prior validate-report from `ctx.inputs` (filter `record.type === 'factory-validate-report'`; take the first match).
  - Extend `buildPrompt` with optional `priorValidateReport` parameter (the record's payload, NOT the record). Emit the `# Prior validate report` section between `# Spec` and `# Working directory` listing failed scenarios only (status !== 'pass') as `**<scenarioId> — <scenarioName>**: <failureDetail>`. Resolve `<scenarioName>` from `ctx.spec.scenarios` then `ctx.spec.holdouts` then fall back to `'(name not in spec)'`. Compose `<failureDetail>` from joined non-empty `SatisfactionResult.detail` strings (separated by `; `); empty → `(no detail recorded)`. Truncate per-line at 1 KB; truncate section-total at 50 KB (with `[runtime] truncated prior-validate section` warning via `ctx.log`).
  - Set `payload.priorValidateReportId` when the prior record is found; omit otherwise.
  - Extend persisted `parents` to `[ctx.runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`.
  - The existing v0.0.2 cost-cap-exceeded path still persists report with the extended parents.
  Tests in `src/phases/implement.test.ts`: iter 1 prompt has no Prior section + no `priorValidateReportId` field; iter 2 prompt has Prior section listing failed scenarios only + `priorValidateReportId` populated + parents extended; truncation kicks in for huge failureDetails (per-line and section-total); empty/all-pass prior validate-report → section omitted; scenario-name resolution falls through scenarios → holdouts → fallback string. **depends on T1, T2**. ~150 LOC.
- **T4** [feature] — `src/phases/validate.ts` extension: extract same-iter implement-report from `ctx.inputs` (filter `record.type === 'factory-implement-report'`); extend persisted parents to `[ctx.runId, ...(sameIterImplementReportId ? [sameIterImplementReportId] : [])]`. Tests: in `[implement → validate]` graph, validate-report parents always `[runId, sameIterImplId]`; in `[validate]`-only, parents `[runId]` (no implement-report in inputs). **depends on T1**. ~30 LOC.
- **T5** [feature] — Test fixtures + iter-2 integration test:
  - Extend `test-fixtures/fake-claude.ts` with `FAKE_CLAUDE_MODE=fail-then-pass` driven by a per-process counter file at `${FAKE_CLAUDE_STATE_DIR}/counter` (env var; first invocation reads counter=0, writes counter=1, produces `is_error: true` + a stub impl that fails the validate test; second invocation reads counter=1, writes counter=2, produces `is_error: false` + the impl that satisfies the test). The mode also reads the prompt to detect `# Prior validate report` substring presence and embeds confirmation into the envelope's `result` field for assertion.
  - New `test-fixtures/needs-iter2.md` (spec referencing `needs-iter2.test.ts`).
  - New `test-fixtures/needs-iter2.test.ts` (asserts `src/needs-iter2.ts` exports a function returning a specific value).
  - Integration test runs `[implement → validate]` against `needs-iter2.md` with default options (`maxIterations = 5`), asserts `RunReport.iterationCount === 2`, `RunReport.status === 'converged'`; iter-2 implement-report's `payload.priorValidateReportId === iter-1-validate-report-id`; iter-2 implement-report's `parents === [runId, priorValidateReportId]`; iter-2 validate-report's `parents === [runId, iter-2-implement-report-id]`; iter-2 prompt contains `# Prior validate report`; iter-1 prompt does not; tree walks the chain back to runId from any leaf.
  **depends on T2, T3, T4**. ~180 LOC.
- **T6** [feature] — `src/cli.ts` extension:
  - Add `--max-total-tokens <n>` flag with positive-integer validation mirroring `--max-prompt-tokens` (exit 2 on bad value with stderr line `runtime/invalid-max-total-tokens: --max-total-tokens must be a positive integer (got '<raw>')` — string label only, NOT a `RuntimeErrorCode` value).
  - Plumb to `run({ options: { maxTotalTokens } })`.
  - Update `USAGE` string: `--max-iterations` line shows `(default: 5)`; new `--max-total-tokens <n>` line with `(default: 500000)` description.
  Tests in `src/cli.test.ts`: `--max-total-tokens 0 / abc / -5` → exit 2 with stderr label; `--max-total-tokens 100` paired with overrunning fake-claude → exit 3 with `total-cost-cap-exceeded:` detail line; `USAGE` text shows `--max-iterations` default 5 and `--max-total-tokens` default 500000. **depends on T2**. ~80 LOC.
- **T7** [chore] — Demo + README:
  - `examples/gh-stars/docs/specs/gh-stars-v2.md`: new spec with 3 scenarios (pagination — loop until empty page; ETag/conditional caching — 304 short-circuit; retry-with-backoff on transient 5xx). Test scaffolding in `examples/gh-stars/src/gh-stars-v2.test.ts` using injected `fetch` to simulate the network behaviors. The agent's job is to extend `src/gh-stars.ts` to satisfy v2's scenarios — do not pre-implement them in this subtask.
  - Update `examples/gh-stars/README.md` to mention the v2 spec, the v0.0.3 unattended-loop default (`--max-iterations 5`), the `--max-total-tokens` knob, and the **note that 500_000 default ÷ 5 iterations ≈ 100k/iter, the same as the per-phase cap — bump `--max-total-tokens` to ~1_000_000 if your task needs longer prompts**.
  - `packages/runtime/README.md` v0.0.3 release notes: default flip 1→5 with rationale and cost implications; cross-iter threading diagram (run → impl₁ → val₁ → impl₂ → val₂ → …); the `# Prior validate report` prompt format with an example; whole-run cost-cap design (post-hoc + hard-stop + report-via-parents pattern); new `RuntimeErrorCode` (`'runtime/total-cost-cap-exceeded'`) with example handling; the `RunOptions.maxTotalTokens` field; the new CLI flag `--max-total-tokens`; the `ctx.inputs` field on `PhaseContext` (with custom-phase consumption pattern); the **CLI/programmatic asymmetry note for `--max-total-tokens`** (CLI label is not a `RuntimeErrorCode`); the **default-budget tightness note** (500k cap × 5 iters ≈ per-phase cap); the v0.0.3 → v0.0.4 deferral list. Verify `src/index.ts` surface unchanged (still 19 names — strict-equality DoD gate).
  **depends on T2..T6**. ~270 LOC (spec + 3 scenarios of test scaffolding + two READMEs).

Total LOC ≈ 1000. Surface area: changes confined to `packages/runtime/src/**` and `examples/gh-stars/`.

# Technical plan — factory-runtime-v0-0-7 (`run-sequence`)

## 1. Context

### What exists today

- `factory-runtime run <spec-path>` is the only orchestration verb. One spec in, one spec ships, one `factory-run` record at the root of the iteration's DAG.
- `RunOptions` (packages/runtime/src/types.ts:48) covers per-run knobs: `maxIterations`, `maxTotalTokens`, `maxAgentTimeoutMs`, `log`. All apply to a single spec's iteration loop.
- `RunReport` (packages/runtime/src/types.ts:93) is the per-spec result: `runId`, `specId`, `iterationCount`, `iterations[]`, `status: 'converged' | 'no-converge' | 'error'`.
- Provenance: `factory-run` is parented at `[]` (root); each `factory-phase` parents at `[runId, ...sameIterPredecessorRecords]`; reports parent at `[runId, priorReportId?]`. `factory-context tree --direction down <runId>` walks the per-spec DAG.
- `factory-runtime` CLI (packages/runtime/src/cli.ts) has one subcommand: `run <spec-path>`. Adding `run-sequence` follows the same shape: subcommand → `runRunSequence(args, io)` helper → `parseArgs` → load + execute → exit-code mapping.
- Existing `RuntimeErrorCode` set (packages/runtime/src/errors.ts): 10 codes. v0.0.7 will add 2 new codes (cycle, dep-not-found).
- Existing `factory-context` exposes `listRecords()` + the v0.0.4 `tree --direction down` which uses `record.parents[]` for the inversion. New `factory-sequence` records will be the new root for sequence runs.

### Patterns and conventions to follow

- **Verb-noun subcommand naming.** `run`, `run-sequence`. NOT `sequence-run`, NOT a `--sequence` flag on `run` (different argument shape: directory vs. single file).
- **CLI flag validation pattern (locked since v0.0.2).** Positive-integer flags use `Number.parseInt + Number.isFinite + n > 0 + String(n) === raw.trim()`. Bad value → exit 2 with `runtime/invalid-<flag>: <message>` stderr line. Mirrored at programmatic level: a `RuntimeError` is thrown only when programmatic callers pass a bad value AND that bad value reaches a code path that needs it (post-hoc in most cases).
- **CLI flag > config file > built-in default precedence (v0.0.5.1).** `factory.config.json` reads from cwd at CLI startup; values under `runtime.*` override built-in defaults; CLI flags override both.
- **Record schema strictness (v0.0.1).** Every persisted record type has a Zod schema registered with the context store. New `factory-sequence` record gets a registered schema in `packages/runtime/src/records.ts`.
- **Surface equality unless explicitly +N (v0.0.3 / v0.0.4 / v0.0.5 / v0.0.6).** v0.0.7 adds 2 exports: `runSequence` + `SequenceReport`. Spec calls this out explicitly in DoD (19 → 21 names).

### Constraints the existing architecture imposes

- The `run()` function in `runtime.ts` is per-spec; it cannot be reused as-is to drive a sequence (no per-spec parent threading). `runSequence` orchestrates by calling `run()` per spec and persists its own `factory-sequence` parent record before any per-spec call.
- `factory-context tree --direction down` walks `record.parents[]` (inverted). For `tree --direction down <factorySequenceId>` to walk the entire product DAG, every `factory-run` produced by the sequence-runner must include `factorySequenceId` in its `parents[]`. The runtime's existing `run()` function takes no `parents` arg — it always parents `factory-run` at `[]`. Two options: (a) extend `run()` to accept an optional `runParents: string[]` arg; (b) write the `factory-sequence` record with `parents[]` containing each per-spec `runId` AFTER each per-spec run completes. Option (a) is cleaner — provenance flows down (sequence → run → phase → report) instead of being patched up after the fact. Picking (a).

## 2. Architecture decisions

### New built-in: `runSequence`

```ts
// packages/runtime/src/sequence.ts
export interface RunSequenceArgs {
  specsDir: string;
  graph: PhaseGraph;
  contextStore: ContextStore;
  options?: RunSequenceOptions;
}

export interface RunSequenceOptions extends RunOptions {
  /** Continue running independent specs after a non-converging spec.
   *  Dependents of the failed spec are marked 'skipped'. Default false (stop-on-fail). */
  continueOnFail?: boolean;
  /** Whole-sequence cap on summed agent tokens, across every spec's runs.
   *  Optional — when undefined, no sequence-level cap (per-spec cap still applies).
   *  Mirrors RunOptions.maxTotalTokens but at the sequence level. */
  maxSequenceTokens?: number;
}

export interface SequenceSpecResult {
  specId: string;
  specPath: string;
  status: 'converged' | 'no-converge' | 'error' | 'skipped';
  /** Populated when status !== 'skipped'. */
  runReport?: RunReport;
  /** Populated when status === 'skipped'; names the failed dep that caused the skip. */
  blockedBy?: string;
}

export interface SequenceReport {
  factorySequenceId: string;
  specsDir: string;
  startedAt: string;
  durationMs: number;
  topoOrder: ReadonlyArray<string>;
  specs: ReadonlyArray<SequenceSpecResult>;
  status: 'converged' | 'partial' | 'no-converge' | 'error';
  totalTokens: number;
}

export function runSequence(args: RunSequenceArgs): Promise<SequenceReport>;
```

### `run()` extension

`runtime.ts`'s `run()` gains an optional internal `runParents?: string[]` parameter (NOT exported at the public type surface — extends `RunArgs`). When provided, the persisted `factory-run` record uses `parents: runParents` instead of `[]`. `runSequence` passes `[factorySequenceId]`; existing CLI / programmatic callers pass nothing and get the v0.0.6 root behavior. **Field-level addition; zero new exports.**

### New context record type: `factory-sequence`

```ts
// packages/runtime/src/records.ts
export const FactorySequenceSchema = z.object({
  specsDir: z.string(),
  topoOrder: z.array(z.string()),
  startedAt: z.string(),
  maxIterations: z.number().int().positive().optional(),
  maxTotalTokens: z.number().int().positive().optional(),
  maxSequenceTokens: z.number().int().positive().optional(),
  continueOnFail: z.boolean().default(false),
});
```

Persisted at sequence start (before any per-spec `run()`). Parents `[]` (root). Every per-spec `factory-run` inherits this id via the new `runParents` arg.

### DAG construction

1. Walk `<specsDir>/*.md` (NOT recursive into `done/` — sequence ships ACTIVE specs only). Parse each via `parseSpec` from `@wifo/factory-core`.
2. Build `Map<id, Spec>`. Build `Map<id, depIds[]>` from each spec's `depends-on`.
3. Validate:
   - Every dep id refers to a spec in the directory. Missing → `RuntimeError({ code: 'runtime/sequence-dep-not-found', message: "spec '<id>' depends on '<dep>' which is not in <specsDir>" })`.
   - No cycles. Detect via DFS with three-color marking. Cycle → `RuntimeError({ code: 'runtime/sequence-cycle', message: "depends-on cycle: <a> → <b> → <c> → <a>" })`. Report the smallest cycle in the message.
4. Topological sort via Kahn's algorithm. Tie-break alphabetically on id (deterministic order across runs). The sorted order is `topoOrder` in `SequenceReport`.

### Failure handling (DEFAULT: stop-on-fail; --continue-on-fail: skip dependents)

```
for spec in topoOrder:
  if any dep of spec is in failed-set:
    record { status: 'skipped', blockedBy: <first failed dep id> }
    add spec to failed-set (so further dependents skip too)
    continue
  result = await run({ spec, graph, contextStore, runParents: [factorySequenceId], options })
  record { status: result.status, runReport: result }
  if result.status !== 'converged':
    add spec to failed-set
    if !continueOnFail: break out of loop  // stop-on-fail
```

After loop ends:
- If failed-set is empty → `SequenceReport.status = 'converged'`.
- If failed-set non-empty AND any spec converged → `'partial'`.
- If failed-set non-empty AND zero specs converged → `'no-converge'`.
- If any spec result was `'error'` (RuntimeError thrown out of run()) → `'error'`.

### Cost capping: per-spec + sequence-level

- Existing `RunOptions.maxTotalTokens` applies per-spec (unchanged behavior — each `run()` call has its own running total).
- New `RunSequenceOptions.maxSequenceTokens` (optional, no built-in default). After each per-spec `run()` returns, sum its `runReport.iterations[].phases[].outputRecordIds`-fed `factory-implement-report` tokens (or use a running counter passed through). If `cumulativeSequenceTokens > maxSequenceTokens`, abort with `RuntimeError({ code: 'runtime/sequence-cost-cap-exceeded' })`. Already-completed specs' provenance is preserved on disk; the sequence aborts mid-loop.
- Implementation note: `runReport` doesn't currently surface a token total at the per-spec level (per-spec cap is enforced inside run()). Adding `RunReport.totalTokens?: number` (field-level addition; existing callers don't break) lets `runSequence` accumulate across specs without re-reading the context store. Field-level addition; surface count unchanged at runtime export.

### Provenance: `factory-context tree --direction down`

After a sequence completes, `factory-context tree <factorySequenceId> --direction down` walks: `factory-sequence → [factory-run (per spec) → factory-phase (per phase per iteration) → factory-implement-report / factory-validate-report (per phase outputs)]`. Pinned by S-3 (now H-3 after promotion to holdout).

### CLI shape

```
factory-runtime run-sequence <dir>/ [flags]

Flags:
  --max-iterations <n>             Per-spec cap (default: 5)
  --max-total-tokens <n>           Per-spec cap on summed agent tokens (default: 500000)
  --max-sequence-tokens <n>        Whole-sequence cap (default: unbounded — per-spec cap still applies)
  --max-agent-timeout-ms <n>       Per-phase agent timeout (default: 600000)
  --continue-on-fail               Continue running independent specs after a failure (default: stop)
  --context-dir <path>             Context store directory (default: ./context)
  --max-prompt-tokens <n>          Per-phase agent prompt cap (default: 100000)
  --claude-bin <path>              Path to the claude executable
  --twin-mode <record|replay|off>  Twin recording mode (default: record)
  --twin-recordings-dir <path>     Twin recordings dir
```

`factory.config.json`'s `runtime.*` keys also apply (existing v0.0.5.1 behavior). New optional keys: `runtime.maxSequenceTokens`, `runtime.continueOnFail`. Forward-compat: unknown keys are ignored.

### Exit codes

- `0` — sequence converged (all specs status: 'converged').
- `1` — sequence partial / no-converge (some specs failed; not a hard runtime error).
- `2` — CLI argument error (bad flag, missing positional). Same as `run` subcommand.
- `3` — sequence error (cycle, missing dep, IO error, sequence-cost-cap-exceeded, agent crash). Same as `run` subcommand.

## 3. Risk assessment

### Blast radius

- **Existing `run()` callers:** the new `runParents?: string[]` field on `RunArgs` is optional. Existing programmatic callers don't break. The single existing CLI caller (`runtime/src/cli.ts`'s `runRun`) doesn't pass `runParents`; existing `factory-run` records continue to parent at `[]`. Verified by S-2's parent-edge test.
- **`factory-context tree --direction down`:** the v0.0.4 implementation walks `record.parents[]` generically. New `factory-sequence` record type adds another node type to the tree but doesn't change the walk algorithm. Existing tests for `tree --direction down <runId>` keep passing (a per-spec `runId` from a sequence-driven run still walks down to its own phases and reports).
- **`factory-context list`:** new record type appears in lists. Tests that filter on type don't break; tests that count records in a tmp dir are sequence-aware (added in T6 below).

### Migration / schema concerns

- New record type registers via `tryRegister` in `runSequence`. No migration needed for existing context stores.
- The `RunReport.totalTokens?: number` field is optional and additive. Persistence layer (`factory-run` schema) doesn't change — the field is computed in-memory and returned to the caller, not persisted.

### Performance

- DAG construction: O(n + e) where n = # of specs, e = # of depends-on edges. For the URL-shortener product (4 specs, 3 edges), trivial.
- Topological sort: O(n + e). Trivial.
- The sequence runs specs sequentially. Parallelism is a v0.0.8+ candidate (independent specs at the same DAG depth could run concurrently). NOT in v0.0.7 scope.

### External dependencies

- None new. The runtime continues to depend on `@wifo/factory-context`, `@wifo/factory-core`, `@wifo/factory-harness`. No new package added.

### Failure modes worth pinning in tests

- Cycle detection finds the smallest cycle (not just any cycle).
- Missing dep error names the offending pair (`spec '<x>' depends on '<y>' which is not in <dir>`), not just "missing dep."
- `--continue-on-fail` correctly skips ALL transitive dependents of a failed spec (not just direct dependents).
- A spec converges in the per-spec loop but the sequence-cost-cap trips on the next spec — the converged spec's records are intact; only the next spec's run is aborted.
- `factory-context tree --direction down <factorySequenceId>` walks every per-spec `factory-run` AND its per-phase children.

## 4. Public API surface deltas

- `@wifo/factory-runtime/src/index.ts`: 19 → **21** names. Two new exports:
  - `runSequence` (function)
  - `SequenceReport` (type)
- All other exports unchanged. `RunSequenceArgs`, `RunSequenceOptions`, `SequenceSpecResult`, `RunSequenceErrorCode` are NOT re-exported from index (internal-only). The minimum surface for callers is `runSequence` (call site) + `SequenceReport` (return-type annotation).

Two new `RuntimeErrorCode` values:
- `runtime/sequence-cycle`
- `runtime/sequence-dep-not-found`

Plus one for cost-cap symmetry (mirrors existing `total-cost-cap-exceeded`):
- `runtime/sequence-cost-cap-exceeded`

`RuntimeErrorCode` enum: 10 → **13** values.

## 5. Open questions to resolve before implementation

These are flagged in the spec's `## Open Questions` section. Needed to lock before any agent run.

- **Default for `maxSequenceTokens`?** Currently leaning unbounded (opt-in via flag). Alternative: 10× per-spec default (= 5,000,000). Decision impacts user experience — unbounded is more permissive for trial runs; 10× catches runaway sequences earlier.
- **Should `--continue-on-fail` retry the failed spec?** Currently: no — failed specs stay failed. Alternative: a separate `--retry-on-fail <n>` flag that retries the failed spec up to N times before marking it failed. v0.0.7 ships only the `--continue-on-fail` semantics; retry is deferred.
- **Status name for cascade-blocked dependents:** `'skipped'` vs `'blocked'` vs `'cancelled'`. Current decision: `'skipped'` (the spec was never run; its dep failed). The `blockedBy: string` field carries the cause. Alternative names changeable in this spec without touching schema.
- **CLI flag name parity:** `--continue-on-fail` vs `--continue` vs `--keep-going` (make-style). Current: `--continue-on-fail` for symmetry with the explicit failure-handling semantics. Alternatives are short but lose specificity.

# Technical Plan — `@wifo/factory-runtime` v0.0.1

## 1. Context

- The four prior layers are shipped: `@wifo/factory-core` (parses specs to `Spec`), `@wifo/factory-harness` (`runHarness(spec, opts) → HarnessReport`), `@wifo/factory-twin` (HTTP record/replay), `@wifo/factory-context` (filesystem-first content-addressed record store with `createContextStore({ dir })` returning `register / put / get / list / parents`). Each follows the same monorepo conventions: strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, injectable `CliIo`, manual subcommand dispatch on `argv[0]`, `<file>.test.ts` next to source, `bun test`. The CLI exemplar is `packages/harness/src/cli.ts`; the public-API exemplar is `packages/context/src/index.ts`; the result-aggregation exemplar is `packages/harness/src/runner.ts`; the cycle-detection / DAG-traversal exemplar is `packages/context/src/tree.ts`.
- `packages/runtime/` is scaffolded: `package.json` declares `bin.factory-runtime → dist/cli.js`, ESM module, `bun test`, all four prior packages as `workspace:*` dependencies, `@types/bun` as dev. `tsconfig.json` and `tsconfig.build.json` mirror the other four. `src/index.ts` is `export {};`. The package is at `version: 0.0.0`.
- The package is the **most opinionated** layer of the factory — it pins phase shape, graph semantics, iteration policy, and the on-disk provenance model. Subsequent versions (v0.0.2+) introduce Claude-Agent-SDK-backed `explore`, `plan`, and `implement` phases; v0.0.1 ships the runtime skeleton plus a single built-in `validatePhase` so the round-trip `spec → run → harness report → context records` works end-to-end.
- `@wifo/factory-twin` was scaffolded into `package.json` dependencies but is **dropped at T1** (v0.0.1 does not import it; the v0.0.2 PR that routes Claude-Agent-SDK HTTP through it will add the dep back when there's actual usage). Pinned in §2.
- Empty `src/index.ts` makes `pnpm test` workspace-wide currently fail (`bun test` exits non-zero with no test files). T1 fixes this as a side effect of adding real test files.

## 2. Architecture Decisions

### Module layout

```
packages/runtime/src/
├── types.ts            # Phase, PhaseContext, PhaseResult, PhaseGraph, RunOptions, RunReport, internals
├── errors.ts           # RuntimeError class + RuntimeErrorCode union
├── records.ts          # zod schemas for factory-run, factory-phase, factory-validate-report; tryRegister helper
├── graph.ts            # definePhase, definePhaseGraph (topo sort + cycle/dup/unknown-edge validation)
├── runtime.ts          # run({ spec, graph, contextStore, options })
├── phases/
│   └── validate.ts     # validatePhase(opts?) — built-in
├── cli.ts              # `factory-runtime run <spec-path>` + flags
└── index.ts            # public re-exports
```

Tests: `<module>.test.ts` next to source. CLI tests use `Bun.spawn` (mirroring harness/context/twin).

### Public API

The full public surface from `src/index.ts` — 17 names total. Adding a name in v0.0.1 requires updating this plan and the spec. The DoD's "matches §2" check is strict equality.

```ts
// runtime
export { run } from './runtime.js';

// graph
export { definePhase, definePhaseGraph } from './graph.js';

// built-in phase
export { validatePhase } from './phases/validate.js';
export type { ValidatePhaseOptions } from './phases/validate.js';

// errors
export { RuntimeError } from './errors.js';
export type { RuntimeErrorCode } from './errors.js';

// types
export type {
  Phase,
  PhaseContext,
  PhaseResult,
  PhaseGraph,
  PhaseStatus,
  RunOptions,
  RunReport,
  RunStatus,
  PhaseInvocationResult,
  PhaseIterationResult,
} from './types.js';
```

`ValidatePhaseOptions`, `PhaseStatus`, `RunStatus`, `PhaseInvocationResult`, `PhaseIterationResult`, and `RuntimeErrorCode` are minor type extensions on top of the user-pinned types — they exist to make `RunReport` shape-walkable, `validatePhase()` callable, and `RuntimeError.code` discriminable from TS without `unknown`-casts. Everything else stays internal.

**Intentionally not exported** (internal): `tryRegister`, the zod schemas (`FactoryRunSchema`, `FactoryPhaseSchema`, `FactoryValidateReportSchema`), `aggregateIterationStatus`, the topo-sort helper, the runtime's internal record-payload types beyond their re-exported shapes.

**Errors**: `RuntimeError extends Error` with a stable `code: RuntimeErrorCode` field. The class is matched with `instanceof`; `.code` is the machine-readable identifier for matching in user code, log lines, and CLI stderr output.

```ts
type RuntimeErrorCode =
  | 'runtime/graph-empty'
  | 'runtime/graph-duplicate-phase'
  | 'runtime/graph-unknown-phase'
  | 'runtime/graph-cycle'
  | 'runtime/invalid-max-iterations'
  | 'runtime/io-error';                // surfaced when a context-store put for factory-run/factory-phase fails

class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
}
```

The set of codes is stable; adding one is a public-API change. Mirrors the convention from `@wifo/factory-context` (`ContextError`) and `@wifo/factory-twin` (`TwinReplayError`/`TwinNoMatchError`) — typed error classes with code fields, matched via `instanceof`. The user's pinned API surface is extended by exactly two names (`RuntimeError` + `RuntimeErrorCode`); the consistency win across all five layers outweighs the surface-area tax.

### Data model

```ts
type PhaseStatus = 'pass' | 'fail' | 'error';

interface PhaseResult {
  status: PhaseStatus;
  records: ContextRecord[];   // records the phase put during this invocation
}

interface PhaseContext {
  spec: Spec;                  // parsed spec from @wifo/factory-core
  contextStore: ContextStore;  // shared store from @wifo/factory-context
  log: (line: string) => void; // single-line logger; phases must not write to process.stdout/stderr directly
  runId: string;               // id of the factory-run record; used by phases to set parents on records they put
  iteration: number;           // 1-indexed iteration number; phases can adapt behavior across iterations
}

interface Phase {
  readonly name: string;
  readonly run: (ctx: PhaseContext) => Promise<PhaseResult>;
}

interface PhaseGraph {
  readonly phases: ReadonlyArray<Phase>;
  readonly edges: ReadonlyArray<readonly [string, string]>;  // [from, to] — from completes before to starts
  readonly topoOrder: ReadonlyArray<string>;                 // computed at construction, frozen
}

interface RunOptions {
  maxIterations?: number;       // default 1 — see "Iteration semantics" for v0.0.1 honest-default rationale
  log?: (line: string) => void; // default: process.stderr.write(line + '\n')
}

interface PhaseInvocationResult {
  phaseName: string;
  phaseRecordId: string;        // id of the factory-phase record persisted by the runtime
  status: PhaseStatus;
  outputRecordIds: string[];    // ids of records returned in PhaseResult.records
  durationMs: number;
}

interface PhaseIterationResult {
  iteration: number;            // 1-indexed
  phases: PhaseInvocationResult[];
  status: PhaseStatus;          // aggregated across phases this iteration
}

type RunStatus = 'converged' | 'no-converge' | 'error';

interface RunReport {
  runId: string;                // id of the factory-run record
  specId: string;
  startedAt: string;            // ISO-8601 UTC
  durationMs: number;
  iterationCount: number;       // number of iterations actually executed
  iterations: PhaseIterationResult[];
  status: RunStatus;
}
```

### `definePhase` / `definePhaseGraph`

```ts
function definePhase(
  name: string,
  fn: (ctx: PhaseContext) => Promise<PhaseResult>,
): Phase;

function definePhaseGraph(
  phases: ReadonlyArray<Phase>,
  edges: ReadonlyArray<readonly [string, string]>,
): PhaseGraph;
```

`definePhase` is a thin `{ name, run: fn }` builder. No validation — name uniqueness is enforced at graph construction.

`definePhaseGraph` validates and computes (all rejections throw `RuntimeError` synchronously with the matching `code`):
1. **No duplicate phase names**: throws `new RuntimeError('runtime/graph-duplicate-phase', '<name> appears twice')`.
2. **Every edge endpoint exists**: each `[from, to]` pair must reference a name in `phases[]`. Else throws `new RuntimeError('runtime/graph-unknown-phase', 'edge references unknown phase <name>')`.
3. **No cycles**: Kahn's algorithm. If the in-degree-zero queue empties before all phases are visited, throws `new RuntimeError('runtime/graph-cycle', 'cycle through <node>, <node>, ...')`.
4. **Topological order**: when multiple phases have in-degree zero simultaneously, the tiebreak is **insertion order from `phases[]`**. Result is frozen and exposed as `graph.topoOrder`.
5. **Empty graph**: `phases: []` is **rejected** at construction (`new RuntimeError('runtime/graph-empty', 'at least one phase required')`). Not because the runtime can't handle it, but because a zero-phase run carries no meaning — the convergence policy is undefined.

Returns a frozen object: `Object.freeze({ phases, edges, topoOrder })`.

### Iteration semantics

```
iteration = 1
while iteration <= maxIterations:
  for each phase in topoOrder:
    inputs = output records from upstream phases in THIS iteration (across all visited predecessors)
    invoke phase.run(ctx) — catch exceptions as status='error'
    persist factory-phase record (parents = [runId, ...inputs.map(id)])
    if status === 'error': mark run errored, break out of both loops
  status = aggregateIterationStatus(phaseInvocations)
  if status === 'pass': mark converged, break
  if status === 'error': mark errored, break  (already broke above; this is defensive)
  iteration++
if loop exited without break: mark no-converge
```

`aggregateIterationStatus`:
- `'error'` if any phase invocation status is `'error'` → run aborts (no further iterations, no further phases).
- else `'fail'` if any is `'fail'` → run iterates if budget remains, else `'no-converge'`.
- else `'pass'` → `'converged'`.

The convergence policy is **generic** — it does not key on the phase name `'validate'`. A graph whose terminal phase is named `'check'` and returns `'pass'` converges; a graph whose terminal phase returns `'fail'` iterates. Pinned by H-2.

**Default `maxIterations: 1` in v0.0.1.** With only `validatePhase` available, iterations 2..N produce the same harness report as iteration 1 (modulo flaky tests / judge variance) — defaulting to 5 would burn the budget for nothing observable. The framework still *supports* iteration (the loop, the per-iteration record persistence, the convergence policy) so v0.0.2 (where `plan` and `implement` mutate the world between iterations) just works without any framework change. Users who want to confirm flake-resilience can pass `--max-iterations 3` explicitly. The README documents the v0.0.2 default flip (likely to 3 or 5).

**Phase exception handling**: if `phase.run(ctx)` throws (sync or async), the runtime catches it, persists a `factory-phase` record with `status: 'error'` and the error message in `failureDetail`, and aborts the run with `status: 'error'`. The phase's exception is never re-thrown — `run()` always returns a `RunReport`.

### Record types and zod schemas

The runtime persists three new context-record types. `records.ts` declares their zod schemas.

```ts
// factory-run — created once, at the start of run(). Parents: [].
const FactoryRunSchema = z.object({
  specId: z.string(),
  specPath: z.string().optional(),
  graphPhases: z.array(z.string()),       // names in topoOrder
  maxIterations: z.number().int().positive(),
  startedAt: z.string(),                   // ISO-8601 UTC
});

// factory-phase — created once per phase invocation per iteration.
// Parents: [runId, ...inputRecordIds]
//   - runId is always first
//   - inputRecordIds are the ids of records returned by upstream phases in the SAME iteration,
//     deduplicated by the context store (which dedups parents internally)
const FactoryPhaseSchema = z.object({
  phaseName: z.string(),
  iteration: z.number().int().positive(),
  status: z.enum(['pass', 'fail', 'error']),
  durationMs: z.number().int().nonnegative(),
  outputRecordIds: z.array(z.string()),    // ids the phase wrote (from PhaseResult.records)
  failureDetail: z.string().optional(),    // populated when status === 'error'
});

// factory-validate-report — written by validatePhase. Parents: [].
// Envelope-only validation — the deep HarnessReport shape (scenarios[], satisfactions[]) is
// kept as z.unknown() to avoid drift with @wifo/factory-harness's TS-only types. The runtime
// stores it; only the envelope is validated.
const FactoryValidateReportSchema = z.object({
  specId: z.string(),
  specPath: z.string().optional(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  scenarios: z.array(z.unknown()),
  summary: z.object({
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  status: z.enum(['pass', 'fail', 'error']),
});
```

### `tryRegister` (idempotent registration)

```ts
function tryRegister<T>(store: ContextStore, type: string, schema: ZodType<T>): void {
  try {
    store.register(type, schema);
  } catch (err) {
    if (err instanceof ContextError && err.code === 'context/duplicate-registration') return;
    throw err;
  }
}
```

`run()` calls `tryRegister` for `factory-run` and `factory-phase` at the top of every invocation. `validatePhase` calls `tryRegister` for `factory-validate-report` at the top of every invocation. This makes both safe to call repeatedly across iterations and across multiple `run()` calls in the same process. Pinned by H-3.

### Parent chain & provenance

For each phase invocation in iteration `i`:

- `inputs` = the union (deduplicated by id, preserving first-occurrence order) of `PhaseResult.records` from every **predecessor phase visited so far in iteration `i`** (predecessors as defined by `graph.edges`). Records from prior iterations do **not** flow forward — each iteration starts fresh from the parsed `spec`. This keeps the v0.0.1 model simple; v0.0.2 can introduce cross-iteration record threading if needed.
- The runtime persists a `factory-phase` record with `parents: [runId, ...inputs.map(r => r.id)]`. The context store deduplicates parents internally, so even if the same record id appears via multiple paths, the on-disk parents are clean.
- The phase's *output* records are NOT in the `factory-phase` parents (they are listed in payload `outputRecordIds` instead). Per the user spec: `factory-phase records per phase (parents: [runId, ...inputRecords])`.

**`factory-validate-report` parents**: `[ctx.runId]`. The phase reads `runId` from `PhaseContext` and uses it as the sole parent of the report record. The DAG is `factory-run → factory-validate-report`; the parallel `factory-run → factory-phase` chain captures the phase event itself with `outputRecordIds` cross-referencing the report. This means `factory-context tree <runId>` shows both the validate-report (direct child) and the phase event (direct child) under the run — full DAG traversal works.

### `validatePhase`

`validatePhase` is a **factory function** that returns a `Phase`. The user-pinned name `validatePhase` is the export; it takes optional config and produces a configured `Phase`. This pattern lets the CLI inject `--scenario` / `--no-judge` flags into the harness call without leaking harness options through `RunOptions` or `PhaseContext`.

```ts
interface ValidatePhaseOptions {
  cwd?: string;                     // default: dirname(spec.raw.filename) ?? process.cwd()
  scenarioIds?: ReadonlySet<string>;
  visibleOnly?: boolean;
  holdoutsOnly?: boolean;
  noJudge?: boolean;
  timeoutMs?: number;
  judge?: { model?: string };       // omits judge.client — runtime always uses default Anthropic-backed client
}

function validatePhase(opts: ValidatePhaseOptions = {}): Phase {
  return definePhase('validate', async (ctx) => {
    tryRegister(ctx.contextStore, 'factory-validate-report', FactoryValidateReportSchema);

    const cwd = opts.cwd
      ?? (ctx.spec.raw.filename !== undefined ? dirname(resolve(ctx.spec.raw.filename)) : process.cwd());

    const harnessOpts: RunHarnessOptions = {
      cwd,
      ...(opts.scenarioIds !== undefined ? { scenarioIds: opts.scenarioIds } : {}),
      ...(opts.visibleOnly !== undefined ? { visibleOnly: opts.visibleOnly } : {}),
      ...(opts.holdoutsOnly !== undefined ? { holdoutsOnly: opts.holdoutsOnly } : {}),
      ...(opts.noJudge !== undefined ? { noJudge: opts.noJudge } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.judge !== undefined ? { judge: opts.judge } : {}),
      log: ctx.log,
    };

    const report = await runHarness(ctx.spec, harnessOpts);
    const id = await ctx.contextStore.put('factory-validate-report', report, {
      parents: [ctx.runId],
    });
    const record = await ctx.contextStore.get(id);
    if (record === null) {
      // Defensive — unreachable since put just succeeded with no concurrent deletion possible.
      return { status: 'error', records: [] };
    }
    return { status: report.status, records: [record] };
  });
}
```

Note: `report.status` is already `'pass' | 'fail' | 'error'` — direct mapping to `PhaseStatus`.

`validatePhase` does **not** itself catch exceptions thrown by `runHarness` because `runHarness` is contractually non-throwing (per its docstring: "never throws on operational state"). The runtime's outer try/catch around `phase.run(ctx)` is the safety net for unexpected throws.

### `run({ spec, graph, contextStore, options })`

```ts
async function run(args: {
  spec: Spec;
  graph: PhaseGraph;
  contextStore: ContextStore;
  options?: RunOptions;
}): Promise<RunReport>;
```

Behavior:

1. Resolve `maxIterations = options.maxIterations ?? 1`. If `maxIterations <= 0` or non-integer, throw `new RuntimeError('runtime/invalid-max-iterations', 'must be a positive integer')` synchronously (validated before any record is written).
2. Resolve `log = options.log ?? defaultStderrLog`.
3. `tryRegister(store, 'factory-run', FactoryRunSchema)` and `tryRegister(store, 'factory-phase', FactoryPhaseSchema)`.
4. Compose `runPayload = { specId, specPath, graphPhases: graph.topoOrder, maxIterations, startedAt }`.
5. `runId = await store.put('factory-run', runPayload, { parents: [] })` (wrap any thrown `ContextError` as `RuntimeError({ code: 'runtime/io-error' })` so callers see one error type).
6. Loop iterations 1..maxIterations (`iteration` is 1-indexed):
   - For each phase name in `graph.topoOrder`:
     - Compute `inputs` = dedup union of output records from visited predecessors in this iteration.
     - `t0 = performance.now()`.
     - Construct `ctx = { spec, contextStore, log, runId, iteration }`.
     - Try: `result = await phase.run(ctx)`.
     - Catch: `result = { status: 'error', records: [] }`; capture error message for `failureDetail`.
     - Build `phasePayload = { phaseName, iteration, status, durationMs, outputRecordIds: result.records.map(r => r.id), failureDetail: errorMessage if errored }`.
     - `phaseRecordId = await store.put('factory-phase', phasePayload, { parents: [runId, ...inputs.map(r => r.id)] })` (wrap thrown `ContextError` as `RuntimeError({ code: 'runtime/io-error' })`).
     - Append to current iteration's `phases[]`. Track output records by phase name for downstream lookup.
     - If status === `'error'`: append iteration with status `'error'`, set RunStatus = `'error'`, break out of outer loop.
   - Compute iteration status. If `'pass'` → RunStatus = `'converged'`, break. If `'error'` → already broke above.
   - Else (`'fail'`): if `iteration === maxIterations` → RunStatus = `'no-converge'`. Else continue.
7. Build `RunReport` and return.

`run` never throws on phase errors, harness errors, or context-store IO errors **inside the run loop** for *phase* execution — those become `factory-phase` records with `status: 'error'`. Pre-loop validation errors (invalid `maxIterations`) and `store.put` failures *before* the run record is written propagate as `RuntimeError` exceptions because there is no `RunReport` to return. Once the `factory-run` record is written, phase failures are captured in the report; only `store.put` failures on the `factory-phase` write itself are re-thrown as `RuntimeError({ code: 'runtime/io-error' })` because the alternative (try-write-and-continue) silently masks data corruption.

### CLI

```
factory-runtime run <spec-path> [flags]

Flags:
  --max-iterations <n>     Max iterations (default: 1; v0.0.2 may flip to 3 or 5)
  --context-dir <path>     Context store directory (default: ./context)
  --scenario <ids>         Comma-separated scenario ids (e.g. S-1,S-2,H-1)
  --no-judge               Skip judge satisfactions in the harness
```

Behavior:

1. `parseArgs` per subcommand. Manual dispatch on `argv[0]` (mirroring harness/context CLIs).
2. Read spec from `<spec-path>`; on `ENOENT` → exit 3, stderr `Spec not found: <path>`.
3. `parseSpec(source, { filename: relative(cwd, specPath) })`. On `SpecParseError` → exit 3, stderr per-issue line `<filename>:<line>  error  <code>  <message>`.
4. Resolve `--context-dir` (default `./context`); `mkdir -p` if missing (consistent with `factory-context` CLI's tolerance — directory presence is the runtime's job, not the user's).
5. `store = createContextStore({ dir })`.
6. Build `validatePhase({ cwd: dirname(specPath), scenarioIds, noJudge })`. `cwd` is the resolved spec directory so `bun test` paths in satisfaction lines resolve as expected.
7. `graph = definePhaseGraph([validate], [])`.
8. `report = await run({ spec, graph, contextStore: store, options: { maxIterations } })`.
9. Print one-line summary to stdout:
   - `'converged'`: `factory-runtime: converged in <n> iteration(s) (run=<runId>, ${durationMs}ms)\n`
   - `'no-converge'`: `factory-runtime: no-converge after <maxIterations> iteration(s) (run=<runId>)\n`
   - `'error'`: `factory-runtime: error during phase '<name>' iteration <n> (run=<runId>)\n  detail: <failureDetail>\n`
10. Exit code: `0` converged, `1` no-converge, `2` usage error, `3` operational error (parse failure, IO, status === `'error'`, missing spec, invalid `--max-iterations`).

`--max-iterations` parsing rejects non-integers and values `<= 0` with exit 2.

`--scenario` parsing trims whitespace per id and drops empty entries (mirrors harness CLI).

Default `--context-dir` is `./context` resolved from `process.cwd()`. Documented in `--help`.

The CLI binary stays separate (`factory-runtime`); not folded into a top-level `factory` umbrella in v0.0.1.

### Logging

Phases receive `log: (line: string) => void`. The CLI passes `log = (line) => process.stderr.write(line + '\n')` so phase logs go to stderr; stdout reserved for the summary. Tests inject a capturing `log` to assert on emitted lines.

`runHarness` already accepts `log` (for cost-notice output); `validatePhase` forwards `ctx.log` to it so all output funnels through the runtime's logger.

### Test fixtures

```
packages/runtime/test-fixtures/
├── all-pass.md            # spec with one passing test → harness 'pass' → run converges in 1 iteration
├── will-fail.md           # spec with one failing test → harness 'fail' → run iterates to maxIterations → no-converge
├── trivial-pass.test.ts   # trivial bun test that passes
└── trivial-fail.test.ts   # trivial bun test that asserts false
```

Fixture specs use `--no-judge`-compatible scenarios (test satisfactions only) so the CLI smoke tests don't require `ANTHROPIC_API_KEY`.

### Dependency choices

| Dependency | Range | Why |
|---|---|---|
| `@wifo/factory-core` | `workspace:*` | `parseSpec`, `Spec`, `SpecParseError` for the CLI. |
| `@wifo/factory-harness` | `workspace:*` | `runHarness`, `HarnessReport`, `RunHarnessOptions` for `validatePhase`. |
| `@wifo/factory-context` | `workspace:*` | `createContextStore`, `ContextStore`, `ContextRecord`, `ContextError` for the runtime store. |
| `zod` | `^3.23.8` | Record schemas for `factory-run`, `factory-phase`, `factory-validate-report`. Added directly to `packages/runtime/package.json` to keep imports explicit (no relying on transitive resolution from `@wifo/factory-context`). |

Dev-only: `@types/bun` (already present).

`packages/runtime/package.json` changes at T1: bump version to `0.0.1`, add `zod`, **remove `@wifo/factory-twin`**. The scaffolded `package.json` lists twin as a workspace dep, but v0.0.1 source does not import it; the v0.0.2 PR that wires Claude-Agent-SDK HTTP through the twin will add it back when there's actual usage. Premature deps are a smell.

### Confirmed constraints

- One JSON file per record on disk (delegated to `@wifo/factory-context`).
- Public API surface is the §2 list above (17 names: 4 functions + 1 class + 12 types); deviating requires updating both this plan and the spec.
- `RuntimeError extends Error` with stable `code: RuntimeErrorCode`. The class is the discriminator (`instanceof`); `.code` is the machine-readable identifier.
- `definePhaseGraph` validates synchronously at construction; cycles, duplicates, unknown edges, and empty `phases[]` all throw `RuntimeError` with the matching `code`.
- `run()` writes `factory-run` once at start (`parents: []`) and one `factory-phase` per phase invocation per iteration with `parents: [runId, ...inputRecordIds]`.
- `validatePhase()` is a factory: `validatePhase(opts?: ValidatePhaseOptions): Phase`. Single export `validatePhase`; the produced phase is named `'validate'`.
- `PhaseContext` is `{ spec, contextStore, log, runId, iteration }`. `runId` and `iteration` let phases attach proper parents on records they put.
- `factory-validate-report` records have `parents: [ctx.runId]`. The DAG is `factory-run → factory-validate-report`; the parallel `factory-run → factory-phase` chain captures the phase event itself with `outputRecordIds` cross-referencing the report.
- Iteration policy is generic across phase names; convergence keys on aggregated phase status, not the literal name `'validate'`.
- `tryRegister` swallows `'context/duplicate-registration'` only; all other `ContextError`s propagate.
- Phase exceptions are caught and converted to `status: 'error'` factory-phase records; the run aborts immediately with `RunReport.status = 'error'`.
- `runHarness` is contractually non-throwing — `validatePhase` does not wrap it in try/catch.
- CLI exit codes: `0` converged, `1` no-converge, `2` usage error, `3` operational error.
- `--max-iterations` default is `1` (honest for v0.0.1 with only `validatePhase`); values `<= 0` or non-integer throw `RuntimeError({ code: 'runtime/invalid-max-iterations' })`. v0.0.2 may flip the default to 3 or 5 once iteration becomes meaningful.
- `--context-dir` default is `./context` resolved from cwd; missing directory is created via `mkdir -p` (the runtime owns directory existence).
- `@wifo/factory-twin` is **dropped** from `packages/runtime/package.json` at T1. v0.0.2 will add it back when there's actual usage.
- All type imports use `import type` (`verbatimModuleSyntax`); every array/object index access is guarded (`noUncheckedIndexedAccess`).
- Cross-iteration record threading is **not** implemented in v0.0.1: each iteration's `inputs` are scoped to predecessor outputs from the same iteration. Documented in README.

## 3. Risk Assessment

- **Phase contract over-coupling to harness**: `validatePhase` reads cwd from `spec.raw.filename` as a fallback. If a spec is parsed without a filename (in-memory tests), the phase falls back to `process.cwd()`. Pinned in §2.
- **`maxIterations: 1` default is honest for v0.0.1**: with only `validatePhase`, iteration n+1 produces the same harness report as iteration n — defaulting to 5 would burn the budget for nothing observable. The framework still supports iteration so v0.0.2 (plan/implement phases) just works. README documents the v0.0.2 default flip.
- **Empty graph**: rejected at construction. Alternative (allow empty + treat as instant-pass) is a footgun with no use case.
- **Phase exception semantics**: a phase that throws asynchronously must not crash the runtime. The outer try/catch around `phase.run(ctx)` covers this. Pinned by H-1.
- **Duplicate registration across `run()` calls**: the same process calling `run()` twice with the same store would fail on the second `register`. `tryRegister` makes both calls idempotent. Pinned by H-3.
- **Convergence policy generality**: a graph whose terminal phase is named other than `'validate'` must converge correctly. The policy keys on aggregate phase status, not phase name. Pinned by H-2.
- **Graph cycle detection at construction**: if cycles slipped past construction into `run()`, the runtime would deadlock on input collection. Catching at construction guarantees `run()` only sees DAGs. Pinned by S-2.
- **Parent-chain integrity**: `factory-phase` records reference `runId` and `inputRecordIds`; `factory-validate-report` records reference `[runId]`. The context store enforces parent existence at put-time, so any breakage shows up as a `ContextError('context/parent-missing')` — the runtime wraps it as `RuntimeError({ code: 'runtime/io-error' })` and re-throws. Pinned by S-3, S-4.
- **Spec without filename**: tests sometimes parse specs in memory without a filename. `validatePhase` handles this by falling back to `process.cwd()`. Pinned in §2.
- **Hash collisions in factory-phase records**: two iterations of the same phase invocation with identical inputs and outputs would collide on id. `recordedAt` is excluded from the hash, but `iteration: number` IS in the payload — two iterations produce different payloads → different ids. Defensive design.
- **Error-class consistency across layers**: `RuntimeError` mirrors `ContextError` / `TwinReplayError` / `TwinNoMatchError`. Without it, runtime would be the only layer where callers had to regex-match `err.message` instead of `instanceof + .code`. The +2 names on the surface (`RuntimeError`, `RuntimeErrorCode`) buy convention parity across all five layers.
- **Blast radius**: contained to `packages/runtime/`. No changes to the other four packages. `pnpm test` becomes green again as a side effect of T1+ adding real test files (currently failing because `src/index.ts` is empty).

## 4. Subtask Outline

Eight subtasks, ~1130 LOC source plus tests. Full test pointers in `docs/specs/factory-runtime-v0-0-1.md`.

- **T1** [config] — Bump `packages/runtime/package.json` to `0.0.1`; **remove `@wifo/factory-twin`** from `dependencies`; add `zod@^3.23.8` dep; create empty source files (`types.ts`, `errors.ts`, `records.ts`, `graph.ts`, `runtime.ts`, `phases/validate.ts`, `cli.ts`); confirm `tsconfig.build.json` excludes test files; create empty `test-fixtures/` directory. ~30 LOC.
- **T2** [feature] — `src/types.ts`: all public types (`Phase`, `PhaseContext` with `runId` + `iteration`, `PhaseResult`, `PhaseGraph`, `PhaseStatus`, `RunOptions`, `RunReport`, `RunStatus`, `PhaseInvocationResult`, `PhaseIterationResult`). Pure type module. ~85 LOC.
- **T3** [feature] — `src/errors.ts` + `src/records.ts` + tests: `RuntimeError extends Error` with stable `code: RuntimeErrorCode`; zod schemas (`FactoryRunSchema`, `FactoryPhaseSchema`, `FactoryValidateReportSchema`); `tryRegister` helper. Tests cover `RuntimeError` `instanceof` + `code` discrimination, schema acceptance/rejection, `tryRegister` idempotency on `context/duplicate-registration`, propagation of every other `ContextError`. **depends on T2**. ~150 LOC.
- **T4** [feature] — `src/graph.ts` + tests: `definePhase`, `definePhaseGraph` with full validation (duplicates, unknown edges, cycles, empty `phases[]`) all throwing `RuntimeError` with the matching `code`; topological sort with insertion-order tiebreak; frozen output. Tests cover linear chain, diamond, cycle (3 forms: self-loop, 2-cycle, 3-cycle), duplicate-name rejection, unknown-edge rejection, empty-phases rejection, deterministic tiebreak. **depends on T2, T3**. ~170 LOC.
- **T5** [feature] — `src/runtime.ts` + tests: `run({ spec, graph, contextStore, options })` — registers types, validates `maxIterations` (default 1; non-positive throws `RuntimeError({ code: 'runtime/invalid-max-iterations' })`), puts `factory-run`, iterates graph in topo order, constructs `PhaseContext` per invocation with `runId` + `iteration` injected, collects PhaseResults, deduplicates inputs across predecessors, persists `factory-phase` records, aggregates iteration status, captures phase exceptions as `'error'`, builds `RunReport`. Wraps `ContextError`s thrown by `store.put` for `factory-run`/`factory-phase` writes as `RuntimeError({ code: 'runtime/io-error' })` and re-throws. Tests use synthetic phases (closures that simulate `validatePhase` outputs deterministically; assert ctx.runId/iteration are populated correctly) against a tmp-dir context store. Covers: default-1 single-shot, single-phase fail → no-converge after maxIterations, multi-phase chain with parent provenance, phase exception → status='error' + run abort, register-or-skip across two `run()` calls in one process. **depends on T2, T3, T4**. ~290 LOC.
- **T6** [feature] — `src/phases/validate.ts` + tests: `validatePhase(opts?)` — returns a `Phase` named `'validate'`; calls `runHarness`; puts `factory-validate-report` with `parents: [ctx.runId]`; maps `report.status` to `PhaseResult.status`; resolves cwd from opts/spec filename/cwd. Tests pre-create a `factory-run` record in a tmp-dir store, construct `PhaseContext` with that runId, call validatePhase, assert validate-report has `parents === [runId]`. Uses fixture specs (`all-pass.md`, `will-fail.md`); `--no-judge`-equivalent options so no API key is needed. **depends on T2, T3**. ~150 LOC.
- **T7** [feature] — `src/cli.ts` + tests + fixtures: `factory-runtime run <spec-path>` with `--max-iterations`, `--context-dir`, `--scenario`, `--no-judge`; manual subcommand dispatch on `argv[0]`; injectable `CliIo`; exit-code mapping (0/1/2/3); summary lines per RunStatus. Fixtures: `test-fixtures/all-pass.md`, `test-fixtures/will-fail.md`, `test-fixtures/trivial-pass.test.ts`, `test-fixtures/trivial-fail.test.ts`. Tests via `Bun.spawn` cover: pass-spec → exit 0 + "converged" line, fail-spec → exit 1 + "no-converge" line, missing spec → exit 3, bad `--max-iterations` → exit 2, unknown subcommand → exit 2. **depends on T5, T6**. ~290 LOC.
- **T8** [chore] — `src/index.ts` public re-exports matching §2; expand `packages/runtime/README.md` with programmatic + CLI usage, on-disk record types and parent chain (run → validate-report; run → phase with phase.outputRecordIds cross-referencing the report), iteration policy + the v0.0.1 honest-default note (`maxIterations: 1`), a one-liner that `PhaseContext.iteration` is forward-compat shape (validatePhase ignores it in v0.0.1; v0.0.2 phases like `plan`/`implement` may adapt across iterations), `RuntimeError.code` list with example handling code, deferred Claude-Agent-SDK + factory-twin note, Node 22+. **depends on T2..T7**. ~85 LOC.

Total LOC ≈ 1130. Surface area: 1 new package, no changes to others.

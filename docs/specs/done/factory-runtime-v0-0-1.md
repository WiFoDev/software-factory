---
id: factory-runtime-v0-0-1
classification: deep
type: feat
status: ready
exemplars:
  - path: packages/harness/src/runner.ts
    why: Result-aggregation pattern — typed structured records collected from sub-routines into a single report; non-throwing operational error propagation.
  - path: packages/harness/src/cli.ts
    why: CLI pattern — manual subcommand dispatch on argv[0], parseArgs per subcommand, injectable CliIo, exit-code mapping (0/1/2/3).
  - path: packages/context/src/tree.ts
    why: DAG traversal with cycle detection (ancestor-set carry). Mirror the cycle-detection idea for graph-construction validation in `definePhaseGraph`.
  - path: packages/context/src/store.ts
    why: createStore/register/put/get pattern this package consumes; also the deduped-parents-preserving-first-occurrence-order semantic that the runtime relies on for input record dedup.
  - path: packages/context/src/index.ts
    why: Public-API-surface convention — explicit re-exports, `import type` for types, internal helpers stay unexported.
---

# factory-runtime-v0-0-1 — Phase-graph runtime that composes core/harness/twin/context with one built-in `validatePhase`

## Intent

Layer-5 of the factory: turn the four primitives into a working agent loop. `@wifo/factory-runtime` exports `definePhase(name, fn)`, `definePhaseGraph(phases, edges)`, and `run({ spec, graph, contextStore, options })`, plus one built-in phase: `validatePhase(opts?)` which calls `@wifo/factory-harness`'s `runHarness` and persists a `factory-validate-report` context record. The runtime executes the graph in topological order (serial in v0.0.1), persists a `factory-run` record at start (`parents: []`) and one `factory-phase` record per phase invocation per iteration (`parents: [runId, ...inputRecordIds]`), and iterates the graph until aggregated phase status is `'pass'` (converged) or `maxIterations` (default 1 in v0.0.1; see Constraints / Decisions) is reached (no-converge). Ships a `factory-runtime run <spec-path>` CLI exiting `0` on convergence, `1` on no-converge, `2` on usage error, `3` on operational error. Claude-Agent-SDK integration and `explore`/`plan`/`implement` phases are deferred to v0.0.2.

## Scenarios

**S-1** — `definePhase` + `definePhaseGraph` build a frozen graph with deterministic topological order
  Given three phases `a`, `b`, `c` and edges `[['a','b'], ['a','c']]` (diamond head)
  When `definePhaseGraph([a,b,c], edges)` is called
  Then it returns a frozen object with `phases.length === 3`, `edges` matching the input, and `topoOrder === ['a','b','c']` (insertion-order tiebreak among in-degree-zero peers)
  And when phases are passed in the order `[c,b,a]` with the same edges, `topoOrder === ['a','c','b']` (a is still first because of edges; c precedes b because of insertion-order tiebreak)
  And when `definePhase('foo', fn)` is called, it returns `{ name: 'foo', run: fn }` with no validation
  Satisfaction:
    - test: `src/graph.test.ts` "definePhase round-trips; definePhaseGraph computes deterministic topoOrder with insertion-order tiebreak"

**S-2** — `definePhaseGraph` rejects malformed graphs at construction time
  Given each of: (a) empty `phases: []`; (b) two phases with the same name; (c) edges referencing a name not in `phases`; (d) a self-loop edge `[['x','x']]`; (e) a 2-cycle `[['x','y'],['y','x']]`; (f) a 3-cycle through `a → b → c → a`
  When `definePhaseGraph(...)` is called
  Then each call throws a `RuntimeError` whose `code` matches the case: `'runtime/graph-empty'` for (a), `'runtime/graph-duplicate-phase'` for (b), `'runtime/graph-unknown-phase'` for (c), `'runtime/graph-cycle'` for (d/e/f); the error message names at least one offending phase id; no record is written to any context store, no harness is invoked, no async work begins (validation is synchronous)
  Satisfaction:
    - test: `src/graph.test.ts` "rejects empty/duplicate/unknown-edge/cycle graphs synchronously as typed RuntimeError with stable code"
    - judge: "each error message names the offending phase(s) clearly enough that a developer can locate the bad edge or duplicate without re-running anything"

**S-3** — `validatePhase` puts a `factory-validate-report` record (parents: [ctx.runId]) and returns `PhaseResult` with status mirroring the harness report
  Given a fixture spec at `test-fixtures/all-pass.md` whose only scenario references `trivial-pass.test.ts`, a tmp-dir `ContextStore` pre-populated with a `factory-run` record (id `runId`), `validatePhase({ cwd: <fixturesDir>, noJudge: true })`, and a `PhaseContext` constructed with `{ spec, contextStore, log, runId, iteration: 1 }`
  When the produced phase's `run(ctx)` is invoked
  Then `runHarness` runs and returns `status: 'pass'`; the phase puts one record of type `factory-validate-report` whose payload mirrors the `HarnessReport` (top-level keys `specId`, `startedAt`, `durationMs`, `scenarios`, `summary`, `status: 'pass'`); the persisted record's `parents === [runId]`; the returned `PhaseResult` is `{ status: 'pass', records: [<that record>] }`
  And when the spec references `trivial-fail.test.ts` (failing test), the same flow returns `{ status: 'fail', records: [<one report record>] }` and the persisted record's `status === 'fail'` and `parents === [runId]`
  Satisfaction:
    - test: `src/phases/validate.test.ts` "puts factory-validate-report with parents=[runId] and returns PhaseResult mirroring HarnessReport.status (pass + fail fixtures)"

**S-4** — `run()` persists `factory-run` and `factory-phase` records with the documented parent chain
  Given a graph of two synthetic phases `p1 → p2` (each puts a single typed record on success), a tmp-dir `ContextStore`, a passing-spec stub, and `maxIterations: 1`
  When `run({ spec, graph, contextStore: store, options: { maxIterations: 1 } })` is called
  Then the report's `runId` references a record of type `factory-run` with `parents: []` and payload `{ specId, graphPhases: ['p1','p2'], maxIterations: 1, startedAt }`
  And there are exactly two records of type `factory-phase`, in this order: one for `p1` with `parents === [runId]` (no upstream inputs) and `payload.phaseName === 'p1'`, `payload.iteration === 1`, `payload.outputRecordIds === [<p1 output>]`; one for `p2` with `parents === [runId, <p1 output id>]` and `payload.outputRecordIds === [<p2 output>]`
  And the `RunReport` has `status: 'converged'`, `iterationCount: 1`, `iterations.length === 1`, `iterations[0].phases.length === 2`, and each `PhaseInvocationResult.phaseRecordId` matches the on-disk `factory-phase` record id
  Satisfaction:
    - test: `src/runtime.test.ts` "persists factory-run + factory-phase chain with [runId, ...inputs] parents in topo order"

**S-5** — `run()` iterates while phases fail and stops at `maxIterations` with `no-converge`
  Given a single-phase graph whose phase always returns `{ status: 'fail', records: [<one record>] }`, a tmp-dir store, and `maxIterations: 3`
  When `run(...)` is called
  Then the phase is invoked exactly 3 times; the report has `status: 'no-converge'`, `iterationCount: 3`, `iterations.length === 3`; three `factory-phase` records exist on disk, each with `payload.iteration ∈ {1,2,3}` and `payload.status: 'fail'`; CLI exit code 1 maps to this status
  And given the same graph with a phase that returns `'fail'` on iteration 1 but `'pass'` on iteration 2, the report has `status: 'converged'`, `iterationCount: 2`, the phase is invoked exactly 2 times (no third call), and the second `factory-phase` record's `payload.status === 'pass'`
  And given `maxIterations: 0` (or any non-positive integer), `run(...)` throws synchronously with a `RuntimeError` whose `code === 'runtime/invalid-max-iterations'` (no records written)
  And given `maxIterations` is omitted entirely, the default is `1` — a one-shot run with no iteration loop
  Satisfaction:
    - test: `src/runtime.test.ts` "iterates on fail, stops on pass, default maxIterations is 1, rejects non-positive maxIterations as RuntimeError"

**S-6** — CLI exit codes, flag parsing, and summary output
  Given a built `dist/cli.js` and the fixture specs at `test-fixtures/all-pass.md` and `test-fixtures/will-fail.md`
  When `factory-runtime run test-fixtures/all-pass.md --no-judge --context-dir <tmp>` is invoked via `Bun.spawn`
  Then exit code `0`, stdout contains a single line matching `factory-runtime: converged in 1 iteration(s) (run=<16-hex-id>` and `,` separating duration, the `<tmp>` directory contains a `factory-run`, a `factory-phase`, and a `factory-validate-report` record
  And when `factory-runtime run test-fixtures/will-fail.md --no-judge --max-iterations 2 --context-dir <tmp>` is invoked
  Then exit code `1`, stdout contains `factory-runtime: no-converge after 2 iteration(s)`, the `<tmp>` directory contains 1 `factory-run`, 2 `factory-phase`, and 2 `factory-validate-report` records (each report's `parents === [runId]`)
  And when `factory-runtime run does-not-exist.md` is invoked, exit code `3`, stderr contains `Spec not found: does-not-exist.md`
  And when `factory-runtime run <spec> --max-iterations 0` is invoked, exit code `2`, stderr contains `runtime/invalid-max-iterations`
  And when `factory-runtime nope` is invoked, exit code `2`, stderr contains `Unknown subcommand: nope`
  And when `factory-runtime run <spec> --scenario S-1,S-2` is invoked, only those scenarios are passed to the harness (verifiable via the persisted `factory-validate-report.scenarios` length matching the filter)
  Satisfaction:
    - test: `src/cli.test.ts` "exit codes (0/1/2/3), --max-iterations validation, --scenario filter, --context-dir, summary lines"
    - judge: "the converged/no-converge/error summary lines name the runId so a developer can run `factory-context tree <runId>` to see the full provenance without re-running anything"

## Holdout Scenarios

**H-1** — Phase exception is captured as `status: 'error'`, run aborts immediately
  Given a graph of two phases `p1 → p2` where `p1.run` throws synchronously (or rejects with `new Error('boom')`), a tmp-dir store, and `maxIterations: 5`
  When `run(...)` is invoked
  Then `run` does not re-throw; the returned `RunReport.status === 'error'`, `iterationCount === 1`, `iterations[0].phases.length === 1` (only `p1`); a single `factory-phase` record exists on disk for `p1` with `payload.status === 'error'`, `payload.failureDetail` containing `'boom'`; `p2.run` is never invoked; subsequent iterations do not occur

**H-2** — Convergence policy is generic across phase names — graph whose terminal phase is named `'check'` (not `'validate'`) converges on `'pass'` and iterates on `'fail'`
  Given a single-phase graph with a phase named `'check'` (synthetic phase, returns whatever status the test demands)
  When the phase returns `'pass'` on first invocation
  Then the report has `status: 'converged'`, `iterationCount: 1`
  And when the phase returns `'fail'` and `maxIterations: 2`, the phase is invoked exactly twice
  Then the report has `status: 'no-converge'` and the runtime never inspects `phase.name` to decide convergence (verified by re-running the same flow with the phase renamed to `'whatever'` and asserting identical observable behavior)

**H-3** — Two `run()` invocations in the same process against the same `ContextStore` don't blow up on duplicate type registration
  Given a single `ContextStore` instance reused across two sequential `run()` calls (each with the same default validate-only graph) in the same process
  When the second `run()` is invoked
  Then no `ContextError('context/duplicate-registration')` is thrown for `factory-run`, `factory-phase`, or `factory-validate-report` (the runtime's `tryRegister` swallows duplicate-registration silently); both `run()` calls complete normally and produce distinct `runId`s; both runs' records coexist on disk

## Constraints / Decisions

- Public API surface from `src/index.ts` is fixed: `run`, `definePhase`, `definePhaseGraph`, `validatePhase` (functions); `RuntimeError` (class); `Phase`, `PhaseContext`, `PhaseResult`, `PhaseGraph`, `PhaseStatus`, `RunOptions`, `RunReport`, `RunStatus`, `PhaseInvocationResult`, `PhaseIterationResult`, `ValidatePhaseOptions`, `RuntimeErrorCode` (types). 4 functions + 1 class + 12 types = 17 names. Adding a name in v0.0.1 requires updating both this spec and the technical plan §2.
- `PhaseContext` shape: `{ spec, contextStore, log, runId, iteration }`. The `runId` (id of the `factory-run` record) and `iteration` (1-indexed iteration number) are injected by the runtime so phases can attach proper parents to records they put — without these, `factory-validate-report` would be orphaned in the DAG. v0.0.1 phases that don't need them simply ignore them. Phases that need additional configuration (like `validatePhase`) are factory functions that close over their config — `validatePhase(opts)` returns a configured `Phase`. The runtime stays opt-agnostic.
- `validatePhase` is a factory function: `validatePhase(opts?: ValidatePhaseOptions): Phase`. The produced phase is named `'validate'`. `ValidatePhaseOptions` is a subset of `RunHarnessOptions` (omits `cwd` default-injection details and `judge.client` — the latter always uses harness's default Anthropic-backed client).
- `definePhaseGraph` validates synchronously and throws `RuntimeError` with `code` ∈ {`'runtime/graph-empty'`, `'runtime/graph-duplicate-phase'`, `'runtime/graph-unknown-phase'`, `'runtime/graph-cycle'`}. The error message names the offending phase id(s); the `code` field lets callers `catch (err) { if (err instanceof RuntimeError && err.code === 'runtime/graph-cycle') ... }` without regex on `err.message`. Mirrors the `ContextError` / `TwinReplayError` convention from the prior layers.
- `RuntimeError extends Error` with a stable `code: RuntimeErrorCode` field. `RuntimeErrorCode` union: `'runtime/graph-empty' | 'runtime/graph-duplicate-phase' | 'runtime/graph-unknown-phase' | 'runtime/graph-cycle' | 'runtime/invalid-max-iterations' | 'runtime/io-error'`. The set of codes is stable; adding one is a public-API change.
- Topological sort uses Kahn's algorithm. Tiebreak among in-degree-zero peers: insertion order from the `phases[]` array. Result is frozen and exposed as `graph.topoOrder` (string array of phase names).
- `run()` writes one `factory-run` record at start with `parents: []` and one `factory-phase` record per phase invocation per iteration with `parents: [runId, ...inputRecordIds]`. `inputRecordIds` is the dedup union (preserving first-occurrence order across visited predecessors) of `PhaseResult.records.map(r => r.id)` from this iteration's predecessor phases. The context store further deduplicates parents internally; mismatched/duplicate ids in the input list never produce malformed parents on disk.
- Cross-iteration record threading is **not** implemented in v0.0.1: each iteration starts fresh from the parsed `spec`. Records from iteration `n` are not exposed as inputs to iteration `n+1`'s phases. Documented in README.
- `factory-validate-report` records have `parents: [ctx.runId]` (the phase reads `runId` from `PhaseContext`). The DAG is `factory-run → factory-validate-report`; the parallel `factory-run → factory-phase` chain captures the phase event itself with `outputRecordIds` cross-referencing the report.
- Phase exceptions: if `phase.run(ctx)` throws or rejects, the runtime catches it, persists a `factory-phase` record with `status: 'error'` and `failureDetail` populated from the exception, sets `RunReport.status = 'error'`, and aborts (no further phases this iteration, no further iterations). `run()` never re-throws on phase exceptions — it always returns a `RunReport`.
- `runHarness` is contractually non-throwing on operational state. `validatePhase` does not wrap it in try/catch — the runtime's outer try/catch is the safety net for unexpected throws.
- `tryRegister` is an internal helper that calls `store.register(type, schema)` and swallows only `ContextError('context/duplicate-registration')`. All other `ContextError`s propagate. Used at the top of `run()` (for `factory-run`/`factory-phase`) and inside `validatePhase` (for `factory-validate-report`). Makes both safe to call repeatedly across iterations and across multiple `run()` invocations in the same process.
- Iteration policy is **generic** across phase names. Convergence keys on aggregated phase status across the iteration: `'error'` if any phase errored (run aborts), else `'fail'` if any failed (iterate while budget remains), else `'pass'` (converged). The runtime never inspects `phase.name` to decide convergence. Pinned by H-2.
- `RunOptions.maxIterations` default is `1`. With only `validatePhase` available in v0.0.1, iterations 2..N produce identical reports modulo flake — defaulting to 1 is the honest choice. v0.0.2 (when `plan`/`implement` phases land and iteration becomes meaningful) may flip the default to 3 or 5. Values `<= 0` (or non-integer) cause `run()` to throw `RuntimeError({ code: 'runtime/invalid-max-iterations' })` synchronously before any record is written. Validated in `run()` itself, not in the CLI alone.
- `run()` re-throws (as `RuntimeError({ code: 'runtime/io-error' })`) when a `store.put` for `factory-run` or `factory-phase` itself fails (rare: corrupt dir, version mismatch from a future schema). The alternative — writing a partial `RunReport` and returning — would silently mask data-corruption signals. Pinned: re-throw.
- Logging: `PhaseContext.log` is a single-line callback (`(line: string) => void`). The CLI passes a default that writes to stderr with a trailing newline. `RunOptions.log` defaults the same. `validatePhase` forwards `ctx.log` to `runHarness` via `RunHarnessOptions.log`. Phases must not write to `process.stdout`/`process.stderr` directly — funnel through `ctx.log`.
- CLI: manual subcommand dispatch on `argv[0] === 'run'`. `parseArgs` consumes the remainder. Injectable `CliIo` matches harness/context CLIs.
- CLI flags: `--max-iterations <n>` (positive integer; rejects 0/negative/non-numeric with exit 2), `--context-dir <path>` (default `./context` resolved from cwd; runtime `mkdir -p`s if missing), `--scenario <ids>` (comma-separated, whitespace trimmed per id, empty entries dropped — mirrors harness CLI), `--no-judge` (skip judge satisfactions in the harness call).
- CLI exit codes: `0` converged, `1` no-converge, `2` usage error (unknown subcommand, missing positional, invalid flag value), `3` operational error (spec not found, parse failure, status === `'error'`, IO error).
- CLI summary lines (single-line each, written to stdout):
  - `'converged'`: `factory-runtime: converged in <n> iteration(s) (run=<runId>, <durationMs>ms)\n`
  - `'no-converge'`: `factory-runtime: no-converge after <maxIterations> iteration(s) (run=<runId>)\n`
  - `'error'`: `factory-runtime: error during phase '<name>' iteration <n> (run=<runId>)\n  detail: <failureDetail>\n`
  - The runId on every line lets a developer run `factory-context tree <runId>` to inspect provenance without re-running.
- `@wifo/factory-twin` is **dropped** from `packages/runtime/package.json` in v0.0.1 — the scaffolded `package.json` lists it, but T1 removes it. The v0.0.2 PR that wires Claude-Agent-SDK HTTP through the twin will add the dep back when there's actual usage. Premature deps are a smell; the lockfile churn isn't worth the "purely additive" framing.
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. Every type import uses `import type`. Every array/object index access is guarded.

## Subtasks

- **T1** [config] — Bump `packages/runtime/package.json` to `0.0.1`; **remove** `@wifo/factory-twin` from `dependencies` (v0.0.1 does not import it; the v0.0.2 PR will add it back when there's actual usage); add `zod@^3.23.8` runtime dep; create empty source files (`src/types.ts`, `src/errors.ts`, `src/records.ts`, `src/graph.ts`, `src/runtime.ts`, `src/phases/validate.ts`, `src/cli.ts`); confirm `tsconfig.build.json` excludes test files; create empty `test-fixtures/` directory. ~30 LOC.
- **T2** [feature] — `src/types.ts`: all public types (`Phase`, `PhaseContext`, `PhaseResult`, `PhaseGraph`, `PhaseStatus`, `RunOptions`, `RunReport`, `RunStatus`, `PhaseInvocationResult`, `PhaseIterationResult`). `PhaseContext` is `{ spec, contextStore, log, runId, iteration }`. Pure type module. ~85 LOC.
- **T3** [feature] — `src/errors.ts` + `src/records.ts` + tests: `RuntimeError` class extending `Error` with `code: RuntimeErrorCode`; zod schemas (`FactoryRunSchema`, `FactoryPhaseSchema`, `FactoryValidateReportSchema`); `tryRegister` helper. Tests cover `RuntimeError` `instanceof` + `code` discrimination, schema acceptance/rejection of well-formed and malformed payloads, `tryRegister` idempotency on `context/duplicate-registration`, and propagation of every other `ContextError`. **depends on T2**. ~150 LOC.
- **T4** [feature] — `src/graph.ts` + tests: `definePhase`, `definePhaseGraph` with synchronous validation (empty `phases[]`, duplicates, unknown edges, self-loop, 2-cycle, 3-cycle) all throwing `RuntimeError` with the matching `code`; topological sort with insertion-order tiebreak; frozen output. Tests cover linear chain, diamond, all six rejection cases from S-2, and deterministic tiebreak per S-1. **depends on T2, T3**. ~170 LOC.
- **T5** [feature] — `src/runtime.ts` + tests: `run({ spec, graph, contextStore, options })` — registers `factory-run`/`factory-phase` types via `tryRegister`, validates `maxIterations` (default 1; non-positive throws `RuntimeError({ code: 'runtime/invalid-max-iterations' })`), puts `factory-run`, iterates graph in topo order, constructs `PhaseContext` per invocation with `runId` + `iteration`, deduplicates inputs from predecessors, persists `factory-phase` records, aggregates iteration status, captures phase exceptions as `'error'` (with `failureDetail`), aborts on error, builds `RunReport`. Tests use synthetic phases (closures that simulate phase outputs deterministically; assert ctx.runId / ctx.iteration are populated correctly) against tmp-dir stores. Covers S-4 (parent chain), S-5 (default 1 / iterate-then-converge / iterate-to-no-converge / invalid maxIterations), H-1 (phase exception), H-3 (idempotent registration across two `run()` calls). **depends on T2, T3, T4**. ~290 LOC.
- **T6** [feature] — `src/phases/validate.ts` + tests: `validatePhase(opts?)` — returns `Phase` named `'validate'`; calls `runHarness`; puts `factory-validate-report` with `parents: [ctx.runId]`; maps `report.status` to `PhaseResult.status`; resolves cwd from `opts.cwd ?? dirname(spec.raw.filename) ?? process.cwd()`; forwards `ctx.log` to harness. Tests pre-create a `factory-run` record in a tmp-dir store, construct `PhaseContext` with that runId, call validatePhase, and assert the validate-report is on disk with `parents === [runId]`. Uses fixture specs (`all-pass.md`, `will-fail.md`) and trivial test files; `--no-judge`-equivalent options so no API key is needed. Covers S-3. **depends on T2, T3**. ~150 LOC.
- **T7** [feature] — `src/cli.ts` + tests + fixtures: `factory-runtime run <spec-path>` with all four flags; manual subcommand dispatch on `argv[0]`; injectable `CliIo`; exit-code mapping (0/1/2/3); summary lines per `RunStatus`. Fixtures: `test-fixtures/all-pass.md` (one passing scenario referencing `trivial-pass.test.ts`), `test-fixtures/will-fail.md` (one scenario referencing `trivial-fail.test.ts`), `test-fixtures/trivial-pass.test.ts`, `test-fixtures/trivial-fail.test.ts`. Tests via `Bun.spawn` cover S-6 (all sub-cases). **depends on T5, T6**. ~290 LOC.
- **T8** [chore] — `src/index.ts` public re-exports matching technical plan §2; expand `packages/runtime/README.md` with a programmatic usage example, the CLI usage example, the on-disk record types and parent chain (run → validate-report; run → phase, with phase.outputRecordIds cross-referencing the report), the convergence policy and iteration semantics, the v0.0.1 honest-default note (`maxIterations: 1` until v0.0.2 ships plan/implement, then iteration becomes meaningful), the cross-iteration-thread limitation, a one-line note that `PhaseContext.iteration` is forward-compat shape (v0.0.1's `validatePhase` ignores it; v0.0.2 phases like `plan`/`implement` may adapt behavior across iterations), the deferred Claude-Agent-SDK + factory-twin note, the `RuntimeError.code` list with example handling code, and Node 22+ as the supported runtime. **depends on T2..T7**. ~85 LOC.

## Definition of Done

- All visible scenarios pass (tests green; judge criteria met).
- All holdout scenarios pass at end-of-task review.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green (`bun test`); `pnpm test` workspace-wide green (currently failing on the empty runtime suite — this DoD makes it green).
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`.
- `node packages/runtime/dist/cli.js run packages/runtime/test-fixtures/all-pass.md --no-judge --context-dir <tmp>` exits 0 against the runnable fixture (created by T7); a `factory-context list --dir <tmp>` against the same directory shows `factory-run`, `factory-phase`, and `factory-validate-report` records.
- Public API surface from `src/index.ts` matches the technical plan §2 exactly (4 functions + 1 class + 12 types = 17 names).
- README in `packages/runtime/` documents: programmatic usage, CLI usage, the on-disk record types and parent chain (run → validate-report; run → phase with phase.outputRecordIds cross-referencing the report), the convergence/iteration policy, the v0.0.1 limitations (no cross-iteration threading; default `maxIterations: 1`), the `RuntimeError.code` list, and Node 22+.
- No imports of `@wifo/factory-twin` in `packages/runtime/src/**`, AND `@wifo/factory-twin` removed from `packages/runtime/package.json` `dependencies`. v0.0.2 will add it back when actually used.

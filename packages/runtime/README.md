# @wifo/factory-runtime

Phase-graph runtime for software-factory. Composes `@wifo/factory-core`, `@wifo/factory-harness`, and `@wifo/factory-context` into an end-to-end pipeline that executes a graph of phases against a parsed spec, persists provenance to the context store, and iterates until convergence or the iteration budget is exhausted.

v0.0.1 ships one built-in phase, `validatePhase`, which runs the harness against the spec and persists a `factory-validate-report` record. v0.0.2 will add Claude-Agent-SDK-backed `explore`, `plan`, and `implement` phases (and re-introduce the `@wifo/factory-twin` dependency for HTTP recording).

Requires Node 22+.

## Programmatic usage

```ts
import { readFileSync } from 'node:fs';
import { createContextStore } from '@wifo/factory-context';
import { parseSpec } from '@wifo/factory-core';
import {
  definePhaseGraph,
  run,
  validatePhase,
} from '@wifo/factory-runtime';

const source = readFileSync('docs/specs/my-feature.md', 'utf8');
const spec = parseSpec(source, { filename: 'docs/specs/my-feature.md' });

const store = createContextStore({ dir: './context' });
const graph = definePhaseGraph(
  [validatePhase({ noJudge: true })],
  [],
);

const report = await run({
  spec,
  graph,
  contextStore: store,
  options: { maxIterations: 1 },
});

console.log(report.status, report.runId);
// → "converged" "abc1234567890def"
```

## CLI

```
factory-runtime run <spec-path> [flags]

Flags:
  --max-iterations <n>     Max iterations (default: 1; v0.0.2 may flip to 3 or 5)
  --context-dir <path>     Context store directory (default: ./context)
  --scenario <ids>         Comma-separated scenario ids (e.g. S-1,S-2,H-1)
  --no-judge               Skip judge satisfactions in the harness
```

Exit codes:
- `0` — converged (every phase passed)
- `1` — no-converge (a phase kept failing within the iteration budget)
- `2` — usage error (bad flags, missing positional, invalid `--max-iterations`)
- `3` — operational error (spec not found, parse error, IO error, phase exception)

The CLI prints a one-line summary to stdout that includes the `runId`, so you can inspect provenance with:

```sh
factory-context tree <runId> --dir ./context
```

## Phase contract

```ts
interface PhaseContext {
  spec: Spec;
  contextStore: ContextStore;
  log: (line: string) => void;
  runId: string;          // id of the factory-run record
  iteration: number;      // 1-indexed; forward-compat (validatePhase ignores it in v0.0.1)
}

interface PhaseResult {
  status: 'pass' | 'fail' | 'error';
  records: ContextRecord[];   // records the phase put during this invocation
}

type Phase = {
  readonly name: string;
  readonly run: (ctx: PhaseContext) => Promise<PhaseResult>;
};
```

Define a phase with `definePhase(name, fn)`. Compose phases into a DAG with `definePhaseGraph(phases, edges)`. Edges are `[from, to]` pairs: `from` completes before `to` starts. The graph is validated synchronously — empty `phases[]`, duplicate names, unknown edge endpoints, and cycles all throw `RuntimeError` at construction.

`PhaseContext.iteration` is part of the public shape so v0.0.2 phases (`plan`/`implement`) can adapt their behavior across iterations. The v0.0.1 `validatePhase` ignores it.

## On-disk record types

The runtime persists three record types via the context store:

| Type | Parents | Created by | Purpose |
|---|---|---|---|
| `factory-run` | `[]` | runtime, once at start | Run-level metadata (specId, graphPhases, maxIterations, startedAt) |
| `factory-phase` | `[runId, ...inputRecordIds]` | runtime, once per phase invocation | Phase-event log (phaseName, iteration, status, durationMs, outputRecordIds, failureDetail?) |
| `factory-validate-report` | `[runId]` | `validatePhase`, once per invocation | The full `HarnessReport` payload |

The DAG is `factory-run → factory-validate-report` (direct child) plus `factory-run → factory-phase` (parallel chain). The `factory-phase` record's `outputRecordIds` field cross-references the validate-report so `factory-context tree <runId>` shows the full provenance.

## Iteration policy

A "convergence" pass is computed across each iteration's phases:

- If any phase status is `'error'` → run aborts with `RunReport.status = 'error'`.
- Else if any is `'fail'` → iterate while `iteration < maxIterations`, else `'no-converge'`.
- Else (all `'pass'`) → `'converged'`.

Convergence is **generic** across phase names — the runtime never inspects `phase.name` to decide. A graph whose terminal phase is named `'check'` (instead of `'validate'`) converges on `'pass'` exactly the same way.

**Default `maxIterations: 1` in v0.0.1.** With only `validatePhase` available, iterations 2..N produce identical reports modulo flake — defaulting to 5 would burn the iteration budget for nothing observable. v0.0.2 (when `plan`/`implement` mutate the world between iterations) may flip the default to 3 or 5.

Cross-iteration record threading is **not** implemented in v0.0.1: each iteration's phase inputs are scoped to predecessor outputs from the **same iteration**. Records from iteration `n` do not flow forward into iteration `n+1`.

## Errors

```ts
type RuntimeErrorCode =
  | 'runtime/graph-empty'
  | 'runtime/graph-duplicate-phase'
  | 'runtime/graph-unknown-phase'
  | 'runtime/graph-cycle'
  | 'runtime/invalid-max-iterations'
  | 'runtime/io-error';
```

Match with `instanceof` + `.code`:

```ts
import { RuntimeError, definePhaseGraph } from '@wifo/factory-runtime';

try {
  definePhaseGraph(phases, edges);
} catch (err) {
  if (err instanceof RuntimeError && err.code === 'runtime/graph-cycle') {
    // handle cycle specifically
  }
  throw err;
}
```

`run()` throws `RuntimeError` synchronously for invalid `maxIterations`, and asynchronously (re-throws as `runtime/io-error`) when a `factory-run` or `factory-phase` write fails. Phase exceptions are **not** re-thrown — they are captured as `factory-phase` records with `status: 'error'` and surfaced in `RunReport.status === 'error'`.

## Status

v0.0.1 — runtime + `validatePhase`. v0.0.2 will add Claude-Agent-SDK-backed `explore`/`plan`/`implement` phases and route their HTTP through `@wifo/factory-twin` (which will be added back to `dependencies` at that time).

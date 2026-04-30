# @wifo/factory-runtime

Phase-graph runtime for software-factory. Composes `@wifo/factory-core`, `@wifo/factory-harness`, `@wifo/factory-twin`, and `@wifo/factory-context` into an end-to-end pipeline that executes a graph of phases against a parsed spec, persists provenance to the context store, and iterates until convergence or the iteration budget is exhausted.

v0.0.1 shipped one built-in phase: `validatePhase`. **v0.0.2 adds `implementPhase`** — an agent-driven phase that subprocesses out to `claude -p` (subscription auth, no `ANTHROPIC_API_KEY` required), captures the agent's output and disk delta into a `factory-implement-report` record, and enforces a hard cost cap on input tokens. The CLI's default graph is now `[implement → validate]`; `--no-implement` preserves the v0.0.1 behavior.

Requires Node 22+ and (for the default graph) the `claude` CLI on PATH, signed in via your Claude Pro/Max subscription.

## Programmatic usage

### v0.0.1: validate-only

```ts
import { readFileSync } from 'node:fs';
import { createContextStore } from '@wifo/factory-context';
import { parseSpec } from '@wifo/factory-core';
import { definePhaseGraph, run, validatePhase } from '@wifo/factory-runtime';

const source = readFileSync('docs/specs/my-feature.md', 'utf8');
const spec = parseSpec(source, { filename: 'docs/specs/my-feature.md' });

const store = createContextStore({ dir: './context' });
const graph = definePhaseGraph([validatePhase({ noJudge: true })], []);

const report = await run({ spec, graph, contextStore: store, options: { maxIterations: 1 } });
console.log(report.status, report.runId);
```

### v0.0.2: agent + validate

```ts
import { definePhaseGraph, implementPhase, validatePhase, run } from '@wifo/factory-runtime';

const cwd = process.cwd();
const graph = definePhaseGraph(
  [
    implementPhase({
      cwd,
      maxPromptTokens: 100_000,
      // Default: 'record' mode at <cwd>/.factory/twin-recordings/
      // Set to 'off' to disable env-var plumbing entirely.
    }),
    validatePhase({ cwd, noJudge: true }),
  ],
  [['implement', 'validate']],
);

const report = await run({ spec, graph, contextStore: store });
// report.status: 'converged' | 'no-converge' | 'error'
```

## CLI

```
factory-runtime run <spec-path> [flags]

Flags:
  --max-iterations <n>             Max iterations (default: 1; v0.0.3 may flip)
  --context-dir <path>              Context store directory (default: ./context)
  --scenario <ids>                  Comma-separated scenario ids (e.g. S-1,S-2,H-1)
  --no-judge                        Skip judge satisfactions in the harness
  --no-implement                    Drop the implement phase (v0.0.1 [validate]-only graph)
  --max-prompt-tokens <n>           Hard cap on agent input tokens (default: 100000)
  --claude-bin <path>               Path to the claude executable (default: 'claude' on PATH)
  --twin-mode <record|replay|off>   Twin recording mode (default: record)
  --twin-recordings-dir <path>      Twin recordings dir (default: <cwd>/.factory/twin-recordings)
```

Both `implementPhase` and `validatePhase` receive `cwd: process.cwd()` from the CLI so the agent's edits and the harness's `bun test` invocation resolve against the same tree.

Exit codes:
- `0` — converged (every phase passed)
- `1` — no-converge (a phase kept failing within the iteration budget)
- `2` — usage error (bad flags, missing positional, invalid `--max-iterations`, invalid `--max-prompt-tokens`, invalid `--twin-mode`)
- `3` — operational error (spec not found, parse error, IO error, agent failure, cost-cap exceeded)

The CLI prints a one-line summary to stdout that includes the `runId`:

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
  iteration: number;      // 1-indexed; v0.0.2 phases adapt across iterations (cross-iter context plumbing lands in v0.0.3)
}

interface PhaseResult {
  status: 'pass' | 'fail' | 'error';
  records: ContextRecord[];
}

type Phase = {
  readonly name: string;
  readonly run: (ctx: PhaseContext) => Promise<PhaseResult>;
};
```

Define a phase with `definePhase(name, fn)`. Compose phases into a DAG with `definePhaseGraph(phases, edges)`. Edges are `[from, to]` pairs: `from` completes before `to` starts. The graph is validated synchronously — empty `phases[]`, duplicate names, unknown edge endpoints, and cycles all throw `RuntimeError` at construction.

## Built-in phases

### `validatePhase(opts?)`

Runs `runHarness` against the spec and persists a `factory-validate-report` record (`parents: [ctx.runId]`). Maps the harness report's `status` directly to `PhaseResult.status`. See `ValidatePhaseOptions` for the configurable knobs (`cwd`, `scenarioIds`, `visibleOnly`, `holdoutsOnly`, `noJudge`, `timeoutMs`, `judge.model`).

### `implementPhase(opts?)` *(v0.0.2)*

Subprocesses out to `claude -p --allowedTools "Read,Edit,Write,Bash" --bare --output-format json` with the prompt on stdin (subscription auth — no `ANTHROPIC_API_KEY`). Captures the agent's output and disk delta into a `factory-implement-report` record (`parents: [ctx.runId]`).

```ts
interface ImplementPhaseOptions {
  cwd?: string;                                                              // default: dirname(spec.raw.filename) ?? process.cwd()
  maxPromptTokens?: number;                                                  // default: 100_000
  allowedTools?: string;                                                     // default: 'Read,Edit,Write,Bash'
  claudePath?: string;                                                       // default: 'claude' (on PATH)
  timeoutMs?: number;                                                        // default: 600_000 (10 min)
  twin?: { mode?: 'record' | 'replay'; recordingsDir?: string } | 'off';     // default: { mode: 'record', recordingsDir: '<cwd>/.factory/twin-recordings' }
  promptExtra?: string;
}
```

`implementPhase(opts)` validates `opts.maxPromptTokens` synchronously at factory-call time — non-positive throws `RuntimeError({ code: 'runtime/invalid-max-prompt-tokens' })` before the closure is constructed.

#### Cost cap (post-hoc, hard-stop)

The cap is checked **after** parsing the agent's JSON envelope (`usage.input_tokens`). If `tokens.input > maxPromptTokens`, implementPhase:

1. Persists the `factory-implement-report` with `status: 'error'` and `failureDetail = 'cost-cap-exceeded: input_tokens=N > maxPromptTokens=M'` (the agent's `result` text is preserved).
2. Throws `RuntimeError({ code: 'runtime/cost-cap-exceeded' })`.

The runtime catches the throw → `factory-phase` status='error'. The implement-report exists on disk with `parents: [ctx.runId]`, so `factory-context tree <runId>` shows the wasted run. The cap is a hard *stop*, not a hard *prevent* — by the time the JSON envelope is read, the agent has already used the tokens. v0.0.3 may add streaming cost monitoring.

#### Status mapping

- `claude` exit 0, JSON parsed, `is_error: false`, no overrun → `'pass'`
- `claude` exit 0, JSON parsed, `is_error: true`, no overrun → `'fail'` (with `failureDetail` from the agent's `result`); validate still runs after
- `claude` spawn-failed / exit-nonzero / output-invalid / timeout → throws `RuntimeError({ code: 'runtime/agent-failed' })` with prefixed detail; runtime maps to `factory-phase` status='error'

The `factory-implement-report` is persisted on `'pass'`, `'fail'`, and the cost-cap path; it is **not** persisted on operational failures (no envelope to record).

#### Twin (HTTP record/replay) plumbing

When `opts.twin !== 'off'`, implementPhase sets two env vars on the spawned subprocess (additive to `process.env` — parent env is unchanged):

- `WIFO_TWIN_MODE` — `'record'` or `'replay'`
- `WIFO_TWIN_RECORDINGS_DIR` — absolute path; `mkdir -p`'d when mode is `'record'`

The runtime does **not** auto-wrap `globalThis.fetch`. User project test setup is responsible:

```ts
// e.g. examples/gh-stars/src/twin-setup.ts (loaded by bunfig.toml [test] preload, etc.)
import { wrapFetch } from '@wifo/factory-twin';

const mode = process.env.WIFO_TWIN_MODE;
const dir = process.env.WIFO_TWIN_RECORDINGS_DIR;
if (mode && dir) {
  globalThis.fetch = wrapFetch(globalThis.fetch, { mode: mode as 'record' | 'replay', recordingsDir: dir });
}
```

Both `implementPhase` and `validatePhase` see the same env (since validate's `bun test` subprocess inherits the parent's env), so recordings made during implement replay during validate.

## On-disk record types

| Type | Parents | Created by | Purpose |
|---|---|---|---|
| `factory-run` | `[]` | runtime, once at start | Run-level metadata (specId, graphPhases, maxIterations, startedAt) |
| `factory-phase` | `[runId, ...inputRecordIds]` | runtime, once per phase invocation | Phase-event log (phaseName, iteration, status, durationMs, outputRecordIds, failureDetail?) |
| `factory-validate-report` | `[runId]` | `validatePhase`, once per invocation | The full `HarnessReport` payload |
| `factory-implement-report` *(v0.0.2)* | `[runId]` | `implementPhase`, once per invocation that gets past the spawn | The agent's run record |

`factory-implement-report` payload shape:

```ts
{
  specId: string;
  specPath?: string;
  iteration: number;
  startedAt: string;            // ISO-8601 UTC
  durationMs: number;
  cwd: string;
  prompt: string;               // full prompt as sent (includes spec source)
  allowedTools: string;
  claudePath: string;
  status: 'pass' | 'fail' | 'error';
  exitCode: number | null;
  signal?: string;
  result: string;               // agent's final message text — ALWAYS populated when persisted
  filesChanged: { path: string; diff: string }[];   // git diff if .git exists; SHA-256 hash walk fallback otherwise
  toolsUsed: string[];          // best-effort
  tokens: {
    input: number;
    output: number;
    cacheCreate?: number;
    cacheRead?: number;
    total: number;
  };
  failureDetail?: string;       // populated on status='fail' or status='error'
}
```

The DAG is `factory-run → factory-implement-report`, `factory-run → factory-validate-report`, plus the parallel `factory-run → factory-phase` chain (one per phase invocation). The `factory-phase` records' `outputRecordIds` cross-reference the implement/validate reports so `factory-context tree <runId>` shows the full provenance.

`result` is always populated when the report is persisted (success and failure path alike) — separate from `failureDetail`. The "what did the agent say it did?" question always resolves to `result`; "what went wrong?" resolves to `failureDetail`.

## Iteration policy

A "convergence" pass is computed across each iteration's phases:

- If any phase status is `'error'` → run aborts with `RunReport.status = 'error'`.
- Else if any is `'fail'` → iterate while `iteration < maxIterations`, else `'no-converge'`.
- Else (all `'pass'`) → `'converged'`.

Convergence is **generic** across phase names — the runtime never inspects `phase.name` to decide.

**Default `maxIterations: 1`.** v0.0.2 still uses the human-triggered single-shot model; iteration auto-loop is v0.0.3. Without cross-iteration context plumbing, iteration 2 in v0.0.2 sees the same prompt as iteration 1 (the agent picks up from disk, not from the prior validate-report). v0.0.3 will plumb prior-iteration validate-reports into the next implementPhase prompt.

## Errors

```ts
type RuntimeErrorCode =
  | 'runtime/graph-empty'
  | 'runtime/graph-duplicate-phase'
  | 'runtime/graph-unknown-phase'
  | 'runtime/graph-cycle'
  | 'runtime/invalid-max-iterations'
  | 'runtime/io-error'
  // v0.0.2 additions:
  | 'runtime/cost-cap-exceeded'
  | 'runtime/agent-failed'
  | 'runtime/invalid-max-prompt-tokens';
```

Match with `instanceof` + `.code`:

```ts
import { RuntimeError } from '@wifo/factory-runtime';

try {
  await run({ spec, graph, contextStore });
} catch (err) {
  if (err instanceof RuntimeError && err.code === 'runtime/cost-cap-exceeded') {
    // The implement-report is on disk with status='error'; check failureDetail for tokens vs cap.
  }
  throw err;
}
```

`'runtime/agent-failed'` is intentionally coarse — covers spawn failure, exit-nonzero, output-invalid, timeout, killed-by-signal. The `failureDetail` carries a prefix (`agent-spawn-failed:`, `agent-exit-nonzero (code=N):`, `agent-output-invalid:`, `agent-timeout (after Nms):`, `agent-killed-by-signal SIG:`) that names the specific reason. Match the prefix on `.message` if you need granular dispatch.

`run()` throws `RuntimeError` synchronously for invalid `maxIterations`, and asynchronously (re-throws as `runtime/io-error`) when a `factory-run` or `factory-phase` write fails. Phase exceptions (including implementPhase's RuntimeErrors) are **not** re-thrown — they are captured as `factory-phase` records with `status: 'error'` and surfaced in `RunReport.status === 'error'`.

## Status

v0.0.2 — runtime + `validatePhase` + `implementPhase` (single-shot agent). The default CLI graph is `[implement → validate]`; `--no-implement` preserves the v0.0.1 `[validate]`-only behavior. v0.0.3 will add iteration auto-loop, cross-iteration record threading, and (maybe) holdout-aware convergence and `explorePhase`/`planPhase` separation.

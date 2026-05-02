# @wifo/factory-runtime

Phase-graph runtime for software-factory. Composes `@wifo/factory-core`, `@wifo/factory-harness`, `@wifo/factory-twin`, and `@wifo/factory-context` into an end-to-end pipeline that executes a graph of phases against a parsed spec, persists provenance to the context store, and iterates until convergence or the iteration budget is exhausted.

v0.0.1 shipped one built-in phase: `validatePhase`. v0.0.2 added `implementPhase` (single-shot agent). **v0.0.3 closes the loop**: `--max-iterations` defaults to **5**, iteration N+1's implement sees iteration N's validate-report (failed scenarios threaded into the prompt), the parent chain extends across iterations so `factory-context tree` walks the full ancestry, and a whole-run `--max-total-tokens` cap (default 500_000) bounds total cost. **v0.0.5** layers a stable behavior-prior prompt prefix into every implement spawn — same bytes every iteration, cache-friendly, +~1.1 KB / ~2.5% of the per-phase cap.

Requires Node 22+ and (for the default graph) the `claude` CLI on PATH, signed in via your Claude Pro/Max subscription.

## Recommended pre-run flow

Before spending agent tokens on the loop, run two cheap checks against the spec:

1. `pnpm exec factory spec lint docs/specs/<id>.md` — format check (free, deterministic).
2. `pnpm exec factory spec review docs/specs/<id>.md` — quality check via [`@wifo/factory-spec-review`](../spec-review/README.md). LLM-judged, cache-backed; catches vague DoD checks and weak holdouts that the runtime would otherwise spend a full iteration discovering.
3. `pnpm exec factory-runtime run docs/specs/<id>.md` — once both checks pass.

Lint then review then run is the recommended sequence — running the loop on a spec that wouldn't pass review is the most common way to burn the `--max-total-tokens` budget on a no-converge.

## v0.0.5.2 release notes

- **Configurable per-phase agent timeout.** New `RunOptions.maxAgentTimeoutMs?: number` (default 600_000) and CLI flag `--max-agent-timeout-ms <n>` raise the previously hardcoded 10-minute wall-clock cap on the `claude -p` subprocess. Wide-blast-radius specs (e.g. v0.0.5's `factory-publish-v0-0-5`, which touched 14 files and tripped the cap on iteration 2 with the agent making real progress) can now opt into a longer ceiling without rebuilding the runtime. The default stays tight as a guardrail against truly hung agents.
- **Resolution order in `implementPhase`**: explicit `opts.timeoutMs` > runtime-threaded `ctx.maxAgentTimeoutMs` > built-in 600_000. Programmatic callers that pin a per-phase override still get it; everyone else inherits the run-level value the runtime threads via `PhaseContext.maxAgentTimeoutMs`.
- **CLI validation mirrors `--max-prompt-tokens`.** Non-positive or non-numeric → exit 2 with stderr line `runtime/invalid-max-agent-timeout-ms: --max-agent-timeout-ms must be a positive integer (got '<raw>')`. The label is a string format only — **not** a `RuntimeErrorCode` value (zero new codes in v0.0.5.2; `RuntimeErrorCode` stays at 10 members from v0.0.3). The existing `runtime/agent-failed` code still covers timeout, with the `agent-timeout (after Nms)` message reporting the resolved value (so a 30000ms run reports `after 30000ms`, not `after 600000ms`).
- **Public API surface unchanged.** Two field-level additions to already-exported types (`RunOptions.maxAgentTimeoutMs?: number`, `PhaseContext.maxAgentTimeoutMs?: number`). Top-level exports from `src/index.ts` stay at **19 names**.

## v0.0.5 release notes

- **Implementation guidelines prompt prefix.** `implementPhase`'s `buildPrompt` now emits a stable `# Implementation guidelines` section between the opening prose and `# Spec`. Four behavior priors: state assumptions, minimum code, surgical changes, verifiable success criteria. Same constant, same bytes, every invocation — so `claude -p`'s ephemeral cache hits the same key on every iteration. See "Implementation guidelines section (v0.0.5)" below for the wording, placement, byte-stability invariant, and budget impact.
- **Public API surface unchanged.** Strict equality with v0.0.4's surface: 5 functions + 1 class + 13 types = **19 names**, zero new exports. `IMPLEMENTATION_GUIDELINES` is internal to `src/phases/implement.ts` and intentionally not re-exported from `src/index.ts`.

## Implementation guidelines section (v0.0.5)

Every `implementPhase` spawn now sees a `# Implementation guidelines` section emitted before `# Spec`. The section is a stable module-level constant (`IMPLEMENTATION_GUIDELINES` in `src/phases/implement.ts`) — byte-identical across iterations and across runs. Four bullets, one per behavior prior:

- **State your assumptions.** Surface ambiguity, name multiple interpretations, push back when warranted.
- **Minimum code that solves the problem.** No features beyond what was asked. No abstractions for single-use code. No gratuitous flexibility/configurability.
- **Surgical changes only.** Edit what the spec requires; leave adjacent code, comments, and formatting alone. Match existing style.
- **Define verifiable success criteria, then loop.** Map each change to a `test:` line, a `judge:` line, or a Constraint. Run the tests yourself before finishing.

**Placement.** Between the opening prose (`'You are an automated coding agent…'`) and `# Spec`. The v0.0.3 `# Prior validate report` section still lives in its v0.0.3 position (between `# Spec` and `# Working directory`); the prefix sits above all of those.

**Byte-stability invariant.** The constant is defined once and emitted unchanged. Tests pin `prompt1 === prompt2` across multiple `buildPrompt` invocations and verify the prefix's bytes are independent of `priorSection`. A stable prefix means `claude -p`'s prompt cache hits the same key every iteration; rewording the constant invalidates the cache for every cached run.

**Default-budget tightness.** `IMPLEMENTATION_GUIDELINES` is bounded at **≤ 2 KB** (~500 tokens, pinned by test). The locked text is ~1.1 KB. Against the default 100k per-phase cap that's ~2.5%; against the 500k whole-run cap (5 iters) it's ~0.5%. The deliberate +N tokens per spawn buys fewer iterations on average — net win expected, measured against the gh-stars-v2 production runs in v0.0.5+ release notes.

**Tradeoff.** Locked behavior priors are an opinion. Future point releases may layer per-spec-overridable priors, prefix variants by spec type (`feat` vs `refactor`), or iteration-count telemetry — all explicitly deferred from v0.0.5 so the locked prefix can soak first.

## v0.0.3 release notes

- **`--max-iterations` default flipped 1 → 5.** Existing v0.0.2 callers who omit the flag will see up to 5 iterations on real-claude runs. Pair with `--max-total-tokens` to bound cost.
- **Cross-iteration record threading.** Iteration N+1's `implementPhase` builds its prompt with a new `# Prior validate report` section listing only iteration N's failed scenarios (id + name + failureDetail). Iter 1 omits the section. The prior validate-report's id is on `factory-implement-report.payload.priorValidateReportId`, and on the record's `parents = [runId, priorValidateReportId]`. `factory-validate-report.parents = [runId, sameIterImplementReportId]`. `factory-context tree <validate-report-id>` walks the full chain back to runId.
- **Whole-run cost cap.** New `RunOptions.maxTotalTokens?: number` (default 500_000) sums `tokens.input + tokens.output` across every implement invocation in the run. Overrun aborts with `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })`. Per-phase `maxPromptTokens` from v0.0.2 still applies. New CLI flag `--max-total-tokens <n>`.
- **One new `RuntimeErrorCode`**: `'runtime/total-cost-cap-exceeded'` (10 codes total). The CLI's `--max-total-tokens 0` exits 2 with stderr label `runtime/invalid-max-total-tokens:` — a string format only, **not** a `RuntimeErrorCode` value (programmatic `RunOptions.maxTotalTokens` is unvalidated; non-positive values trip the cap on first implement).
- **`PhaseContext` gains `inputs: readonly ContextRecord[]`.** Populated by the runtime: same-iter predecessors for non-root phases; prior-iter terminal outputs for root phases on iter ≥ 2; empty for root iter 1. Phases consume by filtering on `record.type` (built-ins look for `factory-validate-report` / `factory-implement-report`). Custom user phases that don't read `ctx.inputs` are unaffected.
- **`ctx.inputs` ≠ `factory-phase.parents`.** They share the same-iter predecessors but `ctx.inputs` additionally includes prior-iter terminal outputs for root phases on iter ≥ 2; `factory-phase.parents` does NOT. This preserves v0.0.2's `--no-implement` record-set parity (every iter's `factory-phase` still has `parents = [runId]`).
- **Default-budget tightness.** 500_000 cap ÷ 5 iterations ≈ 100k/iter, matching the per-phase cap. Tasks with longer prompts will trip one or the other immediately — bump `--max-total-tokens` to ~1_000_000 if you expect long iterations.
- **Deferred to v0.0.4+**: `explorePhase`/`planPhase` separation, holdout-aware automated convergence, worktree sandbox, streaming cost monitoring, scheduler.

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

### v0.0.2 / v0.0.3: agent + validate

```ts
import { definePhaseGraph, implementPhase, validatePhase, run } from '@wifo/factory-runtime';

const cwd = process.cwd();
const graph = definePhaseGraph(
  [
    implementPhase({
      cwd,
      maxPromptTokens: 100_000, // per-phase cap
      // Default: 'record' mode at <cwd>/.factory/twin-recordings/
      // Set to 'off' to disable env-var plumbing entirely.
    }),
    validatePhase({ cwd, noJudge: true }),
  ],
  [['implement', 'validate']],
);

// v0.0.3: maxIterations defaults to 5; maxTotalTokens defaults to 500_000.
const report = await run({
  spec,
  graph,
  contextStore: store,
  options: {
    // maxIterations: 5,                // default
    // maxTotalTokens: 1_000_000,       // raise above default 500k for longer-prompt tasks
  },
});
// report.status: 'converged' | 'no-converge' | 'error'
// report.iterationCount: 1..maxIterations (the actual count taken)
```

### Custom phases reading `ctx.inputs` (v0.0.3)

Built-in phases consume `ctx.inputs` automatically. To write a custom phase that reads same-iteration predecessors and (for root phases) the prior iteration's terminal outputs:

```ts
import { definePhase } from '@wifo/factory-runtime';

const myPhase = definePhase('my-phase', async (ctx) => {
  const priorValidate = ctx.inputs.find((r) => r.type === 'factory-validate-report');
  if (priorValidate !== undefined) {
    // We're on iter ≥ 2 in an [..., validate, my-phase] graph or
    // [..., my-phase] root-cycle — react to prior failures here.
  }
  // ...
  return { status: 'pass', records: [] };
});
```

Note: `ctx.inputs` and `factory-phase.parents` are NOT the same list. `ctx.inputs` includes prior-iter terminal outputs for root phases on iter ≥ 2; `factory-phase.parents` does NOT. The split preserves v0.0.2 record-set parity in `--no-implement` mode.

## CLI

```
factory-runtime run <spec-path> [flags]

Flags:
  --max-iterations <n>             Max iterations (default: 5)
  --max-total-tokens <n>           Whole-run cap on summed agent tokens (default: 500000)
  --context-dir <path>              Context store directory (default: ./context)
  --scenario <ids>                  Comma-separated scenario ids (e.g. S-1,S-2,H-1)
  --no-judge                        Skip judge satisfactions in the harness
  --no-implement                    Drop the implement phase (v0.0.1 [validate]-only graph)
  --max-prompt-tokens <n>           Per-phase cap on agent input tokens (default: 100000)
  --claude-bin <path>               Path to the claude executable (default: 'claude' on PATH)
  --twin-mode <record|replay|off>   Twin recording mode (default: record)
  --twin-recordings-dir <path>      Twin recordings dir (default: <cwd>/.factory/twin-recordings)
```

Both `implementPhase` and `validatePhase` receive `cwd: process.cwd()` from the CLI so the agent's edits and the harness's `bun test` invocation resolve against the same tree.

Exit codes:
- `0` — converged (every phase passed)
- `1` — no-converge (a phase kept failing within the iteration budget)
- `2` — usage error (bad flags, missing positional, invalid `--max-iterations`, invalid `--max-prompt-tokens`, invalid `--max-total-tokens`, invalid `--twin-mode`)
- `3` — operational error (spec not found, parse error, IO error, agent failure, per-phase or whole-run cost-cap exceeded)

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
  runId: string;                    // id of the factory-run record
  iteration: number;                // 1-indexed
  inputs: readonly ContextRecord[]; // v0.0.3 — records the runtime threads in (see v0.0.3 release notes for population rules)
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

Subprocesses out to `claude -p --allowedTools "Read,Edit,Write,Bash" --output-format json` with the prompt on stdin (subscription auth — no `ANTHROPIC_API_KEY`). Captures the agent's output and disk delta into a `factory-implement-report` record (`parents: [ctx.runId]`).

> **Why no `--bare`?** The original v0.0.2 spec called for `--bare` for reproducibility, but in `claude` 2.1+ that flag strictly disables OAuth/keychain reads — making it incompatible with subscription auth. Since the user-facing goal is "no API key required, use your subscription," we drop `--bare`. The rest of the locked surface (headless `-p`, fixed `--allowedTools` allowlist, structured `--output-format json`) preserves the reproducibility intent.

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
| `factory-validate-report` *(v0.0.3 extends parents)* | `[runId, ...(sameIterImplementReportId ? [sameIterImplementReportId] : [])]` | `validatePhase`, once per invocation | The full `HarnessReport` payload |
| `factory-implement-report` *(v0.0.2; v0.0.3 extends parents)* | `[runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]` | `implementPhase`, once per invocation that gets past the spawn | The agent's run record |

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
  priorValidateReportId?: string; // v0.0.3 — id of the prior iter's validate-report when threaded
}
```

The DAG starts as `factory-run → factory-implement-report`, `factory-run → factory-validate-report`, plus the parallel `factory-run → factory-phase` chain. v0.0.3 extends with cross-iteration edges:

```
factory-run
  ├── factory-phase (impl, iter 1)  [parents: runId]
  ├── factory-phase (val,  iter 1)  [parents: runId, impl1]
  ├── factory-implement-report (iter 1)  [parents: runId]
  ├── factory-validate-report  (iter 1)  [parents: runId, impl1]
  ├── factory-phase (impl, iter 2)  [parents: runId]
  ├── factory-phase (val,  iter 2)  [parents: runId, impl2]
  ├── factory-implement-report (iter 2)  [parents: runId, val1]   ← cross-iter
  └── factory-validate-report  (iter 2)  [parents: runId, impl2]
```

`factory-context tree <iter2-validate-report-id>` walks back through the entire chain to runId.

`result` is always populated when the report is persisted (success and failure path alike) — separate from `failureDetail`. The "what did the agent say it did?" question always resolves to `result`; "what went wrong?" resolves to `failureDetail`.

## Iteration policy

A "convergence" pass is computed across each iteration's phases:

- If any phase status is `'error'` → run aborts with `RunReport.status = 'error'`.
- Else if any is `'fail'` → iterate while `iteration < maxIterations`, else `'no-converge'`.
- Else (all `'pass'`) → `'converged'`.

Convergence is **generic** across phase names — the runtime never inspects `phase.name` to decide.

**Default `maxIterations: 5`** (v0.0.3 — was 1 in v0.0.2). The runtime drives `[implement → validate]` until convergence or budget, threading the prior validate-report into the next implement's prompt + payload + parents. Iteration N+1's implement sees a `# Prior validate report` section listing only iteration N's failed scenarios.

**Default `maxTotalTokens: 500_000`** (v0.0.3). Sums `tokens.input + tokens.output` across every implement in the run. Overrun aborts with `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })`, mirroring the v0.0.2 per-phase cap chain (factory-phase persisted with status='error', implement-report on disk via parents=[runId]).

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
  | 'runtime/invalid-max-prompt-tokens'
  // v0.0.3 addition:
  | 'runtime/total-cost-cap-exceeded';
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

v0.0.3 — closed autonomous loop. Default `[implement → validate]`, default `--max-iterations 5`, default `--max-total-tokens 500_000`. Cross-iteration prompt threading + parent-chain extension are in. Deferred to v0.0.4+: `explorePhase` / `planPhase` separation, holdout-aware automated convergence, worktree sandbox, streaming cost monitoring, scheduler.

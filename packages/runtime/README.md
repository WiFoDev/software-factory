# @wifo/factory-runtime

> The execution engine. Phase-graph orchestrator that runs `[implement → validate → dod]` against a parsed spec, iterates until convergence, persists provenance.

`@wifo/factory-runtime` composes `@wifo/factory-core`, `@wifo/factory-harness`, `@wifo/factory-twin`, and `@wifo/factory-context` into an end-to-end pipeline. The default graph spawns Claude in headless mode (`claude -p`) to satisfy a spec's scenarios, then verifies the result via the harness (test/judge satisfactions) and the DoD-verifier (shell gates). Convergence requires all three phases pass. Subscription auth — no `ANTHROPIC_API_KEY` needed.

Pre-spec quality review (8 LLM judges) ships in [`@wifo/factory-spec-review`](../spec-review/README.md) and runs via `factory spec review` before `factory-runtime run` ever spawns. Together: `factory spec lint` + `factory spec review` + `factory-runtime run` form the canonical author → review → ship loop.

> **For AI agents:** start at **[`AGENTS.md`](../../AGENTS.md)** (top-level). This README is detailed reference.

## Install

```sh
pnpm add -D @wifo/factory-runtime
```

Bootstrapping a new project? Use [`@wifo/factory-core`](../core/README.md)'s `factory init` — it pins the runtime + the rest of the toolchain in one step.

Requires Node 22+ and (for the default graph) the `claude` CLI on PATH, signed in via Claude Pro/Max.

## When to reach for it

- **Ship a single spec.** `factory-runtime run <spec>` runs `[implement → validate → dod]` against one spec. Iterates up to 5× until convergence or budget exhaustion.
- **Ship a multi-spec product.** `factory-runtime run-sequence <dir>` walks `<dir>/*.md`, builds the depends-on DAG via Kahn's algorithm, runs each spec in topological order. Provenance threads under one `factory-sequence` root.
- **Verify hand-written code.** `factory-runtime run --no-implement` skips the agent and just runs validate + dod. Useful for "I implemented by hand; verify the work."
- **Programmatically orchestrate phases.** Compose your own `PhaseGraph` from the exported `definePhase` / `definePhaseGraph` + `implementPhase` / `validatePhase` / `dodPhase` builders. Call `run()` directly.

## What's inside

### CLI

```
factory-runtime run <spec-path> [flags]              # Ship one spec
factory-runtime run-sequence <specs-dir> [flags]     # Ship a multi-spec DAG
```

Flags shared by both subcommands:

| Flag | Default | Notes |
|---|---|---|
| `--max-iterations <n>` | 5 | Per-spec iteration budget. |
| `--max-total-tokens <n>` | 500_000 | Per-spec cap on summed agent tokens. |
| `--max-agent-timeout-ms <n>` | 600_000 | Per-phase agent subprocess wall-clock timeout. |
| `--max-prompt-tokens <n>` | 100_000 | Per-phase agent input cap. |
| `--context-dir <path>` | `./context` | Where context records persist. |
| `--no-judge` | off | Skip LLM-judged satisfactions in `validatePhase`. |
| `--no-implement` | off | Drop `implementPhase` from the graph. |
| `--skip-dod-phase` | off | Drop `dodPhase` from the graph (v0.0.10+). |
| `--check-holdouts` | off | Run `## Holdout Scenarios` each iteration; both visible AND holdouts must pass to converge (v0.0.11+). |
| `--worktree` | off | Run inside an isolated git worktree at `.factory/worktrees/<runId>/` (v0.0.11+). |
| `--claude-bin <path>` | `claude` on PATH | Agent binary override (test injection). |
| `--twin-mode <record\|replay\|off>` | `record` | Twin recording mode. |
| `--twin-recordings-dir <path>` | `<cwd>/.factory/twin-recordings` | Twin recordings location. |

`run`-only flag:

| Flag | Default | Notes |
|---|---|---|
| `--scenario <ids>` | all | Comma-separated scenario filter. |

`run-sequence`-only flags:

| Flag | Default | Notes |
|---|---|---|
| `--max-sequence-tokens <n>` | unbounded | Whole-sequence cost cap. Pre-run check before each spec. |
| `--continue-on-fail` | off | Skip transitive dependents only after a failure. |
| `--include-drafting` | off | Walk specs regardless of `frontmatter.status`. Default skips `drafting`. |

CLI flag > `factory.config.json runtime.*` > built-in default.

### Default graph (v0.0.10+)

```
[implement → validate → dod]
```

Convergence requires every phase `pass`. With `--no-implement`, graph becomes `[validate, dod]`. With `--skip-dod-phase`, `[implement, validate]`. Both flags → `[validate]` (back-compat with v0.0.1).

| Phase | Runs | Persists | Failure modes |
|---|---|---|---|
| `implement` | `claude -p` headless agent on the spec body | `factory-implement-report` (full transcript + filesChanged + tokens) | `'fail'` (agent self-reports), `'error'` (timeout / token cap / agent crash). |
| `validate` | `bun test` per `test:` line + LLM judge per `judge:` line | `factory-validate-report` (per-scenario pass/fail) | `'fail'` (any scenario fails), `'error'` (harness crash). |
| `dod` (v0.0.10+) | Bash per shell DoD bullet (locked allowlist) + LLM judge per non-shell bullet | `factory-dod-report` (per-bullet pass/fail) | `'fail'` (any bullet fails), `'error'` (per-bullet timeout). v0.0.12+ — gate-shaped prose without a backtick command (e.g. bare `- typecheck + tests green`) is reported `status: 'skipped'` with `reason: 'dod-gate-no-command-found'` rather than dispatched to a judge or guessed at; pair with `spec/dod-needs-explicit-command` lint to flag at scoping time. |

### Cross-iteration prompt threading

When iteration N fails, iteration N+1's `implementPhase` prompt grows up to three byte-stable sections (cache-friendly):

- `# Prior validate report` (v0.0.3+) — failed scenarios from iter N's validate.
- `# Prior DoD report` (v0.0.10+) — failed shell bullets from iter N's dod with exit codes + stderr-tails.
- `# Prior holdout fail` (v0.0.11+) — IDs only of failed holdouts from iter N's validate (when `--check-holdouts` is set). Criterion text is intentionally never surfaced to the agent — preserves the v0.0.4 overfit guard. Capped at 1 KB per line, 10 KB total.

The validate / DoD sections are capped at 1 KB per line, 50 KB total.

### Holdout-aware convergence (v0.0.11+)

Pass `--check-holdouts` (or set `runtime.checkHoldouts: true` in `factory.config.json`) to validate `## Holdout Scenarios` at the end of EACH iteration. Convergence requires both visible scenarios AND holdouts to pass. The persisted `factory-validate-report.payload` carries a separate `holdouts: ScenarioResult[]` array (alongside `scenarios`); entries are tagged with `scenarioKind: 'holdout'`.

**IDs-only invariant.** When iteration N's holdouts fail, iteration N+1's prompt gains a `# Prior holdout fail` section listing **only the failed holdout IDs** — never the criterion, the given/when/then, or the satisfaction text. The agent sees that holdouts failed; it doesn't see what they checked. Closes the visible-only-overfit gap left by v0.0.10's DoD verifier.

```json
// factory.config.json — opt in for the whole repo
{ "runtime": { "checkHoldouts": true } }
```

Default `false`: only visible scenarios run (v0.0.10 behavior preserved).

### Worktree sandbox (v0.0.11+)

Pass `--worktree` to materialize an isolated `git worktree` for the run. Default location: `<projectRoot>/.factory/worktrees/<runId>/`; default branch: `factory-run/<runId>`. The implement / validate / DoD phases all execute against that checkout — so the agent's edits, the harness's `bun test` invocation, and the DoD shell bullets resolve against the worktree's tree. The maintainer's main tree is never touched.

```sh
factory-runtime run --worktree docs/specs/foo.md --context-dir ./context
factory-runtime worktree list --context-dir ./context
factory-runtime worktree clean --context-dir ./context           # removes converged worktrees
factory-runtime worktree clean --all --context-dir ./context     # also removes failed worktrees (destructive)
```

The runtime persists a new `factory-worktree` context record (parents=[runId]) capturing `runId / worktreePath / branch / baseSha / baseRef / createdAt / status`. `factory-context tree --direction down <runId>` walks it as a sibling of `factory-phase`.

Programmatic shorthand on already-exported types:

```ts
import { run } from '@wifo/factory-runtime';

await run({
  spec, graph, contextStore,
  options: { worktree: true },                                 // default root + branch
  // options: { worktree: { rootDir: '/tmp/wt' } },            // override location
});
```

Failure modes throw `RuntimeError({ code: 'runtime/worktree-failed' })`: not a git repo, `git` missing on PATH, conflicting `git worktree add` (disk full / permission denied / index corruption). Atomic on failure — no orphan branch / record persists. Default `false`: phases run from `process.cwd()` (v0.0.10 behavior preserved).

### Public API (26 exports as of v0.0.11)

```ts
// Per-spec runtime
import { run } from '@wifo/factory-runtime';
import type { RunArgs, RunOptions, RunReport, RunStatus } from '@wifo/factory-runtime';

// Sequence runtime (v0.0.7+)
import { runSequence } from '@wifo/factory-runtime';
import type { SequenceReport } from '@wifo/factory-runtime';

// Graph composition
import { definePhase, definePhaseGraph } from '@wifo/factory-runtime';
import type { Phase, PhaseGraph, PhaseContext, PhaseResult, PhaseStatus,
              PhaseInvocationResult, PhaseIterationResult } from '@wifo/factory-runtime';

// Built-in phases
import { implementPhase, validatePhase, dodPhase } from '@wifo/factory-runtime';
import type { ImplementPhaseOptions, ValidatePhaseOptions, DodPhaseOptions }
  from '@wifo/factory-runtime';

// Errors
import { RuntimeError } from '@wifo/factory-runtime';
import type { RuntimeErrorCode } from '@wifo/factory-runtime';

// Worktree sandbox (v0.0.11+)
import { createWorktree } from '@wifo/factory-runtime';
import type { WorktreeOptions, CreatedWorktree } from '@wifo/factory-runtime';
```

`RuntimeErrorCode` (15 values): `runtime/{graph-empty, graph-duplicate-phase, graph-unknown-phase, graph-cycle, invalid-max-iterations, io-error, cost-cap-exceeded, agent-failed, invalid-max-prompt-tokens, total-cost-cap-exceeded, sequence-cycle, sequence-dep-not-found, sequence-cost-cap-exceeded, sequence-empty, worktree-failed}`.

### Concepts

**Iteration loop.** `[implement → validate → dod]` runs in sequence; phase outputs feed the next phase's `ctx.inputs`. Iteration converges when every phase returns `'pass'`. Iteration retries when any phase returns `'fail'` (the agent's next iter sees the failure detail in its prompt). Iteration aborts when any phase returns `'error'` (no retry).

**Cost caps.** Three layers, each with its own escape hatch: per-phase (`--max-prompt-tokens`), per-spec (`--max-total-tokens`), per-sequence (`--max-sequence-tokens`). Per-spec cap is post-hoc (sum after each implement returns); sequence cap is pre-run (compares cumulative + nextSpec.maxTotalTokens before invoking).

**Status-aware sequence (v0.0.9+).** `run-sequence` walks specs in topological order. With `--include-drafting`, every spec runs from start regardless of `frontmatter.status` (cluster-atomic shipping). Without it, behavior depends on the runtime version — see the next section for v0.0.11+ semantics.

**Dynamic DAG walk (v0.0.11+).** The default `run-sequence` walks the DAG dynamically: drafting specs are no longer skipped indefinitely. After each spec converges, the runtime promotes any direct dependent whose deps are NOW all converged (in-memory `drafting → ready`) and continues the walk. A 4-spec linear chain (1 ready + 3 drafting) ships in ONE invocation — no manual `drafting → ready` flips needed. Each promotion logs `factory-runtime: <converged-id> converged → promoting <dependent-id>` to stdout. Failed specs do NOT promote their dependents — drafting specs whose deps fail stay drafting and are absent from the report. The promotion is in-memory only; `<dir>/<spec>.md`'s `status:` field is NOT edited on disk. Pass `--include-drafting` (or set `runtime.includeDrafting: true` in `factory.config.json`) to preserve the v0.0.10 walk-everything-from-start semantic.

**Already-converged dedup (v0.0.10+).** `runSequence` queries the context store for existing converged `factory-run` records scoped to the current `specsDir`. Match → skip + log. Closes the v0.0.9 BASELINE's N² re-run pattern.

**Dedup-correctness (v0.0.12+).** The dedup walks each candidate `factory-run`'s descendant `factory-phase` records, groups by iteration, and verifies every iteration's terminal phase has `status: 'pass'` before adding to the skip-map. A prior NO-CONVERGE run is therefore RE-RUN (not silently skipped) and the runtime emits `factory-runtime: <id> prior factory-run found but status=no-converge — re-running` to stdout. Closes the v0.0.11 ship bug where retries against the same context dir silently skipped real failures.

**Implement-report telemetry (v0.0.12+).** Two diagnostic side-channels added on `factory-implement-report.payload` (both optional — older records remain valid): `filesChangedDebug: { preSnapshot, postSnapshot }` exposes the raw sorted relative-path lists that fed the v0.0.6 `filesChanged` comparison, so under-attribution bugs reproduce trivially from the persisted record. On `agent-exit-nonzero` the runtime now persists a `status='error'` report whose `failureDetail: { message, stderrTail }` carries the agent's last 10 KB of stderr (byte-truncated with a `… [truncated, original size N bytes]` marker when oversize). Status classification of the run is unchanged — telemetry only.

**Per-spec timeout override (v0.0.9+).** Each spec's frontmatter may declare `agent-timeout-ms: <N>` to raise (or lower) the per-phase agent wall-clock budget for itself. Precedence: `RunOptions.maxAgentTimeoutMs > spec.frontmatter['agent-timeout-ms'] > 600_000`.

**Post-convergence ship hint (v0.0.12+).** When a spec converges, the runtime emits `factory-runtime: <spec-id> converged → ship via 'factory finish-task <spec-id>'` to **stdout** (NOT stderr — script-friendly so a `factory-runtime run | grep` pipeline picks it up). The hint surfaces the canonical next step (move the spec to `done/` + emit a `factory-spec-shipped` provenance record) without imposing it — `factory finish-task` is an explicit user action with the same risk surface as `git push`. The hint is NOT gated on `--quiet`; convergence is a lifecycle event, not progress noise. Programmatic callers can intercept via `RunOptions.stdoutLog`.

**`--quiet` and auto-quiet (v0.0.13+).** Per-iteration progress lines (`[runtime] iter <N> <phase> ...` plus the cause-of-iteration line at iter N+1 start) emit to **stderr** by default. Pass `--quiet` to suppress them, `--no-quiet` (or its alias `--progress`) to force-emit them. With no flag, the runtime auto-detects: when `process.stderr.isTTY === false` (script-piped, redirected via `tee`/`2>&1`, captured by a CI job log) `--quiet` is implied so progress noise doesn't pollute the captured log. On a real terminal (TTY stderr) progress lines emit, preserving the v0.0.12 default. Precedence chain (top wins): `--quiet` / `--no-quiet` / `--progress` CLI flag > `factory.config.json` `runtime.quiet` (`true` | `false` | omitted) > auto-detect (`stderr.isTTY === false` ⇒ quiet) > built-in default `false`. `runtime.quiet: false` is meaningful — it overrides auto-detect and keeps progress on for non-TTY runs (e.g., a CI log that DOES want step-by-step). If both `--quiet` and `--no-quiet` appear in argv, the later occurrence wins.

## Worked example

```sh
# Ship a single spec from the canonical workflow
pnpm exec factory-runtime run docs/specs/my-feature.md \
  --no-judge --max-iterations 5 --max-total-tokens 1000000 \
  --context-dir ./.factory
# → factory-runtime: converged in 1 iteration(s) (run=<id>, 87532ms)

# Ship a multi-spec product
pnpm exec factory-runtime run-sequence docs/specs/ \
  --no-judge --max-iterations 5 --max-total-tokens 1000000 \
  --context-dir ./.factory
# → factory-runtime: sequence converged (4/4 specs, factorySequenceId=<id>, 386123ms)

# Inspect the entire product's DAG
pnpm exec factory-context tree <factorySequenceId> \
  --context-dir ./.factory --direction down
```

Programmatic:

```ts
import { run, runSequence, validatePhase, dodPhase, implementPhase,
         definePhaseGraph } from '@wifo/factory-runtime';
import { parseSpec } from '@wifo/factory-core';
import { createContextStore } from '@wifo/factory-context';

const spec = parseSpec(await Bun.file('docs/specs/foo.md').text());
const graph = definePhaseGraph(
  [implementPhase({ cwd: process.cwd() }),
   validatePhase({ cwd: process.cwd() }),
   dodPhase({ cwd: process.cwd() })],
  [['implement', 'validate'], ['validate', 'dod']],
);
const store = createContextStore({ dir: './.factory' });
const report = await run({ spec, graph, contextStore: store,
  options: { maxIterations: 5, maxTotalTokens: 1_000_000 } });
console.log(report.status, report.iterationCount, report.totalTokens);
```

## See also

- **[`AGENTS.md`](../../AGENTS.md)** — single doc for AI agents using the toolchain.
- **[`packages/core/README.md`](../core/README.md)** — spec format, lint, scaffold.
- **[`packages/context/README.md`](../context/README.md)** — provenance walks and record types.
- **[`packages/harness/README.md`](../harness/README.md)** — `validatePhase`'s scenario runner.
- **[`packages/twin/README.md`](../twin/README.md)** — HTTP record/replay (used by `implementPhase`).
- **[`CHANGELOG.md`](../../CHANGELOG.md)** — every release's deltas.

## Status

Pre-alpha. APIs may break in point releases until v0.1.0.

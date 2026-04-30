# Roadmap

This file is the **direction**. `BACKLOG.md` is the candidate pile. The roadmap commits to what ships when, in what order, and what "done" means for each release. The end state is a closed autonomous loop where a spec drives an agent to convergence with full provenance, paid for by a Claude Pro/Max subscription rather than per-token API billing.

---

## Where we are: v0.0.2 — shipped

The agent does the implementation work autonomously within a single iteration. Human still triggers each iteration, but no longer writes code by hand. Default CLI graph is `[implement → validate]`; `--no-implement` preserves the v0.0.1 `[validate]`-only behavior.

What's in your hands today:

- **`@wifo/factory-core`** — spec format, parser, lint CLI *(v0.0.1)*
- **`@wifo/factory-harness`** — scenario runner (`bun test` for `test:` lines, Anthropic tool-use for `judge:` lines) *(v0.0.1)*
- **`@wifo/factory-twin`** — HTTP record/replay; in v0.0.2 the runtime plumbs `WIFO_TWIN_MODE` + `WIFO_TWIN_RECORDINGS_DIR` env vars to the spawned agent subprocess so user code can opt in via `wrapFetch` *(v0.0.1, wired in v0.0.2)*
- **`@wifo/factory-context`** — filesystem-first content-addressable record store with DAG provenance *(v0.0.1)*
- **`@wifo/factory-runtime`** — phase-graph orchestrator with `validatePhase` *(v0.0.1)* and `implementPhase` *(v0.0.2)*
- **Spec workflow** — `/scope-task`, `/finish-task`, `docs/specs/<id>.md` + `docs/technical-plans/<id>.md` convention
- **Worked examples** — `examples/slugify` (v0.0.1 manual loop) and `examples/gh-stars` (v0.0.2 agent-driven loop)

### What v0.0.2 added

| # | Piece | Notes |
|---|---|---|
| 1 | **`claude` CLI subprocess wrapper** | Spawned with `claude -p --allowedTools "Read,Edit,Write,Bash" --output-format json` on stdin. Subscription auth (no `ANTHROPIC_API_KEY`). |
| 2 | **`implementPhase(opts?)`** in `packages/runtime/src/phases/implement.ts` | Reads spec + cwd state; prompts the agent; persists `factory-implement-report` records (parents=[runId]) with prompt, files changed, tools used, token counts, claude exit status, agent's final `result` text. |
| 3 | **`@wifo/factory-twin` re-added** to `packages/runtime/package.json` | Runtime sets twin env vars on the agent subprocess; user code in tests calls `wrapFetch` against them. |
| 4 | **Tool allowlist** — Read, Edit, Write, Bash | Default-deny for everything else. Pre-approved via `--allowedTools` so no interactive prompts. |
| 5 | **Per-phase cost cap** | Default `--max-prompt-tokens 100000`. Post-hoc check on the agent's reported `usage.input_tokens`. Overrun: persist the implement-report with `status: 'error'` *first*, then throw `RuntimeError({ code: 'runtime/cost-cap-exceeded' })` so the wasted run is auditable. |
| 6 | **Default CLI graph: `[implement → validate]`** | `--no-implement` flag preserves the v0.0.1 single-phase behavior. Both phases pinned to `cwd: process.cwd()`. |
| 7 | **`examples/gh-stars` walkthrough** | Stargazers helper with caching + rate-limit handling. Exercises judge-friendly error message UX, multi-scenario specs, real claude end-to-end. Verified: converges in ~70s on a fresh run. |

### Post-ship reconciliations (worth knowing about)

The original v0.0.2 lock had two places where reality bit back. Both are recorded here, in the spec/plan, and in the runtime README:

- **`--bare` was dropped.** The locked spawn args included `--bare` for reproducibility, but in `claude` 2.1+ that flag strictly disables OAuth/keychain reads — incompatible with the locked subscription-auth model. Subscription auth wins (it's the headline goal). The rest of the locked surface (`-p`, `--allowedTools`, `--output-format json`) carries the reproducibility intent.
- **`RuntimeErrorCode` gained three new members, not two.** The plan committed to two (`'runtime/cost-cap-exceeded'`, `'runtime/agent-failed'`); implementation added a third (`'runtime/invalid-max-prompt-tokens'`) for symmetric programmatic + CLI validation of `implementPhase({ maxPromptTokens })`, mirroring v0.0.1's `'runtime/invalid-max-iterations'` exactly. Public name count stays at 19; the union's membership is what grew.

---

## v0.0.3 — closed autonomous loop

**Goal:** the runtime drives `implement → validate` repeatedly until convergence or budget, no human in the loop. Spec goes in, green report comes out.

### What lands

| # | Piece | Notes |
|---|---|---|
| 1 | **Iteration auto-loop** | `factory-runtime run` defaults `--max-iterations 5`. On validate-fail, automatically run another implement → validate. |
| 2 | **Cross-iteration record threading** — the v0.0.1 wart | Iteration N+1's `implementPhase` sees iteration N's `factory-validate-report` as input. Lets the agent see what failed and react. The `PhaseContext.iteration` field already exists for this. |
| 3 | **Cost guardrails enforced across the run** | Whole-run token budget (default 500k), per-phase cap unchanged, hard stop on overrun. Persisted on `factory-run`. |
| 4 | **Holdout-aware convergence** *(maybe)* | If holdouts are present, validate runs them at the end of every iteration; convergence requires both visible AND holdout scenarios to pass. Optional flag `--check-holdouts`. |
| 5 | **`explorePhase` + `planPhase`** *(maybe — see "Scope discipline")* | Separate "understand the codebase" and "plan the change" steps so implement gets focused context. Defer if v0.0.3 stays under budget without them. |
| 6 | **Demo: same `gh-stars` task converging unattended** | The agent fails once on rate-limit handling, reads the validate report, fixes it, converges. Provenance trail tells the story. |

### Definition of done

- `factory-runtime run docs/specs/gh-stars-v1.md` (no `--max-iterations` override) runs end-to-end without human intervention and converges, on a task that's known-difficult enough to need 2-3 iterations.
- Cost stays under the configured cap; overruns terminate cleanly with `RunReport.status: 'error'` and a typed `runtime/cost-cap-exceeded`.
- Holdouts pass (not just visible scenarios) — if any are declared.
- `factory-context tree <runId>` shows the full multi-iteration ancestry: run → implement (iter 1) → validate (iter 1) → implement (iter 2) → validate (iter 2) → ...
- README v0.0.3 walkthrough demonstrates the unattended loop on the gh-stars demo.

### Scope discipline

`explorePhase`/`planPhase` are tempting but risk turning v0.0.3 into "build the multi-phase pipeline" instead of "close the loop." Rule of thumb: ship v0.0.3 with `[implement → validate]` only; add explore/plan when a real run shows implement is too low-context to converge. Defer scope creep until evidence demands it.

---

## v0.0.4+ — future

The post-autonomous-loop work. Roughly ordered by leverage; not committed.

| Theme | Lead candidate from BACKLOG.md |
|---|---|
| **Scheduler (Layer 5)** — autonomous task queue | Pull `status: ready` specs and run them overnight |
| **Spec-review judges** — the spec-time semantic checks | Catches "matches §2" ambiguities, judge-parity asymmetry, etc. before implementation starts |
| **Domain packs** — schema + judges + twins per domain | `@wifo/factory-pack-web`, `-pack-api`; OLH-specific pack stays private |
| **Descendants traversal in `factory-context`** | The "what came out of this run?" UX gap |
| **Multi-agent coordination** | Beyond a single agent per phase — out of scope until single-agent is solid |

---

## Cadence guesses (not commitments)

- **v0.0.2** — shipped. ~13 commits across 1 feature branch; ~1900 LOC including tests + scaffold.
- **v0.0.3** — 1-2 weeks once we trigger it. Mostly orchestration: auto-loop, cross-iter threading, cost cap. Smaller code surface than v0.0.2.

The throughput trick that worked: scoped slices, `/scope-task` per package, reviewed before implementation. v0.0.3 should follow the same pattern.

---

## Anti-goals (what's NOT on this roadmap)

Stating these explicitly so we don't drift:

- **Multi-LLM support.** Anthropic-only via `claude` CLI is fine for the foreseeable future.
- **Web UI.** CLI + filesystem records are the surface. A dashboard is a separate product.
- **Generic CI integration.** Until v0.0.3 lands, "CI invoking factory-runtime" is premature.
- **Streaming/live progress UI.** Records get written; tail the directory if you want progress. A streaming protocol is over-engineering for v0.0.2/v0.0.3.

---

## What this roadmap commits us to

The end state is **a software factory you can hand a spec and walk away from**. v0.0.2 is the first step where the agent does work; v0.0.3 is the first version where the agent does *all* the work between human-meaningful checkpoints. Anything past v0.0.3 is leverage, not unlock.

If we drift, this file is the anchor. Update it deliberately, not silently.

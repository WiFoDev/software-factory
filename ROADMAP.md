# Roadmap

This file is the **direction**. `BACKLOG.md` is the candidate pile. The roadmap commits to what ships when, in what order, and what "done" means for each release. The end state is a closed autonomous loop where a spec drives an agent to convergence with full provenance, paid for by a Claude Pro/Max subscription rather than per-token API billing.

---

## Where we are: v0.0.1 — shipped

Five primitives + a worked example. Five public packages, ~275 tests, lint clean. The loop runs end-to-end with one missing piece: **the implementation phase is human-driven**. Spec → human writes code → factory-runtime validates → human reviews report → human iterates.

What's already in your hands today:

- **`@wifo/factory-core`** — spec format, parser, lint CLI
- **`@wifo/factory-harness`** — scenario runner (`bun test` for `test:` lines, Anthropic tool-use for `judge:` lines)
- **`@wifo/factory-twin`** — HTTP record/replay (standalone; not yet wired into the runtime loop)
- **`@wifo/factory-context`** — filesystem-first content-addressable record store with DAG provenance
- **`@wifo/factory-runtime`** — phase-graph orchestrator, ships `validatePhase` built-in
- **Spec workflow** — `/scope-task`, `/finish-task`, `docs/specs/<id>.md` + `docs/technical-plans/<id>.md` convention
- **Worked example** — `examples/slugify` demonstrating the full loop on a real (small) helper

Manual loop wall time on the slugify demo: ~100ms per `factory-runtime run` invocation.

---

## v0.0.2 — agent-driven `implementPhase` (single-shot)

**Goal:** the agent does the implementation work autonomously within a single iteration. Human still triggers each iteration, but no longer writes code by hand.

**Why this stepping stone:** flushes the agent integration, sandboxing, cost capture, and tool-allowlist design with a tight feedback loop. If iteration N is wrong, you re-run manually — you're not chasing autonomous convergence bugs at the same time as agent integration bugs.

### What lands

| # | Piece | Notes |
|---|---|---|
| 1 | **`claude` CLI subprocess wrapper** — invoked with `claude -p <prompt> --allowedTools <list> --bare --output-format json` | Subscription-paid (no `ANTHROPIC_API_KEY` needed). Headless. Captures structured JSON output. |
| 2 | **`implementPhase(opts?)`** in `packages/runtime/src/phases/implement.ts` | Reads the spec + current code state; prompts the agent; persists what it did to context as `factory-implement-report` records. |
| 3 | **Re-add `@wifo/factory-twin` dep** to `packages/runtime/package.json` | Agent's HTTP calls go through the twin — record on iteration 1, replay forever after. |
| 4 | **Tool allowlist + sandbox** — Read, Edit, Write, Bash (constrained to test commands) | Pre-approved via `--allowedTools` so no interactive prompts. Default-deny for everything else. |
| 5 | **Token / cost capture** — read from `claude -p` JSON output, persist on the `factory-implement-report` record | Subscription quota is opaque, but token counts are reported per call. |
| 6 | **Updated default CLI graph** — `factory-runtime run` now builds `[implement → validate]` instead of `[validate]` | `--no-implement` flag for the old behavior. |
| 7 | **Demo: `examples/gh-stars`** — small CLI that wraps GitHub's stargazers endpoint with caching + rate-limit handling | Exercises HTTP twin, judge lines (error message UX), and multi-scenario specs. |

### Definition of done

- `factory-runtime run docs/specs/gh-stars-v1.md --max-iterations 1` invokes the agent, the agent writes `src/gh-stars.ts` + tests, validate either passes (good agent run) or fails with a typed report (still useful).
- `claude` CLI on PATH is documented as a prerequisite (similar to `bun`).
- Subscription quota is used by default; no API key required for the happy path.
- Twin records the GitHub API call on iteration 1; iteration 2 (manual re-trigger) replays without hitting the network.
- A `factory-implement-report` record per phase invocation, with `parents: [runId]`, payload includes: prompt sent, files changed (paths + diffs), tools invoked, token counts, exit status.
- README updated with v0.0.2 worked example walkthrough.
- Public API for `@wifo/factory-runtime` extends to include `implementPhase` + `ImplementPhaseOptions`. Strict equality with technical plan §2 maintained.

### Strategic decisions to lock before scoping v0.0.2

| Decision | Lean | Why |
|---|---|---|
| Subprocess vs in-process | **Subprocess to `claude -p`** | Subscription billing, headless mode, sandboxing is cheaper, mirrors the harness's `bun test` pattern |
| Tool allowlist | **Read, Edit, Write, Bash** | Minimum needed for "agent writes code + runs tests"; everything else default-deny |
| Sandboxing | **Run in spec's project root cwd; no git worktree in v0.0.2** | Worktrees add complexity; `--bare` flag + tool allowlist + git-as-undo is sufficient for first cut |
| Cost cap | **Per-phase max prompt tokens (default 100k); halt with `RuntimeError('runtime/cost-cap-exceeded')` on overrun** | Hard stop is honest; degrade-to-stop is a v0.0.3 polish |
| Demo task | **`gh-stars` CLI** | HTTP-bound (twin), quality dimensions (judge), iteration-worthy (cache invalidation, retry, error mapping); self-contained |

---

## v0.0.3 — closed autonomous loop

**Goal:** the runtime drives `implement → validate` repeatedly until convergence or budget, no human in the loop. Spec goes in, green report comes out.

### What lands

| # | Piece | Notes |
|---|---|---|
| 1 | **Iteration auto-loop** | `factory-runtime run` defaults `--max-iterations 5` (back to the runtime spec's original default once iteration is meaningful). On validate-fail, automatically run another implement → validate. |
| 2 | **Cross-iteration record threading** — the v0.0.1 wart | iteration N+1's `implementPhase` sees iteration N's `factory-validate-report` as input. Lets the agent see what failed and react. |
| 3 | **Cost guardrails enforced across the run** | Whole-run token budget (default 500k), per-phase cap, hard stop on overrun. Persisted on the `factory-run` record so post-mortem is possible. |
| 4 | **Holdout-aware convergence** *(maybe)* | If holdouts are present, validate runs them at the end of every iteration; convergence requires both visible AND holdout scenarios to pass. Optional flag `--check-holdouts`. |
| 5 | **`explorePhase` + `planPhase`** *(maybe — see "Scope discipline" below)* | Separate "understand the codebase" and "plan the change" steps so implement gets focused context. Defer if v0.0.3 stays under budget without them. |
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

Honest scoping based on layer-1-through-4 throughput:

- **v0.0.2** — 2-3 weeks of focused work. Subprocess wrapper + implementPhase + twin wiring + gh-stars demo + tests.
- **v0.0.3** — 1-2 weeks once v0.0.2 is solid. Mostly orchestration: auto-loop, cross-iter threading, cost cap. Smaller code surface than v0.0.2.

The throughput trick that worked for v0.0.1: scoped slices, /scope-task per package, reviewed before implementation. v0.0.2 should follow the same pattern — `/scope-task` the implementPhase, get sign-off, implement, ship.

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

# Roadmap

This file is the **direction**. `BACKLOG.md` is the candidate pile. The roadmap commits to what ships when, in what order, and what "done" means for each release. The end state is a closed autonomous loop where a spec drives an agent to convergence with full provenance, paid for by a Claude Pro/Max subscription rather than per-token API billing.

---

## Where we are: v0.0.3 — shipped

**The loop is closed.** `factory-runtime run <spec>` drives `[implement → validate]` repeatedly until convergence or budget, with no human between iterations. Default `--max-iterations 5`; iteration N+1's `implementPhase` sees iteration N's failed scenarios threaded into its prompt; the parent chain extends across iterations so `factory-context tree` walks the full ancestry from any leaf back to the run; a whole-run `--max-total-tokens 500_000` cap bounds total cost on top of the v0.0.2 per-phase cap.

What's in your hands today:

- **`@wifo/factory-core`** — spec format, parser, lint CLI *(v0.0.1)*
- **`@wifo/factory-harness`** — scenario runner (`bun test` for `test:` lines, Anthropic tool-use for `judge:` lines) *(v0.0.1)*
- **`@wifo/factory-twin`** — HTTP record/replay; the runtime plumbs `WIFO_TWIN_MODE` + `WIFO_TWIN_RECORDINGS_DIR` env vars to the spawned agent subprocess so user code can opt in via `wrapFetch` *(v0.0.1, wired in v0.0.2)*
- **`@wifo/factory-context`** — filesystem-first content-addressable record store with DAG provenance *(v0.0.1)*
- **`@wifo/factory-runtime`** — phase-graph orchestrator with `validatePhase` *(v0.0.1)*, `implementPhase` *(v0.0.2)*, and the closed iteration loop *(v0.0.3)*
- **Spec workflow** — `/scope-task`, `/finish-task`, `docs/specs/<id>.md` + `docs/technical-plans/<id>.md` convention
- **Worked examples** — `examples/slugify` (v0.0.1 manual loop), `examples/gh-stars/docs/specs/gh-stars-v1.md` (v0.0.2 single-shot), `examples/gh-stars/docs/specs/gh-stars-v2.md` (v0.0.3 unattended loop — pagination + ETag + retry-with-backoff)

### What v0.0.3 added

| # | Piece | Notes |
|---|---|---|
| 1 | **`--max-iterations` default flipped 1 → 5** | Same flag; `DEFAULT_MAX_ITERATIONS` constant updated; persisted on `factory-run.payload.maxIterations`. |
| 2 | **Cross-iteration record threading** | Iteration N+1's `implementPhase` prompt gains a `# Prior validate report` section listing only iter N's failed scenarios as `**<id> — <name>**: <failureDetail>`. Per-line cap 1 KB; section-total cap 50 KB with a single `[runtime] truncated prior-validate section` warning via `ctx.log`. |
| 3 | **Parent chain extends across iterations** | `factory-implement-report.parents = [runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`; `factory-validate-report.parents = [runId, ...(sameIterImplementReportId ? [sameIterImplementReportId] : [])]`. `factory-context tree` walks the full chain back to runId from any leaf. |
| 4 | **`PhaseContext.inputs: readonly ContextRecord[]`** | Same-iter predecessor outputs for non-root phases; prior-iter terminal outputs for root phases on iter ≥ 2; empty for root iter 1. Built-ins consume by filtering on `record.type`. **Distinct from `factory-phase.parents`** — aliasing them would silently extend `factory-phase.parents` across iterations in `--no-implement` mode (regression-pinned by H-3). |
| 5 | **Whole-run cost cap** | `RunOptions.maxTotalTokens?: number` (default 500_000) sums `tokens.input + tokens.output` across every implement in the run. Overrun aborts with `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })` from inside the per-phase try block; `factory-phase` persisted with `status: 'error'`; `factory-implement-report` already on disk via `parents=[runId,...]`. CLI flag `--max-total-tokens <n>` with positive-integer validation. |
| 6 | **One new `RuntimeErrorCode`** | `'runtime/total-cost-cap-exceeded'`. Total 10. The CLI's `--max-total-tokens 0` exits 2 with stderr label `runtime/invalid-max-total-tokens:` — a string format only, **not** a `RuntimeErrorCode` value. |
| 7 | **`examples/gh-stars/docs/specs/gh-stars-v2.md`** | Pagination, ETag/conditional caching, retry-with-backoff on 5xx. The closed-loop demo — designed to require iteration 2+. |
| 8 | **Public API surface unchanged** | Strict equality with v0.0.2's surface: 5 functions + 1 class + 13 types = **19 names**, zero new exports. Every change is field-level on already-exported types. |

### Reconciliations worth knowing

- **`ctx.inputs` ≠ `factory-phase.parents`.** They share same-iter predecessors, but `ctx.inputs` additionally includes prior-iter terminal outputs for root phases on iter ≥ 2; `factory-phase.parents` does NOT. Pinned by H-3's `--no-implement` regression test.
- **`maxTotalTokens` is post-hoc.** Tokens are summed *after* each implement returns. A single implement that consumes 600k tokens against a 500k cap will overshoot before being detected — same retroactive nature as the v0.0.2 per-phase cap. Streaming cost monitoring is a v0.0.4+ candidate.
- **`maxTotalTokens` is not programmatically validated.** Non-positive values trip the cap on the first implement that records any tokens. The CLI does pre-validate the flag for friendlier UX. This avoided a second new `RuntimeErrorCode` (locked at one).
- **Default-budget tightness.** 500_000 cap ÷ 5 iterations ≈ 100k/iter, matching the per-phase cap. Tasks with longer prompts will trip one or the other immediately — bump `--max-total-tokens` to ~1_000_000 if you expect long iterations.

### v0.0.2 reconciliations (kept for history)

- **`--bare` was dropped** from the locked `claude` spawn args — in `claude` 2.1+ that flag strictly disables OAuth/keychain reads, incompatible with subscription auth. The rest of the locked surface (`-p`, `--allowedTools`, `--output-format json`) carries the reproducibility intent.
- **`RuntimeErrorCode` gained three new members in v0.0.2, not two.** The plan committed to two; implementation added a third (`'runtime/invalid-max-prompt-tokens'`) for symmetric programmatic + CLI validation.

---

## v0.0.4 — next

**Theme:** quality on the spec side, ergonomics on the operator side. The v0.0.3 loop closes the agent gap; v0.0.4 closes the *spec gap* (the agent's output quality follows the spec's quality) and the *bootstrap gap* (5 minutes from `mkdir` to first agent iteration).

### Lead candidates (from BACKLOG.md)

| # | Piece | Notes |
|---|---|---|
| 1 | **`factory spec review`** — second-pass linter that judges *spec quality* | New package `@wifo/factory-spec-review`. Each judge prompt covers one review angle: `internal-consistency`, `judge-parity`, `dod-precision`, `holdout-distinctness`, `api-surface-drift`, `feasibility`, `cross-doc-consistency`, `scope-creep`. Output mirrors `factory spec lint`'s shape. Runs via `claude -p` (subscription auth). Phasing: ship 3-5 strongest judges first. |
| 2 | **`factory init` + starter template repo** | `factory init` drops minimal `docs/specs/done/`, `docs/technical-plans/done/`, `factory.config.json`. Reference `software-factory-starter` repo for `git clone` → `pnpm install` → first feature. |
| 3 | **`factory-context tree --direction down`** (descendants traversal) | Today `tree` walks ancestors only, so `tree <runId>` shows just the run. Add `--direction up\|down` flag (default `up` for compat). |
| 4 | **PostToolUse hook for `factory spec lint`/`review`** | Harness-enforced spec linting on every `Write` to `docs/specs/*.md` — agent literally cannot skip. Lands alongside the reviewer. |
| 5 | **Worktree sandbox** | The agent runs in an isolated `git worktree` per run instead of the spec's project root. Stronger undo guarantees than "use git as your undo button." |

### Definition of done (v0.0.4)

- `factory spec review docs/specs/my-spec.md` runs end-to-end; catches at least 3 classes of real defects on a representative spec set; output integrates with `factory spec lint`'s exit codes.
- `factory init` produces a working scaffold; `pnpm install && factory-runtime run docs/specs/<sample>.md` converges from clean.
- `factory-context tree <runId> --direction down` returns the full descendant DAG of the run.
- README includes a v0.0.4 walkthrough demonstrating the reviewer catching a deliberate spec defect.

### Scope discipline

The v0.0.3 lesson was "ship the smallest thing that closes the loop." For v0.0.4 the temptation is bundling all five candidates. Don't. **Ship the reviewer first** — it has the highest leverage (spec quality → code quality), the smallest blast radius, and unblocks better v0.0.4+ work. Bundle `factory init` if it falls out cheaply; defer the rest if any of them slip.

---

## v0.0.5+ — future

The post-reviewer work. Roughly ordered by leverage; not committed.

| Theme | Lead candidate from BACKLOG.md |
|---|---|
| **Scheduler (Layer 5)** — autonomous task queue | Pull `status: ready` specs and run them overnight. The end-state. |
| **Holdout-aware convergence** | Validate runs holdouts at the end of every iteration; convergence requires both visible AND holdout passes. Optional `--check-holdouts` flag. |
| **Streaming cost monitoring** | Mid-stream abort instead of post-hoc. Worth pursuing once cost-cap-exceeded events become common enough to justify the complexity. |
| **`explorePhase` / `planPhase`** | Separate "understand the codebase" and "plan the change" steps. Speculative — only if a real run shows `implement` is too low-context. |
| **Domain packs** — schema + judges + twins per domain | `@wifo/factory-pack-web`, `-pack-api`; OLH-specific pack stays private. |
| **Multi-agent coordination** | Beyond a single agent per phase. Out of scope until single-agent's ceiling is clearly hit. |

---

## Cadence guesses (not commitments)

- **v0.0.2** — shipped. ~13 commits, ~1900 LOC including tests + scaffold.
- **v0.0.3** — shipped. 7 subtasks (T1–T7) + the gh-stars-v2 implementation; default flip + cross-iter threading + whole-run cap, all under the "zero new exports" lock.
- **v0.0.4** — 1-2 weeks once we trigger it. Reviewer is the centerpiece; everything else is bonus.

The throughput trick that worked: scoped slices, `/scope-task` per package, reviewed before implementation. v0.0.4 follows the same pattern.

---

## Anti-goals (what's NOT on this roadmap)

Stating these explicitly so we don't drift:

- **Multi-LLM support.** Anthropic-only via `claude` CLI is fine for the foreseeable future.
- **Web UI.** CLI + filesystem records are the surface. A dashboard is a separate product.
- **Generic CI integration.** The deterministic fake-claude smoke is CI-friendly; "CI invoking real-claude factory-runtime" is premature until cost monitoring is stronger.
- **Streaming/live progress UI.** Records get written; tail the directory if you want progress. A streaming protocol is over-engineering for v0.0.3/v0.0.4.

---

## What this roadmap commits us to

The end state is **a software factory you can hand a spec and walk away from**. v0.0.2 was the first step where the agent does work; v0.0.3 is the first version where the agent does *all* the work between human-meaningful checkpoints. v0.0.4 closes the spec-side feedback loop so spec quality stops being the ceiling on agent output. Anything past v0.0.4 is leverage, not unlock.

If we drift, this file is the anchor. Update it deliberately, not silently.

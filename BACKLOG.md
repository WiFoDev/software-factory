# Backlog

Cross-package candidates for v0.0.3+. Not bugs; not blocking the current release. Each entry should explain *what* and *why*, plus enough context that a future spec writer can scope it without re-deriving the motivation.

---

## `factory-context`: descendants traversal

**What:** Add a way to walk *down* the DAG from a record, not just up. Today `factory-context tree <id>` walks ancestors (parents), so `tree <runId>` shows only the run itself because the run is a root with no parents. To see "everything that came out of this run", a user has to `list` and visually correlate, or pick a leaf and tree up to the run.

**Why:** The most natural question after `factory-runtime run` is "what was produced under this run?" — descendants, not ancestors. The current UX requires the user to flip the question backwards.

**Shape options:**
- `factory-context tree <id> --direction up|down` (default `up` for backward compat) — extends the existing command
- `factory-context descendants <id>` — separate verb; clearer but doubles the surface
- Both — `tree` becomes the umbrella, `descendants` is its sibling

Mild lean toward `--direction` flag: zero new commands, one well-scoped flag, and the existing `tree` semantics stay the default. `descendants` as a discoverable alias is fine if it's a free addition.

**Implementation note:** Descendants traversal can't use the same single-pass walk as ancestors. Records know their parents but not their children — finding descendants requires scanning the whole `<dir>` and filtering for records whose `parents[]` includes the target. O(n) per call, fine for typical context-store sizes.

**Touches:** `packages/context/src/tree.ts` (new `buildDescendantTree` or generalize `buildTree`), `packages/context/src/cli.ts` (flag parsing + dispatch), `packages/context/README.md` (document direction).

---

## `factory-runtime`: cross-iteration record threading

**What:** Today, each iteration starts fresh from the parsed spec — records from iteration `n` are not exposed as inputs to iteration `n+1`'s phases. v0.0.2's `implementPhase` reads the spec and the current cwd state but doesn't see prior validate failures, so iteration 2 produces the same prompt as iteration 1.

**Why:** Without this, the v0.0.3 iteration auto-loop is essentially "re-run the same thing and hope flake resolves it." The whole point of iterating is letting the agent react to what just failed. Pinned in the v0.0.1 runtime spec as a wart; v0.0.3 is when the wart actually starts costing convergence.

**Shape:** iteration N+1's `implementPhase` prompt grows a `# Prior iteration N validate report` section listing the failing scenarios + their tail output. The `PhaseContext.iteration` field already exists for this; the runtime needs to start passing predecessor records across iteration boundaries (currently scoped to same-iteration predecessors only).

**Touches:** `packages/runtime/src/runtime.ts` (input collection logic across iterations), `packages/runtime/src/phases/implement.ts` (prompt builder accepts prior validate-report), spec/tests for the new semantics.

---

## `factory-runtime`: `explorePhase` + `planPhase`

**What:** Two new built-in phases that run before `implement`: `explore` (read the codebase, summarize what exists) and `plan` (propose a concrete change set). The agent gets focused context for `implement` rather than synthesizing it from scratch every iteration.

**Why:** Speculative — defer until a real v0.0.3 run shows that `implement` alone is too low-context to converge. If gh-stars or similar demos converge in 1-2 iterations without staged thinking, this stays in the backlog. If they thrash, the bottleneck is plan-making, not implementation, and these phases earn their slot.

**Touches:** new `packages/runtime/src/phases/explore.ts` / `plan.ts`, runtime support for the wider graph, README updates.

---

## Spec format: tighten `/scope-task` output verification

**What:** The slash command now mandates a self-check (re-read + lint via `factory spec lint`). If the agent skips that step in practice, malformed specs reach the user. Worth instrumenting somehow — maybe a hook that runs the linter on every newly-written `docs/specs/*.md` and surfaces the result.

**Why:** Belt-and-suspenders for the loop reliability we just shipped.

**Touches:** `~/.claude/settings.json` (hook), maybe a `factory-spec-watch` helper that hooks into Claude Code's PostToolUse for Write.

---

## Shipped (kept here briefly for history)

- ✅ **`factory-runtime`: agent-driven `implement` phase** — landed in v0.0.2. `validatePhase` + `implementPhase` ship; `explorePhase`/`planPhase` deferred (see above).
- ✅ **`factory-twin`: wire into runtime** — landed in v0.0.2. The runtime sets `WIFO_TWIN_MODE` + `WIFO_TWIN_RECORDINGS_DIR` on the spawned agent subprocess; user code calls `wrapFetch` against them in test setup. Auto-injection of `wrapFetch` is intentionally not done — keeps the runtime mechanism minimal.

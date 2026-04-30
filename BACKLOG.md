# Backlog

Cross-package candidates for v0.0.2+. Not bugs; not blocking v0.0.1. Each entry should explain *what* and *why*, plus enough context that a future spec writer can scope it without re-deriving the motivation.

---

## `factory-context`: descendants traversal

**What:** Add a way to walk *down* the DAG from a record, not just up. Today `factory-context tree <id>` walks ancestors (parents), so `tree <runId>` shows only the run itself because the run is a root with no parents. To see "everything that came out of this run", a user has to `list` and visually correlate, or pick a leaf and tree up to the run.

**Why:** The most natural question after `factory-runtime run` is "what was produced under this run?" — descendants, not ancestors. The current UX requires the user to flip the question backwards. v0.0.1 ships with this rough edge accepted; v0.0.2 should close it.

**Shape options:**
- `factory-context tree <id> --direction up|down` (default `up` for backward compat) — extends the existing command
- `factory-context descendants <id>` — separate verb; clearer but doubles the surface
- Both — `tree` becomes the umbrella, `descendants` is its sibling

Mild lean toward `--direction` flag: zero new commands, one well-scoped flag, and the existing `tree` semantics stay the default. `descendants` as a discoverable alias is fine if it's a free addition.

**Implementation note:** Descendants traversal can't use the same single-pass walk as ancestors. Records know their parents but not their children — finding descendants requires scanning the whole `<dir>` and filtering for records whose `parents[]` includes the target. O(n) per call, fine for typical context-store sizes.

**Touches:** `packages/context/src/tree.ts` (new `buildDescendantTree` or generalize `buildTree`), `packages/context/src/cli.ts` (flag parsing + dispatch), `packages/context/README.md` (document direction).

---

## `factory-runtime`: cross-iteration record threading

**What:** Today, each iteration starts fresh from the parsed spec — records from iteration `n` are not exposed as inputs to iteration `n+1`'s phases. `validatePhase` is idempotent so this doesn't matter for v0.0.1, but once `plan` and `implement` phases land, an iteration's outputs almost certainly want to feed forward (e.g. "the failing scenarios from validate become input to a re-plan").

**Why:** Pinned as a v0.0.1 wart in the runtime spec. Real fix lands when there are non-trivial phases that benefit from cross-iteration state.

**Touches:** `packages/runtime/src/runtime.ts` (input collection logic), spec/tests for new semantics.

---

## `factory-runtime`: agent-driven phases (`explore`, `plan`, `implement`)

**What:** Built-in phases backed by the Claude Agent SDK. v0.0.1 ships only `validatePhase` because the agent integration is a large piece of work on its own.

**Why:** Without these, the runtime is a glorified test runner with provenance. The point of a software factory is the agent doing the work between iterations.

**Touches:** new `packages/runtime/src/phases/explore.ts` / `plan.ts` / `implement.ts`, re-introduce `@wifo/factory-twin` dep for HTTP recording inside agent runs, README updates.

---

## `factory-twin`: wire into runtime

**What:** Twin is shipped and works standalone but the runtime doesn't use it yet. Once `implement` phases run agents that hit external HTTP, those calls need to record/replay through the twin.

**Why:** Pinned in the runtime spec as a v0.0.2 forward-compat note. The twin dep was deliberately removed from `packages/runtime/package.json` for v0.0.1 to avoid declaring an unused dep; v0.0.2 re-adds it as part of the agent-phase work.

**Touches:** `packages/runtime/package.json` (re-add dep), agent-phase code (wrap fetch with twin in record or replay mode), README docs.

---

## Spec format: tighten `/scope-task` output verification

**What:** The slash command now mandates a self-check (re-read + lint via `factory spec lint`). If the agent skips that step in practice, malformed specs reach the user. Worth instrumenting somehow — maybe a hook that runs the linter on every newly-written `docs/specs/*.md` and surfaces the result.

**Why:** Belt-and-suspenders for the loop reliability we just shipped.

**Touches:** `~/.claude/settings.json` (hook), maybe a `factory-spec-watch` helper that hooks into Claude Code's PostToolUse for Write.

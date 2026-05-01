---
id: factory-runtime-v0-0-5
classification: light
type: feat
status: ready
exemplars:
  - path: packages/runtime/src/phases/implement.ts
    why: "buildPrompt at line 378. The new IMPLEMENTATION_GUIDELINES section is inserted between the opening prose block (lines 386-390) and `# Spec` (line 392). Stable across iterations — same constant, same bytes, every invocation — so prompt caching kicks in. Existing structure is the contract; v0.0.5 adds one section, doesn't restructure."
  - path: packages/runtime/src/phases/implement.test.ts
    why: "buildPrompt test patterns. v0.0.5 adds three tests (presence, byte-stability, length cap) using the same fixture-based assertion shape."
  - path: BACKLOG.md
    why: "the implementer-behavior prompt prefix entry deferred from v0.0.4. The four priors named there (state assumptions; simplicity first; surgical changes; goal-driven execution) are the source of truth for the section's content."
  - path: docs/specs/done/factory-runtime-v0-0-3.md
    why: "v0.0.3's `# Prior validate report` section pattern — placement between `# Spec` and `# Working directory`, byte-stability under iteration, length cap with truncation marker. v0.0.5's section is structurally similar (stable text), positionally different (before `# Spec`, not after)."
---

# factory-runtime-v0-0-5 — `implementPhase`: behavior-prior prompt prefix

## Intent

Add a stable `# Implementation guidelines` section to `implementPhase`'s `buildPrompt` (placed BEFORE `# Spec`) that bakes in four behavior priors for the spawned agent: (1) state assumptions / surface tradeoffs before coding; (2) write the minimum code that solves the problem — no speculative abstractions; (3) surgical edits — touch only what the task requires; (4) define verifiable success criteria and loop until met.

The text is **stable across iterations** — same constant, same bytes, every invocation — so prompt caching applies. The section appears in iter 1 and every subsequent iteration. Reduces iteration count by reducing scope-creep / over-engineering loops in early iterations. Pairs with v0.0.3's `# Prior validate report` section: the prefix shapes how the agent reasons; the prior-validate section shapes what the agent fixes on iter ≥ 2.

No public API changes. No new exports. Zero changes to records or schemas. One new internal constant (`IMPLEMENTATION_GUIDELINES`) emitted by `buildPrompt`.

## Scenarios

**S-1** — `buildPrompt` emits `# Implementation guidelines` before `# Spec` on every iteration
  Given a `buildPrompt` invocation with arbitrary `specSource`, `cwd`, `iteration` (any positive integer), and no `priorSection`
  When the prompt is built
  Then the produced string contains the substring `# Implementation guidelines`; the section appears BEFORE `# Spec` in the output (the index of `# Implementation guidelines` is strictly less than the index of `# Spec`); the section contains four bullet items corresponding to the four priors (substrings: `state your assumptions`, `minimum code`, `surgical`, `verifiable`); the section is followed by a blank line then `# Spec`.
  And given the same call with `iteration: 5` instead of `iteration: 1`, the produced section is byte-identical (the section's content does not vary by iteration).
  Satisfaction:
    - test: `src/phases/implement.test.ts` "buildPrompt emits Implementation guidelines section before # Spec"
    - test: `src/phases/implement.test.ts` "Implementation guidelines section is byte-identical across iterations 1..5"

**S-2** — Prefix is byte-stable across multiple invocations (cache-friendly)
  Given `buildPrompt` invoked twice with identical arguments (same `specSource`, same `cwd`, same `iteration`, same/no `priorSection`)
  When the two prompts are compared
  Then they are byte-identical (`prompt1 === prompt2`); the byte-range corresponding to the `# Implementation guidelines` section is identical across the two; this property holds even when `priorSection` differs across calls (the prefix is independent of the prior section).
  Satisfaction:
    - test: `src/phases/implement.test.ts` "Implementation guidelines section bytes are stable under different priorSection inputs"
    - judge: "the section's wording reads as a coherent set of behavior priors a developer would actually want their agent to follow — not a checklist the agent will skim past"

**S-3** — Section length is bounded (does not balloon the prompt)
  Given the `IMPLEMENTATION_GUIDELINES` constant
  When measured
  Then `Buffer.byteLength(IMPLEMENTATION_GUIDELINES, 'utf8') <= 2048` (≤ 2 KB / ≈ 500 tokens). Documented in the runtime README's "default-budget tightness" section: the prefix consumes ~2.5% of the default 100k per-phase cap, ~0.5% of the 500k whole-run cap.
  Satisfaction:
    - test: `src/phases/implement.test.ts` "IMPLEMENTATION_GUIDELINES is under the 2 KB cap"

**S-4** — Existing prompt structure is preserved
  Given the v0.0.4 `buildPrompt` output (without the prefix) on a fixture spec
  When the v0.0.5 `buildPrompt` is invoked on the same fixture
  Then every existing section still appears in the same relative order: opening prose → `# Implementation guidelines` (NEW) → `# Spec` → optional `# Prior validate report` → `# Working directory` → `# Tools` → `# Constraints` → `# What "done" looks like` → closing iteration line. No section is renamed; no section's content (other than the new one) changes.
  Satisfaction:
    - test: `src/phases/implement.test.ts` "buildPrompt output preserves v0.0.4 section ordering with the new section inserted before # Spec"

## Constraints / Decisions

- New module-level constant `IMPLEMENTATION_GUIDELINES` in `packages/runtime/src/phases/implement.ts`. Internal-only — NOT exported from `src/index.ts`. Public API surface unchanged at 19 names.
- Section content (the literal markdown block):
  ```
  # Implementation guidelines

  Read these before reading the spec, and revisit them when you're tempted to expand scope:

  - **State your assumptions.** If something is ambiguous, say so. If multiple interpretations exist, name them — don't pick silently. Push back when warranted.
  - **Minimum code that solves the problem.** No features beyond what was asked. No abstractions for single-use code. No "flexibility" or "configurability" the spec didn't request. If you wrote 200 lines and it could be 50, rewrite it.
  - **Surgical changes only.** Edit what the spec requires; leave adjacent code, comments, and formatting alone. Match existing style. If you notice unrelated dead code, mention it — don't delete it.
  - **Define verifiable success criteria, then loop.** Every change should map to a `test:` line, a `judge:` line, or a Constraint in the spec. Run the tests yourself before finishing — "the tests will pass" is not the same as "I ran them and they pass".
  ```
  This is the locked text — verbatim. Tests in S-2 pin byte-stability against this string.
- Placement in `buildPrompt`: insert the section AFTER the opening prose block (`'You are an automated coding agent...'`) and BEFORE `# Spec`. The blank-line separator pattern matches the existing `# Spec → blank → # Working directory` rhythm.
- Section is emitted on **every iteration** (iter 1 and iter ≥ 2 alike). NOT conditional on the presence of `priorSection`.
- Section is **independent** of `priorSection`. The prior-validate-report section (v0.0.3) still appears in its v0.0.3 position (between `# Spec` and `# Working directory`); the new section sits above all of those.
- Byte-stability: the constant is defined once, used once. Tests compare `prompt1 === prompt2` across multiple `buildPrompt` invocations to pin invariance. (Cache-stability matters for `claude -p`'s ephemeral cache_control — a stable prefix means the cache hits the same key every iteration.)
- Length cap: `IMPLEMENTATION_GUIDELINES` ≤ 2048 bytes (~500 tokens). The locked text above is ~1100 bytes — well under the cap. The cap exists so future edits don't accidentally balloon the prompt.
- README updates in `packages/runtime/README.md`: new "Implementation guidelines section (v0.0.5)" subsection documenting the four priors, the placement, the byte-stability invariant, the budget impact (~2.5% of the per-phase cap), and the tradeoff (deliberate +N tokens per implement spawn vs. fewer iterations on average — net win expected, measured against gh-stars-v2 production runs in v0.0.5+ release notes).
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere.
- v0.0.5 explicitly does **not** ship: per-spec-overridable behavior priors, prefix variants per spec type (`feat` vs `refactor`), runtime telemetry on iteration-count deltas. Future point releases may layer these once the v0.0.5 prefix has soaked.

## Subtasks

- **T1** [feature] — Add `IMPLEMENTATION_GUIDELINES` constant in `packages/runtime/src/phases/implement.ts` (above `buildPrompt`). Update `buildPrompt`'s `lines` array to push the constant + a blank line between the opening prose and `# Spec`. Bump `packages/runtime/package.json` version to `0.0.5`. Tests in `packages/runtime/src/phases/implement.test.ts`:
  - "buildPrompt emits Implementation guidelines section before # Spec" (per S-1).
  - "Implementation guidelines section is byte-identical across iterations 1..5" (per S-1's iteration invariance).
  - "Implementation guidelines section bytes are stable under different priorSection inputs" (per S-2).
  - "IMPLEMENTATION_GUIDELINES is under the 2 KB cap" (per S-3).
  - "buildPrompt output preserves v0.0.4 section ordering with the new section inserted before # Spec" (per S-4).
  Existing buildPrompt tests should continue passing without changes (they assert presence of `# Spec`, `# Prior validate report`, etc.; none assert that `# Implementation guidelines` is ABSENT). **depends on nothing**. ~120 LOC including tests.
- **T2** [chore] — Update `packages/runtime/README.md`:
  - New "Implementation guidelines section (v0.0.5)" subsection between the v0.0.3 release notes and the API surface table. Documents the four priors, placement, byte-stability invariant, budget impact, and the tradeoff statement.
  - Update the v0.0.5 release-notes block at the top to summarize the change.
  Top-level `README.md` "What you get today" gets a new bullet under "Manual mode" / "Agent-driven mode" — "the runtime now ships a stable Implementation guidelines section in every implement prompt (v0.0.5)". `ROADMAP.md` v0.0.5 entry advances to "shipped" once T1 + the publish spec land. **depends on T1**. ~60 LOC.

## Definition of Done

- All scenarios (S-1..S-4) pass (tests green; S-2's judge criterion eyeballed against the locked text — read the section out loud, does it sound like advice you'd want to follow, or boilerplate?).
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green (`bun test`); the new buildPrompt tests are part of the suite.
- `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`.
- **Deterministic CI smoke**: existing `factory-runtime run` smoke (the `needs-iter2.md` fixture from v0.0.3) still converges in 2 iterations under default options; the iter-1 implement prompt now contains `# Implementation guidelines` (verified by reading `factory-implement-report.payload.prompt` from disk and asserting the substring).
- **Manual smoke (release-gate, optional but recommended)**: re-run `examples/gh-stars/docs/specs/done/gh-stars-v2.md` against real claude before tagging. Compare iteration count + token totals to the v0.0.4 baseline documented in the v0.0.3 release notes. The hypothesis: the prefix reduces speculative abstractions in iter 1, so v0.0.5's iter count is ≤ v0.0.4's. NOT a CI gate — informational, captured in v0.0.5 release notes.
- Public API surface from `packages/runtime/src/index.ts` is **strictly equal** to v0.0.4's 19 names. `IMPLEMENTATION_GUIDELINES` is internal-only.
- The v0.0.5 BACKLOG entry for "implementPhase: behavior-prior prompt prefix" is removed (it's now shipped; the entry's purpose is served).
- README in `packages/runtime/` documents the new section, the byte-stability invariant, and the budget impact.
- v0.0.5 explicitly does **not** ship: per-spec overrides, prefix variants by spec type, iteration-count telemetry. Deferred per Constraints.

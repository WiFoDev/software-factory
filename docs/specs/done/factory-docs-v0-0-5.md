---
id: factory-docs-v0-0-5
classification: light
type: chore
status: ready
exemplars:
  - path: docs/SPEC_TEMPLATE.md
    why: "current template file. References the pre-v0.0.3 single-tree filename convention (`<id>.technical-plan.md`). v0.0.5 fixes that to the parallel-tree convention (`docs/specs/<id>.md` ↔ `docs/technical-plans/<id>.md`) and adds a `factory spec review` line."
  - path: docs/specs/done/factory-runtime-v0-0-3.md
    why: "live spec following the parallel-tree convention. The template needs to match THIS layout — frontmatter shape, section ordering, satisfaction-line format. SPEC_TEMPLATE.md drifted; this spec is the ground truth."
  - path: packages/spec-review/README.md
    why: "the existing reviewer doc — comprehensive. Other READMEs (harness, runtime) reference review only via the top-level README. v0.0.5 adds short cross-package pointers in their READMEs so the reviewer is discoverable from anywhere."
  - path: packages/core/README.md
    why: "exemplar for cross-package-pointer style — already references `factory init` and `factory spec review` cleanly. Other READMEs mirror this pattern."
---

# factory-docs-v0-0-5 — Doc hygiene: SPEC_TEMPLATE convention fix + cross-package review pointers + PostToolUse hook recipe

## Intent

Three small doc tasks bundled because they all surfaced as gaps after v0.0.4 shipped:

1. **`docs/SPEC_TEMPLATE.md` is wrong.** It tells new users to write `<id>.technical-plan.md` (single-tree) when v0.0.3 moved to the `docs/specs/<id>.md` ↔ `docs/technical-plans/<id>.md` parallel-tree convention. Actively misleading.
2. **`packages/harness/README.md` and `packages/runtime/README.md` don't mention `factory spec review`.** A user reading the harness or runtime docs has no path to discover the reviewer except via the top-level README.
3. **No PostToolUse hook recipe is documented.** v0.0.4's BACKLOG flagged this as the natural pairing for the reviewer — harness-enforced lint+review on every Write to `docs/specs/*.md`. The hook config lives in `~/.claude/settings.json` (not this repo), so the deliverable is a **documented recipe** (one block in `packages/core/README.md`), not new code.

Pure docs. No exports change. No code changes. No new packages.

## Scenarios

**S-1** — `docs/SPEC_TEMPLATE.md` matches the v0.0.3+ parallel-tree convention
  Given the current `docs/SPEC_TEMPLATE.md`
  When read after the fix
  Then the file contains the substring `docs/specs/<id>.md` AND `docs/technical-plans/<id>.md` (the parallel-tree paths). It does NOT contain the obsolete substrings `<id>.technical-plan.md` or `single-tree`. The "Filename convention" subsection explicitly explains the parallel-tree rationale: "specs and technical plans live in parallel directories so `factory spec lint docs/specs/` recurses without tripping over technical plans."
  Satisfaction:
    - test: packages/core/src/spec-template.test.ts "SPEC_TEMPLATE references the parallel-tree convention and not the obsolete single-tree filename"

**S-2** — `SPEC_TEMPLATE.md` references `factory spec review` in the workflow
  Given the same file after the fix
  When read
  Then the closing section (after the skeleton block) contains a "Validating" or "Workflow" subsection that lists `factory spec lint docs/specs/<id>.md` AND `factory spec review docs/specs/<id>.md` as the two recommended pre-implementation checks. The text explains lint = format/free, review = quality/judges/subscription.
  Satisfaction:
    - test: packages/core/src/spec-template.test.ts "SPEC_TEMPLATE recommends both factory spec lint and factory spec review"

**S-3** — `packages/harness/README.md` and `packages/runtime/README.md` cross-link the reviewer
  Given the current harness + runtime READMEs
  When read after the fix
  Then each contains a one-paragraph "Related" or "See also" section pointing at `@wifo/factory-spec-review`'s `factory spec review` CLI, framed as "the spec-side analog of this package" (for harness — both run LLM judges; reviewer reuses the harness `JudgeClient` interface) or "the recommended pre-run quality check" (for runtime — review before you spend tokens on the loop). Each reference includes the relative path to the spec-review package's README.
  Satisfaction:
    - test: packages/core/src/spec-template.test.ts "harness README references @wifo/factory-spec-review"
    - test: packages/core/src/spec-template.test.ts "runtime README references @wifo/factory-spec-review"

**S-4** — `packages/core/README.md` documents the PostToolUse hook recipe
  Given the current core README after the fix
  When read
  Then a new section `## Harness-enforced spec linting + review (Claude Code hook recipe)` is present. The section contains a JSON snippet for `~/.claude/settings.json`'s `hooks.PostToolUse` block, configured to run `factory spec lint <path>` AND `factory spec review <path>` on every `Write` (or `Edit`) to a path matching `docs/specs/*.md`. The snippet uses the documented Claude Code hooks shape (`matcher`, `command`, `event`). The section frames this as opt-in: "drop this into your settings to make the agent literally unable to forget the linter." It also documents the single failure mode: the hook fires AFTER the write succeeds, so a failing review surfaces as a warning the agent sees, not a blocked write.
  Satisfaction:
    - test: packages/core/src/spec-template.test.ts "core README contains the PostToolUse hook recipe with both lint and review commands"
    - judge: "the hook recipe is copy-paste runnable — a developer can drop the block into their settings.json verbatim, run the agent on a spec, and observe the lint/review output without any other configuration"

## Constraints / Decisions

- `docs/SPEC_TEMPLATE.md` is rewritten to match the v0.0.3+ parallel-tree convention. The "Filename convention" line explicitly references both directories. The "active vs done" lifecycle (active in `docs/specs/`, finished moves to `docs/specs/done/`, technical plan parallel under `docs/technical-plans/done/`) is documented.
- `SPEC_TEMPLATE.md` adds a closing "Validating the spec" section listing `factory spec lint` (format/free/deterministic) and `factory spec review` (quality/LLM-judges/subscription). One paragraph each, ~3 sentences.
- `packages/harness/README.md` adds a "Related" section at the bottom (~80 words) cross-linking `@wifo/factory-spec-review` — frames it as the spec-side analog reusing `JudgeClient`.
- `packages/runtime/README.md` adds a "Recommended pre-run flow" subsection near the top (~60 words) — `factory spec lint` then `factory spec review` then `factory-runtime run`. Cross-links to spec-review's README.
- `packages/core/README.md` adds a new section `## Harness-enforced spec linting + review (Claude Code hook recipe)`:
  - One paragraph framing: harness-enforced means the hook runs in the Claude Code harness regardless of whether the agent remembers to run the linter; closes the "agent forgot to run lint" failure mode.
  - JSON snippet for `~/.claude/settings.json`:
    ```json
    {
      "hooks": {
        "PostToolUse": [
          {
            "matcher": "Write|Edit",
            "command": "if [ \"${CLAUDE_PROJECT_DIR}/${CLAUDE_FILE_PATH}\" = *docs/specs/*.md ]; then pnpm exec factory spec lint \"$CLAUDE_FILE_PATH\" && pnpm exec factory spec review \"$CLAUDE_FILE_PATH\" --no-cache; fi"
          }
        ]
      }
    }
    ```
    (Bash/zsh-portable. The shell guard ensures the hook only fires for spec writes, not every Write.)
  - One paragraph documenting the failure mode: PostToolUse fires AFTER the write completes, so failing review is a notification the agent sees, not a blocked write. If the agent shipped a bad spec, the hook tells the user; the user can revert or trigger a fix.
  - One sentence noting this is an OPT-IN config — not auto-installed by `factory init` (which doesn't touch `~/.claude/`).
- `packages/core/src/spec-template.test.ts` is a new test file with five tests covering S-1..S-4. The tests `readFileSync` each doc and assert string-presence/absence — no special test infra needed. Lives in `packages/core` because that's where the spec format itself lives.
- Other packages' READMEs (`twin`, `context`, `spec-review`) are NOT changed in v0.0.5 — already current or unrelated to spec-quality flow.
- No code changes. No new exports. No new packages. The factory-core public API surface stays at 27 names exactly.
- v0.0.5 explicitly does **not** ship: a `factory spec watch` daemon, a `factory hook install` command that writes the recipe to `~/.claude/settings.json` automatically (the recipe is intentionally manual — opt-in is the right default), a CI workflow that wires the hook for repos. Each is a future candidate.

## Subtasks

- **T1** [chore] — Rewrite `docs/SPEC_TEMPLATE.md`:
  - Update the opening "Filename convention" line to the parallel-tree convention.
  - Add the lifecycle paragraph (active → done, in parallel directories).
  - Append the "Validating the spec" section listing `factory spec lint` and `factory spec review`.
  - Verify the file still mirrors the `/scope-task` slash command's output shape so it stays a faithful template.
  **depends on nothing**. ~50 LOC of edits to the existing file.
- **T2** [chore] — Add cross-package review pointers:
  - `packages/harness/README.md` — append a "Related" section (~80 words) referencing `@wifo/factory-spec-review` as the spec-side analog reusing `JudgeClient`.
  - `packages/runtime/README.md` — insert a "Recommended pre-run flow" subsection near the top (~60 words) recommending `lint` → `review` → `run`. Cross-link to spec-review's README.
  **depends on nothing**. ~40 LOC across two files.
- **T3** [chore] — Add the PostToolUse hook recipe to `packages/core/README.md`. New section as Constraints describes; ~120 words + the JSON snippet. **depends on nothing**. ~40 LOC.
- **T4** [test] — `packages/core/src/spec-template.test.ts`. Five tests reading the four docs from disk (or from string constants if test isolation matters) and asserting the string presence/absence per S-1..S-4. **depends on T1, T2, T3**. ~80 LOC.

## Definition of Done

- All scenarios (S-1..S-4) pass (tests green; S-4's judge criterion eyeballed by copy-pasting the JSON snippet into a real `~/.claude/settings.json` and confirming a Write to a `docs/specs/*.md` file fires both checkers — manual smoke, not CI).
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; the new `spec-template.test.ts` suite is part of it.
- `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `docs/SPEC_TEMPLATE.md` lints clean via `factory spec lint` if the lint accepts non-spec markdown (or the file is excluded from lint via path filter — current behavior).
- `factory spec lint docs/specs/` continues to return OK (template is in `docs/`, not `docs/specs/`, so it's not in the lint path).
- README cross-links resolve: a relative link from `harness/README.md` to `spec-review/README.md` works on GitHub's renderer.
- Public API surface from every package is unchanged in v0.0.5 (zero export deltas — pure docs).
- `ROADMAP.md` v0.0.5 entry advances to "shipped" once this spec + the publish spec + the runtime spec all land.
- v0.0.5 explicitly does **not** ship: `factory spec watch`, `factory hook install`, automated hook config in `factory init`. Deferred per Constraints.

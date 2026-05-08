---
id: factory-core-v0-0-14-yaml-colon-quoting
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/core/src/lint.ts
    why: "lint codes registry. v0.0.14 adds spec/yaml-colon-needs-quoting (severity: warning) — detects unquoted frontmatter values containing a colon-space (which YAML parses as a nested mapping)."
  - path: packages/core/commands/scope-project.md
    why: "slash command source. v0.0.14 adds a frontmatter authoring rule: 'if a frontmatter value contains a colon, wrap in single quotes' — prevents the bomb at scoping time so the lint warning rarely fires in practice."
  - path: BACKLOG.md
    why: "v0.0.14 entry 'YAML colon-in-string parse trap on frontmatter'. Small papercut; high re-discovery rate per the v0.0.13 BASELINE."
depends-on:
  - factory-harness-v0-0-14-apostrophe-fix
---

# factory-core-v0-0-14-yaml-colon-quoting — catch + prevent YAML colon-in-string parse traps

## Intent

A spec frontmatter value containing an unquoted colon-space — e.g., `why: \`clicks: Map<string, Click[]>\`` — is parsed by YAML as a nested mapping (the inner `: ` is a key/value separator). The v0.0.13 BASELINE dogfooder hit this; lint catches the parse error but with cryptic YAML jargon.

v0.0.14 closes it from both sides:
1. **Lint**: new `spec/yaml-colon-needs-quoting` warning (severity: warning) detects the pattern at scoping time and emits a friendly fix-suggestion.
2. **Slash command**: `/scope-project`'s authoring rules are updated so the scoper auto-quotes frontmatter values containing colons. Prevents the trap at the source.

Small fix; high re-discovery rate per the BASELINE — every spec author who paraphrases a generic-typed value hits it.

## Scenarios

**S-1** — Lint detects unquoted colon-space in frontmatter values
  Given a spec with frontmatter `why: \`clicks: Map<string, Click[]>\`` (note the inner `: ` after `clicks`)
  When `factory spec lint <path>` runs
  Then it emits one warning at the offending line: `<file>:<line>  warning  spec/yaml-colon-needs-quoting  frontmatter value contains an unquoted colon-space; wrap in single quotes (e.g., 'clicks: Map<string, Click[]>')`. Lint exit code 0 (warnings don't fail).
  And given the value is correctly single-quoted (`why: 'clicks: Map<string, Click[]>'`), no warning fires.
  Satisfaction:
    - test: packages/core/src/lint.test.ts "spec/yaml-colon-needs-quoting fires on unquoted colon-space in frontmatter"
    - test: packages/core/src/lint.test.ts "spec/yaml-colon-needs-quoting does not fire on quoted form"

**S-2** — Lint distinguishes valid YAML mapping from accidental colon-in-string
  Given a spec with frontmatter that contains a LEGITIMATE nested mapping (e.g., `exemplars:\n  - path: foo\n    why: bar` — the inner `:` keys ARE meant to be mapping keys)
  When `factory spec lint <path>` runs
  Then no `spec/yaml-colon-needs-quoting` warning fires (the nested structure is intentional). The lint detector targets values, not keys: it looks at the RIGHT side of a top-level frontmatter `key: value` pair and checks if the value (after parsing) is a string AND the source line contains a colon-space inside the unquoted value text.
  Satisfaction:
    - test: packages/core/src/lint.test.ts "spec/yaml-colon-needs-quoting ignores legitimate nested mappings"

**S-3** — `/scope-project` documents the frontmatter quoting rule
  Given the canonical `/scope-project` source at `packages/core/commands/scope-project.md`
  When read in v0.0.14+
  Then it contains explicit guidance in the field-rules section: "If a frontmatter value contains a colon (e.g., a generic type like `Map<string, T>`), wrap the value in single quotes to avoid YAML parsing it as a nested mapping. Example: `why: 'clicks: Map<string, Click[]>'` (quoted) instead of `why: \`clicks: Map<string, Click[]>\`` (unquoted, parses incorrectly)."
  Satisfaction:
    - test: packages/core/src/scope-project-source.test.ts "scope-project source documents the frontmatter colon-quoting rule"

## Constraints / Decisions

- **Lint detection regex (locked):** scan top-level frontmatter `key: value` lines (not nested mappings). For each value, if the value is unquoted (does not start with `'` or `"`) AND contains `: ` (colon-space) inside the value text (after the first `:` separator) AND the parsed YAML value is a string (not a parsed mapping), emit the warning. False-positive rate: low — legitimate nested mappings are detected via YAML parser's structure.
- **Severity (locked):** `warning` (does not fail `factory spec lint`'s exit code 0). Catches the friction at scoping time but doesn't block ship.
- **Fix-suggestion shape (locked):** `frontmatter value contains an unquoted colon-space; wrap in single quotes (e.g., 'clicks: Map<string, Click[]>')`. Includes the offending value in the example so the spec author can copy-paste-fix.
- **Slash-command rule (locked):** added to Step 2's "Field rules" section (or a new "Frontmatter quoting" subsection) in `packages/core/commands/scope-project.md`. ~10 LOC of prompt content.
- **Public API surface delta in `@wifo/factory-core`:** `LintCode` union gains `'spec/yaml-colon-needs-quoting'`. No new exports.
- **References v0.0.14 cross-cutting Constraints from `factory-harness-v0-0-14-apostrophe-fix`** for cluster ordering and ship flags.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.14 explicitly does NOT ship in this spec:** auto-quoting via lint --fix mode (deferred); upgrading severity to error (premature — let the warning soak); other YAML traps (multiline strings, anchors — out of scope).

## Subtasks

- **T1** [feature] — Add `spec/yaml-colon-needs-quoting` lint code in `packages/core/src/lint.ts`. Walks frontmatter source line-by-line; for each top-level `key: value` line, checks for unquoted colon-space in the value text. ~30 LOC. **depends on nothing.**
- **T2** [chore] — Edit `packages/core/commands/scope-project.md` Step 2's field rules: add the frontmatter colon-quoting rule + worked example. ~12 LOC of prompt content. **depends on nothing.**
- **T3** [test] — `packages/core/src/lint.test.ts`: 3 tests for S-1 + S-2 (warning fires on unquoted; doesn't fire on quoted; doesn't fire on legitimate nested mappings). `packages/core/src/scope-project-source.test.ts`: 1 test for S-3. ~60 LOC. **depends on T1, T2.**
- **T4** [chore] — Update `packages/core/README.md`'s lint-codes list: add the new code. ~10 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.14 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/core build`).
- A regression-pin verifies that `why: \`clicks: Map<string, Click[]>\`` triggers the warning AND `why: 'clicks: Map<string, Click[]>'` does not.
- The legitimate nested-mapping case (`exemplars:` block) is verified to NOT trigger false positives.
- `/scope-project` source documents the frontmatter colon-quoting rule with a worked example.
- Public API surface delta: `@wifo/factory-core` `LintCode` union +1 (`spec/yaml-colon-needs-quoting`); export count unchanged.
- README in `packages/core/` documents the new lint code.
- v0.0.14 explicitly does NOT ship in this spec: auto-fix mode; severity upgrade; other YAML traps. Deferred per Constraints.

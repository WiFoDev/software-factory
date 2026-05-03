---
id: factory-core-v0-0-9
classification: light
type: feat
status: ready
exemplars:
  - path: docs/specs/done/factory-core-v0-0-7.md
    why: "Reference shape for adding an optional field to SpecFrontmatterSchema + a new lint code. v0.0.7 added 'depends-on' the same way; v0.0.9 adds 'agent-timeout-ms' and a separate wide-blast-radius warning. Same pattern: field-level addition + new internal validation logic + new lint code."
  - path: packages/core/src/schema.ts
    why: "SpecFrontmatterSchema (lines 22-30) — v0.0.9 adds optional `'agent-timeout-ms': z.number().int().positive().optional()`. Field-level addition; zero new public exports."
  - path: packages/core/src/lint.ts
    why: "lintSpec (lines ~30-150) — v0.0.9 adds a Subtasks-section walker that counts distinct file-path mentions; emits `spec/wide-blast-radius` (severity: warning) when count >= 8. Existing scaffolding for `spec/` codes is the template."
  - path: BACKLOG.md
    why: "v0.0.9 lead candidate entries: 'Per-spec agent-timeout override + file-blast-radius guidance'. Source of truth for the design lean (spec-frontmatter override + scoping-time lint, not raised default)."
depends-on: []
---

# factory-core-v0-0-9 — `agent-timeout-ms` frontmatter field + `spec/wide-blast-radius` lint warning

## Intent

Add two field-level extensions to `@wifo/factory-core` that close the agent-timeout failure surfaced by the v0.0.8 self-build (spec 3 hit the 600s implement-phase timeout despite landing all the work). First: an optional `agent-timeout-ms?: number` field on `SpecFrontmatter` so wide-blast-radius specs can declare their own budget without bumping the global default. Second: a `factory spec lint`-time warning (`spec/wide-blast-radius`) that fires when a spec's `## Subtasks` block references >= 8 distinct file paths — catches the bomb at scoping time, before the implement phase blows the budget.

Public API surface unchanged: zero new exports. Field-level addition to `SpecFrontmatterSchema` + new internal scanner in `lint.ts`. Pairs with `factory-runtime-v0-0-9` (which consumes the new field) and the existing v0.0.6 `--max-agent-timeout-ms` flag (raised global ceiling, complementary to per-spec override).

## Scenarios

**S-1** — `parseSpec` accepts `agent-timeout-ms` and exposes it on frontmatter; absent → undefined
  Given a spec source with frontmatter `agent-timeout-ms: 1200000`
  When `parseSpec(source)` is invoked
  Then `spec.frontmatter['agent-timeout-ms']` equals `1200000` (number); the field's type is `number | undefined`. Given a spec without the field, `spec.frontmatter['agent-timeout-ms']` is `undefined` (NOT 0; NOT a default). Given a spec with `agent-timeout-ms: 0` or a negative value, `parseSpec` throws `SpecParseError` (Zod schema rejects non-positive integers).
  Satisfaction:
    - test: packages/core/src/schema.test.ts "SpecFrontmatterSchema accepts agent-timeout-ms as a positive integer"
    - test: packages/core/src/schema.test.ts "SpecFrontmatterSchema leaves agent-timeout-ms undefined when absent"
    - test: packages/core/src/schema.test.ts "SpecFrontmatterSchema rejects non-positive agent-timeout-ms"
    - test: packages/core/src/parser.test.ts "parseSpec exposes agent-timeout-ms on frontmatter"

**S-2** — `factory spec lint` emits `spec/wide-blast-radius` warning when Subtasks names >= 8 distinct file paths
  Given a spec source whose `## Subtasks` section names 9 distinct file paths (each subtask references one or more files, e.g., `packages/core/src/foo.ts`, `packages/runtime/src/bar.ts`, `docs/specs/baz.md`, etc.)
  When `lintSpec(source)` is invoked
  Then the returned errors include exactly one with `code: 'spec/wide-blast-radius'`, `severity: 'warning'`, `message: "## Subtasks references 9 distinct file paths; specs touching >= 8 files commonly exceed the 600s implement-phase budget. Consider splitting or setting agent-timeout-ms in frontmatter."`. The line points at the `## Subtasks` heading line.
  And given a spec with 7 distinct file paths, NO `spec/wide-blast-radius` warning fires.
  And given a spec with 12 distinct file paths but `agent-timeout-ms: 1800000` declared in frontmatter, the warning STILL fires (the lint catches scope-creep at scoping time; the maintainer can dismiss it knowing the timeout is raised).
  Satisfaction:
    - test: packages/core/src/lint.test.ts "lintSpec emits spec/wide-blast-radius when Subtasks names >= 8 distinct file paths"
    - test: packages/core/src/lint.test.ts "lintSpec does not emit spec/wide-blast-radius for < 8 paths"
    - test: packages/core/src/lint.test.ts "lintSpec emits spec/wide-blast-radius regardless of agent-timeout-ms declaration"

**S-3** — File-path detection heuristic catches the canonical patterns without false positives
  Given a Subtasks block whose subtasks reference: `packages/core/src/foo.ts`, `src/bar.test.ts`, `docs/specs/baz.md`, `package.json` (referenced multiple times — counted once), `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `BACKLOG.md`, `BASELINE.md`
  When the lint's path-extraction heuristic runs
  Then it returns 9 distinct paths (the four .md files at repo-root, the .json, and the 3 typed files). Each path is normalized (no leading/trailing whitespace; case-preserved). Paths inside fenced code blocks within the Subtasks section ARE counted (the agent often references files via `` `packages/.../foo.ts` `` style); paths in inline backticks are also counted; paths in plain prose ("touches packages/core/src/foo.ts") are counted.
  And given a Subtasks block whose subtasks ONLY contain prose ("update the README", "add tests"), the heuristic returns 0 paths (no file-path tokens detected).
  Satisfaction:
    - test: packages/core/src/lint.test.ts "wide-blast-radius scanner detects backtick-wrapped paths in Subtasks"
    - test: packages/core/src/lint.test.ts "wide-blast-radius scanner detects plain-prose paths in Subtasks"
    - test: packages/core/src/lint.test.ts "wide-blast-radius scanner deduplicates repeated paths"
    - test: packages/core/src/lint.test.ts "wide-blast-radius scanner returns 0 for prose-only Subtasks"

## Constraints / Decisions

- **Schema field name (locked):** `'agent-timeout-ms'` (kebab-case, matches the existing `'depends-on'` field's idiom). Accessed in TypeScript as `spec.frontmatter['agent-timeout-ms']` (bracket notation).
- **Schema type:** `z.number().int().positive().optional()`. Optional input; no default. Programmatic callers reading the field MUST handle `undefined`. Mirrors the existing `RunOptions.maxAgentTimeoutMs` semantics (positive integer; non-positive → reject).
- **Runtime consumption is OUT OF SCOPE for this spec.** `factory-runtime-v0-0-9` reads `spec.frontmatter['agent-timeout-ms']` and threads it into `PhaseContext.maxAgentTimeoutMs`. This spec only adds the field to the schema and validates it — runtime wiring lives in the dependent spec.
- **Lint code (locked):** `spec/wide-blast-radius` — namespaced under existing `spec/` codes (`spec/invalid-depends-on`, `spec/depends-on-missing`). Severity: `warning` (non-blocking).
- **Lint threshold (locked):** >= 8 distinct file paths. Sourced from v0.0.8 self-build evidence (the spec that timed out touched 12 files; specs touching 4-6 file paths converged in 1 iteration consistently). 8 is the conservative midpoint; future calibration may tighten or loosen based on additional baseline runs.
- **Path-extraction heuristic (locked):** A regex that matches tokens shaped like a file path:
  ```
  /(?:(?:packages|docs|src|examples|test-fixtures|scripts)\/[\w./\-]+|\b\w[\w./\-]*\.(?:md|ts|tsx|js|jsx|json|sh|yaml|yml|toml))/g
  ```
  Captures: package-prefixed paths (`packages/core/src/foo.ts`), well-known root dirs (`docs/specs/foo.md`, `src/bar.ts`), and stand-alone files with known extensions (`README.md`, `package.json`, `tsconfig.json`). Strings matching the regex are deduplicated case-insensitively. Tokens inside Markdown code fences and inline backticks are still scanned (the regex doesn't honor backticks specifically).
- **Scope of the scan:** ONLY the `## Subtasks` section's body (extracted via the existing `findSection` helper from `scenarios.ts`). The scan does NOT walk other sections — Subtasks is the maintainer's authoring intent for "files this spec touches."
- **`factory spec lint --cwd <dir>` (existing flag from v0.0.7) does not change this lint's behavior.** The wide-blast-radius scan is path-pattern-based, not file-existence-based.
- **`agent-timeout-ms` in frontmatter does NOT suppress the wide-blast warning.** The maintainer who set the timeout is opting into the wider budget but should still see the warning so they (and reviewers) know the spec is unusual.
- **Lint warning message format (locked):**
  ```
  ${file}:${line}  warning  spec/wide-blast-radius  ## Subtasks references ${n} distinct file paths; specs touching >= 8 files commonly exceed the 600s implement-phase budget. Consider splitting or setting agent-timeout-ms in frontmatter.
  ```
  `${line}` points at the `## Subtasks` heading line (1-indexed).
- **Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.8's surface (29 names — unchanged).** The new field is field-level on `SpecFrontmatter`; the new lint code is internal logic in `lint.ts`. No new exports.
- **Coordinated package version bump deferred to spec 4** (`factory-spec-review-v0-0-9`'s chore subtask).
- **v0.0.9 explicitly does NOT ship in this spec:** auto-suppression of the warning when `agent-timeout-ms` is set; per-section blast-radius scans (only Subtasks); raised default `agent-timeout-ms` (still 600_000 globally — opt-in via frontmatter); custom thresholds via config (locked at 8).

## Subtasks

- **T1** [feature] — Add `'agent-timeout-ms'` field to `SpecFrontmatterSchema` in `packages/core/src/schema.ts`. ~5 LOC. **depends on nothing.**
- **T2** [feature] — Add wide-blast-radius scanner to `packages/core/src/lint.ts`: extract `## Subtasks` section via `findSection`, run the path-extraction regex, dedupe case-insensitively, emit `spec/wide-blast-radius` warning when count >= 8. ~50 LOC. **depends on nothing (parallel with T1).**
- **T3** [test] — `packages/core/src/schema.test.ts`: 3 tests covering S-1. `packages/core/src/parser.test.ts`: 1 test asserting `agent-timeout-ms` is exposed. `packages/core/src/lint.test.ts`: 4 tests covering S-2 + S-3 (warning fires, doesn't fire below threshold, fires regardless of timeout declaration, scanner edge cases). ~120 LOC. **depends on T1, T2.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.9 cluster (this spec + the cluster's other specs); the wide-blast-radius warning, if any spec triggers it, is informational not blocking.
- Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.8's 29 names.
- v0.0.9 explicitly does NOT ship in this spec: auto-suppression; runtime consumption (deferred to factory-runtime-v0-0-9); custom thresholds. Deferred per Constraints.

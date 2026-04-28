---
id: factory-core-v0-0-1
classification: deep
type: feat
status: ready
exemplars:
  - path: docs/SPEC_TEMPLATE.md
    why: Canonical spec format — the zod schema and parser must mirror this exactly and lint clean against it.
---

# factory-core-v0-0-1 — Bootstrap `@wifo/factory-core` with schema, parser, scenario reader, and lint CLI

## Intent

Implement v0.0.1 of `@wifo/factory-core`, the foundation package every later factory layer (`-harness`, `-twin`, `-runtime`) builds on. Deliver: a zod schema for spec frontmatter mirroring `docs/SPEC_TEMPLATE.md`, a line-aware markdown + YAML parser returning typed `Spec` entries, a Given/When/Then scenario parser, a `factory spec lint <path>` CLI that aggregates schema and scenario errors, plus a JSON Schema export (runtime function and build-time `dist/spec.schema.json`) for editor intellisense. Tests run on `bun test`.

## Scenarios

**S-1** — valid spec parses cleanly
  Given a markdown file with valid frontmatter and one well-formed scenario
  When `parseSpec(text)` is called
  Then it returns a `Spec` with frontmatter, body, scenarios populated, and holdouts empty
  Satisfaction:
    - test: `src/parser.test.ts` "parses a complete spec"

**S-2** — missing required frontmatter field surfaces line-accurate error
  Given a spec missing the `id` field
  When `lintSpec(text, 'docs/TASKS.md')` is called
  Then the returned errors include one with `code: 'frontmatter/missing-field'`, the field name in `message`, and a `line` pointing inside the YAML block
  Satisfaction:
    - test: `src/lint.test.ts` "reports missing frontmatter id"
    - judge: "error message names the field and is actionable without reading source"

**S-3** — scenario without `test:` satisfaction is flagged
  Given a scenario with Given/When/Then but no `- test:` line in its `Satisfaction:` block
  When `lintSpec` runs
  Then it returns a `scenario/missing-test` error with the scenario id (`S-1`) and the scenario's source line
  Satisfaction:
    - test: `src/lint.test.ts` "scenario without test satisfaction"
    - judge: "error message identifies the offending scenario id and is actionable"

**S-4** — JSON Schema reflects the zod schema
  Given the JSON Schema returned by `getFrontmatterJsonSchema()`
  When validated with Ajv against (a) a valid frontmatter and (b) a frontmatter missing `id`
  Then (a) passes and (b) fails with an error referencing `id`
  Satisfaction:
    - test: `src/json-schema.test.ts` "round-trips through Ajv"

**S-5** — CLI exits non-zero on broken spec, zero on clean spec
  Given fixture files `valid.md` and `broken.md`
  When `factory spec lint <path>` is run
  Then exit code is 0 for valid (stdout `OK`) and 1 for broken (stderr lists `file:line code message`)
  Satisfaction:
    - test: `src/cli.test.ts` "exit codes and output match expectations"
    - judge: "stderr output is grep-friendly and human-readable"

**S-6** — `docs/SPEC_TEMPLATE.md` lints clean against itself
  Given the in-repo `docs/SPEC_TEMPLATE.md`
  When linted
  Then no errors are reported (the canonical template must always be valid)
  Satisfaction:
    - test: `src/lint.test.ts` "SPEC_TEMPLATE.md is canonical"

## Holdout Scenarios

**H-1** — Windows line endings (CRLF)
  Given a spec saved with `\r\n` line endings
  When parsed
  Then frontmatter, scenarios, and line numbers are correct (CRLF counts as one line)

**H-2** — multi-line `Given` value
  Given a scenario where the `Given` clause spans two indented continuation lines
  When parsed
  Then `scenario.given` contains the joined text and `scenario.when` is not contaminated

**H-3** — empty `## Scenarios` section followed by another heading
  Given a spec with `## Scenarios` immediately followed by `## Constraints / Decisions`
  When parsed
  Then `parseSpec` returns `scenarios: []` and `lintSpec` warns rather than throws

## Constraints / Decisions

- Dependencies pinned: `yaml@^2.5`, `zod-to-json-schema@^3.23`. No other new runtime deps; `ajv` added as `devDependency` for the JSON Schema round-trip test.
- No markdown AST library; line-based parser only.
- CLI uses `node:util` `parseArgs` — no commander/yargs. Subcommand dispatch is handled manually on `argv[0]`/`argv[1]` (`factory spec lint`, `factory spec schema`); `parseArgs` consumes the remainder per subcommand.
- Frontmatter zod schema is `.strict()`. Unknown fields produce `frontmatter/unknown-field` **warning** (not error).
- JSON Schema source of truth is the runtime `getFrontmatterJsonSchema()`; build emits `dist/spec.schema.json` for editor intellisense.
- `lint <path>` recursively walks directories matching `*.md`.
- `parseSpec` throws `SpecParseError` only when the document is structurally unreadable (no closing `---`). All other issues become `LintError[]` via `lintSpec`.
- Line numbers in errors are 1-based and absolute to the source file.
- All type imports use `import type` (`verbatimModuleSyntax`); every array index access is guarded (`noUncheckedIndexedAccess`).

## Subtasks

- **T1** [config] — Add `yaml@^2.5` and `zod-to-json-schema@^3.23` to `packages/core/package.json`; create empty source files (`schema.ts`, `frontmatter.ts`, `parser.ts`, `scenarios.ts`, `lint.ts`, `json-schema.ts`, `cli.ts`). ~30 LOC.
- **T2** [feature] — `src/schema.ts`: zod `SpecFrontmatterSchema` (strict) mirroring `SPEC_TEMPLATE.md` frontmatter; exported types (`SpecFrontmatter`, `Scenario`, `ScenarioSatisfaction`, `Spec`). Tests: valid input, missing required field, invalid enum, exemplars default. **~120 LOC**.
- **T3** [feature] — `src/scenarios.ts`: parse Given/When/Then blocks + satisfaction lines for both `## Scenarios` and `## Holdout Scenarios` sections. Tests: single, multiple, multi-line values, holdouts, empty section. ~220 LOC.
- **T4** [feature] — `src/frontmatter.ts` + `src/parser.ts`: line-aware frontmatter splitter, body extraction, compose with schema (T2) and scenario parser (T3). Tests: valid, missing fences, malformed YAML, no frontmatter. **depends on T2, T3**. ~180 LOC.
- **T5** [feature] — `src/lint.ts`: aggregate schema + scenario errors into `LintError[]`. Rules: missing required frontmatter field, invalid enum, unknown frontmatter field (warning), scenario missing Given/When/Then, scenario missing `test:` satisfaction, malformed scenario marker. Tests cover each rule + the canonical `SPEC_TEMPLATE.md` fixture. **depends on T2, T4**. ~150 LOC.
- **T6** [feature] — `src/json-schema.ts`: wrap `zod-to-json-schema`, set `$id` and `title`. Snapshot test of generated shape; round-trip Ajv test on a sample frontmatter. **depends on T2**. ~40 LOC.
- **T7** [feature] — `src/cli.ts`: `factory spec lint <path>` (file or recursive `.md` directory) and `factory spec schema [--out]`. Test by spawning built file via `Bun.spawn` against fixtures; assert exit codes + stdout/stderr. **depends on T5, T6**. ~180 LOC.
- **T8** [feature] — `src/index.ts` public re-exports + build script that emits `dist/spec.schema.json`. End-to-end check: `pnpm build && node dist/cli.js spec lint docs/SPEC_TEMPLATE.md` exits 0. **depends on T2..T7**. ~30 LOC.

## Definition of Done

- All visible scenarios pass (tests green; judge criteria met).
- All holdout scenarios pass at end-of-task review.
- `pnpm -C packages/core typecheck` clean.
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/core test` green (`bun test`).
- `pnpm -C packages/core build` produces a working `dist/cli.js` and `dist/spec.schema.json`.
- `node packages/core/dist/cli.js spec lint docs/TASKS.md` exits 0. (`SPEC_TEMPLATE.md` is documentation that contains the format inside a code fence — it is not itself a spec, and the canonical-shape test lives in `src/lint.test.ts`.)
- `dist/` is git-ignored.
- Public API surface from `src/index.ts` matches the technical plan §2.

---
id: factory-core-v0-0-14-scaffold-day-zero
classification: light
type: fix
status: drafting
exemplars:
  - path: packages/core/src/init-templates.ts
    why: "scaffold templates. v0.0.14 fixes 2 day-zero frictions: (a) BIOME_JSON_TEMPLATE single-line `\"includes\": [\"**\"]` (Biome's lineWidth=100 rule rejects multi-line array); (b) ship a stub src/index.ts + src/index.test.ts so day-zero pnpm typecheck/test/check all pass."
  - path: packages/core/src/init.test.ts
    why: "regression-pin: scaffold a tmp dir; run pnpm typecheck && pnpm test && pnpm check; assert all three exit 0. v0.0.13's init-ergonomics spec promised this gate but didn't ship the test."
  - path: BACKLOG.md
    why: "v0.0.14 entries 'Scaffold biome.json fails own pnpm check' (#6) + 'Day-0 DoD gates fail on freshly-scaffolded tree' (#7). Closes 2 frictions in one spec."
depends-on:
  - factory-harness-v0-0-14-apostrophe-fix
---

# factory-core-v0-0-14-scaffold-day-zero — scaffold passes its own DoD gates on day zero

## Intent

v0.0.13's `factory-core-v0-0-13-init-ergonomics` spec promised "factory init scaffold passes pnpm check on first run" as a Definition of Done bullet but didn't ship the regression test that verifies it. The v0.0.13 BASELINE caught the gap: the scaffold's own `biome.json` fails biome's lineWidth=100 rule (multi-line `"includes"` array trips on biome's own format check) AND `pnpm typecheck` / `pnpm test` fail on an empty `src/` (only `.gitkeep`).

v0.0.14 closes both:
1. Single-line `BIOME_JSON_TEMPLATE` arrays (biome's preferred format).
2. Ship a stub `src/index.ts` (one export) + `src/index.test.ts` (one test) so all three day-zero DoD gates pass.

The agent overwrites the stubs on first feature scope; they're harmless placeholders that prove the scaffold can pass its own claims.

## Scenarios

**S-1** — Scaffold's `biome.json` passes its own `pnpm check` on day zero
  Given `factory init --name my-app` is invoked in a fresh tmp dir
  When the scaffold completes
  Then the resulting `biome.json` uses single-line array values for `files.includes` (and any other short array). Specifically: `"includes": ["**"]` (or whatever value, but on a single line). Running `pnpm check` against the scaffold exits 0 — biome's lineWidth=100 rule does not trip on the template's own format.
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "BIOME_JSON_TEMPLATE files.includes is single-line"
    - test: packages/core/src/init.test.ts "scaffold passes pnpm check on day zero (biome single-line includes)"

**S-2** — Scaffold ships stub `src/index.ts` + `src/index.test.ts`; day-zero DoD gates pass
  Given `factory init --name my-app` in a fresh tmp dir
  When the scaffold completes
  Then `src/index.ts` exists with content `export const VERSION = '0.0.0';\n` (or equivalent — small, real, valid TS). `src/index.test.ts` exists with `import { test, expect } from 'bun:test';\nimport { VERSION } from './index.js';\ntest('VERSION exists', () => expect(VERSION).toBe('0.0.0'));\n`.
  And running each day-zero DoD gate against the scaffold exits 0:
  - `pnpm typecheck` — tsc finds src/index.ts; no errors.
  - `pnpm test` — bun finds src/index.test.ts; 1 pass.
  - `pnpm check` — biome formats clean (S-1).
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "INDEX_TS_TEMPLATE + INDEX_TEST_TEMPLATE exist with expected content"
    - test: packages/core/src/init.test.ts "scaffold day-zero pnpm typecheck && pnpm test && pnpm check all exit 0"

**S-3** — Scaffold stubs survive being overwritten by the first feature scope
  Given a scaffold has been initialized AND the user (or scope-project) replaces `src/index.ts` with feature code
  When the new content is written
  Then the original stub `INDEX_TS_TEMPLATE` was small enough to be replaced trivially (no leftover comments, no required content). The stub is `export const VERSION = '0.0.0';\n` — a one-liner. Removing or replacing it is mechanical.
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "INDEX_TS_TEMPLATE is a single export line under 50 bytes"

## Constraints / Decisions

- **`BIOME_JSON_TEMPLATE` shape (locked):** all array values are single-line when at most 1-2 elements. Specifically `files.includes` becomes `["**"]` (single-line). Multi-line is reserved for arrays with 3+ elements where readability beats line-width. Biome's lineWidth=100 default tolerates ~80 chars of array content on one line.
- **Stub file content (locked):**
  - `src/index.ts`: `export const VERSION = '0.0.0';\n` (one line, 30 bytes).
  - `src/index.test.ts`: 4 lines (import, import, test, blank). ~120 bytes.
- **Scaffolded `.gitkeep` is dropped from `src/`.** The two stub files replace it (the dir is no longer empty). `.gitkeep` stays in `docs/specs/`, `docs/specs/done/`, `docs/technical-plans/done/`, etc.
- **Day-zero regression test (locked):** `packages/core/src/init.test.ts` gains a test that scaffolds a tmp dir, runs each DoD gate (`pnpm typecheck && pnpm test && pnpm check`), and asserts all three exit 0. The test uses bun's child_process spawn (or equivalent) and skips if `pnpm` isn't on PATH — graceful degradation in environments without pnpm.
- **No public API surface change in `@wifo/factory-core`.** Both fixes are template-content + new test. Public exports stay at 34 (or 35 with v0.0.14's `resolveContextDir`).
- **References v0.0.14 cross-cutting Constraints from `factory-harness-v0-0-14-apostrophe-fix`** for cluster ordering and ship flags.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.14 explicitly does NOT ship in this spec:** parameterizing the stub content (deferred — single canonical shape is fine); a "scaffold-passes-DoD" gate in `factory init` itself (deferred — runtime test is enough); `--no-stub` flag (out of scope).

## Subtasks

- **T1** [fix] — Update `packages/core/src/init-templates.ts`'s `BIOME_JSON_TEMPLATE`: change `"files": { "includes": [\n  "**"\n] }` to `"files": { "includes": ["**"] }` (single-line array). Verify other array fields are also single-line if short. ~5 LOC. **depends on nothing.**
- **T2** [feature] — Add `INDEX_TS_TEMPLATE` and `INDEX_TEST_TEMPLATE` constants in `packages/core/src/init-templates.ts`. Update `init.ts` to write them at scaffold time (replacing the `src/.gitkeep` write). ~25 LOC. **depends on nothing.**
- **T3** [test] — `packages/core/src/init-templates.test.ts`: 3 tests for S-1 (biome single-line) + S-2 (templates exist) + S-3 (stub size limit). `packages/core/src/init.test.ts`: 1 day-zero DoD regression test (S-2 — scaffolds tmp + runs all 3 gates). ~80 LOC. **depends on T1, T2.**
- **T4** [chore] — Update `packages/core/README.md`: brief note on the v0.0.14 day-zero scaffold polish. ~15 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.14 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/core build`).
- A regression-pin: scaffold a tmp dir, run `pnpm typecheck && pnpm test && pnpm check`, all three exit 0.
- The biome single-line rule is verified by both unit test (template content) and integration test (running biome against the scaffold).
- The stub `src/index.ts` is small enough to be overwritten without ceremony (under 50 bytes; one export line).
- Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.13's count (34, or 35 if `resolveContextDir` from spec E lands first).
- README in `packages/core/` documents v0.0.14 day-zero scaffold polish.
- v0.0.14 explicitly does NOT ship in this spec: parameterized stub content; built-in `factory init` self-test; `--no-stub` flag. Deferred per Constraints.

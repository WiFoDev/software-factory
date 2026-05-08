---
id: factory-cli-context-dir-default-v0-0-14
classification: light
type: fix
status: drafting
exemplars:
  - path: packages/core/src/cli.ts
    why: "factory finish-task defaults --context-dir to ./context. Should be ./.factory (the directory factory init creates) AND auto-detect from factory.config.json runtime.contextDir."
  - path: packages/context/src/cli.ts
    why: "factory-context defaults --dir to ./context (with --context-dir as a v0.0.10 synonym). Same fix — universal default to ./.factory."
  - path: BACKLOG.md
    why: "v0.0.14 entry '--context-dir default differs across factory-runtime / factory finish-task / factory-context'. The dogfooder hit this in the v0.0.13 BASELINE."
depends-on:
  - factory-harness-v0-0-14-apostrophe-fix
---

# factory-cli-context-dir-default-v0-0-14 — universal `./.factory` default + auto-detect from `factory.config.json`

## Intent

Three CLIs that read the same context store have three different defaults: `factory-runtime` defaults to `./.factory`, `factory finish-task` defaults to `./context`, `factory-context` defaults to `./context`. Forgetting `--context-dir ./.factory` silently looks in the wrong directory and reports "no factory-sequence found" — the records exist; the lookup just doesn't see them.

v0.0.14 picks `./.factory` as the universal default (the directory `factory init` actually creates) AND adds auto-detect from `factory.config.json runtime.contextDir` if present. Per-CLI override via `--context-dir` still works; precedence: CLI flag > config > universal default `./.factory`.

The change is breaking for users who rely on the old `./context` default. Document it in CHANGELOG; the migration is one flag added per invocation.

## Scenarios

**S-1** — `factory finish-task` defaults to `./.factory` (was `./context`)
  Given a tmp dir with `.factory/` containing context records, NO `./context/` directory, AND no `factory.config.json`
  When `factory finish-task my-spec` is invoked WITHOUT `--context-dir`
  Then the command resolves the context dir to `./.factory` (the universal default), reads records from there, and finds the converged factory-run for `my-spec`. Exit code 0.
  And given the same setup but with `factory.config.json` declaring `runtime.contextDir: "./custom-records"`, the resolved dir is `./custom-records` (config wins over universal default).
  And given the maintainer passes `--context-dir ./elsewhere` AND config has `runtime.contextDir: "./custom-records"`, the CLI flag wins → resolved dir is `./elsewhere`.
  Satisfaction:
    - test: packages/core/src/finish-task.test.ts "factory finish-task default --context-dir resolves to ./.factory"
    - test: packages/core/src/finish-task.test.ts "factory.config.json runtime.contextDir wins over universal default"
    - test: packages/core/src/finish-task.test.ts "--context-dir CLI flag wins over factory.config.json"

**S-2** — `factory-context tree/list/get` default also resolves to `./.factory`
  Given a tmp dir with `.factory/` containing context records AND no `./context/` directory
  When `factory-context list` is invoked WITHOUT `--dir` / `--context-dir`
  Then the command resolves to `./.factory` (was `./context` in v0.0.13). Lists records from there. The same precedence chain applies (CLI flag > config > universal default).
  And given a `--dir ./elsewhere` flag (the v0.0.10 deprecated alias for `--context-dir`), it still works (the alias is preserved).
  Satisfaction:
    - test: packages/context/src/cli.test.ts "factory-context default --context-dir resolves to ./.factory"
    - test: packages/context/src/cli.test.ts "--dir alias from v0.0.10 still works"

**S-3** — Resolution helper is shared / consistent across CLIs
  Given a `resolveContextDir({ cliFlag?: string, configValue?: string }): string` helper
  When called with various input combinations
  Then it returns:
  - CLI flag value if defined (highest precedence)
  - Else config value if defined
  - Else `./.factory` (universal default)
  All three CLIs (factory-runtime, factory-core finish-task, factory-context) call the same helper. Used in tests via direct invocation.
  Satisfaction:
    - test: packages/core/src/cli.test.ts "resolveContextDir precedence: CLI flag > config > universal default"

## Constraints / Decisions

- **Universal default (locked):** `./.factory`. Matches the directory `factory init` creates. The change is breaking for users who relied on the old `./context` default — document in CHANGELOG.
- **Precedence chain (locked):** CLI flag (`--context-dir <path>`) > `factory.config.json runtime.contextDir` > universal default `./.factory`.
- **`resolveContextDir` helper location (locked):** `packages/core/src/finish-task.ts` (or a new `context-dir.ts` for testability). Pure function with no side effects. Exported from `packages/core/src/index.ts` so factory-context and factory-runtime can import it consistently. ~15 LOC.
- **`factory.config.json` reading:** the helper reads `runtime.contextDir` (existing field; v0.0.6+ schema). Reads from `<cwd>/factory.config.json` if exists; silently no-ops on missing/malformed. Existing config-loader pattern (used by factory-runtime for other config keys).
- **`--dir` alias preservation:** `factory-context` retains its v0.0.10 `--dir` flag as a deprecated alias for `--context-dir` (no removal in v0.0.14; deprecation arc started in v0.0.10).
- **No `--legacy-context-dir-default` flag.** The breaking change is documented; migration is trivial (add `--context-dir ./context` to invocations that need the old behavior). Adding a flag for a one-release deprecation arc is overkill.
- **Public API surface delta in `@wifo/factory-core`:** `resolveContextDir` exported. 34 → 35 (+1).
- **References v0.0.14 cross-cutting Constraints from `factory-harness-v0-0-14-apostrophe-fix`** for cluster ordering and ship flags.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.14 explicitly does NOT ship in this spec:** auto-creating `./.factory` if missing (factory init does this; runtime tolerates absence); a `--legacy-context-dir-default` flag (rejected — see above); per-subcommand context-dir defaults (universal is the goal).

## Subtasks

- **T1** [feature] — Add `resolveContextDir({ cliFlag?, configValue? })` helper in `packages/core/src/finish-task.ts` (or new `context-dir.ts`). Pure function. Export from `packages/core/src/index.ts`. ~15 LOC. **depends on nothing.**
- **T2** [fix] — Update `packages/core/src/cli.ts`'s `runFinishTask` to call `resolveContextDir` (was hard-coded to `./context`). Read config via existing factory-runtime config-loader pattern OR a small inline reader. ~15 LOC. **depends on T1.**
- **T3** [fix] — Update `packages/context/src/cli.ts`'s default-handler to call `resolveContextDir`. Preserve the `--dir` v0.0.10 alias. ~15 LOC. **depends on T1.**
- **T4** [test] — `packages/core/src/cli.test.ts` covers S-1 + S-3 (4 tests). `packages/context/src/cli.test.ts` covers S-2 (2 tests). ~80 LOC. **depends on T1-T3.**
- **T5** [chore] — Update READMEs (core + context + top-level) + CHANGELOG: document the v0.0.14 universal default + the breaking change for `./context` users. ~30 LOC. **depends on T4.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck` and `pnpm -C packages/context typecheck`).
- tests green (`pnpm -C packages/core test` and `pnpm -C packages/context test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.14 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/core build` and `pnpm -C packages/context build`).
- A regression-pin verifies the precedence chain (CLI flag > config > universal default).
- The `--dir` v0.0.10 alias on factory-context still works.
- Public API surface delta: factory-core 34 → 35 (`+resolveContextDir`); factory-context unchanged in count.
- READMEs document the universal default + the breaking change.
- v0.0.14 explicitly does NOT ship in this spec: `--legacy-context-dir-default` flag; per-subcommand defaults; auto-create `./.factory`. Deferred per Constraints.

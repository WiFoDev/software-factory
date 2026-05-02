---
id: factory-core-v0-0-5-1
classification: light
type: fix
status: ready
exemplars:
  - path: packages/core/src/init-templates.ts
    why: "PACKAGE_JSON_TEMPLATE + GITIGNORE_TEMPLATE + README_TEMPLATE. v0.0.5.1 adds `@wifo/factory-spec-review` to devDependencies, `.factory-spec-review-cache` to GITIGNORE_TEMPLATE, and a new `FACTORY_CONFIG_TEMPLATE` const."
  - path: packages/core/src/init.ts
    why: "the planFiles function. v0.0.5.1 adds factory.config.json to the planned-files list."
  - path: packages/core/src/init.test.ts
    why: "init test patterns. v0.0.5.1 adds 3 tests asserting all 3 sub-issues are fixed."
  - path: packages/runtime/src/cli.ts
    why: "the runtime CLI. v0.0.5.1 adds an OPTIONAL config-file read (factory.config.json from cwd) that supplies defaults for max-iterations / max-total-tokens / no-judge / max-prompt-tokens. CLI flags always override."
  - path: BASELINE.md
    why: "the v0.0.5 URL-shortener entry's friction #2 + surprises section frame WHY this matters: real first-contact pain on a fresh `factory init`, surfaced by a real product run."
---

# factory-core-v0-0-5-1 — `factory init` first-contact UX gaps

## Intent

Three sub-issues surfaced by the v0.0.5 URL-shortener BASELINE run when a fresh user invokes `factory init` and immediately tries to run the canonical workflow:

1. **`@wifo/factory-spec-review` is not in scaffolded devDependencies.** Invoking `factory spec review` fails with `spec/review-unavailable` because the dispatch's `findPackageRoot` walk doesn't find the package — `pnpm install` never fetched it.
2. **`.factory-spec-review-cache` is not in `GITIGNORE_TEMPLATE`.** After the first `factory spec review` run, the cache shows up in `git status`. Maintainer adds the line by hand (or accidentally commits cache hashes).
3. **No `factory.config.json` defaults file.** Canonical run flags (`--max-iterations 5`, `--max-total-tokens 1_000_000`, `--no-judge`, `--max-prompt-tokens 100_000`) are documented but not codified. The user types the same flags every invocation.

Fix: 3-line changes to `init-templates.ts` for #1 and #2; new `FACTORY_CONFIG_TEMPLATE` const + emit it from `planFiles`; new optional config-file read in `packages/runtime/src/cli.ts` (CLI flag > config file > built-in default precedence). All three sub-issues land together because they share the same first-contact UX surface.

## Scenarios

**S-1** — `factory init` scaffold includes `@wifo/factory-spec-review` in devDependencies
  Given a fresh empty cwd
  When `factory init --name test` is invoked
  Then `<cwd>/package.json`'s `devDependencies` contains `"@wifo/factory-spec-review": "^0.0.5"` alongside the existing entries
  Satisfaction:
    - test: src/init.test.ts "scaffold devDependencies include @wifo/factory-spec-review at ^0.0.5"

**S-2** — `.factory-spec-review-cache` is in the scaffold .gitignore
  Given a fresh `factory init` scaffold
  When `<cwd>/.gitignore` is read
  Then it contains the line `.factory-spec-review-cache` (alongside the existing `node_modules`, `.factory`, `*.log`, `.DS_Store` entries)
  Satisfaction:
    - test: src/init.test.ts "scaffold gitignore includes .factory-spec-review-cache"

**S-3** — `factory init` writes `factory.config.json` with documented defaults
  Given a fresh `factory init` invocation
  When the scaffold completes
  Then `<cwd>/factory.config.json` exists and parses to `{ "runtime": { "maxIterations": 5, "maxTotalTokens": 1000000, "maxPromptTokens": 100000, "noJudge": false } }` (canonical defaults; users edit to taste)
  Satisfaction:
    - test: src/init.test.ts "scaffold writes factory.config.json with documented defaults"

**S-4** — `factory-runtime run` reads `factory.config.json` from cwd; CLI flags override
  Given a cwd containing `factory.config.json` with `{ "runtime": { "maxIterations": 3 } }`
  When `factory-runtime run <spec> --no-judge --no-implement --context-dir <tmp>` is invoked (no `--max-iterations` flag)
  Then `RunReport.maxIterations === 3` (resolved from config) — NOT the built-in default of 5
  And given the same setup but `--max-iterations 7` flag added, `RunReport.maxIterations === 7` (CLI overrides config)
  And given a cwd WITHOUT `factory.config.json`, `RunReport.maxIterations === 5` (built-in default unchanged — config is OPTIONAL)
  Satisfaction:
    - test: packages/runtime/src/cli.test.ts "factory.config.json defaults are honored when CLI flag absent; CLI flag overrides config"
    - test: packages/runtime/src/cli.test.ts "absent factory.config.json leaves built-in defaults intact"

## Constraints / Decisions

- New `FACTORY_CONFIG_TEMPLATE` const in `packages/core/src/init-templates.ts`. Shape: `{ runtime: { maxIterations: 5, maxTotalTokens: 1000000, maxPromptTokens: 100000, noJudge: false } }`. JSON-serialized with 2-space indent.
- `planFiles` in `packages/core/src/init.ts` adds `{ relPath: 'factory.config.json', contents: JSON.stringify(FACTORY_CONFIG_TEMPLATE, null, 2) + '\n' }`.
- `PACKAGE_JSON_TEMPLATE.devDependencies` adds `'@wifo/factory-spec-review': '^0.0.5'` alongside `@types/bun`. The spec-review's `findPackageRoot` dispatch then resolves cleanly without manual install.
- `GITIGNORE_TEMPLATE` adds `.factory-spec-review-cache` as a new line at the bottom (after `.DS_Store`).
- `packages/runtime/src/cli.ts` reads `<cwd>/factory.config.json` if present; values under `config.runtime` apply as defaults to the matching options. Precedence: CLI flag > config file value > built-in default. If the file is absent, malformed, or doesn't have a `runtime` key, the built-in defaults apply silently (no warning — config is OPTIONAL by design).
- Config-read schema validation uses Zod with `.partial()` so users can specify any subset of the runtime keys. Unknown keys are ignored (forward-compatible — v0.0.6's `/scope-project` may add new sections).
- Public API surface unchanged across both packages. `FACTORY_CONFIG_TEMPLATE` is internal-only (NOT exported from `core/src/index.ts`). The runtime config-read is internal helper logic in `cli.ts` — no new RunOptions field, no new export from `runtime/src/index.ts`.
- `packages/core/package.json` and `packages/runtime/package.json` both bump to `0.0.5.1`.

## Subtasks

- **T1** [fix] — `packages/core/src/init-templates.ts`: add `@wifo/factory-spec-review: ^0.0.5` to PACKAGE_JSON_TEMPLATE.devDependencies; add `.factory-spec-review-cache\n` line to GITIGNORE_TEMPLATE; new `FACTORY_CONFIG_TEMPLATE` const. ~15 LOC. **depends on nothing.**
- **T2** [feature] — `packages/core/src/init.ts`: add factory.config.json to `planFiles`. ~5 LOC. **depends on T1.**
- **T3** [feature] — `packages/runtime/src/cli.ts`: read optional `<cwd>/factory.config.json`; merge into options as defaults (CLI flag > config > built-in). Internal helper function `readFactoryConfig(cwd: string): { runtime?: Partial<RunOptions> } | null`. Validate with Zod schema; absent/malformed → return null silently. ~50 LOC. **depends on nothing (parallel with T1).**
- **T4** [test] — `packages/core/src/init.test.ts`: add 3 tests covering S-1, S-2, S-3. `packages/runtime/src/cli.test.ts`: add 2 tests covering S-4. ~80 LOC across both files. **depends on T1, T2, T3.**
- **T5** [chore] — Bump both `packages/core/package.json` and `packages/runtime/package.json` to `0.0.5.1`. Document `factory.config.json` shape + precedence in `packages/core/README.md` (one short section). ~30 LOC. **depends on T1..T4.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/core typecheck` + `pnpm -C packages/runtime typecheck` clean.
- `pnpm test` workspace-wide green.
- `pnpm check` clean.
- Public API surfaces from `@wifo/factory-core/src/index.ts` (27 names) and `@wifo/factory-runtime/src/index.ts` (19 names) are **strictly equal** to v0.0.5.
- A fresh `factory init` produces all three new artifacts: spec-review devDep, cache gitignore line, factory.config.json with documented defaults.
- `packages/core/package.json` and `packages/runtime/package.json` both at `0.0.5.1`.

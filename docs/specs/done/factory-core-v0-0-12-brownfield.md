---
id: factory-core-v0-0-12-brownfield
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/core/src/init.ts
    why: "factory init scaffold logic. Today exits 2 if package.json/tsconfig.json/biome.json already exist. v0.0.12 adds `--adopt` mode that walks the same template plan, skips files that already exist (logs the skip), and only creates factory-specific bits — closes the brownfield-adopter onramp friction surfaced in CORE-836 (image #7)."
  - path: packages/core/src/cli.ts
    why: "core CLI dispatcher. v0.0.12 adds two changes: (a) `factory finish-task <spec-id>` subcommand that moves a converged spec from <dir>/<id>.md to <dir>/done/<id>.md and emits a `factory-spec-shipped` context record; (b) drops the lazy `spec/review-unavailable` error path — `@wifo/factory-spec-review` becomes a hard dep of `@wifo/factory-core`."
  - path: packages/core/package.json
    why: "package.json. v0.0.12 moves @wifo/factory-spec-review from optionalDependencies (or absence) to dependencies — single install brings everything; npx -p factory-core suffices for `factory spec review` to resolve."
  - path: packages/runtime/src/runtime.ts
    why: "post-convergence behavior. v0.0.12 emits a 'to ship: run `factory finish-task <id>`' hint on convergence (read-only — does NOT mutate the working tree). Pairs the hint with the new core subcommand."
  - path: BACKLOG.md
    why: "v0.0.12 entries 'factory init --adopt for existing repos' (CORE-836 friction), 'factory spec review resolution: bundle as hard dep OR walk parent dirs' (CORE-836 friction), 'Spec auto-moves to done/ post-convergence' (CORE-836 friction). All three close in this spec."
depends-on:
  - factory-core-v0-0-12-dod-literal
---

# factory-core-v0-0-12-brownfield — make factory adoptable in existing repos

## Intent

The CORE-836 OLH dogfood revealed three brownfield-adopter frictions: (1) `factory init` exits 2 on conflict with existing `package.json`/`tsconfig.json`/`biome.json` — refusing to overwrite, but blocking adoption in any non-greenfield repo; (2) `factory spec review` errors with `spec/review-unavailable` even when both `@wifo/factory-core` and `@wifo/factory-spec-review` are passed via `npx -p` because the dispatcher's `require.resolve` walks `factory-core`'s own `node_modules`, not the npx scope; (3) when a spec converges, no automated path moves it to `<dir>/done/` — the maintainer hand-runs `git mv` every time. v0.0.12 closes all three: `factory init --adopt` for safe additive scaffold; hard-dep `@wifo/factory-spec-review` so `factory spec review` Just Works; `factory finish-task <id>` CLI subcommand for the lifecycle move; runtime emits a hint on convergence.

## Scenarios

**S-1** — `factory init --adopt` skips existing files; creates only factory-specific bits
  Given a tmp dir containing `package.json` (with custom name + scripts), `tsconfig.json`, `biome.json` (all pre-existing) AND no `docs/specs/` AND no `.factory-spec-review-cache` in `.gitignore`
  When `factory init --adopt --name custom-name` is invoked in that dir
  Then the command exits 0. Stdout lists each skipped file: `skip: package.json (already present)`, `skip: tsconfig.json (already present)`, `skip: biome.json (already present)`. The factory-specific bits ARE created: `docs/specs/` (empty + `done/` subdir), `docs/technical-plans/` (empty + `done/` subdir), `factory.config.json` (with documented defaults), `.gitignore` is appended (not overwritten) with `.factory/` and `.factory-spec-review-cache` if missing, `.claude/commands/scope-project.md` is created. The pre-existing `package.json`/`tsconfig.json`/`biome.json` are NOT mutated. Pre-existing `.gitignore` is preserved + appended (not overwritten).
  And given the dir already contains `docs/specs/` (e.g., factory was partially adopted earlier), the directory is skipped (logged) and the `done/` subdir is created if missing.
  Satisfaction:
    - test: packages/core/src/init.test.ts "factory init --adopt skips existing package.json/tsconfig.json/biome.json and logs skips"
    - test: packages/core/src/init.test.ts "factory init --adopt creates docs/specs/, docs/technical-plans/, factory.config.json, scope-project.md zero-config"
    - test: packages/core/src/init.test.ts "factory init --adopt preserves existing .gitignore and appends factory entries if missing"

**S-2** — `factory spec review` resolves zero-config via `npx @wifo/factory-core`
  Given a tmp dir with NO `node_modules` (fresh) AND a valid spec at `docs/specs/foo.md`
  When `npx -p @wifo/factory-core factory spec review docs/specs/foo.md` is invoked
  Then `@wifo/factory-spec-review` resolves successfully (it's a hard dep of `@wifo/factory-core` — single install brings both). The reviewer runs and produces output. NO `spec/review-unavailable` error. The dispatcher in `packages/core/src/cli.ts` no longer has a lazy-resolution code path for `factory-spec-review`.
  Satisfaction:
    - test: packages/core/src/cli.test.ts "factory spec review resolves @wifo/factory-spec-review without optional-dep fallback"
    - test: packages/core/src/cli.test.ts "factory-core's package.json declares @wifo/factory-spec-review in dependencies (not optionalDependencies)"

**S-3** — `factory finish-task <spec-id>` moves a converged spec to done/ + emits provenance record
  Given a context dir containing a converged `factory-run` for spec id `core-store-and-slug` AND a tmp `<dir>` with `<dir>/core-store-and-slug.md` (the spec at the original path)
  When `factory finish-task core-store-and-slug --dir <dir> --context-dir <ctx>` is invoked
  Then the command exits 0. The spec file is moved from `<dir>/core-store-and-slug.md` to `<dir>/done/core-store-and-slug.md` (creating `done/` if missing). A new `factory-spec-shipped` context record is persisted with `parents: [<runId-of-the-converged-factory-run>]` and `payload: { specId: 'core-store-and-slug', shippedAt: <isoTimestamp>, fromPath: '<dir>/core-store-and-slug.md', toPath: '<dir>/done/core-store-and-slug.md' }`. Stdout: `factory: shipped core-store-and-slug → <dir>/done/core-store-and-slug.md (run <runId-short>)`.
  And given the spec id is unknown (no `factory-run` found for that id), the command exits 1 with stderr `factory: no converged factory-run found for spec id <spec-id>; refusing to move`.
  And given the runtime emits a post-convergence hint: when `factory-runtime run` (or `run-sequence`) terminates a spec with `status: 'converged'`, stdout (NOT stderr — script-friendly) gains one line: `factory-runtime: <spec-id> converged → ship via 'factory finish-task <spec-id>'`.
  Satisfaction:
    - test: packages/core/src/cli.test.ts "factory finish-task <id> moves spec file to done/ and emits factory-spec-shipped record"
    - test: packages/core/src/cli.test.ts "factory finish-task refuses to move when no converged factory-run exists"
    - test: packages/runtime/src/runtime.test.ts "post-convergence stdout hint references factory finish-task <spec-id>"

## Constraints / Decisions

- **`--adopt` IGNORE_IF_PRESENT set (locked):** `package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `.gitignore` (appended, not overwritten), `README.md`. The set lives in `packages/core/src/init.ts` as a constant for easy extension.
- **`--adopt` does NOT mutate the host's `package.json`.** Adding factory devDeps (`@wifo/factory-core` + `@wifo/factory-spec-review` + `typescript` etc) is the maintainer's responsibility. A future v0.0.13 candidate adds `--write-deps` for opt-in. Minimal-blast-radius first.
- **`@wifo/factory-spec-review` is a hard dep of `@wifo/factory-core`.** Move from optionalDependencies (or absence — check current state) to `dependencies`. Drop the `spec/review-unavailable` error path; `dynamic import` of `@wifo/factory-spec-review` becomes a static import or a hard-dep require. Slight install-size bump; correctness gain large.
- **`factory finish-task` does NOT auto-fire from the runtime.** Move-to-done is a ship action — same risk surface as `git push`; v0.0.12 keeps it as an explicit CLI subcommand. The runtime's post-convergence hint surfaces the action; the maintainer (or a future hook) executes it.
- **`factory-spec-shipped` record schema (locked):** `{ type: 'factory-spec-shipped', payload: { specId: string, shippedAt: string-iso, fromPath: string, toPath: string }, parents: [factoryRunId] }`. New record type; small addition to `@wifo/factory-context`'s known-types list (or add as opaque type — context store is content-addressable + permissive).
- **CLI subcommand surface delta in `@wifo/factory-core`:** `factory finish-task <spec-id>` ships as a new export from `packages/core/src/cli.ts`'s subcommand registry. Counted as +1 to the public CLI surface (not the API export count which stays at 33).
- **Public API export count from `@wifo/factory-core/src/index.ts`** — TBD: if the new subcommand needs library-level exports (e.g., `finishTask` function for programmatic use), +1; if purely CLI, unchanged. Lean toward exporting `finishTask({ specId, dir, contextDir }): Promise<{ shippedRecordId, fromPath, toPath }>` for programmatic reuse; +1 to surface count.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.12 explicitly does NOT ship in this spec:** `factory init --merge` (active JSON merging — deferred); `factory init --dry-run` (orthogonal preview mode — deferred to v0.0.13); auto-flip of `status: drafting → ready` on disk (in-memory only per v0.0.11); `--write-deps` for adopt-mode dependency injection (deferred).

## Subtasks

- **T1** [feature] — Add `factory init --adopt` mode in `packages/core/src/init.ts`. New `IGNORE_IF_PRESENT` set. New `appendToGitignore` helper. `init({ adopt: true })` walks the template plan with skips; logs each skip. ~80 LOC. **depends on nothing.**
- **T2** [chore] — Move `@wifo/factory-spec-review` to `dependencies` in `packages/core/package.json` (workspace + published). Drop the lazy-resolve / `spec/review-unavailable` error path in `packages/core/src/cli.ts`'s spec-review dispatcher. ~20 LOC. **depends on nothing.**
- **T3** [feature] — New `factory finish-task <spec-id>` CLI subcommand in `packages/core/src/cli.ts`. Library helper `finishTask({ specId, dir, contextDir })` exported from `packages/core/src/index.ts`. New `factory-spec-shipped` record type emitted via `contextStore.write`. ~80 LOC. **depends on T2.**
- **T4** [feature] — Runtime post-convergence hint: `packages/runtime/src/runtime.ts` (and `sequence.ts` for the per-spec-converged path) emits `factory-runtime: <spec-id> converged → ship via 'factory finish-task <spec-id>'` to stdout when a spec converges. ~15 LOC. **depends on T3.**
- **T5** [test] — `packages/core/src/init.test.ts`: 3 tests covering S-1. `packages/core/src/cli.test.ts`: 3 tests covering S-2 + S-3 (review-resolves, finish-task moves, finish-task refuses). `packages/runtime/src/runtime.test.ts`: 1 test for the hint. ~140 LOC. **depends on T1-T4.**
- **T6** [chore] — Update `packages/core/README.md` (`init --adopt` + `finish-task`) and `packages/runtime/README.md` (post-convergence hint). ~30 LOC. **depends on T5.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck` and `pnpm -C packages/runtime typecheck`).
- tests green (`pnpm -C packages/core test` and `pnpm -C packages/runtime test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.12 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/core build` and `pnpm -C packages/runtime build`).
- A test verifies that `factory init --adopt` is idempotent (run twice → no duplicate appends to .gitignore; no error).
- A test verifies that `factory spec review` resolves successfully via `npx -p @wifo/factory-core` without needing to also pass `-p @wifo/factory-spec-review`.
- A test verifies that `factory finish-task` refuses to move a spec when no converged factory-run exists for it.
- Public API surface delta: `@wifo/factory-core` +1 (`finishTask` function) → 34 names; `@wifo/factory-core` package.json gains `@wifo/factory-spec-review` in `dependencies`. `@wifo/factory-runtime` strictly equal to v0.0.11's 26 names.
- v0.0.12 explicitly does NOT ship in this spec: `--merge` mode; `--dry-run` mode; auto-flip status on disk; `--write-deps`. Deferred per Constraints.

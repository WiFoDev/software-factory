# Changelog

All notable changes to the `@wifo/factory-*` workspace are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows pre-1.0 semantics — point releases (v0.0.X) may break public APIs as the surface stabilizes.

For the project's forward direction and shipped-release retrospectives, see [`ROADMAP.md`](./ROADMAP.md). For the candidate pile of post-v0.0.X work, see [`BACKLOG.md`](./BACKLOG.md).

---

## [0.0.7] — 2026-05-02

**Theme: real-product workflow.** Three deliverables that together collapse the multi-spec-product friction quantified in the v0.0.6 BASELINE run (32 manual interventions per 4-spec product → ~8): a `/scope-project` slash command, a `depends-on` frontmatter field, and a `factory-runtime run-sequence` CLI subcommand. The maintainer now decomposes one product description with one slash command and ships the resulting spec set with one `run-sequence` invocation; provenance threads the entire product DAG under one `factory-sequence` record.

### Added

- **`/scope-project` slash command** *(docs/commands/)*. New canonical source at `docs/commands/scope-project.md` (in-repo). Takes a natural-language product description and writes 4-6 LIGHT specs in dependency order under `docs/specs/<id>.md`. First spec ships `status: ready`; rest ship `status: drafting`. Each spec populates the new `depends-on:` frontmatter field. Worked example: `docs/baselines/scope-project-fixtures/url-shortener/`. Install via `cp docs/commands/scope-project.md ~/.claude/commands/scope-project.md`.
- **`depends-on: [<id>, ...]` frontmatter field** *(factory-core)*. Optional array on `SpecFrontmatter`. Defaults to `[]`. `factory spec lint` validates each entry against the new `KEBAB_ID_REGEX = /^[a-z][a-z0-9-]*$/` and (with `--cwd <dir>`) checks that each declared dep file exists under `docs/specs/` or `docs/specs/done/`. Two new lint codes: `spec/invalid-depends-on` (error), `spec/depends-on-missing` (warning).
- **`lintSpecFile(filePath, opts?)` helper export** *(factory-core)*. Wraps `readFileSync` + `lintSpec` with a `cwd` defaulted to `<file>/../..`. CLI uses this; programmatic callers can keep using `lintSpec` directly.
- **`KEBAB_ID_REGEX` constant export** *(factory-core)*. Canonical kebab-case spec id pattern.
- **`cross-doc-consistency` judge reads declared deps** *(factory-spec-review)*. Judge `applies()` returns true when `hasTechnicalPlan || depsCount > 0`. New `JudgeApplicabilityCtx.depsCount`, `JudgePromptCtx.deps?: ReadonlyArray<{id, body}>`, `RunReviewOptions.deps?`. CLI auto-loads each declared dep from `docs/specs/<id>.md` or `docs/specs/done/<id>.md`; missing → `review/dep-not-found` warning.
- **`factory-runtime run-sequence <dir>/` CLI subcommand** *(factory-runtime)*. Walks `<dir>/*.md`, builds the depends-on DAG, topologically sorts via Kahn's (alphabetic tie-break), runs each spec via existing per-spec `run()` in order. Exit 0 on full converge, 1 on partial / no-converge, 3 on error / cycle / missing dep / sequence-cost-cap.
- **`runSequence` function + `SequenceReport` type exports** *(factory-runtime)*. Public API surface: 19 → 21 names.
- **New context record type `factory-sequence`** *(factory-runtime)*. Persisted at sequence start (root, parents=[]); every per-spec `factory-run` parents at `[factorySequenceId]` via the new `RunArgs.runParents?: string[]` arg. `factory-context tree --direction down <factorySequenceId>` walks the entire product DAG.
- **`--max-sequence-tokens <n>` CLI flag** *(factory-runtime)*. Whole-sequence cap on summed agent tokens. Pre-run check: `cumulative + nextSpec.maxTotalTokens > maxSequenceTokens` aborts before invoking the next spec. Default unbounded (per-spec cap from v0.0.3 still applies).
- **`--continue-on-fail` CLI flag** *(factory-runtime)*. Continue running independent specs after a failure; transitive dependents are marked `'skipped'` with `blockedBy: <first-failed-id>`.
- **`RunReport.totalTokens?: number`** *(factory-runtime)*. Field-level addition. Computed in-memory from the run's `factory-implement-report.tokens`. Used by `runSequence` to accumulate sequence totals.
- **Three new `RuntimeErrorCode` values** *(factory-runtime)*: `'runtime/sequence-cycle'`, `'runtime/sequence-dep-not-found'`, `'runtime/sequence-cost-cap-exceeded'`. Enum count: 10 → 13.
- **Two new `factory.config.json` keys** *(factory-runtime)*: `runtime.maxSequenceTokens`, `runtime.continueOnFail`. CLI flag > config > built-in default precedence preserved.
- **URL-shortener fixture set** *(docs/baselines/scope-project-fixtures/)*. Four hand-authored LIGHT spec files demonstrating the canonical `/scope-project` output shape against the canonical URL-shortener prompt.

### Changed

- **All six `@wifo/factory-*` packages bumped to `0.0.7`** in lockstep. `init-templates` scaffold deps bumped from `^0.0.6` to `^0.0.7`.

### Public API surface

| Package | v0.0.6 | v0.0.7 | Δ |
|---|---|---|---|
| `@wifo/factory-core` | 27 | 29 | +`KEBAB_ID_REGEX`, +`lintSpecFile` |
| `@wifo/factory-runtime` | 19 | 21 | +`runSequence`, +`SequenceReport` |
| `@wifo/factory-spec-review` | 10 | 10 | (field-level on existing types) |
| `@wifo/factory-context` | 18 | 18 | unchanged |
| `@wifo/factory-harness` | ~16 | ~16 | unchanged |
| `@wifo/factory-twin` | ~7 | ~7 | unchanged |

### Test surface growth

- `@wifo/factory-core`: 94 → 104 (+8 depends-on schema/lint scenarios + 2 fixture/source structural tests)
- `@wifo/factory-runtime`: 138 → 161 (+13 sequence + 3 records + 4 runtime.runParents/totalTokens + 3 cli scenarios)
- `@wifo/factory-spec-review`: 62 → 74 (+8 cross-doc-consistency deps scenarios + 1 review.deps thread + 2 cli dep-loading + 1 review/dep-not-found)
- Workspace total: 446 → 455

### Reconciliations worth knowing

- **`SpecFrontmatter.id` is NOT retroactively tightened** to match `KEBAB_ID_REGEX`. The pattern is documented as canonical and enforced ONLY for `depends-on` entries. Existing specs (and existing third-party specs) may not match. A future v0.0.8+ may add an `id-format` lint warning for existing-spec ids.
- **`run-sequence` does NOT recurse into `<dir>/done/`.** Specs in `done/` already shipped — they are external constraints, not part of the sequence DAG. The `cross-doc-consistency` reviewer judge handles cross-`done/` consistency at review time.
- **Sequence-cost-cap is enforced PRE-RUN.** Before invoking `run()` for each spec in topological order, the runtime compares `cumulative + nextSpec.maxTotalTokens` against `maxSequenceTokens`. Stricter than post-hoc but prevents one spec from blowing the entire sequence budget on its own.
- **Failure cascade is dep-chain-only.** A failed spec poisons its TRANSITIVE dependents (via the depends-on chain). Specs with `depends-on=[]` always run regardless of other failures. `--continue-on-fail` flips between "run independent roots" and the default "stop on first failure."
- **Cascade-blocked status is `'skipped'`.** Maintains the CI-tooling convention; `blockedBy: string` field carries the cause.

---

## [0.0.6] — 2026-05-02

**Theme: v0.0.5.x cluster shipped together.** Four BACKLOG-tracked follow-ups to v0.0.5, bundled because they're all small fixes / quality-of-life improvements that make every subsequent v0.0.6+ workflow cleaner. Three of the four runs hit the very 600s agent timeout that the fourth fix is making configurable — concrete validation that the friction is real.

### Added

- **`--max-agent-timeout-ms <n>` CLI flag + `RunOptions.maxAgentTimeoutMs?: number`** *(factory-runtime)*. Default 600_000 (unchanged). Mirrors the v0.0.3 `--max-total-tokens` pattern exactly: field-level addition, string-label CLI validation (NOT a new `RuntimeErrorCode`). Wide-blast-radius specs can raise the ceiling explicitly.
- **`factory.config.json`** — optional config file at the consumer project root. Specifies defaults for `runtime: { maxIterations, maxTotalTokens, maxPromptTokens, noJudge }`. Read by `factory-runtime run` from cwd. Precedence: CLI flag > config file > built-in default. `factory init` writes one with documented defaults.
- **`@wifo/factory-spec-review` in scaffolded `devDependencies`** *(factory-core)*. `factory init` now produces a scaffold where `factory spec review` works on first invocation (previously the dispatch's `findPackageRoot` walk failed because the package wasn't installed).
- **`.factory-spec-review-cache` in `GITIGNORE_TEMPLATE`** *(factory-core)*. The reviewer cache no longer shows up in `git status` after a fresh `factory init` + `factory spec review` run.

### Fixed

- **Harness strips surrounding backticks from `test:` paths and patterns** *(factory-harness)*. Recurring spec-authoring pitfall — `parseTestLine` was passing the literal token (with backticks) to `bun test`, which never matched any file. Caught twice now (parse-size v1, factory-runtime-v0-0-5). The SPEC_TEMPLATE backtick-guidance BACKLOG entry is now obsolete; spec authors can write either backtick-quoted or bare paths and the harness handles both.
- **`factory-implement-report.filesChanged` is reliable** *(factory-runtime)*. Replaces the simple post-run `git diff` with a pre/post working-tree snapshot (tracked + untracked + content hash). Two failure modes resolved:
  - False negative on new-file-only runs (plain `git diff` doesn't report untracked files).
  - False positive on pre-run uncommitted changes (the agent gets attributed for files that were already dirty).
  Pre-dirty paths are filtered out — over-attributing the agent is worse than under-attributing.

### Changed

- **All six `@wifo/factory-*` packages bumped to `0.0.6`** in lockstep (matches the v0.0.5 publish coordination pattern). `init-templates` scaffold deps bumped from `^0.0.5` to `^0.0.6`.
- **ROADMAP shift:** v0.0.6 was originally themed `/scope-project` + real-product workflow. That theme moves to **v0.0.7**; v0.0.6 contains the v0.0.5.x cluster shipped here.

### Public API surface

Unchanged across every package. Strictly equal to v0.0.5's surface (27 / 18 / ~16 / 19 / 10 / ~7). All v0.0.6 changes are field-level on already-exported types or internal-only helpers.

| Package | Exports |
|---|---|
| `@wifo/factory-core` | 27 |
| `@wifo/factory-context` | 18 |
| `@wifo/factory-harness` | ~16 |
| `@wifo/factory-runtime` | 19 |
| `@wifo/factory-spec-review` | 10 |
| `@wifo/factory-twin` | ~7 |

### Test surface growth

- `@wifo/factory-core`: 74 → 77 (+3 init-ergonomics scenarios)
- `@wifo/factory-harness`: 56 → 60 (+4 backtick-stripping scenarios)
- `@wifo/factory-runtime`: 131 → 138 (+4 filesChanged + 3 agent-timeout scenarios)
- Workspace total: 446 → 462

### Reconciliations worth knowing

- **The cluster shipped as v0.0.6, not v0.0.5.1.** Spec ids stay as `factory-{harness,core,runtime}-v0-0-5-{1,2}` (they refer to the v0.0.5 follow-up cluster). The published npm version is v0.0.6 because 4-segment versions like `0.0.5.1` aren't strict SemVer and would be rejected by the registry.
- **Three of four runs hit the 600s agent timeout** while implementing the cluster. The fourth fix (`--max-agent-timeout-ms`) is now in for the next run. Net effect: the v0.0.7 work will not hit this — the configurable knob exists.
- **Lockstep bump even for unchanged packages.** spec-review/context/twin didn't change in v0.0.6 but bumped to 0.0.6 anyway. Matches the v0.0.5 publish-coordination pattern; keeps the scaffold's `^0.0.6` deps uniformly resolvable.

---

## [0.0.5] — 2026-05-01

**Theme: easier to adopt, smarter to use.** Every `@wifo/factory-*` package is now on the public npm registry. `factory init` scaffolds work outside this monorepo for the first time. The implementer agent gets a stable behavior-prior prompt prefix so prompt caching hits consistently across iterations.

This release was built **by the factory itself** — `factory-runtime` ran against three v0.0.5 specs (`factory-runtime-v0-0-5`, `factory-docs-v0-0-5`, `factory-publish-v0-0-5`) with `claude -p` doing the implementation. Provenance is on disk under `.factory-v0-0-5/` for the specs that completed runs.

### Added
- **npm publish for every package.** All six `@wifo/factory-*` packages (core, context, harness, runtime, spec-review, twin) now ship to npm under v0.0.5 with `publishConfig.access: public`, full repository/homepage/bugs/keywords/author/license metadata, and per-package `LICENSE` files.
- **Top-level `pnpm release` script.** Gates on typecheck → test → biome check → build → `pnpm publish -r --access public`. Manual release-gate (not a CI workflow yet).
- **`# Implementation guidelines` prompt prefix in `implementPhase`.** Stable module-level constant `IMPLEMENTATION_GUIDELINES` emitted between the opening prose and `# Spec` on every implement spawn. Four behavior priors: state assumptions, minimum code, surgical changes, verifiable success criteria. ≤ 2 KB / ~500 tokens; byte-stable across iterations so `claude -p`'s ephemeral cache hits the same key every iteration.
- **PostToolUse hook recipe** in `packages/core/README.md` — opt-in `~/.claude/settings.json` block that runs `factory spec lint` + `factory spec review` on every Write/Edit to `docs/specs/*.md`.
- **Cross-package review pointers.** `packages/harness/README.md` and `packages/runtime/README.md` now reference `@wifo/factory-spec-review` so the reviewer is discoverable from anywhere in the monorepo.
- **`packages/core/src/publish-meta.test.ts`** (5 new tests). Asserts per-package metadata, the init-templates dep version (`^0.0.5`), the caveat sweep across READMEs, and the release-script gating.

### Changed
- **`docs/SPEC_TEMPLATE.md`** rewritten to match the v0.0.3+ parallel-tree filename convention (`docs/specs/<id>.md` ↔ `docs/technical-plans/<id>.md`). Added a "Validating the spec" section listing both `factory spec lint` and `factory spec review`. The pre-v0.0.3 single-tree `<id>.technical-plan.md` convention is gone.
- **`packages/core/src/init-templates.ts`** `PACKAGE_JSON_TEMPLATE.dependencies` bumped `^0.0.4` → `^0.0.5`. Scaffold `README_TEMPLATE` no longer carries the v0.0.4 "monorepo-only" caveat.

### Removed
- **The v0.0.4 "monorepo-only" caveat** is swept from every README + scaffold template (top-level README, `packages/core/README.md`, `packages/spec-review/README.md`, `examples/{slugify,gh-stars,parse-size}/README.md`, `init-templates.ts` README_TEMPLATE). v0.0.5 is the first release where `factory init`-generated scaffolds resolve their `@wifo/factory-*` deps from public npm.
- **BACKLOG entry** for "implementPhase: behavior-prior prompt prefix" — shipped in this release.

### Public API surface
Unchanged across every package. v0.0.5 is metadata + prompt content only — zero new exports, zero rename or removal of existing exports.

| Package | Exports |
|---|---|
| `@wifo/factory-core` | 27 |
| `@wifo/factory-context` | 18 |
| `@wifo/factory-harness` | ~16 |
| `@wifo/factory-runtime` | 19 |
| `@wifo/factory-spec-review` | 10 |
| `@wifo/factory-twin` | ~7 |

`IMPLEMENTATION_GUIDELINES` lives in `packages/runtime/src/phases/implement.ts` but is intentionally NOT re-exported from `src/index.ts`.

### Reconciliations worth knowing
- **Coordinated versioning across all six packages.** Even packages that didn't change in v0.0.4 (`harness` was at `0.0.0`, `twin` at `0.0.1`) jumped to `0.0.5`. Required so the scaffold's `^0.0.5` deps resolve uniformly. Per-package version drift is deferred until there's an operational need.
- **`pnpm publish -r` is manually triggered.** v0.0.5 ships the release script and the dry-run-clean tarballs; the actual `npm publish` is maintainer-driven, not a CI workflow.
- **Per-package `LICENSE` files are copies, not symlinks.** Each package gets its own copy so `npm pack` reliably includes it in every tarball. The root `LICENSE` is still the source of truth.
- **The reviewer's exit-1 condition stays dormant** in v0.0.5 — all 5 v0.0.4 judges still default to `severity: 'warning'`. Promotion is per-judge, post-calibration, in v0.0.5+ point releases.

### Notes
This release was the first **moneyball run** — building v0.0.5 by running v0.0.4's `factory-runtime` against the three v0.0.5 specs. Three real lessons surfaced and are queued in BACKLOG:
- The harness parses backtick-quoted test paths literally (recurring spec-authoring pitfall).
- `SPEC_TEMPLATE.md` should warn against the same.
- The 600s per-phase agent timeout is too tight for very-broad specs (the publish spec hit it on iteration 2).

---

## [0.0.4] — 2026-04-30

**Theme: spec quality + bootstrap.**

### Added
- **`@wifo/factory-spec-review`** (new package, 10 exports). LLM-judged spec quality reviewer. Five judges enabled by default: `internal-consistency`, `judge-parity`, `dod-precision`, `holdout-distinctness`, `cross-doc-consistency`. All ship at `severity: 'warning'` (exit-1 condition dormant by default until per-judge calibration).
- **`claudeCliJudgeClient`** — `JudgeClient` adapter spawning `claude -p --allowedTools '[]' --output-format json`. Subscription auth (no `ANTHROPIC_API_KEY`). Mirrors `implementPhase`'s subprocess pattern. Strict-JSON-in-text parsing with a regex-extract fallback for prefixed prose.
- **Content-addressable cache** for the reviewer. `cacheKey = sha256(specBytes : ruleSetHash : sortedJudges)`. Re-runs on unchanged specs cost zero `claude` spawns. Editing a judge prompt invalidates the cache automatically (the rule-set hash covers prompt content).
- **`factory init`** — new top-level subcommand on `@wifo/factory-core`. Drops a self-contained scaffold (`package.json` with semver deps, self-contained `tsconfig.json`, `.gitignore`, `README.md`, `docs/{specs,technical-plans}/done/` + `src/` `.gitkeep` skeleton). Idempotent + safe — preexisting target → exit 2 listing every conflict, zero writes (no `--force`).
- **`factory-context tree --direction <up|down>`** — descendants traversal. Default `up` (backward-compat); `down` walks the descendant DAG by inverting `parents[]` across `listRecords()` once. Internal `buildDescendantTree`; zero new public exports.
- **`fake-claude-judge.ts`** test fixture in `@wifo/factory-spec-review`. Modes: `clean-json`, `prefixed-json`, `garbage`, `pass`, `exit-nonzero`, `hang`. Optional `FAKE_JUDGE_COUNTER_FILE` for cross-process spawn-counting in cache-hit tests.
- **`examples/parse-size`** worked example walking the v0.0.4 surface end-to-end.

### Changed
- `factory spec review` integrates into `factory-core`'s CLI dispatch via dynamic import — keeps `core` dep-free for callers that only run `lint`/`init`.

### Fixed
- `factory-context tree`'s ancestor walk continues to work as the default; the new direction flag is purely additive.
- `factory spec review`'s tech-plan auto-resolution no longer feeds the spec back as its own paired plan (regex no-op bug — caught while building `examples/parse-size`).

---

## [0.0.3] — 2026-04-29

**Theme: closed autonomous iteration loop.**

### Added
- **`--max-iterations` default flipped 1 → 5.** `factory-runtime run <spec>` drives `[implement → validate]` until convergence or budget, no human between iterations.
- **Cross-iteration record threading.** Iteration N+1's `implementPhase` builds a `# Prior validate report` section from iteration N's failed scenarios. The DAG parent chain extends across iterations.
- **Whole-run cost cap.** `RunOptions.maxTotalTokens?: number` (default 500_000). New `RuntimeError` code `runtime/total-cost-cap-exceeded`. CLI flag `--max-total-tokens <n>`.
- **`PhaseContext.inputs: readonly ContextRecord[]`** — same-iteration predecessor outputs (non-root phases) + prior-iteration terminal outputs (root phases on iter ≥ 2). Distinct from `factory-phase.parents` to preserve v0.0.2's `--no-implement` record-set parity.
- **`examples/gh-stars/docs/specs/gh-stars-v2.md`** — pagination + ETag/conditional caching + retry-with-backoff, designed to require iteration 2+.

### Changed
- `factory-implement-report.parents = [runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`.
- `factory-validate-report.parents = [runId, ...(implementReportIdFromCtxInputs ? [implementReportIdFromCtxInputs] : [])]`.

### Public API surface
Strict equality with v0.0.2 — 5 functions + 1 class + 13 types = 19 names in `@wifo/factory-runtime`. Zero new exports; v0.0.3 changes are field-level on already-exported types.

---

## [0.0.2] — 2026-04-22

**Theme: agent-driven `implementPhase`.**

### Added
- **`implementPhase`** — single-shot agent built on `claude -p --allowedTools "Read,Edit,Write,Bash" --output-format json`. Spec on stdin, JSON envelope back. The agent edits files in the spec's project root; validate runs after.
- **Per-phase cost cap.** `RunOptions.maxPromptTokens?: number` (default 100_000). New `RuntimeError` codes: `runtime/cost-cap-exceeded`, `runtime/agent-failed`, `runtime/invalid-max-prompt-tokens`. CLI flag `--max-prompt-tokens <n>`.
- **Twin wired into the runtime.** `WIFO_TWIN_MODE` + `WIFO_TWIN_RECORDINGS_DIR` are set on the spawned agent subprocess so user code can opt in via `wrapFetch`.

### Removed
- `--bare` from the locked `claude` spawn args. In `claude` 2.1+ that flag strictly disables OAuth/keychain reads — incompatible with subscription auth.

---

## [0.0.1] — 2026-04-15

**Initial framework.**

### Added
- **`@wifo/factory-core`** — spec format, zod frontmatter schema, markdown + YAML parser, scenario/Given-When-Then parser, `factory spec lint` CLI, JSON Schema export.
- **`@wifo/factory-harness`** — scenario runner. `bun test` for `test:` lines; Anthropic LLM judge (via SDK) for `judge:` lines.
- **`@wifo/factory-twin`** — HTTP record/replay for deterministic agent runs against fixed responses.
- **`@wifo/factory-context`** — filesystem-first content-addressable record store with DAG provenance. `factory-context list/get/tree` CLI.
- **`@wifo/factory-runtime`** — phase-graph orchestrator with one built-in phase: `validatePhase`.
- **Spec workflow** — `/scope-task`, `/finish-task`, `docs/specs/<id>.md` + `docs/technical-plans/<id>.md` convention.
- **`examples/slugify`** — manual-loop walkthrough.

[0.0.6]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.6
[0.0.5]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.5
[0.0.4]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.4
[0.0.3]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.3
[0.0.2]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.2
[0.0.1]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.1

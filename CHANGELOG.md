# Changelog

All notable changes to the `@wifo/factory-*` workspace are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows pre-1.0 semantics — point releases (v0.0.X) may break public APIs as the surface stabilizes.

For the project's forward direction and shipped-release retrospectives, see [`ROADMAP.md`](./ROADMAP.md). For the candidate pile of post-v0.0.X work, see [`BACKLOG.md`](./BACKLOG.md).

---

## [0.0.10] — 2026-05-03

**Theme: trust contract — DoD-verifier + reviewer judges = trust on both sides.** v0.0.10 closes the v0.0.9 BASELINE friction list with five sibling specs that together turn each spec's Definition of Done into a checked contract and tighten the spec-quality teeth. The DoD verifier now treats unchecked DoD items as a converge-blocking signal; three new reviewer judges (`feasibility`, `api-surface-drift`, `scope-creep`) catch quality regressions before runtime; `run-sequence` polish + `factory spec watch` smooth the workflow; and the `spec/wide-blast-radius` heuristic is recalibrated against empirical data.

### Added

- **DoD-verifier phase** *(factory-runtime)*. New verifier consumes the spec's `## Definition of Done` checklist and surfaces unchecked items as a converge-blocking signal. Public surface: `+2` exports (21 → 23).
- **Three reviewer judges** *(factory-spec-review)*: `feasibility`, `api-surface-drift`, `scope-creep`. Three new `ReviewCode` union members; export count unchanged at 10.
- **`factory spec watch`** *(factory-core)*. Watches a directory tree for `*.md` changes and re-runs `factory spec lint` (and optionally `factory spec review --no-cache`) on every save. Public surface: `+2` exports (29 → 31).
- **`spec/wide-blast-radius` threshold raise from 8 to 12 + NOQA suppression directive** *(factory-core)*. Threshold raised based on v0.0.8 self-build evidence (the spec that actually timed out touched 12 files) + v0.0.9 BASELINE empirical data (18 historical specs warned at threshold 8). New HTML-comment NOQA directive (`<!-- NOQA: spec/wide-blast-radius -->` / `<!-- NOQA: code-a, code-b -->` / blanket `<!-- NOQA -->`) suppresses warnings per-spec; per-code, per-spec scope; never suppresses severity-`error` codes.
- **`run-sequence` polish** *(factory-runtime)*. Workflow ergonomics improvements landed alongside the other v0.0.10 deliverables.

### Changed

- **All six `@wifo/factory-*` packages bumped to `0.0.10`** in lockstep. `init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies` bumped from `^0.0.9` to `^0.0.10` for every `@wifo/factory-*` dep.
- **`spec/wide-blast-radius` warning message** updated to reference the new `>= 12` threshold.

### Public API surface

| Package | v0.0.9 | v0.0.10 |
|---|---|---|
| `@wifo/factory-core` | 29 | 33 (+watch +DoD helpers) |
| `@wifo/factory-context` | 18 | 18 |
| `@wifo/factory-harness` | ~16 | ~16 |
| `@wifo/factory-runtime` | 21 | 23 (+DoD-verifier) |
| `@wifo/factory-spec-review` | 10 | 10 (+3 ReviewCode union members; count unchanged) |
| `@wifo/factory-twin` | ~7 | ~7 |

### Reconciliations worth knowing

- **NOQA does NOT suppress errors.** Severity-`error` codes (e.g., `spec/invalid-depends-on`) always fire. NOQA is warnings-only.
- **NOQA placement constraint.** The directive lives in the spec body (HTML comment), NOT in the YAML frontmatter — the schema is `.strict()` and would reject the comment as an unknown key.
- **NOQA scope is per-spec, not per-line.** A single matching comment anywhere in the body suppresses every emission of the named code from `lintSpec`.
- **No retroactive NOQA additions.** v0.0.10 raises the threshold but does NOT walk the 18 historical specs to add NOQA — most fall below 12 paths after the raise; the rest can opt in on demand.

---

## [0.0.9] — 2026-05-03

**Theme: status-aware run-sequence + per-spec timeout + scaffold scripts + dep-aware internal-consistency.** Four small frictions surfaced in the v0.0.8 BASELINE — drafting specs got pulled into `run-sequence`; wide-blast-radius specs hit the 600s agent-timeout ceiling with no override; the scaffold's `package.json` shipped empty `scripts` even as every spec's DoD claimed they were runnable; `internal-consistency` flagged shared constraints in multi-spec products as unreferenced because it didn't follow `depends-on` edges. v0.0.9 closes all four.

### Added

- **`agent-timeout-ms` frontmatter field + `spec/wide-blast-radius` lint warning** *(factory-core)*. New optional `'agent-timeout-ms': z.number().int().positive().optional()` on `SpecFrontmatterSchema`. New lint code `spec/wide-blast-radius` (severity: warning) emitted when a spec's Subtasks section names ≥ 8 distinct file paths. Field-level addition; zero new public exports.
- **Scaffold `scripts: { typecheck, test, check, build }`** *(factory-core)*. `PACKAGE_JSON_TEMPLATE.scripts` now ships the four canonical entries matching the monorepo's own conventions, so a fresh `factory init` project can immediately run the gates its DoD claims.
- **`run-sequence` skips drafting specs by default + `--include-drafting` flag** *(factory-runtime)*. `loadSpecs` now filters `frontmatter.status === 'drafting'` unless `includeDrafting: true`. New CLI flag `--include-drafting` and `factory.config.json` key `runtime.includeDrafting` (default `false`). CLI flag > config > built-in default.
- **Per-spec `agent-timeout-ms` consumption** *(factory-runtime)*. `run()` now resolves the agent timeout via `spec.frontmatter['agent-timeout-ms'] ?? options.maxAgentTimeoutMs ?? DEFAULT_MAX_AGENT_TIMEOUT_MS`. Wide-blast-radius specs override the 600s ceiling without bumping the global default for everyone.
- **`internal-consistency` judge follows `depends-on` edges** *(factory-spec-review)*. The judge's `buildPrompt` consumes the existing `JudgePromptCtx.deps` (plumbed through in v0.0.7 by `cross-doc-consistency`) and appends a `## Deps Constraints (referenced via depends-on)` section to the artifact, with each dep's `## Constraints / Decisions` block sliced via `findSection`. The criterion gains a sentence instructing the LLM judge to score against the union of this spec's Constraints + every dep's Constraints. Field-level on existing types; zero new exports.

### Changed

- **All six `@wifo/factory-*` packages bumped to `0.0.9`** in lockstep. `init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies` bumped from `^0.0.8` to `^0.0.9` for every `@wifo/factory-*` dep.

### Public API surface

Unchanged across every package. Strictly equal to v0.0.8's surface (29 / 21 / 10 / 18 / ~16 / ~7). All v0.0.9 changes are field-level on existing schemas/types/templates + version metadata.

### Reconciliations worth knowing

- **`internal-consistency` cache invalidates on first run after upgrade.** The criterion text gains one sentence, so `ruleSetHash()` flips and v0.0.8 cache entries miss. Expected and correct.
- **Dep loading remains the CLI's responsibility.** v0.0.7 already wired the CLI to auto-load each declared dep from `docs/specs/<id>.md` or `docs/specs/done/<id>.md` and thread them through `runReview`'s `deps` option. v0.0.9 just teaches `internal-consistency` to opt into the existing data flow.
- **`internal-consistency` still applies on every spec.** The judge's `applies()` is unchanged (returns true unconditionally). The dep-awareness affects scoring, not whether the judge fires. A spec without deps still gets scored, just without dep-context.
- **Transitive dep loading is NOT yet shipped.** The CLI loads direct deps only. Walking a dep's own `depends-on` chain is deferred to a future release.
- **Drafting-by-default is `run-sequence` only.** `factory-runtime run` (single-spec) still runs whatever spec you point it at regardless of status. The status filter is purely a sequence-level guard.

---

## [0.0.8] — 2026-05-03

**Theme: discoverability + baseline reset.** The v0.0.7 BASELINE run shipped a critical finding: v0.0.7's three deliverables (`/scope-project`, `depends-on`, `run-sequence`) were on npm but invisible to a fresh-repo agent — `factory init` didn't auto-install the slash command into `.claude/commands/`, the scaffold README didn't mention `run-sequence`, and the canonical baseline prompt explicitly told the agent those tools didn't exist (the prompt was authored when they were future work). v0.0.8 closes all three gaps so v0.0.7's value is actually exercised by a fresh-repo agent.

### Added

- **Bundled `/scope-project` slash command** *(factory-core)*. Canonical source moves from `docs/commands/scope-project.md` to `packages/core/commands/scope-project.md` so it ships in the npm tarball. `packages/core/package.json`'s `files` glob extends with `commands`. New internal helper `readScopeProjectCommandTemplate()` in `init-templates.ts` resolves the bundled markdown via `import.meta.url` + relative path (works in both source and built contexts). NOT exported from `core/src/index.ts`.
- **`factory init` writes `.claude/commands/scope-project.md`** *(factory-core)*. The scaffold's `planFiles` now drops the bundled slash-command source into the fresh project's `.claude/commands/` so any Claude Code session opened in the project picks it up zero-config. The file is a regular file (not a symlink — symlinks don't survive `npm pack` reliably across platforms).
- **Scaffold README `## Multi-spec products` section** *(factory-core)*. New section in `init-templates.ts`'s `README_TEMPLATE` documents the canonical v0.0.7+ flow: `/scope-project <description>` → `factory spec lint docs/specs/` → `factory-runtime run-sequence docs/specs/`. Section explicitly notes that `factory init` writes `.claude/commands/scope-project.md` automatically. ~25 lines, scannable not tutorial. The scaffold is the documentation.
- **Baseline prompt reset** *(docs/baselines)*. Archived `docs/baselines/url-shortener-prompt.md` as `url-shortener-prompt-v0.0.5-v0.0.7.md` (preserves the historic v0.0.5–v0.0.7 baseline against which prior friction lists were measured). Wrote a fresh canonical prompt opening with `/scope-project` + `factory-runtime run-sequence` so v0.0.8+ baselines measure the v0.0.7+ flow honestly. `BASELINE.md` documents the methodology reset event.

### Changed

- **All six `@wifo/factory-*` packages bumped to `0.0.8`** in lockstep. `init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies` bumped from `^0.0.7` to `^0.0.8` for every `@wifo/factory-*` dep.

### Public API surface

Unchanged across every package. Strictly equal to v0.0.7's surface (29 / 21 / 10 / 18 / ~16 / ~7). All v0.0.8 changes are field-level on existing constants/templates + version metadata + new internal-only helpers.

| Package | Exports |
|---|---|
| `@wifo/factory-core` | 29 |
| `@wifo/factory-context` | 18 |
| `@wifo/factory-harness` | ~16 |
| `@wifo/factory-runtime` | 21 |
| `@wifo/factory-spec-review` | 10 |
| `@wifo/factory-twin` | ~7 |

### Test surface growth

- `@wifo/factory-core`: 104 → 124 (+scope-project source/init bundling tests + Multi-spec README tests + baseline-reset evidence test + version-pin tests)

### Reconciliations worth knowing

- **The discoverability gap was the binding constraint, not DoD coverage.** Pre-v0.0.7 BASELINE the v0.0.8 plan was DoD-verifier + worktree sandbox + PostToolUse hook + CI publish. The v0.0.7 BASELINE evidence re-ranked entirely: discoverability is the actual ceiling, so DoD-verifier slips to v0.0.9+.
- **Slash command is a regular file, not a symlink.** Cross-platform reliability: symlinks don't survive `npm pack`/`npm install` consistently across macOS/Linux/Windows. The in-repo `.claude/commands/scope-project.md` IS a symlink for dogfooding (single source of truth), but the scaffolded copy is a plain-file write.
- **No retroactive backports.** Projects scaffolded before v0.0.8 don't auto-pick-up the new section or slash command — users either re-run `factory init` or copy the new section by hand. A `factory init --upgrade` flag is a v0.0.9+ candidate.
- **Lockstep bump even for unchanged packages.** harness/spec-review/context/twin didn't change in v0.0.8 but bumped to 0.0.8 anyway. Matches the v0.0.5 / v0.0.6 / v0.0.7 publish-coordination pattern; keeps the scaffold's `^0.0.8` deps uniformly resolvable.
- **Section content is locked, prose is flexible.** The spec locked the section heading (`## Multi-spec products`) and the structural elements (named commands, code block, auto-install note); the exact wording is implementation-flexible so future doc edits don't trip the structural tests.

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

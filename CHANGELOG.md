# Changelog

All notable changes to the `@wifo/factory-*` workspace are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows pre-1.0 semantics — point releases (v0.0.X) may break public APIs as the surface stabilizes.

For the project's forward direction and shipped-release retrospectives, see [`ROADMAP.md`](./ROADMAP.md). For the candidate pile of post-v0.0.X work, see [`BACKLOG.md`](./BACKLOG.md).

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

[0.0.5]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.5
[0.0.4]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.4
[0.0.3]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.3
[0.0.2]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.2
[0.0.1]: https://github.com/WiFoDev/software-factory/releases/tag/v0.0.1

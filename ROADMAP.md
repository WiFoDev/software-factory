# Roadmap

This file is the **direction**. `BACKLOG.md` is the candidate pile. The roadmap commits to what ships when, in what order, and what "done" means for each release. The end state is a closed autonomous loop where a spec drives an agent to convergence with full provenance, paid for by a Claude Pro/Max subscription rather than per-token API billing.

---

## Where we are: v0.0.8 — shipped

**Theme: discoverability + baseline reset.** The v0.0.7 BASELINE run (2026-05-03) shipped a critical finding: v0.0.7's three deliverables (`/scope-project`, `depends-on`, `run-sequence`) were on npm but invisible to a fresh-repo agent — `factory init` didn't auto-install the slash command, the scaffold README didn't mention `run-sequence`, and the canonical baseline prompt explicitly told the agent those tools didn't exist. v0.0.8 closes all three gaps so v0.0.7's value is actually exercised.

### What v0.0.8 added

| # | Piece | Notes |
|---|---|---|
| 1 | **Baseline prompt reset** *(docs/baselines)* | Archived `docs/baselines/url-shortener-prompt.md` as `url-shortener-prompt-v0.0.5-v0.0.7.md`. Wrote a fresh canonical opening with `/scope-project A URL shortener with click tracking…` + `factory-runtime run-sequence docs/specs/`. The new prompt measures the v0.0.7+ flow honestly. `BASELINE.md` documents the methodology reset event. |
| 2 | **`factory init` bundles `/scope-project`** *(factory-core)* | Canonical source moves from `docs/commands/` to `packages/core/commands/scope-project.md` (ships in npm tarball via `files` glob extension). `factory init` writes the bundled source to `<cwd>/.claude/commands/scope-project.md` zero-config. Internal helper `readScopeProjectCommandTemplate()` resolves via `import.meta.url`. |
| 3 | **Scaffold README `## Multi-spec products` section** *(factory-core)* | New section in `init-templates.ts`'s `README_TEMPLATE` documents the canonical v0.0.7+ flow: `/scope-project` → `factory spec lint` → `factory-runtime run-sequence`. Notes that `factory init` writes the slash command automatically. Scannable not tutorial. |

### Reconciliations worth knowing

- **All 6 packages bumped to 0.0.8 in lockstep.** Even packages that didn't change (context, twin, harness, spec-review, runtime) bumped — matches v0.0.5 / v0.0.6 / v0.0.7 publish-coordination pattern; keeps the scaffold's `^0.0.8` deps uniformly resolvable.
- **The discoverability gap was the binding constraint.** Pre-v0.0.7 BASELINE the v0.0.8 plan was DoD-verifier + worktree sandbox + PostToolUse hook + CI publish. The v0.0.7 BASELINE evidence re-ranked entirely. DoD-verifier and friends slip to v0.0.9+.
- **Slash command is a regular file, not a symlink.** Cross-platform reliability — symlinks don't survive `npm pack`/`npm install` consistently. The in-repo `.claude/commands/scope-project.md` IS a symlink (dogfooding); the scaffolded copy is a plain-file write.
- **No retroactive backports.** Projects scaffolded before v0.0.8 don't auto-pick-up the new section or slash command — users either re-run `factory init` or copy by hand. `factory init --upgrade` is a v0.0.9+ candidate.
- **Public API surface unchanged across every package.** All changes are field-level on already-exported types or internal-only helpers. Strict-equality DoD per package still holds (29 / 21 / 10 / 18 / ~16 / ~7).

---

## Where we were: v0.0.7 — shipped

**Theme: real-product workflow.** Three deliverables that together collapse the multi-spec-product friction quantified in the v0.0.6 BASELINE run (32 manual interventions per 4-spec product → ~8): a `/scope-project` slash command, a `depends-on` frontmatter field, and a `factory-runtime run-sequence` CLI subcommand. The maintainer now decomposes one product description with one slash command and ships the resulting spec set with one `run-sequence` invocation.

### What v0.0.7 added

| # | Piece | Notes |
|---|---|---|
| 1 | **`/scope-project` slash command** *(docs/commands/)* | Canonical source at `docs/commands/scope-project.md` (in-repo). Takes a natural-language product description, writes 4-6 LIGHT specs in dependency order. First spec ships `status: ready`; rest ship `status: drafting`. Worked example: URL-shortener fixture under `docs/baselines/scope-project-fixtures/`. |
| 2 | **`depends-on` frontmatter field** *(factory-core)* | Optional `string[]` on `SpecFrontmatter`. `factory spec lint` validates kebab-case id format + (with `--cwd`) file existence. Two new lint codes: `spec/invalid-depends-on` (error), `spec/depends-on-missing` (warning). Two new exports: `KEBAB_ID_REGEX` + `lintSpecFile`. |
| 3 | **`cross-doc-consistency` reviewer reads deps** *(factory-spec-review)* | Judge applies via `hasTechnicalPlan \|\| depsCount > 0`. CLI auto-loads each declared dep from `docs/specs/` or `docs/specs/done/`; missing → `review/dep-not-found` warning. |
| 4 | **`factory-runtime run-sequence <dir>/`** *(factory-runtime)* | Walks the depends-on DAG (Kahn's, alphabetic tie-break), runs each spec in topological order. New `factory-sequence` context record at the root; per-spec `factory-run` records parent at `[factorySequenceId]` via new `RunArgs.runParents?: string[]`. New flags: `--max-sequence-tokens` (pre-run cost cap), `--continue-on-fail` (skip transitive dependents only). Two new exports: `runSequence` + `SequenceReport`. Three new `RuntimeErrorCode` values: `runtime/sequence-{cycle,dep-not-found,cost-cap-exceeded}`. |

### Reconciliations worth knowing

- **All 6 packages bumped to 0.0.7 in lockstep.** Even packages that didn't change (context, twin, harness) bumped — matches v0.0.5 / v0.0.6 publish-coordination pattern; keeps the scaffold's `^0.0.7` deps uniformly resolvable.
- **`SpecFrontmatter.id` is NOT retroactively tightened.** `KEBAB_ID_REGEX` is documented as canonical and enforced ONLY for `depends-on` entries.
- **`run-sequence` does NOT recurse into `<dir>/done/`.** Sequence ships ACTIVE specs only; deps already in `done/` are external constraints.
- **Sequence-cost-cap is enforced PRE-RUN** — `cumulative + nextSpec.maxTotalTokens > maxSequenceTokens` aborts before invoking the next spec. Stricter than post-hoc but prevents one spec from blowing the budget alone.
- **Failure cascade is dep-chain-only.** `'skipped'` status with `blockedBy: string` field.

---

## Where we were: v0.0.6 — shipped

**The v0.0.5.x cluster, bundled.** Four BACKLOG-tracked follow-ups to v0.0.5 — harness backtick stripping, `factory init` first-contact UX, `factory-implement-report.filesChanged` audit reliability, and configurable per-phase agent timeout — shipped together as one v0.0.6 release. The ROADMAP's prior v0.0.6 theme (`/scope-project` + real-product workflow) moves to v0.0.7.

### What v0.0.6 added

| # | Piece | Notes |
|---|---|---|
| 1 | **Harness backtick stripping** *(factory-harness)* | `parseTestLine` strips a leading + trailing backtick from both the file token and the pattern. Recurring spec-authoring pitfall closed at the source; SPEC_TEMPLATE backtick-guidance BACKLOG entry now obsolete. |
| 2 | **`factory init` first-contact gaps** *(factory-core)* | (a) `@wifo/factory-spec-review` added to scaffold devDependencies; (b) `.factory-spec-review-cache` added to GITIGNORE_TEMPLATE; (c) new `FACTORY_CONFIG_TEMPLATE` writes `factory.config.json` with documented defaults; (d) runtime CLI reads optional `factory.config.json` from cwd (CLI flag > config > built-in default). |
| 3 | **`filesChanged` audit reliability** *(factory-runtime)* | Pre/post working-tree snapshot replaces the buggy `git diff` capture. False negative on new-file-only runs + false positive on pre-dirty files both fixed. Pre-dirty paths filtered out (over-attribution > under-attribution). Schema unchanged. |
| 4 | **Configurable per-phase agent timeout** *(factory-runtime)* | New `RunOptions.maxAgentTimeoutMs?: number` (default 600_000) + `--max-agent-timeout-ms <n>` CLI flag with positive-integer validation. Mirrors the v0.0.3 `--max-total-tokens` pattern; no new RuntimeErrorCode. |

### Reconciliations worth knowing

- **The cluster shipped as v0.0.6, not v0.0.5.1.** Spec ids (`factory-{harness,core,runtime}-v0-0-5-{1,2}`) refer to the v0.0.5 follow-up cluster; the published npm version is v0.0.6 because 4-segment versions like `0.0.5.1` aren't strict SemVer and the registry would reject.
- **All 6 packages bumped to 0.0.6 in lockstep.** spec-review/context/twin didn't change but bumped anyway — matches v0.0.5's publish-coordination pattern; keeps the scaffold's `^0.0.6` deps uniformly resolvable.
- **Three of four runs hit the 600s agent timeout** while implementing the cluster. Fix #4 is now in place — the agent timeout is configurable for v0.0.7's wider-blast-radius work.
- **Public API surface unchanged across every package.** All four fixes are field-level on already-exported types or internal-only helpers. Strict equality with v0.0.5's surface counts.

---

## Where we were: v0.0.5 — shipped

**npm publish + implement-guidelines.** v0.0.4 shipped `factory init` and `factory spec review` but the packages weren't on npm — `factory init`-generated scaffolds couldn't resolve `^0.0.4` deps outside this monorepo. v0.0.5 publishes every `@wifo/factory-*` package to the public registry under v0.0.5, removes the documented "monorepo-only" caveat from every consumer doc, and adds the cache-friendly `# Implementation guidelines` prompt prefix that `implementPhase` emits above every spec. Coordinated version bump across all six packages keeps the scaffold's `^0.0.5` deps correct.

### What v0.0.5 added

| # | Piece | Notes |
|---|---|---|
| 1 | **npm publish** of every `@wifo/factory-*` package | Coordinated v0.0.5 across all six packages (core, context, harness, runtime, spec-review, twin); each gains `publishConfig.access: public`, `repository`, `homepage`, `bugs`, `keywords`, `author`, `license`, `LICENSE` in `files`. Top-level `pnpm release` gates on typecheck → test → biome check → build → `pnpm publish -r --access public`. |
| 2 | **Doc caveat sweep** | Every README + `init-templates.ts` README_TEMPLATE drops the v0.0.4 "monorepo-only" / "not yet published to npm" caveat. `factory init` scaffolds now describe a plain `pnpm install` flow against published packages. |
| 3 | **`init-templates.ts` semver bump** | `PACKAGE_JSON_TEMPLATE` deps bumped from `^0.0.4` → `^0.0.5` so fresh scaffolds resolve against the published packages. |
| 4 | **`# Implementation guidelines` prompt prefix** *(factory-runtime)* | Stable prefix emitted before `# Spec` on every implement spawn. Cache-friendly (same bytes every iteration); installs behavior bias — state assumptions, no speculative abstractions, surgical edits, verifiable success criteria. |

### Reconciliations worth knowing

- **Coordinated versioning across all six packages.** Even packages that didn't change in v0.0.4 (`harness` was at `0.0.0`, `twin` at `0.0.1`) jumped to `0.0.5` — required so the scaffold's `^0.0.5` deps resolve uniformly. Per-package version drift is deferred until there's an operational need for it.
- **`pnpm publish -r` is manually triggered.** v0.0.5 ships the `release` script and the dry-run-clean tarballs; the actual `npm publish` is a maintainer-driven release-gate, NOT a CI workflow. CI publishing is deferred to v0.0.5+ once the manual flow has been exercised.
- **`LICENSE` is copied per-package.** Each package gets its own `LICENSE` file (rather than a symlink) so `npm pack` reliably includes it in every tarball. The root `LICENSE` is still the source of truth — package copies are byte-equivalent.

---

## Where we were: v0.0.4 — shipped

**Spec quality + bootstrap.** v0.0.3 closed the agent gap (autonomous loop). v0.0.4 closes the spec-side feedback loop with `factory spec review` (LLM-judged spec quality, subscription-paid via `claude -p`) and the bootstrap gap with `factory init` (zero-to-first-iteration scaffold). Plus `factory-context tree --direction down` for the natural "what came out of this run?" question.

What's in your hands today:

- **`@wifo/factory-core`** — spec format, parser, lint CLI *(v0.0.1)*; `factory init` *(v0.0.4)*; CLI dispatch into `spec-review` *(v0.0.4)*
- **`@wifo/factory-harness`** — scenario runner (`bun test` for `test:` lines, Anthropic tool-use for `judge:` lines) *(v0.0.1)*
- **`@wifo/factory-twin`** — HTTP record/replay; runtime plumbs `WIFO_TWIN_MODE` + `WIFO_TWIN_RECORDINGS_DIR` *(v0.0.1, wired in v0.0.2)*
- **`@wifo/factory-context`** — filesystem-first content-addressable record store with DAG provenance *(v0.0.1)*; `tree --direction <up|down>` *(v0.0.4)*
- **`@wifo/factory-runtime`** — phase-graph orchestrator with `validatePhase` *(v0.0.1)*, `implementPhase` *(v0.0.2)*, closed iteration loop *(v0.0.3)*
- **`@wifo/factory-spec-review`** — *(NEW v0.0.4)* — 5 LLM judges (internal-consistency, judge-parity, dod-precision, holdout-distinctness, cross-doc-consistency) via `claude -p` subprocess (subscription auth, no `ANTHROPIC_API_KEY`); content-addressable cache; output mirrors `factory spec lint`
- **Spec workflow** — `/scope-task`, `/finish-task`, `docs/specs/<id>.md` + `docs/technical-plans/<id>.md` convention
- **Worked examples** — `examples/slugify` (v0.0.1 manual loop), `examples/gh-stars/docs/specs/gh-stars-v1.md` (v0.0.2 single-shot), `examples/gh-stars/docs/specs/gh-stars-v2.md` (v0.0.3 unattended loop)

### What v0.0.4 added

| # | Piece | Notes |
|---|---|---|
| 1 | **`@wifo/factory-spec-review` package** | 10 exports (4 functions + 6 types). 5 judges enabled by default, all at `severity: 'warning'` (exit-1 condition dormant by default until per-judge calibration). |
| 2 | **`claudeCliJudgeClient`** | New `JudgeClient` adapter spawning `claude -p --allowedTools '[]' --output-format json`. Mirrors `implementPhase`'s subprocess pattern. Strict-JSON-in-text parsing with regex-extract fallback for prefixed prose. |
| 3 | **Content-addressable cache** | `cacheKey = sha256(specBytes : ruleSetHash : sortedJudges)`. `ruleSetHash` covers each judge's prompt content — editing a prompt invalidates correctly. Re-runs on unchanged specs cost zero `claude` spawns. |
| 4 | **Section slicer (`slice-sections.ts`)** | Fenced-block aware; recognizes the 6 canonical headings (Intent, Constraints / Decisions, Subtasks, Definition of Done, Scenarios, Holdout Scenarios). Missing required sections → `review/section-missing` info finding. |
| 5 | **`factory init`** | New top-level subcommand. Drops `package.json` (npm semver, NOT `workspace:*`), self-contained `tsconfig.json`, `.gitignore`, `README.md`, and `docs/{specs,technical-plans}/done/` + `src/` `.gitkeep` skeleton. Idempotent + safe (preexisting target → exit 2 listing every conflict, zero writes; no `--force`). |
| 6 | **`factory-context tree --direction <up|down>`** | Default `up` (backward-compat). `down` walks descendants by inverting `parents[]` across `listRecords()` once. Internal `buildDescendantTree`; zero new public exports (still 18 from `@wifo/factory-context/src/index.ts`). |
| 7 | **`factory spec review` CLI** | Dispatched from `factory-core` via dynamic import (keeps core dep-free). Recursive directory traversal, `--cache-dir` / `--no-cache` / `--judges` / `--claude-bin` / `--technical-plan` / `--timeout-ms` flags. Auto-resolves paired technical-plan from `docs/specs/<id>.md` ↔ `docs/technical-plans/<id>.md` (and `done/` subdirs). |
| 8 | **`fake-claude-judge.ts` test fixture** | Mirrors `runtime/test-fixtures/fake-claude.ts`. Modes: `clean-json`, `prefixed-json`, `garbage`, `pass`, `exit-nonzero`, `hang`. Optional `FAKE_JUDGE_COUNTER_FILE` for cross-process spawn-counting in cache-hit tests. |

### Reconciliations worth knowing

- **The reviewer's exit-1 condition is dormant.** All 5 judges ship at `severity: 'warning'` — even findings don't escalate exit codes. Promotion to `'error'` happens per-judge in point releases, post-calibration. Documented in `packages/spec-review/README.md`.
- **`claude -p` cannot use the SDK's `record_judgment` tool path.** `--allowedTools '[]'` (locked for read-only judges) blocks all tool calls. Reviewer uses strict-JSON-in-text + regex-extract fallback instead. Documented tradeoff: tool-forced JSON is more reliable, but doesn't fit the subscription-auth path.
- **`factory init` was monorepo-only in v0.0.4.** Scaffold deps used npm semver (`^0.0.4`) but the packages weren't on npm. Closed in v0.0.5 — packages publish under `^0.0.5`, scaffold deps follow.
- **`factory init` defaults sanitize the basename.** `mkdtempSync` produces dirs with uppercase chars (e.g. `factory-init-yoUctO`) which fail npm's strict regex; the default-name path lowercases + replaces invalid chars. User-supplied `--name` is validated strictly.
- **Cache stores even failures.** A `review/judge-failed` finding lands in the cache file. Operators must `--no-cache` after fixing flaky network. Tradeoff: cache integrity vs eager-recovery.
- **Public API surface deltas** — every existing package's surface is unchanged in v0.0.4. New surface is contained to the new `@wifo/factory-spec-review` package (10 exports). Strict-equality DoD per package still holds.

### v0.0.3 reconciliations (kept for history)

- **`ctx.inputs` ≠ `factory-phase.parents`.** They share same-iter predecessors, but `ctx.inputs` additionally includes prior-iter terminal outputs for root phases on iter ≥ 2; `factory-phase.parents` does NOT. Pinned by H-3's `--no-implement` regression test.
- **`maxTotalTokens` is post-hoc.** Tokens are summed *after* each implement returns. A single implement that consumes 600k tokens against a 500k cap will overshoot before being detected. Streaming cost monitoring is a v0.0.5+ candidate.
- **`maxTotalTokens` is not programmatically validated.** Non-positive values trip the cap on the first implement that records any tokens. The CLI does pre-validate the flag for friendlier UX.
- **Default-budget tightness.** 500_000 cap ÷ 5 iterations ≈ 100k/iter, matching the per-phase cap. Bump `--max-total-tokens` to ~1_000_000 if you expect long iterations.

### What v0.0.3 added

| # | Piece | Notes |
|---|---|---|
| 1 | **`--max-iterations` default flipped 1 → 5** | Same flag; `DEFAULT_MAX_ITERATIONS` constant updated; persisted on `factory-run.payload.maxIterations`. |
| 2 | **Cross-iteration record threading** | Iteration N+1's `implementPhase` prompt gains a `# Prior validate report` section listing only iter N's failed scenarios as `**<id> — <name>**: <failureDetail>`. Per-line cap 1 KB; section-total cap 50 KB with a single `[runtime] truncated prior-validate section` warning via `ctx.log`. |
| 3 | **Parent chain extends across iterations** | `factory-implement-report.parents = [runId, ...(priorValidateReportId ? [priorValidateReportId] : [])]`; `factory-validate-report.parents = [runId, ...(sameIterImplementReportId ? [sameIterImplementReportId] : [])]`. `factory-context tree` walks the full chain back to runId from any leaf. |
| 4 | **`PhaseContext.inputs: readonly ContextRecord[]`** | Same-iter predecessor outputs for non-root phases; prior-iter terminal outputs for root phases on iter ≥ 2; empty for root iter 1. Built-ins consume by filtering on `record.type`. **Distinct from `factory-phase.parents`** — aliasing them would silently extend `factory-phase.parents` across iterations in `--no-implement` mode (regression-pinned by H-3). |
| 5 | **Whole-run cost cap** | `RunOptions.maxTotalTokens?: number` (default 500_000) sums `tokens.input + tokens.output` across every implement in the run. Overrun aborts with `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })` from inside the per-phase try block; `factory-phase` persisted with `status: 'error'`; `factory-implement-report` already on disk via `parents=[runId,...]`. CLI flag `--max-total-tokens <n>` with positive-integer validation. |
| 6 | **One new `RuntimeErrorCode`** | `'runtime/total-cost-cap-exceeded'`. Total 10. The CLI's `--max-total-tokens 0` exits 2 with stderr label `runtime/invalid-max-total-tokens:` — a string format only, **not** a `RuntimeErrorCode` value. |
| 7 | **`examples/gh-stars/docs/specs/gh-stars-v2.md`** | Pagination, ETag/conditional caching, retry-with-backoff on 5xx. The closed-loop demo — designed to require iteration 2+. |
| 8 | **Public API surface unchanged** | Strict equality with v0.0.2's surface: 5 functions + 1 class + 13 types = **19 names**, zero new exports. Every change is field-level on already-exported types. |

### Reconciliations worth knowing

- **`ctx.inputs` ≠ `factory-phase.parents`.** They share same-iter predecessors, but `ctx.inputs` additionally includes prior-iter terminal outputs for root phases on iter ≥ 2; `factory-phase.parents` does NOT. Pinned by H-3's `--no-implement` regression test.
- **`maxTotalTokens` is post-hoc.** Tokens are summed *after* each implement returns. A single implement that consumes 600k tokens against a 500k cap will overshoot before being detected — same retroactive nature as the v0.0.2 per-phase cap. Streaming cost monitoring is a v0.0.4+ candidate.
- **`maxTotalTokens` is not programmatically validated.** Non-positive values trip the cap on the first implement that records any tokens. The CLI does pre-validate the flag for friendlier UX. This avoided a second new `RuntimeErrorCode` (locked at one).
- **Default-budget tightness.** 500_000 cap ÷ 5 iterations ≈ 100k/iter, matching the per-phase cap. Tasks with longer prompts will trip one or the other immediately — bump `--max-total-tokens` to ~1_000_000 if you expect long iterations.

### v0.0.2 reconciliations (kept for history)

- **`--bare` was dropped** from the locked `claude` spawn args — in `claude` 2.1+ that flag strictly disables OAuth/keychain reads, incompatible with subscription auth. The rest of the locked surface (`-p`, `--allowedTools`, `--output-format json`) carries the reproducibility intent.
- **`RuntimeErrorCode` gained three new members in v0.0.2, not two.** The plan committed to two; implementation added a third (`'runtime/invalid-max-prompt-tokens'`) for symmetric programmatic + CLI validation.

---

## v0.0.9 — next

**Theme: TBD — pending v0.0.8 BASELINE re-run.** With discoverability closed (v0.0.8), re-run the URL-shortener BASELINE against the new prompt and let the friction list pick the next theme. Lead candidates from the v0.0.7→v0.0.8 deferral pile below.

### Lead candidates (carried from v0.0.8)

- **PostToolUse hook for `factory spec lint`/`review`** — opt-in config recipe in `~/.claude/settings.json`. Pairs naturally with v0.0.8's `factory init` slash-command drop (both make Claude Code aware of factory tooling).
- **CI publish workflow** — tag-driven GitHub Actions. v0.0.7+v0.0.8 manual publishing went smoothly; defer one more release if friction is still elsewhere.
- **DoD-verifier runtime phase** — audit-trust gap surfaced by v0.0.6 BASELINE. ~300 LOC. Promote when discoverability stops being the bottleneck — i.e., once the v0.0.8 BASELINE confirms `/scope-project` + `run-sequence` are reachable zero-config.

### Scope discipline

v0.0.7 → v0.0.8 was a discoverability close-out. v0.0.9 picks up wherever the v0.0.8 BASELINE evidence points; don't pre-commit. The roadmap's anchor — `BASELINE.md`'s friction list shrinking version-over-version — is the binding constraint.

---

## v0.0.10+ — future

The post-discoverability work. Roughly ordered by leverage; not committed.

| Theme | Lead candidate from BACKLOG.md |
|---|---|
| **DoD-verifier runtime phase** *(surfaced by v0.0.6 BASELINE; deferred from v0.0.8 by v0.0.7 BASELINE re-rank)* | Today `## Definition of Done` is documentation-only. `factory-runtime run` returns "converged" without verifying DoD shell gates ("typecheck clean", "biome clean"). New `dodPhase` parses shell-runnable DoD lines and executes them. Audit-trust gap, not just UX. ~300 LOC. |
| **PostToolUse hook for `factory spec lint`/`review`** *(deferred from v0.0.7+v0.0.8)* | Harness-enforced linting on every `Write` to `docs/specs/*.md`. Lives in `~/.claude/settings.json` — opt-in config recipe. |
| **CI publish workflow** *(deferred from v0.0.7+v0.0.8)* | Promote `pnpm release` to a tag-driven GitHub Actions workflow. |
| **Worktree sandbox** | Agent runs in an isolated `git worktree` per run. Strong undo by construction. Ship after `/scope-project` proves the product workflow. |
| **Holdout-aware automated convergence** | Validate runs holdouts at the end of every iteration; convergence requires both visible AND holdout passes. Quality knob; ride alongside worktree. |
| **Scheduler (Layer 5)** — autonomous task queue | Pull `status: ready` specs and run them overnight. With `depends-on` declared, the scheduler can walk a project's DAG without human intervention. The end-state. |
| **Reviewer's deferred judges** | `review/api-surface-drift`, `review/feasibility`, `review/scope-creep`. Each ships per-judge with a "this real spec would have caught X" justification. |
| **`explorePhase` / `planPhase`** | Separate "understand the codebase" and "plan the change" steps. Speculative — only if a real run shows `implement` is too low-context. |
| **Domain packs** — schema + judges + twins per domain | `@wifo/factory-pack-web`, `-pack-api`; OLH-specific pack stays private. v1.0.0 territory. |
| **Streaming cost monitoring** | Mid-stream abort instead of post-hoc. Worth pursuing once cost-cap-exceeded events become common enough. |
| **Streaming cost monitoring** | Mid-stream abort instead of post-hoc. Worth pursuing once cost-cap-exceeded events become common enough. |
| **Multi-agent coordination** | Beyond a single agent per phase. Out of scope until single-agent's ceiling is clearly hit. |

---

## Cadence guesses (not commitments)

- **v0.0.2** — shipped. ~13 commits, ~1900 LOC including tests + scaffold.
- **v0.0.3** — shipped. 7 subtasks + gh-stars-v2; default flip + cross-iter threading + whole-run cap.
- **v0.0.4** — shipped. New `@wifo/factory-spec-review` package (10 exports, 5 judges) + `factory init` + `tree --direction down`. ~3800 LOC across 3 specs. 431 workspace tests, all green.
- **v0.0.5** — shipped. npm publish across all six packages + `# Implementation guidelines` prompt prefix. Coordinated v0.0.5 version bump; doc caveat sweep; manual release-gate.
- **v0.0.6** — worktree sandbox + holdout-aware convergence. Wait until v0.0.5 has soaked against real installs before triggering.

The throughput trick that worked: scoped slices per-package, technical-plan only for the centerpiece, ship per-package commits so anything can slip independently. v0.0.6 follows the same pattern.

---

## Anti-goals (what's NOT on this roadmap)

Stating these explicitly so we don't drift:

- **Multi-LLM support.** Anthropic-only via `claude` CLI is fine for the foreseeable future.
- **Web UI.** CLI + filesystem records are the surface. A dashboard is a separate product.
- **Generic CI integration.** The deterministic fake-claude smoke is CI-friendly; "CI invoking real-claude factory-runtime" is premature until cost monitoring is stronger.
- **Streaming/live progress UI.** Records get written; tail the directory if you want progress. A streaming protocol is over-engineering for v0.0.3/v0.0.4.

---

## What this roadmap commits us to

The end state is **a software factory you can hand a product description to and walk away from**. v0.0.2 was the first step where the agent does work; v0.0.3 is the first version where the agent does *all* the work between human-meaningful checkpoints. v0.0.4 closes the spec-side feedback loop so spec quality stops being the ceiling on agent output. v0.0.5 puts the toolkit on npm so the loop can run from a fresh `pnpm install`. v0.0.6 closes the **product-scale gap** so the loop scales from one feature to a sequence of features. Anything past v0.0.6 is leverage, not unlock.

### The end-state UX, made concrete

The canonical test case is **"build a URL shortener with a stats dashboard."** That product description should yield, with no further intervention beyond reviewing each spec before it ships:

```sh
# Step 1 — bootstrap (v0.0.4)
mkdir url-shortener && cd url-shortener
npx -y @wifo/factory-core init --name url-shortener
pnpm install

# Step 2 — open Claude Code in this dir, prompt:
#   /scope-project A URL shortener with a stats dashboard.
#                  JSON-over-HTTP, SQLite for storage, optional API-key auth.
# → produces docs/specs/url-shortener-{core,redirect,tracking,stats,dashboard}.md
#   in dependency order. First is status: ready; rest are status: drafting.

# Step 3 — review + ship each spec (v0.0.4 reviewer + v0.0.3 runtime)
pnpm exec factory spec review docs/specs/url-shortener-core.md
pnpm exec factory-runtime run docs/specs/url-shortener-core.md
# … repeat for each spec, flipping status: drafting → ready as you go …

# Step 4 — inspect the whole project's provenance
pnpm exec factory-context tree <runId> --dir ./.factory --direction down
```

This is the v0.0.6 target. **Today (v0.0.5) every step except the `/scope-project` decomposition works.** v0.0.6 ships `/scope-project` + the `depends-on` frontmatter field, closing the product-scale gap. v0.0.7 layers the sequence-runner so the per-spec loop becomes one CLI invocation. v0.1.0's scheduler removes the human from "flip the next spec to `ready`," landing the full end-state.

### Drift signals

If we drift from this anchor, these are the symptoms:

- **Specs the maintainer writes are getting bigger.** The factory's value is per-feature small specs. If `/scope-project` produces 200-LOC specs that touch 20 files each, decomposition is wrong — push back on the slash command's prompt.
- **Manual sequencing feels fine indefinitely.** That's a signal the sequence-runner isn't earning its v0.0.7 slot — defer it further, work on something else.
- **Real users describe products the factory can't ship.** The URL-shortener test case is *one* shape. Mobile apps, ETL pipelines, ML training scripts — each is a different decomposition. Domain packs (v1.0.0) close those gaps, but not before we've shipped 3+ products of each shape manually first.

If we drift, this file is the anchor. Update it deliberately, not silently.

### Empirical ground truth

Drift signals above are heuristic. The empirical check is in [`BASELINE.md`](./BASELINE.md) — each minor version runs the canonical URL-shortener prompt against a fresh repo and captures friction in a structured per-version entry. If the friction list stops shrinking version-over-version, the roadmap is wandering. The canonical prompt at [`docs/baselines/url-shortener-prompt.md`](./docs/baselines/url-shortener-prompt.md) is byte-stable across versions on purpose — only the factory changes between runs.

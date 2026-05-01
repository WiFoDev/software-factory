# Roadmap

This file is the **direction**. `BACKLOG.md` is the candidate pile. The roadmap commits to what ships when, in what order, and what "done" means for each release. The end state is a closed autonomous loop where a spec drives an agent to convergence with full provenance, paid for by a Claude Pro/Max subscription rather than per-token API billing.

---

## Where we are: v0.0.5 — shipped

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

## v0.0.6 — next

**Theme:** worktree sandbox + holdout-aware convergence.

### Lead candidates

| # | Piece | Notes |
|---|---|---|
| 1 | **Worktree sandbox** | Agent runs in an isolated `git worktree` per run. Stronger undo guarantees than "use git as your undo button." |
| 2 | **Holdout-aware automated convergence** | Validate runs holdouts at the end of every iteration; convergence requires both visible AND holdout passes. Optional `--check-holdouts` flag. |
| 3 | **PostToolUse hook for `factory spec lint`/`review`** | Harness-enforced linting on every `Write` to `docs/specs/*.md` — agent literally cannot skip. Lives in `~/.claude/settings.json`. Now that the reviewer ships, the hook can chain both checkers. |
| 4 | **Streaming cost monitoring** | Mid-stream abort instead of post-hoc. Worth pursuing once cost-cap-exceeded events become common enough. |
| 5 | **CI publish workflow** | Promote the manual `pnpm release` to a tag-driven GitHub Actions workflow. Deferred from v0.0.5 until the manual flow has soaked. |

### Scope discipline

The v0.0.5 lesson was "metadata-only changes can still be coordinated work — keep the version-bump in lockstep across the workspace." For v0.0.6 the worktree sandbox is the highest-leverage agent-loop guarantee; holdout-aware convergence makes spec quality a runtime invariant. Ship those two together; bundle the hook if it falls out cheaply; defer streaming + CI publish if any slip.

---

## v0.0.7+ — future

The post-publish work. Roughly ordered by leverage; not committed.

| Theme | Lead candidate from BACKLOG.md |
|---|---|
| **Scheduler (Layer 5)** — autonomous task queue | Pull `status: ready` specs and run them overnight. The end-state. |
| **Reviewer's deferred judges** | `review/api-surface-drift`, `review/feasibility`, `review/scope-creep`. Each ships with a "this real spec would have caught X" justification. |
| **`explorePhase` / `planPhase`** | Separate "understand the codebase" and "plan the change" steps. Speculative — only if a real run shows `implement` is too low-context. |
| **Domain packs** — schema + judges + twins per domain | `@wifo/factory-pack-web`, `-pack-api`; OLH-specific pack stays private. |
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

The end state is **a software factory you can hand a spec and walk away from**. v0.0.2 was the first step where the agent does work; v0.0.3 is the first version where the agent does *all* the work between human-meaningful checkpoints. v0.0.4 closes the spec-side feedback loop so spec quality stops being the ceiling on agent output. v0.0.5 puts the toolkit on npm so the loop can run from a fresh `pnpm install`. Anything past v0.0.5 is leverage, not unlock.

If we drift, this file is the anchor. Update it deliberately, not silently.

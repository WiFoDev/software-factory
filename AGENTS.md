# Building with @wifo/factory-* — agent onboarding

You've been asked to build an app with the `@wifo/factory-*` toolchain. Read this once. It's the entry point.

This document maps **what you want to do** to **which command/package gets you there**, end to end. Skim Sections 1–4 first; the rest is reference. The full primitives table at the bottom is for when you need it.

---

## 1. Mental model in 60 seconds

The factory is a **spec-driven loop** for software development. You write a Markdown spec describing intent + scenarios; the runtime spawns Claude in headless mode (`claude -p`) to implement it; a harness runs the scenarios as tests; a verifier runs the Definition of Done as shell gates. Convergence happens when all gates pass. Every step persists a content-addressable record with full DAG provenance.

The pieces:

- **A spec is a contract.** YAML frontmatter (id, classification, status, depends-on, agent-timeout-ms) + Markdown body (Intent, Scenarios with Given/When/Then, Constraints, Subtasks, Definition of Done).
- **A run is one execution attempt.** Phases (`implement → validate → dod`) iterate until convergence or budget exhaustion. Default budget: 5 iterations × 500k tokens × 600s per agent spawn.
- **A sequence is multiple specs in dependency order.** `factory-runtime run-sequence` walks `<dir>/*.md`, builds the depends-on DAG via Kahn's algorithm, runs each spec via the per-spec path. Threads provenance under one root.
- **Convergence is decided by gates, not by the agent.** Tests pass + judges pass + DoD shell commands pass = converged. The agent never self-reports success.

You write specs; the runtime makes them real. **You're the architect; the factory is the foreman.**

---

## 2. The canonical workflow (six commands, in order)

Given an agent prompt of the shape *"build app X that does Y; use the @wifo/factory-* toolchain"*, the canonical flow is:

```sh
# 1. Scaffold a fresh project
mkdir my-app && cd my-app
git init -q
npx -y @wifo/factory-core init --name my-app
pnpm install

# 2. Decompose the product into 4-6 ordered specs (auto-installed in v0.0.8+)
/scope-project A URL shortener with click tracking and JSON stats. JSON-over-HTTP, in-memory, no auth.

# 3. Format-floor lint (fast, free, deterministic)
pnpm exec factory spec lint docs/specs/

# 4. Quality review on the FIRST spec (LLM-judged, subscription-paid)
pnpm exec factory spec review docs/specs/<first-spec-id>.md

# 5. Walk the dependency DAG and ship every spec
pnpm exec factory-runtime run-sequence docs/specs/ \
  --no-judge --max-iterations 5 --max-total-tokens 1000000 \
  --context-dir ./.factory

# 6. Inspect the entire product's provenance
pnpm exec factory-context tree <factorySequenceId> \
  --context-dir ./.factory --direction down
```

That's the entire surface for the prompt above. If you're an agent following one of these prompts, **you should not need to touch the runtime by hand**. The factory's job is to do the work; yours is to review the spec set after step 2 and confirm the spec list before step 5.

**When to deviate:**

| Situation | Adjustment |
|---|---|
| Single feature (one spec, not a product) | `/scope-task` instead of `/scope-project`; `factory-runtime run <spec>` instead of `run-sequence`. |
| The product description is fuzzy / you want manual decomposition | Skip `/scope-project`, write specs by hand using the skeleton in `docs/SPEC_TEMPLATE.md`. |
| Your project has no `pnpm typecheck` script (e.g., a deno project) | `--skip-dod-phase` to disable the DoD-verifier phase. |
| Cluster-atomic shipping (review all specs at once, ship together) | Add `--include-drafting` to `run-sequence`. |
| You want continuous lint+review while authoring | Run `factory spec watch docs/specs/ --review` in another terminal. |

---

## 3. When to reach for which package

Six packages, each with one job. You usually only invoke `factory-core` (init + lint + review dispatch) and `factory-runtime` (run + run-sequence) directly. The others are dependencies of the runtime.

| Package | One-line intent | Primary commands / exports | When to reach for it |
|---|---|---|---|
| **`@wifo/factory-core`** | Spec format, parser, lint, scaffold, slash commands, watch | `factory init`, `factory spec lint`, `factory spec review` (dispatch), `factory spec watch`, `factory spec schema` | **Always — start here.** Bootstrap, lint, review. The slash commands `/scope-project` + `/scope-task` ship as canonical sources here. |
| **`@wifo/factory-runtime`** | Phase-graph orchestrator + sequence-runner | `factory-runtime run`, `factory-runtime run-sequence` | **To ship code from a spec.** The actual loop. Spawns `claude -p`. |
| **`@wifo/factory-context`** | Content-addressable record store with DAG provenance | `factory-context tree --direction up\|down`, `factory-context list`, `factory-context get` | **To inspect what a run produced.** Walk the provenance trail. |
| **`@wifo/factory-harness`** | Scenario runner (`bun test` + LLM-as-judge) | Used internally by `validatePhase` | Not invoked directly by agents. The runtime uses it. |
| **`@wifo/factory-twin`** | HTTP record/replay | Set `WIFO_TWIN_MODE=record\|replay\|off` | When you need deterministic external HTTP in tests. The runtime threads env vars. |
| **`@wifo/factory-spec-review`** | 8 LLM judges scoring spec quality | Dispatched from `factory spec review` (in factory-core) | Not invoked directly. Runs as a subprocess of the lint+review CLI. |

**Rule of thumb:** if you reach for a package other than `factory-core` or `factory-runtime` directly, you're probably doing something the runtime should do for you. Stop and ask whether a different command would handle it.

---

## 4. When to reach for which slash command

Two slash commands ship with the toolchain. Pick based on **scope**, not preference.

| Slash command | Use when | Output |
|---|---|---|
| `/scope-project <product description>` | The agent's prompt describes a **product** (multi-feature, 4-6 endpoints, multiple modules). | 4-6 LIGHT specs in dependency order under `docs/specs/`, first `status: ready`, rest `status: drafting`, every spec populates `depends-on`. |
| `/scope-task <one feature>` | The agent's prompt describes **one feature, one fix, one refactor** that fits in a single spec. | One spec at `docs/specs/<id>.md`, optionally a paired `docs/technical-plans/<id>.md` for DEEP. |

**Critical:** `/scope-project` is the right call ~80% of the time for "build app X" prompts. Real products don't fit in one spec. If you're tempted to skip decomposition, you're about to ship a 500-LOC spec that will time out — split it.

---

## 5. Anti-patterns (what NOT to do)

These are the failure modes most likely to bite an agent. Each has shipped as a real BASELINE friction at some point in the project's history.

**❌ Don't bypass `/scope-project` for multi-feature products.** Manually decomposing a product description into specs is the friction the toolchain exists to remove. The slash command produces a strictly better DAG than hand-decomposition (per v0.0.8 BASELINE).

**❌ Don't run `factory-runtime` without first running `factory spec lint`.** Lint is fast, free, and catches frontmatter / scenario / depends-on errors before you spend agent tokens. The runtime won't validate the spec format for you.

**❌ Don't fight the DoD-verifier (v0.0.10+).** If `pnpm typecheck` fails, fix the code. Don't add `--skip-dod-phase` to dodge it. The DoD gates are the trust contract — turning them off means "I'm shipping something that wasn't verified."

**❌ Don't pre-mark specs as `status: ready` that aren't reviewed.** `run-sequence` walks ready specs by default; drafting specs are skipped (v0.0.9+). The status field is a review checkpoint, not bookkeeping.

**❌ Don't `git mv` shipped specs to `done/` between sequence runs in the SAME cluster.** As of v0.0.10 this works (`<dir>/done/` is consulted for depends-on resolution), but the natural workflow is to ship the cluster atomically (one `run-sequence` invocation), then move all specs to `done/` together at the end.

**❌ Don't put cross-spec decisions in every spec's Constraints block.** Shared constraints (data shape, error codes, public API) belong in the FIRST spec's Constraints; later specs **reference** them via `depends-on`. The `internal-consistency` reviewer judge is dep-aware (v0.0.9+) and won't false-positive on this pattern.

**❌ Don't write specs that touch ≥ 12 files.** The `spec/wide-blast-radius` lint warns at this threshold (v0.0.10+ — was 8 in v0.0.9). Wide-blast specs commonly exceed the 600s implement-phase budget. Either split the spec or set `agent-timeout-ms: 1200000` in frontmatter.

**❌ Don't backtick-wrap test paths in `Satisfaction:` lines.** Write `test: src/foo.test.ts "name"`, not `` test: `src/foo.test.ts` "name" ``. The harness tolerates both forms (since v0.0.6) but bare paths are canonical.

### bun is required for `pnpm test` only (v0.0.13+)

**bun is required for `pnpm test` only** — every workspace package's `scripts.test` is `bun test src` per package. `pnpm build` and `pnpm typecheck` are Node-native (Node 22+); the JSON-schema emitter runs via `tsx scripts/emit-json-schema.ts` with no bun on PATH at build time. `pnpm install` for consumers of the published packages does NOT require bun.

---

## 6. The full primitives reference

Every primitive the agent might reference, in one place. Skim once; come back as needed.

### Spec frontmatter fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | — | Kebab-case (`^[a-z][a-z0-9-]*$`). Filename matches: `docs/specs/<id>.md`. |
| `classification` | enum | yes | — | `light` (default) or `deep` (DEEP requires paired `docs/technical-plans/<id>.md`). |
| `type` | enum | yes | — | `feat`, `fix`, `refactor`, `chore`, `perf`. |
| `status` | enum | yes | — | `ready` (eligible for run-sequence), `drafting` (skipped by default — v0.0.9+), `blocked`. |
| `exemplars` | array | no | `[]` | Pinned files to mirror; `{ path, why }`. |
| `depends-on` | array of ids | no | `[]` | v0.0.7+. Validates against `<dir>/*.md` + `<dir>/done/*.md` (v0.0.10+). |
| `agent-timeout-ms` | positive int | no | unset | v0.0.10+. Per-spec override; takes precedence over the built-in 600_000 default but loses to RunOptions/CLI flag. |

### Scenario satisfaction kinds

- `test: <path> "<name>"` — `bun test` runs the file, filters by name. Required for visible scenarios; bare paths only.
- `judge: "<criterion>"` — LLM scores the criterion. Optional; for fuzzy criteria (UX, log clarity).

### `factory spec lint` codes

| Code | Severity | Meaning |
|---|---|---|
| `frontmatter/structural` | error | Malformed frontmatter fence. |
| `frontmatter/yaml` | error | YAML parse error. |
| `frontmatter/missing-field` | error | Required field absent (`id`, `classification`, `type`, `status`). |
| `frontmatter/invalid-enum` | error | Bad enum value. |
| `frontmatter/unknown-field` | warning | Extra field; informational. |
| `scenarios/missing-section` | warning | No `## Scenarios` section. |
| `scenarios/empty-section` | warning | Section present but no scenarios. |
| `scenario/missing-given` / `-when` / `-then` / `-test` | error | Per-scenario field check. |
| `spec/invalid-depends-on` | error | v0.0.7+. Entry doesn't match kebab-case. |
| `spec/depends-on-missing` | warning | v0.0.7+. Dep file not found under `docs/specs/` or `docs/specs/done/`. |
| `spec/wide-blast-radius` | warning | v0.0.9+. `## Subtasks` references ≥ 12 distinct file paths (was 8 in v0.0.9; calibrated to 12 in v0.0.10). |
| `spec/test-name-quote-chars` | warning | v0.0.12+. `test:` pattern uses non-ASCII quote chars (curly `‘ ’ “ ”`); the harness normalizes at run-time as a safety net, but rewriting to ASCII at scope-time is cleanest. |

NOQA directive (v0.0.10+): place `<!-- NOQA: spec/wide-blast-radius -->` (or `<!-- NOQA: -->` blanket) anywhere in the spec body to suppress warnings per-spec. Errors cannot be suppressed.

### `factory spec review` codes (LLM judges)

8 judges, all severity `warning` by default:

| Code | Catches |
|---|---|
| `review/internal-consistency` | Constraints reference deps not declared; scenarios reference test files outside `cwd`. (Dep-aware since v0.0.9.) |
| `review/judge-parity` | Asymmetric satisfaction kinds across same-category scenarios. |
| `review/dod-precision` | Vague DoD checks ("X validates Y" without operator). |
| `review/holdout-distinctness` | Holdouts that overlap with visible scenarios (overfit risk). |
| `review/cross-doc-consistency` | Spec ↔ technical-plan disagreement on names, defaults, deferral list. (Dep-aware since v0.0.7.) |
| `review/api-surface-drift` | v0.0.10+. Public API names in spec Constraints don't appear in tech-plan §4 (or vice versa). |
| `review/feasibility` | v0.0.10+. Subtask LOC estimates that don't match file-path counts. |
| `review/scope-creep` | v0.0.10+. Subtasks naming future-version work; missing anti-goals in DEEP specs. |

Plus the meta-codes `review/judge-failed` (judge subprocess errored), `review/section-missing` (judge skipped because target section absent), `review/dep-not-found` (declared dep file missing during CLI dep-load).

### `factory-runtime` `RuntimeErrorCode` values (14 total in v0.0.10)

`runtime/graph-empty`, `runtime/graph-duplicate-phase`, `runtime/graph-unknown-phase`, `runtime/graph-cycle`, `runtime/invalid-max-iterations`, `runtime/io-error`, `runtime/cost-cap-exceeded`, `runtime/agent-failed`, `runtime/invalid-max-prompt-tokens`, `runtime/total-cost-cap-exceeded`, `runtime/sequence-cycle`, `runtime/sequence-dep-not-found`, `runtime/sequence-cost-cap-exceeded`, `runtime/sequence-empty`.

### Runtime phases (default graph)

`[implement, validate, dod]` with edges `[['implement', 'validate'], ['validate', 'dod']]` since v0.0.10. Convergence requires every phase `pass`.

| Phase | Inputs | Outputs | Failure mode |
|---|---|---|---|
| `implement` | Spec + prior-iter validate report + prior-iter DoD report | `factory-implement-report` (full agent transcript + filesChanged) | `'fail'` if agent self-reports; `'error'` on timeout / token cap. |
| `validate` | Spec + (optional) implement report | `factory-validate-report` (per-scenario pass/fail) | `'fail'` if any scenario fails; `'error'` on harness crash. |
| `dod` | Spec + run cwd | `factory-dod-report` (per-bullet pass/fail) | `'fail'` on any DoD shell exit non-zero or judge `pass: false`. |

### Context records (DAG nodes)

`factory-sequence` (root, v0.0.7+) → `factory-run` (per spec) → `factory-phase` (per phase per iteration) → `factory-implement-report` / `factory-validate-report` / `factory-dod-report` (per phase outputs).

Walk down: `factory-context tree <factorySequenceId> --direction down`.
Walk up: `factory-context tree <leafId> --direction up` (default).

### CLI flags (`factory-runtime run` and `run-sequence`)

| Flag | Default | Notes |
|---|---|---|
| `--max-iterations <n>` | 5 | Per-spec iteration budget. |
| `--max-total-tokens <n>` | 500_000 | Per-spec cap on summed agent tokens. |
| `--max-agent-timeout-ms <n>` | 600_000 | Per-phase agent subprocess timeout. |
| `--context-dir <path>` | `./context` | Where records persist. |
| `--no-judge` | off | Skip LLM-judged satisfactions in validate. |
| `--no-implement` | off | v0.0.1 [validate]-only graph. |
| `--skip-dod-phase` | off (DoD on) | v0.0.10+. Drop dodPhase from default graph. |
| `--max-sequence-tokens <n>` | unbounded | v0.0.7+. Whole-sequence cap (`run-sequence` only). |
| `--continue-on-fail` | off | v0.0.7+. Skip transitive dependents only (`run-sequence` only). |
| `--include-drafting` | off | v0.0.9+. Walk specs regardless of status (`run-sequence` only). |
| `--scenario <ids>` | all | Comma-separated scenario filter (`run` only). |
| `--max-prompt-tokens <n>` | 100_000 | Per-phase agent input cap. |
| `--claude-bin <path>` | `claude` on PATH | Agent binary override (test injection). |
| `--twin-mode <mode>` | `record` | `record` / `replay` / `off`. |

`factory.config.json` (written by `factory init`) sets defaults under `runtime.*` for: `maxIterations`, `maxTotalTokens`, `maxPromptTokens`, `noJudge`, `maxSequenceTokens`, `continueOnFail`, `includeDrafting`, `skipDodPhase`. Precedence: **CLI flag > config > built-in default**.

---

## 7. Worked example (terse)

```sh
# A 4-spec URL shortener, scoped + shipped end to end.

mkdir url-shortener && cd url-shortener && git init -q
npx -y @wifo/factory-core init --name url-shortener
pnpm install

# /scope-project produces docs/specs/{url-store, click-store, redirect-endpoint, stats-endpoint}.md
# (or similar; the slash command may produce 4-6 specs depending on its decomposition).
/scope-project A URL shortener with click tracking and JSON stats. \
  JSON-over-HTTP, in-memory, no auth.

pnpm exec factory spec lint docs/specs/         # → OK
pnpm exec factory spec review docs/specs/url-store.md  # → 0 errors, 1 warning

pnpm exec factory-runtime run-sequence docs/specs/ \
  --no-judge --max-iterations 5 --max-total-tokens 1000000 \
  --context-dir ./.factory
# → factory-runtime: sequence converged (4/4 specs, factorySequenceId=<id>, ~6m)

pnpm exec factory-context tree <factorySequenceId> \
  --context-dir ./.factory --direction down
# → walks the entire product's DAG: sequence → 4 runs → phases → reports

# At this point the product is shipped. curl the live server to verify.
```

Empirical evidence (v0.0.10 BASELINE): a 5-spec URL shortener shipped via this flow in ~80 minutes wall-clock, ~30k raw tokens, all DoD shell gates green. See [`BASELINE.md`](./BASELINE.md) for longitudinal data.

---

## 8. See also

- **[`README.md`](./README.md)** — top-level project overview + worked examples.
- **[`docs/SPEC_TEMPLATE.md`](./docs/SPEC_TEMPLATE.md)** — the canonical spec skeleton.
- **[`docs/commands/scope-project.md`](./packages/core/commands/scope-project.md)** (canonical) — slash command source. Auto-installed by `factory init` since v0.0.8.
- **[`ROADMAP.md`](./ROADMAP.md)** — direction + shipped-release retrospectives.
- **[`BASELINE.md`](./BASELINE.md)** — longitudinal evidence the factory is getting better.
- **[`CHANGELOG.md`](./CHANGELOG.md)** — every release's deltas.
- **Per-package READMEs** under [`packages/<name>/README.md`](./packages/) — detailed reference once you have the mental model.

If something in this document is wrong or stale, [open an issue](https://github.com/WiFoDev/software-factory/issues). The factory ships from this repo; the docs ship with it.

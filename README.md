# software-factory

A toolkit for **spec-driven, agent-friendly software development**. You write a Markdown spec describing the *intent* and the *scenarios* a feature must satisfy. The factory's tooling lints the spec for format, reviews it for quality with LLM judges, runs the scenarios as tests, executes the Definition of Done as shell gates, and ships the result with full DAG provenance — paid for by a Claude Pro/Max subscription, not per-token API billing.

> **For AI agents using this toolchain:** start at **[`AGENTS.md`](./AGENTS.md)**. It maps "what you want to do" to "which command/package gets you there," end to end. ~10 minutes to skim; will save you from every common failure mode.

---

## v0.0.11: trust → isolation — runs sandboxed in their own git worktree

**Runtime side:** `factory-runtime run --worktree` materializes an isolated `git worktree` at `<projectRoot>/.factory/worktrees/<runId>/` on a throwaway branch `factory-run/<runId>`; the implement / validate / DoD phases all execute against that checkout, so the maintainer's main tree is never touched by the agent. Strong undo by construction; enables parallel runs against distinct worktree paths. New CLI subcommand `factory-runtime worktree { list | clean }` for forensic inspection + maintenance. New context record type `factory-worktree`.

**Polish:** holdout-aware convergence (`--check-holdouts` runs `## Holdout Scenarios` each iteration; both sets must pass); `dod-precision` recalibrated against v0.0.10 BASELINE; `RunReport.chargedTokens` exposes the budget-relevant total (cache reads/creates excluded); `run-sequence` walks the dep DAG dynamically (drafting specs auto-promoted as their deps converge).

**Release lineage:** v0.0.1 framework → v0.0.2 single-shot agent → v0.0.3 closed loop → v0.0.4 spec quality + bootstrap → v0.0.5 npm publish + implement-guidelines → v0.0.6 v0.0.5.x cluster → v0.0.7 real-product workflow → v0.0.8 discoverability + scaffold drops → v0.0.9 status-aware sequence + per-spec timeout → v0.0.10 trust contract → **v0.0.11 worktree-sandbox + trust-layer calibration**.

Inspired by the [StrongDM Software Factory](https://factory.strongdm.ai/) model.

---

## The canonical workflow (v0.0.11)

The recommended end-to-end shape from a fresh directory to a shipped product:

```
mkdir my-app && cd my-app
git init -q
npx -y @wifo/factory-core init --name my-app    # bootstrap (v0.0.4+)
pnpm install
  ↓
/scope-project A <product description>          # decompose → N ordered specs (v0.0.7+; auto-installed by init in v0.0.8+)
  ↓
factory spec lint docs/specs/                   # format check (fast, free, deterministic)
  ↓
factory spec review docs/specs/<first>.md       # quality check — 8 LLM judges (v0.0.4+; +3 in v0.0.10; recalibrated in v0.0.11)
  ↓
factory-runtime run-sequence docs/specs/        # walk the depends-on DAG (v0.0.7+)
  ↓                                             #   [implement → validate → dod] phases per spec (v0.0.10+)
  ↓                                             #   skips status: drafting by default (v0.0.9+)
factory-context tree <factorySequenceId> --direction down   # walk the entire product DAG
```

For one feature (not a multi-feature product), substitute `/scope-task <feature>` and `factory-runtime run <spec>` for the slash command + sequence-runner.

**Empirical evidence (longitudinal in [`BASELINE.md`](./BASELINE.md)):** the canonical URL-shortener (4-5 specs, JSON-over-HTTP + click tracking + stats) ships in 5-10 minutes wall-clock + ~20-30k raw tokens, all DoD shell gates green. Versus v0.0.5's manual ~32 maintainer interventions to ship the same product, v0.0.10 / v0.0.11 collapses to ~3-8. Add `--worktree` to keep the maintainer's main tree untouched.

**Three modes of use:**

- **Agent-driven (default).** `factory-runtime run` spawns `claude -p` with the spec; the agent edits files; `validate` runs `bun test`; `dod` runs `pnpm typecheck && pnpm test && pnpm check`. Iterates up to 5 times until convergence. Subscription auth — no `ANTHROPIC_API_KEY` needed.
- **Manual (`--no-implement`).** You implement by hand; the runtime just runs `validate` + `dod` to gate convergence.
- **Reviewer-only.** `factory spec lint` + `factory spec review` to score a spec for quality without running anything. Cache-backed; re-runs on unchanged specs are free.

---

## Worked example: `slugify(text)` — the manual loop

A small helper, walked through end-to-end with `--no-implement` so the loop is visible without an agent in the way.

### 1. Author the spec

```bash
$ /scope-task "Add a slugify(text) helper that lowercases, replaces non-alphanumerics with dashes, and collapses runs of dashes"
```

Result: `docs/specs/slugify-v1.md` lands with frontmatter, scenarios, subtasks, and a Definition of Done.

```yaml
---
id: slugify-v1
classification: light
type: feat
status: ready
---

# slugify-v1 — Add a slugify(text) helper

## Intent
Lowercase the input, replace runs of non-alphanumerics with a single dash, trim leading/trailing dashes.

## Scenarios
**S-1** — Basic word lowercased and joined
  Given the input "Hello World"
  When `slugify(input)` is called
  Then it returns "hello-world"
  Satisfaction:
    - test: src/slugify.test.ts "lowercases and dashes spaces"

**S-2** — Runs of punctuation collapse to one dash
  Given "foo!!!bar---baz"
  When slugified
  Then it returns "foo-bar-baz"
  Satisfaction:
    - test: src/slugify.test.ts "collapses runs"
```

### 2. Lint the spec

```bash
$ factory spec lint docs/specs/slugify-v1.md
OK
```

### 3. Run the spec against an empty implementation

```bash
$ factory-runtime run docs/specs/slugify-v1.md --no-judge --no-implement --context-dir ./.factory
factory-runtime: no-converge after 1 iteration(s) (run=08f7bae8214a22aa)
# exit code: 1
```

### 4. Implement, then run again

```ts
// src/slugify.ts
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
```

```ts
// src/slugify.test.ts
import { test, expect } from 'bun:test';
import { slugify } from './slugify';

test('lowercases and dashes spaces', () => expect(slugify('Hello World')).toBe('hello-world'));
test('collapses runs', () => expect(slugify('foo!!!bar---baz')).toBe('foo-bar-baz'));
```

```bash
$ factory-runtime run docs/specs/slugify-v1.md --no-judge --no-implement --context-dir ./.factory
factory-runtime: converged in 1 iteration(s) (run=a1b2c3d4e5f60718, 32ms)
# exit code: 0
```

### 5. Walk the provenance

```bash
$ factory-context tree a1b2c3d4e5f60718 --dir ./.factory
a1b2c3d4e5f60718 [type=factory-run] 2026-04-30T...
├── 5f08abc94d2e3c11 [type=factory-validate-report] 2026-04-30T...
└── 9e7f2b18a36d04ac [type=factory-phase] 2026-04-30T...
```

Every run leaves a typed, content-addressable, diffable trail on disk. `git log -- .factory/` shows what changed and when.

---

## Worked example: `gh-stars` — the agent-driven loop

Two specs, two flavors of the agent loop:

- **`gh-stars-v1.md`** *(v0.0.2)* — single-shot. A `getStargazers(repo, opts?)` helper with caching + rate-limit handling. Small enough to converge in one iteration.
- **`gh-stars-v2.md`** *(v0.0.3)* — extends v1 with **pagination**, **ETag/conditional caching**, and **retry-with-backoff on 5xx**. Designed to require iteration 2+. The closed-loop demo for v0.0.3.

```bash
$ cd examples/gh-stars
$ factory-runtime run docs/specs/gh-stars-v2.md \
    --no-judge \
    --max-total-tokens 1000000 \
    --context-dir ./.factory
# … claude runs in headless mode using your subscription, edits files, runs bun test …
# … if iter 1 fails, the runtime threads the failed scenarios into iter 2's prompt …
factory-runtime: converged in 2 iteration(s) (run=…, …)
```

`factory-context tree <runId>` walks every iteration's records — `factory-implement-report` (full prompt including the `# Prior validate report` section on iter ≥ 2, files changed, tokens used, agent's `result` text), `factory-validate-report`, plus `factory-phase` cross-references. See [`examples/gh-stars/README.md`](./examples/gh-stars) for the walk-through.

What v0.0.3 enforces that's worth knowing:
- **Tool allowlist:** the agent gets `Read,Edit,Write,Bash` and nothing else. Default-deny.
- **Per-phase cost cap:** `--max-prompt-tokens` (default `100000`). Overruns hard-stop with `RuntimeError({ code: 'runtime/cost-cap-exceeded' })` *after* persisting the implement-report.
- **Whole-run cost cap:** `--max-total-tokens` (default `500000`). Sums `tokens.input + tokens.output` across every implement in the run. Overruns hard-stop with `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })`. The implement-report is on disk via `parents=[runId]` for both — the wasted run is auditable.
- **Cross-iteration record threading:** iter N+1's `factory-implement-report.parents = [runId, iterN-validate-report-id]`; the prompt section quotes only failed scenarios; `factory-context tree` walks the chain back to runId from any leaf.
- **Twin env vars:** `WIFO_TWIN_MODE` + `WIFO_TWIN_RECORDINGS_DIR` are set on the spawned subprocess so user code can opt into HTTP record/replay through `@wifo/factory-twin`.
- **No git worktree.** The agent runs in the spec's project root cwd. Use git as your undo button.

### What just happened

1. **You didn't write a runner, an agent driver, OR an iteration loop.** The runtime composed all six packages — `factory-core` parses, `factory-runtime` orchestrates, `factory-harness` validates, `factory-context` records, `factory-twin` (when wired) records HTTP, `factory-spec-review` (when invoked) judges spec quality — into a single CLI call that drives the agent until convergence.
2. **Convergence is the success signal**, not "tests pass." A spec with zero tests but five `judge:` lines converges when the LLM-judged criteria are met — same loop, different satisfaction kind.
3. **The provenance trail is what makes the agent trustworthy.** Every code change links back to the report that justified it, across every iteration. Not "the agent claimed it worked." Verifiable.

---

## Worked example: `parse-size` — the v0.0.4 walkthrough

A small `parseSize(text)` parser used to demonstrate **all three v0.0.4 surfaces** end-to-end: `factory init`, `factory spec review` (against a deliberately-defective spec → fixed spec), and `factory-context tree --direction down`.

Two specs ship with it:

- **`parse-size-v1.md`** — deliberately defective. Vague DoD ("matches the format"), asymmetric satisfaction lines, undeclared dep, overlapping/irrelevant holdouts. **Lints clean** — only the reviewer catches the quality issues. Demonstrates `factory spec review` discovering 4 distinct categories of defects.
- **`parse-size-v2.md`** — fixed after applying the review feedback. Concrete operators in DoD, parity restored, holdouts redesigned to probe genuinely distinct failure modes. Paired with `docs/technical-plans/parse-size-v2.md` to exercise the `cross-doc-consistency` judge.

```bash
$ cd examples/parse-size
$ pnpm exec factory spec review docs/specs/parse-size-v1.md
docs/specs/parse-size-v1.md:17  warning  review/judge-parity           ...
docs/specs/parse-size-v1.md:55  warning  review/holdout-distinctness   ...
docs/specs/parse-size-v1.md:67  warning  review/internal-consistency   ...
docs/specs/parse-size-v1.md:77  warning  review/dod-precision          ...
0 errors, 4 warnings

$ pnpm exec factory spec review docs/specs/parse-size-v2.md
docs/specs/parse-size-v2.md: OK

$ pnpm exec factory-runtime run docs/specs/parse-size-v2.md \
    --no-judge --no-implement --context-dir ./.factory
factory-runtime: converged in 1 iteration(s) (run=8ce2db012eb70592, 194ms)

$ pnpm exec factory-context tree 8ce2db012eb70592 --dir ./.factory --direction down
8ce2db012eb70592 [type=factory-run] 2026-...
├── a2e78230c5da5ade [type=factory-phase] 2026-...
└── a34279c85138571e [type=factory-validate-report] 2026-...
```

For environments without an authenticated `claude`, the example also walks the deterministic path using `@wifo/factory-spec-review`'s `fake-claude-judge.ts` test fixture (zero subscription tokens, same pipeline). See [`examples/parse-size/README.md`](./examples/parse-size).

What v0.0.4 added that's worth knowing:

- **`factory init`** drops a self-contained scaffold. Idempotent + safe — preexisting target → exit 2 with a list of conflicts, zero writes (no `--force`).
- **Reviewer judges all default to `severity: 'warning'`.** The exit-1 condition is dormant by default until per-judge calibration in v0.0.4.x point releases. Promoting a judge from `warning` to `error` is one config edit per file.
- **Reviewer cache is content-addressable.** `cacheKey = sha256(specBytes : ruleSetHash : sortedJudges)`. Re-runs on unchanged specs cost zero `claude` spawns. Editing a judge prompt invalidates correctly — `ruleSetHash` covers the prompt content.
- **`tree --direction down` is the natural follow-up to a run.** `up` is still the default (backward-compat); `down` walks descendants by inverting `parents[]` across `listRecords()` once.

---

## The six packages

| Layer | Package | What it does | Status |
|---|---|---|---|
| 0 | [`@wifo/factory-core`](./packages/core) | Spec format, zod schema, markdown parser, `factory spec lint` + `factory init` CLI | ✓ v0.0.4 |
| 1 | [`@wifo/factory-harness`](./packages/harness) | Scenario runner — `bun test` for `test:` lines, Anthropic LLM judge for `judge:` lines | ✓ v0.0.1 |
| 2 | [`@wifo/factory-twin`](./packages/twin) | HTTP record/replay so agents iterate against fixed responses, no real API quota | ✓ v0.0.1 |
| 3 | [`@wifo/factory-context`](./packages/context) | Filesystem-first context store — typed shared memory + DAG of provenance; `tree --direction <up\|down>` *(v0.0.4)* | ✓ v0.0.4 |
| 4 | [`@wifo/factory-runtime`](./packages/runtime) | Phase-graph orchestrator — composes the four primitives, ships `validatePhase` + `implementPhase`, drives the closed iteration loop | ✓ v0.0.3 |
| 4.5 | [`@wifo/factory-spec-review`](./packages/spec-review) | LLM-judged spec-quality reviewer — 5 judges via `claude -p` subprocess (subscription auth); `factory spec review <path>` | ✓ v0.0.4 |
| 5 | `@wifo/factory-scheduler` | Shift-work scheduler (autonomous task queue) | planned |

Domain packs (`@wifo/factory-pack-web`, `-pack-api`, etc.) extend core with domain-specific schema fields, judges, and twin presets. None ship yet.

---

## Repo layout

```
software-factory/
├── packages/
│   ├── core/           # @wifo/factory-core         — spec format + lint + init CLI
│   ├── harness/        # @wifo/factory-harness      — scenario runner (test + judge)
│   ├── twin/           # @wifo/factory-twin         — HTTP record/replay
│   ├── context/        # @wifo/factory-context      — filesystem-first context store
│   ├── runtime/        # @wifo/factory-runtime      — phase-graph orchestrator
│   └── spec-review/    # @wifo/factory-spec-review  — LLM-judged spec quality (v0.0.4+)
├── examples/
│   ├── slugify/        # v0.0.1 manual loop walkthrough
│   ├── gh-stars/       # v1: v0.0.2 single-shot agent loop; v2: v0.0.3 unattended loop
│   └── parse-size/     # v0.0.4: factory init + spec review + tree --direction down
└── docs/
    ├── SPEC_TEMPLATE.md          # canonical shape (docs)
    ├── example-spec.md           # canonical fixture (lints clean)
    ├── specs/
    │   ├── <id>.md               # active spec (one per file)
    │   └── done/                 # finished — moved here for history
    └── technical-plans/
        ├── <id>.md               # optional supporting plan for DEEP specs
        └── done/
```

## Spec convention

One spec per file, named after the spec's `id` frontmatter (kebab-case). Specs live in `docs/specs/`; their optional technical plans live in the parallel `docs/technical-plans/` tree (kept separate so the spec linter never trips over prose). Active work lives at the top of each tree; finished work is moved to `done/`. Lint every active spec with `factory spec lint docs/specs/` (recursive).

## Prerequisites

- **Bun** for running the harness and tests.
- **Node 22+** as the supported runtime.
- **`claude` CLI on PATH** for the agent-driven flow AND for `factory spec review`. Sign in once via your Claude Pro/Max subscription; both surfaces spawn `claude -p` headless on your behalf — no `ANTHROPIC_API_KEY` needed. `--no-implement` lets you skip this for the runtime; `factory spec review --claude-bin <fake>` (with `@wifo/factory-spec-review`'s `fake-claude-judge.ts`) lets you skip it for the reviewer.

## What's new in v0.0.4

- **`@wifo/factory-spec-review`** — `factory spec review docs/specs/<id>.md` runs five LLM judges (`internal-consistency`, `judge-parity`, `dod-precision`, `holdout-distinctness`, `cross-doc-consistency`) via `claude -p` subprocess. Subscription auth, no API key. Output mirrors `factory spec lint` exactly.
- **`factory init`** — bootstrap a new project: `mkdir my-thing && cd my-thing && pnpm exec factory init`. Drops `package.json` (semver deps), self-contained `tsconfig.json`, `.gitignore`, `README.md`, plus the canonical `docs/{specs,technical-plans}/done/` + `src/` skeleton. Idempotent + safe (preexisting target → exit 2, zero writes).
- **`factory-context tree --direction <up|down>`** — finally answers "what came out of this run?". Default `up` (backward-compat) walks ancestors; `down` builds an inverted child-index from `listRecords` once and DFSes down.

## What's missing from v0.0.5

- **PostToolUse hook for `factory spec lint` + `review`.** Now that the reviewer ships, the hook can chain both. Lives in `~/.claude/settings.json`, not in this repo.
- **Worktree sandbox.** The agent runs in the spec's project root cwd. Git is your undo button.
- **`explorePhase` / `planPhase`.** Deferred. Will revisit if a real run thrashes on plan-making rather than implementation.
- **Holdout-aware automated convergence.** `validatePhase` runs visible scenarios; running holdouts at the end of every iteration as a convergence gate is a v0.0.6+ candidate.
- **Streaming cost monitoring.** Both cost caps are post-hoc.
- **Scheduler (Layer 5).** Pulls `status: ready` specs and runs them overnight. The end-state of the roadmap.

## License

MIT — see [LICENSE](./LICENSE).

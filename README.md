# software-factory

A toolkit for **spec-driven, agent-friendly software development**. You write a spec describing the *intent* and the *scenarios* a feature must satisfy. The factory's tooling lints the spec, runs the scenarios as tests (and optionally as LLM-judged criteria for things tests can't capture), persists everything as content-addressable records, and gives you a typed convergence report with full DAG provenance.

**v0.0.4 closes the spec-side feedback loop and the bootstrap gap:** `factory spec review` runs five LLM judges (subscription-paid via `claude -p`) against your spec and emits findings in the same format as `factory spec lint`. `factory init` bootstraps a fresh project (`mkdir my-thing && cd my-thing && pnpm exec factory init`). `factory-context tree --direction down` finally answers "what came out of this run?" — descendants traversal of the DAG. v0.0.1 framework, v0.0.2 single-shot agent, v0.0.3 closed loop, **v0.0.4 spec quality + bootstrap**.

Inspired by the [StrongDM Software Factory](https://factory.strongdm.ai/) model.

---

## What you get today (v0.0.4)

Two flows, same end-to-end shape:

**Manual mode (v0.0.1, still supported via `--no-implement`):**
1. **Author a spec** with `/scope-task` (or by hand) — frontmatter + Given/When/Then scenarios + `Satisfaction:` lines pointing at tests and LLM-judged criteria.
2. **Lint** it: `factory spec lint docs/specs/`
3. **Implement** by hand.
4. **Run** validate: `factory-runtime run docs/specs/my-feature.md --no-judge --no-implement`
5. **Inspect** the convergence trail: `factory-context tree <runId>`

**Agent-driven mode (v0.0.2 single-shot, v0.0.3 unattended loop — default):**
1. Author + lint the spec as above.
2. **Run** the `[implement → validate]` graph: `factory-runtime run docs/specs/my-feature.md --no-judge`
   - The runtime spawns `claude -p` with the spec on stdin, lets it use Read/Edit/Write/Bash to satisfy the `test:` lines, then runs validate against its output.
   - On validate-fail, the runtime threads the failed scenarios into the next iteration's prompt under a `# Prior validate report` section and tries again — up to `--max-iterations 5` (default) or until summed `tokens.input + tokens.output` crosses `--max-total-tokens 500_000` (default).
   - Subscription auth — no `ANTHROPIC_API_KEY` required.
3. Inspect the trail: `factory-context tree <runId>` shows every iteration's `factory-implement-report` (full prompt, files changed, tokens used) and `factory-validate-report`, with the cross-iteration parent edges so you can walk the chain back to runId from any leaf.

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

1. **You didn't write a runner, an agent driver, OR an iteration loop.** The runtime composed all five packages — `factory-core` parses, `factory-runtime` orchestrates, `factory-harness` validates, `factory-context` records, `factory-twin` (when wired) records HTTP — into a single CLI call that drives the agent until convergence.
2. **Convergence is the success signal**, not "tests pass." A spec with zero tests but five `judge:` lines converges when the LLM-judged criteria are met — same loop, different satisfaction kind.
3. **The provenance trail is what makes the agent trustworthy.** Every code change links back to the report that justified it, across every iteration. Not "the agent claimed it worked." Verifiable.

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
│   └── gh-stars/       # v1: v0.0.2 single-shot agent loop; v2: v0.0.3 unattended loop
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
- **`claude` CLI on PATH** (for the default `[implement → validate]` graph). Sign in once via your Claude Pro/Max subscription; the runtime spawns it headless on your behalf. `--no-implement` lets you skip this requirement and run the v0.0.1 validate-only flow.

## What's new in v0.0.4

- **`@wifo/factory-spec-review`** — `factory spec review docs/specs/<id>.md` runs five LLM judges (`internal-consistency`, `judge-parity`, `dod-precision`, `holdout-distinctness`, `cross-doc-consistency`) via `claude -p` subprocess. Subscription auth, no API key. Output mirrors `factory spec lint` exactly.
- **`factory init`** — bootstrap a new project: `mkdir my-thing && cd my-thing && pnpm exec factory init`. Drops `package.json` (semver deps), self-contained `tsconfig.json`, `.gitignore`, `README.md`, plus the canonical `docs/{specs,technical-plans}/done/` + `src/` skeleton. Idempotent + safe (preexisting target → exit 2, zero writes).
- **`factory-context tree --direction <up|down>`** — finally answers "what came out of this run?". Default `up` (backward-compat) walks ancestors; `down` builds an inverted child-index from `listRecords` once and DFSes down.

## What's missing from v0.0.4

- **npm publish.** Workspace deps still resolve via `pnpm-workspace.yaml`; standalone `pnpm install` against a `factory init`-generated scaffold won't find `@wifo/factory-*`. Top v0.0.5 deliverable.
- **`implementPhase` behavior-prior prompt prefix.** A stable `# Implementation guidelines` section before `# Spec` to install behavior bias (no speculative abstractions, surgical edits, verifiable success criteria) into every implement spawn. Deferred to v0.0.5; see [BACKLOG.md](./BACKLOG.md).
- **PostToolUse hook for `factory spec lint` + `review`.** Now that the reviewer ships, the hook can chain both. Lives in `~/.claude/settings.json`, not in this repo.
- **Worktree sandbox.** The agent runs in the spec's project root cwd. Git is your undo button.
- **`explorePhase` / `planPhase`.** Deferred. Will revisit if a real run thrashes on plan-making rather than implementation.
- **Holdout-aware automated convergence.** `validatePhase` runs visible scenarios; running holdouts at the end of every iteration as a convergence gate is a v0.0.5+ candidate.
- **Streaming cost monitoring.** Both cost caps are post-hoc.
- **Scheduler (Layer 5).** Pulls `status: ready` specs and runs them overnight. The end-state of the roadmap.

## License

MIT — see [LICENSE](./LICENSE).

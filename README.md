# software-factory

A toolkit for **spec-driven, agent-friendly software development**. You write a spec describing the *intent* and the *scenarios* a feature must satisfy. The factory's tooling lints the spec, runs the scenarios as tests (and optionally as LLM-judged criteria for things tests can't capture), persists everything as content-addressable records, and gives you a typed convergence report with full DAG provenance.

**v0.0.2 closes the agent gap:** the runtime now drives `claude -p` to do the implementation work, captures the agent's output + disk delta + token counts into a typed report, and runs validate against the result — all in a single `factory-runtime run <spec>` call. v0.0.1 framework, v0.0.2 agent loop, v0.0.3 will close the iteration auto-loop.

Inspired by the [StrongDM Software Factory](https://factory.strongdm.ai/) model.

---

## What you get today (v0.0.2)

Two flows, same end-to-end shape:

**Manual mode (v0.0.1, still supported via `--no-implement`):**
1. **Author a spec** with `/scope-task` (or by hand) — frontmatter + Given/When/Then scenarios + `Satisfaction:` lines pointing at tests and LLM-judged criteria.
2. **Lint** it: `factory spec lint docs/specs/`
3. **Implement** by hand.
4. **Run** validate: `factory-runtime run docs/specs/my-feature.md --no-judge --no-implement`
5. **Inspect** the convergence trail: `factory-context tree <runId>`

**Agent-driven mode (v0.0.2, default):**
1. Author + lint the spec as above.
2. **Run** the `[implement → validate]` graph: `factory-runtime run docs/specs/my-feature.md --no-judge`
   - The runtime spawns `claude -p` with the spec on stdin, lets it use Read/Edit/Write/Bash to satisfy the `test:` lines, then runs validate against its output.
   - Subscription auth — no `ANTHROPIC_API_KEY` required.
3. Inspect the trail: `factory-context tree <runId>` shows both the agent's `factory-implement-report` (full prompt, files changed, tokens used) and the harness's `factory-validate-report`.

Iteration is still human-triggered in v0.0.2 (default `--max-iterations 1`); v0.0.3 will close that loop with cross-iteration context plumbing so the agent can react to validate failures.

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

## Worked example: `gh-stars` — the agent-driven loop (v0.0.2)

The same loop with the agent doing the implementation. Drop `--no-implement` and the runtime's default graph runs `[implement → validate]`:

```bash
$ cd examples/gh-stars
$ factory-runtime run docs/specs/gh-stars-v1.md --no-judge --context-dir ./.factory
# … claude runs in headless mode using your subscription, edits files,
#   then validate runs bun test against the agent's output …
factory-runtime: converged in 1 iteration(s) (run=cfe0fe872815ccbe, 69404ms)
```

`factory-context tree <runId>` now shows four record types — the run, the implement-report (with the full prompt, the files changed, the tokens used, the agent's `result` text), the validate-report, and two `factory-phase` records cross-referencing them. See [`examples/gh-stars/README.md`](./examples/gh-stars) for the walk-through.

What v0.0.2 enforces that's worth knowing:
- **Tool allowlist:** the agent gets `Read,Edit,Write,Bash` and nothing else. Default-deny.
- **Cost cap:** `--max-prompt-tokens` (default `100000`). On overrun, the runtime hard-stops with `RuntimeError({ code: 'runtime/cost-cap-exceeded' })` *after* persisting the implement-report — the wasted run is auditable.
- **Twin env vars:** `WIFO_TWIN_MODE` + `WIFO_TWIN_RECORDINGS_DIR` are set on the spawned subprocess so user code can opt into HTTP record/replay through `@wifo/factory-twin`.
- **No git worktree.** The agent runs in the spec's project root cwd. Use git as your undo button.

### What just happened

1. **You didn't write a runner OR an agent driver.** The runtime composed all five packages — `factory-core` parses, `factory-runtime` orchestrates, `factory-harness` validates, `factory-context` records, `factory-twin` (when wired) records HTTP — into a single CLI call.
2. **Convergence is the success signal**, not "tests pass." A spec with zero tests but five `judge:` lines converges when the LLM-judged criteria are met — same loop, different satisfaction kind.
3. **The provenance trail is what makes the agent trustworthy.** Every code change links back to the report that justified it. Not "the agent claimed it worked." Verifiable.

---

## The five packages

| Layer | Package | What it does | Status |
|---|---|---|---|
| 0 | [`@wifo/factory-core`](./packages/core) | Spec format, zod schema, markdown parser, `factory spec lint` CLI | ✓ v0.0.1 |
| 1 | [`@wifo/factory-harness`](./packages/harness) | Scenario runner — `bun test` for `test:` lines, Anthropic LLM judge for `judge:` lines | ✓ v0.0.1 |
| 2 | [`@wifo/factory-twin`](./packages/twin) | HTTP record/replay so agents iterate against fixed responses, no real API quota | ✓ v0.0.1 |
| 3 | [`@wifo/factory-context`](./packages/context) | Filesystem-first context store — typed shared memory + DAG of provenance | ✓ v0.0.1 |
| 4 | [`@wifo/factory-runtime`](./packages/runtime) | Phase-graph orchestrator — composes the four primitives, ships `validatePhase` + `implementPhase` | ✓ v0.0.2 |
| 5 | `@wifo/factory-scheduler` | Shift-work scheduler (autonomous task queue) | planned |

Domain packs (`@wifo/factory-pack-web`, `-pack-api`, etc.) extend core with domain-specific schema fields, judges, and twin presets. None ship yet.

---

## Repo layout

```
software-factory/
├── packages/
│   ├── core/           # @wifo/factory-core      — spec format + lint CLI
│   ├── harness/        # @wifo/factory-harness   — scenario runner (test + judge)
│   ├── twin/           # @wifo/factory-twin      — HTTP record/replay
│   ├── context/        # @wifo/factory-context   — filesystem-first context store
│   └── runtime/        # @wifo/factory-runtime   — phase-graph orchestrator
├── examples/
│   ├── slugify/        # v0.0.1 manual loop walkthrough
│   └── gh-stars/       # v0.0.2 agent-driven loop walkthrough
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
- **`claude` CLI on PATH** (for the v0.0.2 default graph). Sign in once via your Claude Pro/Max subscription; the runtime spawns it headless on your behalf. `--no-implement` lets you skip this requirement and run the v0.0.1 validate-only flow.

## What's missing from v0.0.2

- **Iteration auto-loop.** Default `--max-iterations` stays `1`. v0.0.3 closes the loop: validate-fail → re-prompt agent → validate again, until convergence or the run-level token budget.
- **Cross-iteration context plumbing.** Iteration N+1's prompt doesn't see iteration N's failures yet. v0.0.3.
- **`explorePhase` / `planPhase`.** Deferred until a real run shows `implement` is too low-context to converge without staged thinking. Maybe v0.0.3, maybe later.
- **Holdout-aware convergence.** Optional flag to also run holdout scenarios at the end of every iteration. v0.0.3 if it's pulling weight.
- **Scheduler (Layer 5).** Pulls `status: ready` specs and runs them overnight. Lands once the v0.0.3 loop is reliable.

## License

MIT — see [LICENSE](./LICENSE).

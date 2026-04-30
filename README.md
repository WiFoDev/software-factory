# software-factory

A toolkit for **spec-driven, agent-friendly software development**. You write a spec describing the *intent* and the *scenarios* a feature must satisfy. The factory's tooling lints the spec, runs the scenarios as tests (and optionally as LLM-judged criteria for things tests can't capture), persists everything as content-addressable records, and gives you a typed convergence report with full DAG provenance.

The end goal: agents that iterate against your spec until scenarios converge, with every iteration recorded and inspectable. v0.0.1 ships the entire framework around that loop except the agent itself; the implementation phase is a manual swap-in for now and gets a built-in driver in v0.0.2.

Inspired by the [StrongDM Software Factory](https://factory.strongdm.ai/) model.

---

## What you get today (v0.0.1)

A complete loop you can run end-to-end:

1. **Author a spec** with `/scope-task` (or write one by hand) — frontmatter + Given/When/Then scenarios + `Satisfaction:` lines pointing at tests and LLM-judged criteria.
2. **Lint** it: `factory spec lint docs/specs/`
3. **Run** it: `factory-runtime run docs/specs/my-feature.md --no-judge`
4. **Inspect** the convergence trail: `factory-context tree <runId>`

What's deferred to v0.0.2: the autonomous `explore` / `plan` / `implement` phases (Claude-Agent-SDK driven) that turn this from "ergonomic test runner with provenance" into "agent that drives the spec to green on its own."

---

## Worked example: spec a `slugify(text)` helper end-to-end

You're adding a small helper. Conventional flow: write the function, add tests, hope you covered the edge cases. Factory flow: write the spec first, let the runtime tell you when you're done.

### 1. Author the spec

```bash
$ /scope-task "Add a slugify(text) helper that lowercases, replaces non-alphanumerics with dashes, and collapses runs of dashes"
```

Result: `docs/specs/slugify-v1.md` lands with frontmatter, scenarios, subtasks, and a Definition of Done — produced by your `/scope-task` slash command in the format the factory's parser understands.

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

### 2. Lint the spec — does it parse?

```bash
$ factory spec lint docs/specs/slugify-v1.md
OK
```

Frontmatter shape, scenario well-formedness, satisfaction lines all check out. Ready to run.

### 3. Run the spec against an empty implementation

```bash
$ factory-runtime run docs/specs/slugify-v1.md --no-judge --context-dir ./.factory
factory-runtime: no-converge after 1 iteration(s) (run=08f7bae8214a22aa)
# exit code: 1
```

The harness ran `bun test` against your missing `src/slugify.test.ts` — both scenarios fail. The runtime persisted a `factory-run` record + a `factory-phase` record + a `factory-validate-report` record. Provenance is on disk.

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
$ factory-runtime run docs/specs/slugify-v1.md --no-judge --context-dir ./.factory
factory-runtime: converged in 1 iteration(s) (run=a1b2c3d4e5f60718, 32ms)
# exit code: 0
```

### 5. Walk the provenance

```bash
$ factory-context tree a1b2c3d4e5f60718 --dir ./.factory
a1b2c3d4e5f60718 [type=factory-run] 2026-04-30T...
├── 5f08abc94d2e3c11 [type=factory-validate-report] 2026-04-30T...
└── 9e7f2b18a36d04ac [type=factory-phase] 2026-04-30T...

$ factory-context get 5f08abc94d2e3c11 --dir ./.factory
{
  "version": 1,
  "id": "5f08abc94d2e3c11",
  "type": "factory-validate-report",
  "parents": ["a1b2c3d4e5f60718"],
  "payload": {
    "specId": "slugify-v1",
    "scenarios": [{ "id": "S-1", "status": "pass", ... }, { "id": "S-2", "status": "pass", ... }],
    "summary": { "pass": 2, "fail": 0, "error": 0, "skipped": 0 },
    "status": "pass"
  }
}
```

Every run leaves a typed, content-addressable, diffable trail on disk. `git log -- .factory/` shows what changed and when. If a holdout scenario fails six weeks from now, you can replay the exact `factory-validate-report` to see what passed back then.

### What just happened

Three observations worth registering:

1. **You didn't write a runner.** No glue code between the spec and `bun test`. The runtime composed `factory-core` (parsing) + `factory-harness` (scenario execution) + `factory-context` (provenance) for you.
2. **Convergence is the success signal**, not "tests pass." A spec with zero tests but five `judge:` lines converges when the LLM-judged criteria are met — exactly the same loop, different satisfaction kind.
3. **The provenance trail is what makes agents trustworthy.** v0.0.2 will let `implement` write code, run validate, and iterate until convergence — and every code change links back to the report that justified it. Not "the agent claimed it worked." Verifiable.

---

## The five packages

| Layer | Package | What it does | Status |
|---|---|---|---|
| 0 | [`@wifo/factory-core`](./packages/core) | Spec format, zod schema, markdown parser, `factory spec lint` CLI | ✓ v0.0.1 |
| 1 | [`@wifo/factory-harness`](./packages/harness) | Scenario runner — `bun test` for `test:` lines, Anthropic LLM judge for `judge:` lines | ✓ v0.0.1 |
| 2 | [`@wifo/factory-twin`](./packages/twin) | HTTP record/replay so agents iterate against fixed responses, no real API quota | ✓ v0.0.1 |
| 3 | [`@wifo/factory-context`](./packages/context) | Filesystem-first context store — typed shared memory + DAG of provenance | ✓ v0.0.1 |
| 4 | [`@wifo/factory-runtime`](./packages/runtime) | Phase-graph orchestrator — composes the four primitives, ships `validatePhase` built-in | ✓ v0.0.1 |
| 5 | `@wifo/factory-scheduler` | Shift-work scheduler (autonomous task queue) | planned |

Domain packs (`@wifo/factory-pack-web`, `-pack-api`, etc.) extend core with domain-specific schema fields, judges, and twin presets. None ship in v0.0.1.

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

## What's missing from v0.0.1

- **Autonomous implementation phase.** The runtime ships `validatePhase` as the only built-in. v0.0.2 adds Claude-Agent-SDK-backed `explore` / `plan` / `implement` so the agent drives the spec to green without manual swap-ins.
- **HTTP twins wired into the runtime loop.** The `twin` package is shipped and works standalone, but the runtime doesn't yet use it. Lands when v0.0.2's `implement` phase needs it.
- **Scheduler.** Layer 5 — autonomous task queue that picks `status: ready` specs and runs them overnight. Planned.

## License

MIT — see [LICENSE](./LICENSE).

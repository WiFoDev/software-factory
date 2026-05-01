# example-slugify

A scaffold for trying the software-factory loop end-to-end **with you in the implement seat instead of the agent** — `--no-implement` keeps the runtime in v0.0.1 validate-only mode so the loop is visible without `claude` in the way. **Nothing is implemented yet** — the point is to walk the loop yourself: write a spec, run it against an empty implementation (it'll fail), implement the helper, run again (it converges), inspect the provenance.

> Want the agent to do it? See [`examples/gh-stars`](../gh-stars) for the v0.0.2 single-shot and v0.0.3 unattended-loop walkthroughs. Want the v0.0.4 surface (init, spec review, descendants traversal) demonstrated end-to-end? See [`examples/parse-size`](../parse-size).

> The directory layout below — `package.json`, `tsconfig.json`, `.gitignore`, `src/`, `docs/specs/done/`, `docs/technical-plans/done/` — is what `factory init` produces in an empty cwd (v0.0.4+). To bootstrap a fresh project: `mkdir my-thing && cd my-thing && pnpm exec factory init`.

## Setup (one-time)

From the monorepo root:

```sh
pnpm install
```

That links the factory CLIs (`factory`, `factory-runtime`, `factory-context`) into this example's `node_modules/.bin`.

## The loop

All commands run from this directory (`examples/slugify`). `pnpm exec <bin>` pulls the bin from `node_modules/.bin`.

### 1. Scope the task

```sh
/scope-task "Add a slugify(text) helper that lowercases, replaces non-alphanumerics with dashes, and collapses runs of dashes"
```

(Run from inside this directory so the spec lands at `docs/specs/<id>.md`.)

The slash command writes the spec and an optional technical plan. Read both. Push back on anything that feels off — the spec is the contract.

### 2. Lint the spec

```sh
pnpm exec factory spec lint docs/specs/
# → OK
```

### 2.5 (optional) Review spec quality (v0.0.4+)

```sh
pnpm exec factory spec review docs/specs/<id>.md
# → 5 LLM judges score spec QUALITY (not just format) — internal consistency,
#   judge parity, DoD precision, holdout distinctness, cross-doc consistency.
# → All judges default to severity: 'warning' (exit 0 even with findings).
# → Subscription auth via claude -p; no ANTHROPIC_API_KEY needed.
```

### 3. Run it (will fail — no implementation yet)

```sh
pnpm exec factory-runtime run docs/specs/<id>.md --no-judge --no-implement --context-dir ./.factory
# → factory-runtime: no-converge after 1 iteration(s) (run=<runId>)
# → exit code 1
```

### 4. Implement

Write your code in `src/` and tests at the paths your spec's `test:` lines reference. Iterate until `bun test src` passes locally.

### 5. Run it again (convergence)

```sh
pnpm exec factory-runtime run docs/specs/<id>.md --no-judge --no-implement --context-dir ./.factory
# → factory-runtime: converged in 1 iteration(s) (run=<runId>, <Nms>)
# → exit code 0
```

### 6. Inspect the provenance

```sh
pnpm exec factory-context tree <runId> --dir ./.factory
pnpm exec factory-context get <reportId> --dir ./.factory
pnpm exec factory-context list --dir ./.factory
```

### 7. Archive the spec

```sh
/finish-task <id>
```

Sweeps the spec and technical plan into `docs/specs/done/` and `docs/technical-plans/done/`.

## Layout

```
examples/slugify/
├── package.json
├── tsconfig.json
├── .gitignore
├── src/                     # write your implementation + tests here
└── docs/
    ├── specs/
    │   └── done/            # /finish-task moves shipped specs here
    └── technical-plans/
        └── done/
```

## Tips

- The factory's `.factory/` directory holds the run records. It's gitignored — diffable history lives in commits, not in agent runs.
- `--no-judge` skips the LLM-judged satisfaction lines so you don't need an `ANTHROPIC_API_KEY` for the loop to work.
- `--no-implement` drops back to the v0.0.1 `[validate]`-only graph (no `claude` spawn). Drop the flag to let the agent fill in `src/` instead.
- If you want to try a different feature (not slugify) — preferred (v0.0.4+): `mkdir my-thing && cd my-thing && pnpm exec factory init --name my-thing`. Drops the same scaffold layout as this directory, idempotent + safe (preexisting target → exit 2, zero writes). The pre-v0.0.4 alternative `cp -r examples/slugify examples/<your-thing>` still works inside the monorepo.

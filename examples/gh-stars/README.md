# example-gh-stars

A scaffold for trying the v0.0.2 `[implement → validate]` loop end-to-end. **Nothing is implemented yet** — the point is to walk the loop:

1. you have a spec at `docs/specs/gh-stars-v1.md`
2. `factory-runtime run` invokes the agent (`claude -p`) which writes the implementation
3. validate runs `bun test` against the agent's output
4. inspect the provenance via `factory-context`

The spec's `getStargazers(repo, opts?)` helper is non-trivial enough to exercise the v0.0.2 cost cap, twin env-var plumbing, and the `factory-implement-report` payload — but small enough to converge in a single iteration on a good agent run.

## Setup (one-time)

From the monorepo root:

```sh
pnpm install
pnpm -r build
```

That links the factory CLIs (`factory`, `factory-runtime`, `factory-context`, `factory-twin`) into this example's `node_modules/.bin`.

You also need `claude` (the Claude Code CLI) on your PATH, signed in via your subscription:

```sh
claude --version
# claude 1.x.x
```

No `ANTHROPIC_API_KEY` is required — the runtime drives `claude -p` headless under your subscription auth.

## The loop

All commands run from this directory (`examples/gh-stars`). `pnpm exec <bin>` pulls the bin from `node_modules/.bin`.

### 1. Lint the spec

```sh
pnpm exec factory spec lint docs/specs/
# → OK
```

### 2. Run the loop (agent writes `src/`, validate runs the tests)

```sh
pnpm exec factory-runtime run docs/specs/gh-stars-v1.md --no-judge --context-dir ./.factory
```

What happens:

- **Iteration 1, implement phase**: the runtime spawns `claude -p --allowedTools "Read,Edit,Write,Bash" --bare --output-format json` with the spec source on stdin. The agent reads the spec, edits files in `examples/gh-stars/`, runs `bun test src` to verify, and exits.
- **Iteration 1, validate phase**: the harness runs `bun test src/gh-stars.test.ts -t "..."` for each `test:` line in the spec.
- **Convergence**: if validate passes, exit code 0. If it fails, exit code 1 with a typed report — re-run manually after the agent's next attempt (v0.0.3 will do this automatically).

### 3. Inspect the provenance

```sh
pnpm exec factory-context tree <runId> --dir ./.factory
pnpm exec factory-context get <implementReportId> --dir ./.factory
pnpm exec factory-context list --dir ./.factory
```

The `factory-implement-report` record carries the full prompt, the `result` text the agent wrote, the per-file diffs (from `git diff` if `examples/gh-stars/` is in a git repo), the tools the agent used, the token counts, and the claude exit status.

### 4. Iterate

If the agent didn't converge in iteration 1:

```sh
# Re-run — the agent picks up from the current disk state, no cross-iteration
# context plumbing in v0.0.2 (that's v0.0.3).
pnpm exec factory-runtime run docs/specs/gh-stars-v1.md --no-judge --context-dir ./.factory
```

### 5. Archive the spec

```sh
/finish-task gh-stars-v1
```

Sweeps the spec into `docs/specs/done/`.

## v0.0.2 knobs worth knowing

- `--max-prompt-tokens 100000` — hard cap on `usage.input_tokens` (default `100000`). Overruns terminate the run with a typed report.
- `--claude-bin <path>` — override the `claude` executable (useful for testing or for pinning a specific install).
- `--twin-mode <record|replay|off>` — sets `WIFO_TWIN_MODE` on the spawned subprocess. The spec's `Constraints / Decisions` notes that the tests use injected fetch (so the twin isn't required for convergence), but if you implement against the real GitHub API, set up `wrapFetch` from `@wifo/factory-twin` in your test setup using these env vars.
- `--twin-recordings-dir <path>` — explicit directory for HTTP recordings (default `./.factory/twin-recordings`).
- `--no-implement` — drop back to the v0.0.1 `[validate]`-only graph if you want to validate hand-written code without invoking the agent.

## Layout

```
examples/gh-stars/
├── package.json
├── tsconfig.json
├── .gitignore
├── src/                                 # the agent fills this in
└── docs/
    ├── specs/
    │   ├── gh-stars-v1.md               # the contract — lint with `factory spec lint`
    │   └── done/                        # /finish-task moves shipped specs here
    └── technical-plans/
        └── done/
```

## Tips

- The `.factory/` directory holds the run records. It's gitignored — diffable history lives in commits, not in agent runs.
- `--no-judge` skips the LLM-judged satisfaction lines so you don't need a separate Anthropic API key for the loop to work (the agent itself uses your `claude` subscription).
- The agent has `Read,Edit,Write,Bash` access in this directory. Use git as your undo button: `git status` after each run, commit the parts you like, `git restore` the parts you don't.
- If the agent's run hits the cost cap, the `factory-implement-report` is still persisted with status `'error'` and the agent's `result` text — useful for debugging what burned the budget.

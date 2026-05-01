# example-gh-stars

A walkthrough of the factory-runtime `[implement → validate]` loop. Two specs:

- **`docs/specs/gh-stars-v1.md`** — the v0.0.2 single-shot demo: a `getStargazers(repo, opts?)` helper with caching + rate-limit handling. Small enough to converge in one iteration.
- **`docs/specs/gh-stars-v2.md`** *(v0.0.3)* — extends v1 with **pagination**, **ETag/conditional caching**, and **retry-with-backoff on 5xx**. Designed to require iteration 2+ — the closed-loop demo for v0.0.3.

The v0.0.3 unattended loop drives `[implement → validate]` repeatedly (default `--max-iterations 5`) with the prior validate-report threaded into the next iteration's implement prompt. Run it once, walk away.

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

### 1.5 (recommended, v0.0.4+) Review spec quality

```sh
pnpm exec factory spec review docs/specs/gh-stars-v2.md
# → 5 LLM judges score the spec for quality (not just format) — internal
#   consistency, judge parity, DoD precision, holdout distinctness, and
#   cross-doc consistency against the paired technical-plan.
# → Subscription auth (claude -p), same path as the agent loop below.
# → Cache: re-runs against an unchanged spec are free.
```

`factory spec review` is the spec-side analog of the harness — a second-pass quality check before you spend tokens running the agent loop. All v0.0.4 judges ship at `severity: 'warning'`, so findings inform but don't gate the run.

### 2. Run the loop (agent writes `src/`, validate runs the tests)

**v0.0.2 single-shot (one iteration):**

```sh
pnpm exec factory-runtime run docs/specs/gh-stars-v1.md \
  --no-judge \
  --max-iterations 1 \
  --context-dir ./.factory
```

**v0.0.3 unattended loop (recommended for v2):**

```sh
pnpm exec factory-runtime run docs/specs/gh-stars-v2.md \
  --no-judge \
  --max-total-tokens 1000000 \
  --context-dir ./.factory
```

`--max-iterations` defaults to **5** in v0.0.3; `--max-total-tokens` defaults to 500_000. If your task uses long prompts, bump to ~1_000_000 (the default 500k ÷ 5 iterations = 100k/iter is the same as the per-phase cap, so they coexist tightly under defaults — see runtime README "default-budget tightness").

What happens:

- **Iteration 1, implement phase**: the runtime spawns `claude -p --allowedTools "Read,Edit,Write,Bash" --output-format json` with the spec source on stdin. The agent reads the spec, edits files in `examples/gh-stars/`, runs `bun test src` to verify, and exits.
- **Iteration 1, validate phase**: the harness runs `bun test src/gh-stars-v2.test.ts -t "..."` for each `test:` line in the spec.
- **Iteration 2+ (v0.0.3)**: if validate fails, the runtime threads the prior validate-report's failed scenarios into the next iteration's implement prompt under a `# Prior validate report` section, and runs implement → validate again. Up to `--max-iterations` times.
- **Convergence**: when validate passes, exit code 0. The CLI summary names the run id; `factory-context tree <runId>` walks the multi-iteration ancestry.

### 3. Inspect the provenance

```sh
# v0.0.4+: walk descendants of the run — the natural "what came out?" question.
pnpm exec factory-context tree <runId> --dir ./.factory --direction down

# Walk ancestors (default --direction up) from any leaf back to the run:
pnpm exec factory-context tree <implementReportId> --dir ./.factory

pnpm exec factory-context get <implementReportId> --dir ./.factory
pnpm exec factory-context list --dir ./.factory
```

The `factory-implement-report` record carries the full prompt, the `result` text the agent wrote, the per-file diffs (from `git diff` if `examples/gh-stars/` is in a git repo), the tools the agent used, the token counts, and the claude exit status.

### 4. Iterate

In v0.0.3, the runtime auto-iterates up to `--max-iterations` (default 5). If you hit `no-converge`, raise `--max-iterations` or fix the spec — the agent already has the prior failures threaded into its prompt for each retry.

If you want to manually re-run from the current disk state (e.g., after editing the spec):

```sh
pnpm exec factory-runtime run docs/specs/gh-stars-v2.md --no-judge --context-dir ./.factory
```

### 5. Archive the spec

```sh
/finish-task gh-stars-v1
```

Sweeps the spec into `docs/specs/done/`.

## Knobs worth knowing

- `--max-iterations 5` *(v0.0.3 default)* — autonomous loop budget. Set to `1` to recreate v0.0.2's single-shot.
- `--max-total-tokens 500000` *(v0.0.3 default)* — whole-run cap on summed `tokens.input + tokens.output` across every implement. **Bump to `1_000_000` for long-prompt tasks** (default ÷ 5 iterations ≈ 100k/iter, same as the per-phase cap — they coexist tightly).
- `--max-prompt-tokens 100000` — per-phase cap on `usage.input_tokens` (v0.0.2). Overruns terminate that iteration with `runtime/cost-cap-exceeded`.
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
- If the agent's run hits a cost cap, the `factory-implement-report` is still persisted (parents=[runId,...]) with the agent's `result` text — useful for debugging what burned the budget. Per-phase cap → `runtime/cost-cap-exceeded`. Whole-run cap → `runtime/total-cost-cap-exceeded`.
- v0.0.3 multi-iteration provenance: `factory-context tree <iter2-validate-report-id>` walks back through `iter2-validate → iter2-implement → iter1-validate → iter1-implement → factory-run`.

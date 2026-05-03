# URL shortener — canonical baseline prompt

This file is the **byte-stable test fixture** for measuring factory progress. Every baseline run pastes this prompt verbatim into a fresh Claude Code session; nothing changes between versions except the factory itself.

> **Editing rule:** do NOT modify this prompt to fit a new factory version. If the prompt needs an edit because the factory's API changed, that's a baseline reset — archive the current prompt as `<product>-prompt-vX.Y.Z-vA.B.C.md`, log the reset in `BASELINE.md`'s methodology section, and write a fresh canonical at the new version. The whole point is that the prompt is locked across runs of the same era.

This canonical was reset on 2026-05-03 for the v0.0.8 era. The v0.0.5–v0.0.7 prompt (manual decomposition; pre-`/scope-project`) is archived at [`url-shortener-prompt-v0.0.5-v0.0.7.md`](./url-shortener-prompt-v0.0.5-v0.0.7.md).

## Setup (do this BEFORE opening Claude Code)

```sh
mkdir ~/dev/url-shortener-v<X.Y.Z> && cd ~/dev/url-shortener-v<X.Y.Z>
git init -q
# now open Claude Code in this directory and paste the prompt below
```

Use a **fresh directory outside the software-factory monorepo** so `pnpm install` resolves `@wifo/factory-*` from public npm (that's part of what's being measured).

## The prompt (paste this verbatim)

```text
I want to use the @wifo/factory-* toolchain (v0.0.7+ on npm) to build a small URL shortener
end-to-end. Goal: a baseline run against the current state of the factory so we can capture
v0.0.8+ requirements concretely. We'll re-run this same prompt against future versions to
measure improvement.

### What we're building

A JSON-over-HTTP URL shortener. In-memory storage. Four endpoints, four specs, four runs.

1. `POST /shorten { url }` → `{ slug }`     (6-char base62; idempotent on the same URL)
2. `GET /:slug` → 302 redirect              (404 if missing)
3. Click tracking on every redirect          (timestamp + user-agent, in-memory log)
4. `GET /stats/:slug` → `{ clicks, lastClickedAt }`

Bun + native `Bun.serve` only. No Express, no DB, no frontend, no auth.

### Setup before scoping

Run these now, in order, and stop if any step fails:

```sh
npx -y @wifo/factory-core init --name url-shortener
pnpm install
git add -A && git commit -q -m "scaffold (factory init)"
```

Then create JOURNAL.md at the project root with this header:

```markdown
# url-shortener — factory baseline run

Date: <today>
Factory version: v<X.Y.Z> (the @wifo/factory-* packages on npm)
Goal: build a working URL shortener using the factory toolchain at its current state;
capture friction so v0.X.Y+1+ requirements stay concrete.

## Per-spec runs
```

Commit JOURNAL.md.

### Workflow (one decomposition, one walk)

After `factory init` finishes, invoke the slash command:

/scope-project A URL shortener with click tracking and JSON stats. JSON-over-HTTP, in-memory, no auth.

The command writes one spec file per dependency-ordered feature into `docs/specs/`. The
first spec is `status: ready`; the rest stay `status: drafting` with `depends-on:` edges
back to their predecessor.

Show me the generated specs before doing anything else. I want to be in the review seat:

- Read each spec end-to-end.
- Run `pnpm exec factory spec lint docs/specs/` — every spec should be OK.
- Run `pnpm exec factory spec review docs/specs/<first-id>.md` — eyeball the findings.
  All v0.0.4+ judges default to `severity: 'warning'` so nothing fails the run. If a judge
  fires with substance, STOP and tell me — that's a real signal.

When I confirm the specs read cleanly, walk the dependency DAG with one invocation:

```sh
pnpm exec factory-runtime run-sequence docs/specs/ \
    --no-judge --max-iterations 5 --max-total-tokens 1000000 --context-dir ./.factory
```

I'll flip `drafting → ready` as each spec converges (or, when status-aware iteration
ships, the runtime drives that). On every converge, capture the runId and append to
JOURNAL.md:

- Spec id, # of iterations, wall-clock duration, total tokens (sum of input+output across
  iterations from `factory-context get <implementReportId>`)
- One paragraph: what was unexpected, what felt awkward, what `/scope-project`,
  `depends-on`, or `run-sequence` made trivial that used to be manual

Move each shipped spec to `docs/specs/done/` with `git mv` before moving on.

### Rules

- Use Bun for tests (`bun test src`). No vitest, jest, or other test runners.
- Native `Bun.serve` for HTTP. No Express, Hono, or Koa.
- Each spec is the smallest version that satisfies its 3-5 scenarios. Don't over-engineer.
- Don't bundle multiple specs into one. Decomposition discipline is what we're testing —
  if `/scope-project` produced a spec that does too much, flag it; that's a real signal.
- Spec test paths: bare paths in `test:` lines. Write `test: src/foo.test.ts "name"`,
  not wrapped in backticks.
- When something feels awkward, write it in JOURNAL.md before fixing it. The friction
  IS the artifact.

### When all specs ship

Append a "Final state" section to JOURNAL.md:

- Total iterations across all spec runs
- Total tokens (sum of every implement-report's input+output)
- Total wall-clock time
- Top 3 friction points that the next factory minor would eliminate — ranked by how much
  annoyance they caused
- A `curl` cookbook against the running server, end-to-end:
  ```sh
  curl -X POST http://localhost:3000/shorten -d '{"url":"https://example.com"}' ...
  curl -L http://localhost:3000/<slug>
  curl http://localhost:3000/stats/<slug>
  ```
- One sentence: would you, the agent, want to use the factory for the next product?

Commit JOURNAL.md as the final commit. Don't push — we'll review locally.

Start with the setup commands. When `pnpm install` finishes cleanly and you've committed
the scaffold + JOURNAL.md header, invoke `/scope-project` with the description above and
show me the generated specs.
```

# URL shortener — canonical baseline prompt (v0.0.5–v0.0.7 era; archived 2026-05-03)
# URL shortener — canonical baseline prompt

This file is the **byte-stable test fixture** for measuring factory progress. Every baseline run pastes this prompt verbatim into a fresh Claude Code session; nothing changes between versions except the factory itself.

> **Editing rule:** do NOT modify this prompt to fit a new factory version. If the prompt needs an edit because the factory changed, that's a v0.X.Y → v0.X.Y+1 baseline reset — note it in `BASELINE.md`'s methodology section, archive the old prompt, and create a fresh canonical at v0.X.Y+1. The whole point is that the prompt is locked.

## Setup (do this BEFORE opening Claude Code)

```sh
mkdir ~/dev/url-shortener-v<X.Y.Z> && cd ~/dev/url-shortener-v<X.Y.Z>
git init -q
# now open Claude Code in this directory and paste the prompt below
```

Use a **fresh directory outside the software-factory monorepo** so `pnpm install` resolves `@wifo/factory-*` from public npm (that's part of what's being measured).

## The prompt (paste this verbatim)

```text
I want to use the @wifo/factory-* toolchain (v0.0.5+ on npm) to build a small URL shortener
end-to-end. Goal: a baseline run against the current state of the factory so we can capture
v0.0.6+ requirements concretely. We'll re-run this same prompt against future versions to
measure improvement.

### What we're building

A JSON-over-HTTP URL shortener. In-memory storage. Four endpoints, four specs, four runs.

1. `POST /shorten { url }` → `{ slug }`     (6-char base62; idempotent on the same URL)
2. `GET /:slug` → 302 redirect              (404 if missing)
3. Click tracking on every redirect          (timestamp + user-agent, in-memory log)
4. `GET /stats/:slug` → `{ clicks, lastClickedAt }`

Bun + native `Bun.serve` only. No Express, no DB, no frontend, no auth.

### Why we're decomposing manually

The factory's `/scope-project` slash command (natural-language → ordered specs) is a v0.0.6
deliverable — it doesn't ship until later. Until then, decomposition is the maintainer's
job. We're going to feel that friction explicitly. Capture every place where you (or I)
think "this would have been easier if /scope-project existed" in JOURNAL.md.

### The four specs, in dependency order

1. `url-shortener-core`     — `shortenUrl(url) → slug` + `resolveSlug(slug) → url`,
                              in-memory Map<slug, url>. Pure functions, no HTTP.
2. `url-shortener-redirect` — HTTP server: `POST /shorten` + `GET /:slug`. Depends on core.
3. `url-shortener-tracking` — every redirect records a click event to an in-memory log.
                              Depends on redirect.
4. `url-shortener-stats`    — `GET /stats/:slug` reads the click log. Depends on tracking.

### Per-spec workflow (we repeat this 4 times)

For each spec, in order:

1. **`/scope-task` the feature.** LIGHT classification. ~50-150 LOC of impl + tests.
   The first spec is `status: ready`; the rest stay `status: drafting` until their
   predecessor converges, then I flip them.
2. **`pnpm exec factory spec lint`** — should be OK.
3. **`pnpm exec factory spec review`** — eyeball the findings. All v0.0.4 judges default
   to `severity: 'warning'` so nothing fails the run. If a judge fires with substance,
   STOP and tell me — that's a real signal.
4. **Show me the spec before running.** Don't invoke `factory-runtime run` until I confirm.
   I want to be in the review seat.
5. **`pnpm exec factory-runtime run docs/specs/<id>.md --no-judge --max-iterations 5 \
       --max-total-tokens 1000000 --context-dir ./.factory`**
   On converge, capture the runId.
6. **Append to JOURNAL.md** (create at project root if it doesn't exist):
   - Spec id, # of iterations, wall-clock duration, total tokens (sum of input+output across
     iterations from `factory-context get <implementReportId>`)
   - One paragraph: what was unexpected, what felt awkward, what /scope-project or
     depends-on or sequence-runner would have made trivial
7. **Move the shipped spec to `docs/specs/done/`** with `git mv` before moving on.

### Setup before spec 1

Run these now, in order, and stop if any step fails:

```sh
npx -y @wifo/factory-core init --name url-shortener
pnpm install                              # ← this is the v0.0.5 publish smoke;
                                          #    confirm @wifo/factory-* resolve from npm
git add -A && git commit -q -m "scaffold (factory init)"
```

Then create JOURNAL.md with this header:

```markdown
# url-shortener — factory baseline run

Date: <today>
Factory version: v<X.Y.Z> (the four @wifo/factory-* packages on npm)
Goal: build a working URL shortener using the factory toolchain at its current state;
capture friction so v0.X.Y+1+ requirements stay concrete.

## Decomposition (manual; /scope-project ships in v0.0.6)

1. url-shortener-core
2. url-shortener-redirect
3. url-shortener-tracking
4. url-shortener-stats

## Per-spec runs
```

Then commit JOURNAL.md and tell me you're ready for spec 1.

### Rules

- Use Bun for tests (`bun test src`). No vitest, jest, or other test runners.
- Native `Bun.serve` for HTTP. No Express, Hono, or Koa.
- Spec test paths: NO backticks around the path. Write `test: src/foo.test.ts "name"`,
  not `` test: `src/foo.test.ts` "name" ``. (The harness has a known backtick-stripping
  bug — fix queued in BACKLOG as v0.0.5.x; for now, write bare paths.)
- Each spec is the smallest version that satisfies its 3-5 scenarios. Don't over-engineer.
- Don't bundle multiple specs into one. Decomposition discipline is what we're testing.
- When something feels awkward, write it in JOURNAL.md before fixing it. The friction
  IS the artifact.

### When all 4 specs ship

Append a "Final state" section to JOURNAL.md:

- Total iterations across all 4 runs
- Total tokens (sum of every implement-report's input+output)
- Total wall-clock time
- Top 3 friction points that /scope-project, depends-on, or sequence-runner would have
  eliminated — ranked by how much annoyance they caused
- A `curl` cookbook against the running server, end-to-end:
  ```sh
  curl -X POST http://localhost:3000/shorten -d '{"url":"https://example.com"}' ...
  curl -L http://localhost:3000/<slug>
  curl http://localhost:3000/stats/<slug>
  ```
- One sentence: would you, the agent, want to use the factory for the next product?

Commit JOURNAL.md as the final commit. Don't push — we'll review locally.

Start with the setup commands. When pnpm install finishes cleanly and you've committed
the scaffold + JOURNAL.md header, tell me you're ready for spec 1.
```

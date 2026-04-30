---
id: gh-stars-v1
classification: light
type: feat
status: ready
exemplars:
  - path: examples/slugify/src/slugify.ts
    why: "Tiny single-file helper pattern — small public surface, named-export, no dependencies, paired with a sibling `*.test.ts` file. Mirror this layout for `src/gh-stars.ts`."
---

# gh-stars-v1 — `getStargazers(repo, opts?)` helper that fetches stargazers from GitHub with caching + rate-limit handling

## Intent

A small CLI helper, exposed as `getStargazers(repo, opts?): Promise<Stargazer[]>`, that fetches a GitHub repository's stargazers via the REST API (`GET /repos/<owner>/<repo>/stargazers`), caches successful responses for a configurable TTL (default 5 minutes), and surfaces rate-limit hits as a typed error rather than throwing the raw 403. The agent has full freedom to choose the file layout — the only contract is the spec's `test:` lines and the `Constraints / Decisions` block. Walk-through demo for the v0.0.2 `[implement → validate]` loop: the agent implements `src/gh-stars.ts` and tests pass.

## Scenarios

**S-1** — happy path: returns parsed stargazers
  Given `repo: 'wifo/example'` and a successful 200 response from GitHub with two stargazer entries
  When `getStargazers(repo)` is called
  Then it returns an array of `Stargazer` objects whose `login` and `html_url` fields match the response, in response order
  Satisfaction:
    - test: src/gh-stars.test.ts "returns parsed stargazers on 200 OK"

**S-2** — caching: a second call within TTL hits the cache, not the network
  Given `getStargazers('wifo/example')` was just called and resolved with one network round-trip
  When `getStargazers('wifo/example')` is called again before the TTL elapses (default 5 minutes)
  Then no second network request is made; the cached array is returned
  And when the TTL has elapsed, the next call refetches
  Satisfaction:
    - test: src/gh-stars.test.ts "second call within TTL serves from cache"

**S-3** — rate limit: 403 with `X-RateLimit-Remaining: 0` becomes a typed error
  Given a GitHub response with status 403 and headers `X-RateLimit-Remaining: 0` and `X-RateLimit-Reset: <unix-ts>`
  When `getStargazers(repo)` is called
  Then the call rejects with an error whose `name === 'GhStarsRateLimitError'` (or matching the typed error your implementation defines), whose `.message` mentions the reset time as a human-readable hint, and whose `.resetAt` is a `Date` aligned with `X-RateLimit-Reset`
  Satisfaction:
    - test: src/gh-stars.test.ts "403 with rate-limit headers throws GhStarsRateLimitError with resetAt"
    - judge: "the error message would tell a user when they can retry without them having to read the X-RateLimit-Reset header themselves"

## Constraints / Decisions

- File layout: at minimum `src/gh-stars.ts` (public exports) and `src/gh-stars.test.ts` (the satisfaction tests above). Helper modules are fine; a single file is also fine.
- Public surface: `getStargazers(repo: string, opts?: { ttlMs?: number; fetch?: typeof fetch; now?: () => number }): Promise<Stargazer[]>` plus the typed error class. The injectable `fetch` and `now` make the test reliable without network.
- Tests must use the injected `fetch` mock; **do not** rely on real network access. The `@wifo/factory-twin` plumbing is wired by the runtime via env vars (`WIFO_TWIN_MODE`, `WIFO_TWIN_RECORDINGS_DIR`) for users who want to run the implementation against the real GitHub API in a recordable way; the spec's tests stay deterministic via injection.
- `repo` argument format is `'<owner>/<repo>'`. Reject malformed input early.
- Cache is process-local; a `Map<string, { fetchedAt: number; data: Stargazer[] }>` is sufficient. No persistence required.

## Definition of Done

- All scenarios pass (`pnpm exec factory-runtime run docs/specs/gh-stars-v1.md --no-judge --context-dir ./.factory` exits 0).
- `bun test src` from `examples/gh-stars/` is green.
- `pnpm exec factory spec lint docs/specs/` is green.

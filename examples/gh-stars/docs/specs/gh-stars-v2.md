---
id: gh-stars-v2
classification: light
type: feat
status: ready
exemplars:
  - path: examples/gh-stars/src/gh-stars.ts
    why: "v1's getStargazers helper — v2 extends this. Keep the same public shape (returns Stargazer[]) and the same injected-fetch testing pattern. v2 adds pagination, ETag/conditional caching, and retry-with-backoff."
---

# gh-stars-v2 — `getStargazers` extended with pagination, ETag/conditional caching, and retry-with-backoff

## Intent

Build on v1's `getStargazers(repo, opts?)` helper to handle three real-world GitHub API behaviors that v1 ignores:

1. **Pagination**: stargazer lists span multiple pages (`per_page` defaults to 30; popular repos have thousands). v2 walks `Link: <…>; rel="next"` headers until the next page is empty (or absent), concatenating results.
2. **Conditional caching via ETag**: when re-requesting (within or beyond the TTL), v2 sends `If-None-Match: <etag>` from the prior response. A 304 short-circuits the network round-trip and serves the cached body — saving rate-limit budget.
3. **Retry-with-backoff on transient 5xx**: GitHub occasionally returns 502/503/504 under load. v2 retries up to 2 additional times with exponential backoff (100ms → 200ms), then gives up and throws.

This spec is the v0.0.3 walkthrough demo: it has scenarios known to require iteration 2+ for the agent to converge, exercising the closed-loop iteration runtime.

## Scenarios

**S-1** — pagination: walks `rel="next"` Link headers until exhausted
  Given a repo `'wifo/popular'` whose first page has 2 stargazers and a `Link: <…?page=2>; rel="next"` header, page 2 has 1 stargazer and no `rel="next"`
  When `getStargazers('wifo/popular', { fetch: mock })` is called
  Then it returns 3 stargazers in `[page1[0], page1[1], page2[0]]` order; the mock fetch was invoked exactly twice (one per page)
  Satisfaction:
    - test: src/gh-stars-v2.test.ts "pagination: concatenates pages until rel=next absent"

**S-2** — ETag conditional caching: 304 short-circuits to cached body
  Given a first call that returns 200 + `ETag: "abc123"` + a body of 1 stargazer; the second call (same repo) sees the request go out with `If-None-Match: "abc123"` and the server responds 304 with no body
  When `getStargazers('wifo/repo')` is called twice (the second call after TTL has elapsed via injected `now`)
  Then both calls return the same single-stargazer array; the second call's mock fetch was invoked but received `If-None-Match: "abc123"` in its headers; on receipt of 304, the helper returned the cached body without parsing JSON
  Satisfaction:
    - test: src/gh-stars-v2.test.ts "ETag: 304 short-circuits to cached body with If-None-Match header sent"

**S-3** — retry-with-backoff on transient 5xx: succeeds on retry, gives up after 2 retries
  Given two sub-cases:
    (a) first call returns 503 (Service Unavailable); the second attempt returns 200 with 1 stargazer
    (b) all three attempts return 503
  When `getStargazers(repo, { fetch: mock, now: () => fixedTime })` is called (with a custom backoff scheduler injected via `opts.sleep` so the test doesn't actually wait)
  Then for (a): returns the single stargazer; mock fetch invoked exactly twice (1 fail + 1 success); the test's sleep mock was called once with the first backoff (100ms)
  And for (b): rejects with an error whose `.message` mentions `503` or "Service Unavailable" or "exhausted retries"; mock fetch invoked exactly 3 times (1 + 2 retries); sleep mock called twice (100ms then 200ms)
  Satisfaction:
    - test: src/gh-stars-v2.test.ts "retry-with-backoff: succeeds after 1 retry on 503"
    - test: src/gh-stars-v2.test.ts "retry-with-backoff: gives up after 2 retries on persistent 503"
    - judge: "the rejection message after exhausted retries gives a developer enough information to know that the helper retried, how many times, and what the final status was — without reading the source"

## Constraints / Decisions

- File layout: extend `src/gh-stars.ts` (don't replace v1's exports). Add a sibling `src/gh-stars-v2.test.ts` (or merge into the existing test file) for the v2 satisfactions.
- Public surface: `getStargazers(repo, opts?)` keeps the same v1 signature; `opts` extends with an optional `sleep?: (ms: number) => Promise<void>` for testable backoff. The pagination and ETag behavior are internal — no new exports needed.
- ETag store: extend the existing `cache: Map<string, ...>` entry shape to include `etag?: string`. No persistent storage; process-local Map is fine.
- Retry policy: at most 2 retries (3 total attempts). Backoff schedule `[100ms, 200ms]`. 5xx triggers retry; 4xx (other than the existing rate-limit handling) does not.
- Tests must use injected `fetch`, `now`, AND `sleep` mocks. Do not rely on real network or real timers.
- v1's existing scenarios (S-1, S-2, S-3 in `gh-stars-v1.md`) must still pass after v2 is implemented — backwards compatibility.

## Definition of Done

- All v2 scenarios pass (`pnpm exec factory-runtime run docs/specs/gh-stars-v2.md --no-judge --context-dir ./.factory --max-iterations 5 --max-total-tokens 1000000` exits 0).
- v1's tests still pass (`bun test src/gh-stars.test.ts` is green).
- `pnpm exec factory spec lint docs/specs/` is green.
- The closed-loop demo: at least one fixture run from this spec converges with `iterationCount > 1` (the moneyball test for v0.0.3).

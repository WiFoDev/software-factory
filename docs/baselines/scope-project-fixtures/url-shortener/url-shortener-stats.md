---
id: url-shortener-stats
classification: light
type: feat
status: drafting
depends-on:
  - url-shortener-tracking
---

# url-shortener-stats — `GET /stats/:slug` JSON endpoint

## Intent

Add a `GET /stats/:slug` HTTP endpoint that returns `{ slug, url, clicks }` as JSON, or 404 if the slug is unknown. Read-only; uses the click-tracking machinery from `url-shortener-tracking`.

## Scenarios

**S-1** — `GET /stats/:slug` returns `{ slug, url, clicks }` for a known slug
  Given a server where `slug=abc123` maps to `https://example.com/foo` with 5 clicks
  When the client `GET /stats/abc123`
  Then the response is HTTP 200; `Content-Type: application/json`; the body parses to `{ slug: 'abc123', url: 'https://example.com/foo', clicks: 5 }`
  Satisfaction:
    - test: src/stats.test.ts "GET /stats/:slug returns slug+url+clicks JSON"

**S-2** — `GET /stats/:slug` returns 404 for an unknown slug
  Given an empty server
  When the client `GET /stats/missing`
  Then the response is HTTP 404 with body `{ error: 'slug-not-found' }`
  Satisfaction:
    - test: src/stats.test.ts "GET /stats/:slug returns 404 with slug-not-found body for missing slug"

**S-3** — Calling `GET /stats/:slug` does NOT increment the click counter
  Given a server where `slug=abc123` has 5 clicks
  When the client `GET /stats/abc123` is called
  Then the slug's click count remains 5 (stats endpoint is read-only)
  Satisfaction:
    - test: src/stats.test.ts "GET /stats/:slug is read-only (does not increment clicks)"

## Constraints / Decisions

- New endpoint added to `src/redirect.ts`'s `createServer` (NOT a separate file — keeps the HTTP routing centralized). `GET /stats/:slug` is wired alongside the existing two routes.
- Uses the `slug-not-found` error code from `url-shortener-core`'s Constraints.
- Response shape is locked: `{ slug: string, url: string, clicks: number }`. Field ordering is `slug, url, clicks` for consistency.

## Subtasks

- **T1** [feature] — Add the `GET /stats/:slug` route handler to `src/redirect.ts`. ~20 LOC.
- **T2** [test] — `src/stats.test.ts`: tests covering S-1..S-3. ~50 LOC.

## Definition of Done

- All scenarios pass.
- `pnpm exec tsc --noEmit` clean.
- `pnpm test` green (including all earlier specs' tests).
- Live `curl` check: `curl http://localhost:<port>/stats/<slug>` returns the expected JSON shape.

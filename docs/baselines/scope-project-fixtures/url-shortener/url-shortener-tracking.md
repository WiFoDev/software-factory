---
id: url-shortener-tracking
classification: light
type: feat
status: drafting
depends-on:
  - url-shortener-redirect
---

# url-shortener-tracking — click counter on `GET /:slug`

## Intent

Add a per-slug click counter. Each `GET /:slug` increments an in-memory counter for that slug; the counter is queryable via a new `Storage.clicks(slug): number` method that returns 0 for unknown slugs.

## Scenarios

**S-1** — `GET /:slug` increments the slug's click counter
  Given a server where `slug=abc123` exists with click count 0
  When the client makes 3 successive `GET /abc123` requests
  Then `storage.clicks('abc123')` returns 3
  Satisfaction:
    - test: src/tracking.test.ts "GET /:slug increments click counter"

**S-2** — `Storage.clicks(slug)` returns 0 for unknown slugs
  Given an empty storage
  When `storage.clicks('nope')` is called
  Then it returns 0 (NOT null; NOT throw)
  Satisfaction:
    - test: src/tracking.test.ts "Storage.clicks returns 0 for unknown slug"

**S-3** — Click counter does NOT increment on 404 responses
  Given an empty server
  When the client `GET /missing` (returns 404)
  Then `storage.clicks('missing')` returns 0
  Satisfaction:
    - test: src/tracking.test.ts "404 path does not increment click counter"

## Constraints / Decisions

- Extend the `Storage` interface from `url-shortener-core` with `clicks(slug: string): number` and `incrementClicks(slug: string): void`. Both methods are added to `createInMemoryStorage`.
- The `redirect.ts` server's `GET /:slug` handler calls `storage.incrementClicks(slug)` AFTER confirming the slug exists (before sending the 302).
- Click count is per-process / in-memory only — persistence is out of scope.

## Subtasks

- **T1** [feature] — Extend `src/core.ts` with `clicks` + `incrementClicks` on the `Storage` interface and `createInMemoryStorage`. ~30 LOC.
- **T2** [feature] — Wire `incrementClicks` into `src/redirect.ts`'s GET handler. ~10 LOC.
- **T3** [test] — `src/tracking.test.ts`: tests covering S-1..S-3. ~60 LOC.

## Definition of Done

- All scenarios pass.
- `pnpm exec tsc --noEmit` clean.
- `pnpm test` green (including all earlier specs' tests).

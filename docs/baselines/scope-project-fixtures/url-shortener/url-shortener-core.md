---
id: url-shortener-core
classification: light
type: feat
status: ready
depends-on: []
---

# url-shortener-core — slug + URL shape + storage interface

## Intent

Define the data shapes, error codes, and storage interface that every later spec in the URL-shortener product depends on. Pure module — no HTTP, no persistence beyond an in-memory `Map`.

## Scenarios

**S-1** — `generateSlug(url)` returns a 6-char base62 slug and is idempotent for the same URL
  Given a URL `https://example.com/foo`
  When `generateSlug(url)` is called twice with the same input
  Then both calls return the same slug; the slug is exactly 6 characters long; every character is in `[0-9A-Za-z]`
  Satisfaction:
    - test: src/core.test.ts "generateSlug is idempotent"
    - test: src/core.test.ts "generateSlug produces a 6-char base62 slug"

**S-2** — `Storage.get(slug)` returns `null` for an unknown slug
  Given an empty storage instance
  When `storage.get('abc123')` is called
  Then it returns `null`
  Satisfaction:
    - test: src/core.test.ts "Storage.get returns null for missing slug"

## Constraints / Decisions

- Public exports from `src/core.ts`: `generateSlug(url: string): string`, `Storage` interface (`get(slug): URL | null`, `put(slug, url): void`), `createInMemoryStorage(): Storage`.
- Slug shape: 6 base62 chars (`[0-9A-Za-z]`); deterministic on URL via the SHA-256 hash's first 36 bits, base62-encoded.
- Error codes (used across all later specs): `'invalid-url'` (URL fails URL parse), `'slug-not-found'` (lookup miss). Throw `Error` with the code as the message prefix.

## Subtasks

- **T1** [feature] — `src/core.ts`: `generateSlug`, `Storage` interface, `createInMemoryStorage`. ~60 LOC.
- **T2** [test] — `src/core.test.ts`: tests covering S-1, S-2 + edge cases (empty URL, very long URL). ~40 LOC.

## Definition of Done

- All scenarios pass.
- `pnpm exec tsc --noEmit` clean.
- `pnpm test` green.

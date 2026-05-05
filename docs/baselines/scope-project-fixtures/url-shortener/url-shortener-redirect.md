---
id: url-shortener-redirect
classification: light
type: feat
status: drafting
depends-on:
  - url-shortener-core
---

# url-shortener-redirect — `POST /shorten` + `GET /:slug` HTTP server

## Intent

Wire `Bun.serve` to two endpoints: `POST /shorten { url }` returns `{ slug }`; `GET /:slug` returns a 302 redirect to the stored URL or 404 if missing. Uses the `Storage` interface from `url-shortener-core` (no direct in-memory access here).

## Scenarios

**S-1** — `POST /shorten` returns `{ slug }` for a valid URL
  Given a running server with empty storage
  When the client posts `{ url: 'https://example.com' }` to `/shorten`
  Then the response is HTTP 200 with body `{ slug: '<6-char base62>' }`; the slug matches `[0-9A-Za-z]{6}`
  Satisfaction:
    - test: src/redirect.test.ts "POST /shorten returns slug for valid URL"

**S-2** — `GET /:slug` returns 302 redirect for a known slug
  Given a server where `slug=abc123` maps to `https://example.com/foo`
  When the client `GET /abc123` (no follow)
  Then the response is HTTP 302 with `Location: https://example.com/foo`
  Satisfaction:
    - test: src/redirect.test.ts "GET /:slug returns 302 for known slug"

**S-3** — `GET /:slug` returns 404 for an unknown slug
  Given an empty server
  When the client `GET /missing`
  Then the response is HTTP 404
  Satisfaction:
    - test: src/redirect.test.ts "GET /:slug returns 404 for missing slug"

**S-4** — boots the production entrypoint on the configured port
  Given the spec's public API exports
  When `bun src/main.ts` (or the entrypoint declared in Constraints) is spawned with PORT=<test-port>
  Then the process binds the configured port; a /health probe (or any defined route) returns 2xx; the process is killed cleanly
  Satisfaction:
    - test: src/main.test.ts "boots the production entrypoint on the configured port"

## Constraints / Decisions

- New file: `src/redirect.ts`. Public export: `createServer(storage: Storage, port?: number): { stop(): void; port: number }`.
- New file: `src/main.ts`. Production entrypoint — instantiates `createInMemoryStorage()`, calls `createServer(storage, Number(process.env.PORT ?? 3000))`, and serves a `/health` route returning HTTP 200 `{ ok: true }` for the smoke-boot probe.
- Uses the `Storage` interface from `url-shortener-core`'s `src/core.ts` — does NOT define its own storage.
- Bad URL on `POST /shorten` → HTTP 400 with body `{ error: 'invalid-url' }` (uses the error code from `url-shortener-core`'s Constraints).

## Subtasks

- **T1** [feature] — `src/redirect.ts`: `createServer` with the two endpoints + `/health`. ~80 LOC.
- **T2** [feature] — `src/main.ts`: production entrypoint that boots `createServer` on `process.env.PORT`. ~15 LOC.
- **T3** [test] — `src/redirect.test.ts`: tests covering S-1..S-3 using ephemeral ports. ~70 LOC.
- **T4** [test] — `src/main.test.ts`: smoke-boot test covering S-4 (spawn `bun src/main.ts`, probe `/health`, kill cleanly). ~40 LOC.

## Definition of Done

- All scenarios pass.
- `pnpm exec tsc --noEmit` clean.
- `pnpm test` green (including url-shortener-core's tests).

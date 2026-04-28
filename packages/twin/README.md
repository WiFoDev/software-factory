# @wifo/factory-twin

Digital twin for HTTP/`fetch`. Record real interactions to disk, then replay them in tests and agent runs without burning real API quota or risking production state.

## Modes

- **`record`** — wrap a real `fetch`, persist each request/response pair to `recordingsDir` as one JSON file per interaction. Filename is a stable 16-char hex hash of `method + url + body + selected headers`.
- **`replay`** — match incoming requests against existing recordings. A miss throws `TwinNoMatchError`; the real network is never touched.

`auto`, `passthrough`, and `synthesize` modes are deferred past v0.0.1.

## Install

```bash
pnpm add @wifo/factory-twin
```

Requires Node 22+ (or Bun) for the global Fetch types.

## Usage

```ts
import { wrapFetch } from '@wifo/factory-twin';

const recordedFetch = wrapFetch(fetch, {
  mode: 'record',
  recordingsDir: './recordings',
});

const res = await recordedFetch('https://api.example.com/users/42');
// → real fetch is called, response is persisted to ./recordings/<hash>.json,
//   res is a freshly-constructed Response identical to the real one.
```

In tests / agent iteration, swap `mode: 'replay'` and the same code reads from disk:

```ts
const replayFetch = wrapFetch(fetch, {
  mode: 'replay',
  recordingsDir: './recordings',
});

const res = await replayFetch('https://api.example.com/users/42');
// → no network call, response served from ./recordings/<hash>.json.
//   On a miss: throws TwinNoMatchError.
```

## `hashHeaders` — and the bearer-token footgun

By default, **no** request headers participate in the hash. Two requests differing only in their `Authorization` header collide on disk and will replay the same response. That's a footgun: a request signed with one bearer token will happily replay a recording made with a different one — and you won't notice unless the response itself encodes the identity.

If your traffic is auth-bearing, list the headers that affect identity:

```ts
const recordedFetch = wrapFetch(fetch, {
  mode: 'record',
  recordingsDir: './recordings',
  hashHeaders: ['authorization', 'x-tenant-id'],
});
```

`hashHeaders` entries are matched case-insensitively against incoming headers. Only the listed headers are persisted in the recording's `request.headers` (auditable: you can tell what was hashed by reading the file).

## Request body shapes

v0.0.1 accepts `string`, `URLSearchParams`, `null`, and `undefined` as request bodies. Anything else (`FormData`, `Blob`, `ReadableStream`, typed arrays) throws `TwinReplayError({ code: 'twin/unsupported-body' })`. Lift this in a later version once we settle on serialization for those shapes.

Response bodies of any byte content are supported. Bytes that round-trip through UTF-8 decoding are stored as `bodyEncoding: 'utf8'`; otherwise they're base64-encoded for byte-exact fidelity (PNGs, gzip, protobuf, etc.).

## URL canonicalization

URLs are canonicalized via `new URL(input).toString()`. Query order is **significant**: `?a=1&b=2` and `?b=2&a=1` produce different hashes. Sort your query strings if you want them to collapse to one recording.

## Recording schema

```jsonc
{
  "version": 1,
  "hash": "8f3a…",                  // 16 hex chars; equals the filename stem
  "recordedAt": "2026-04-28T…Z",
  "request": {
    "method": "POST",
    "url": "https://api.x/y",
    "headers": { "authorization": "…" },  // ONLY hashed headers
    "body": "raw string" | null
  },
  "response": {
    "status": 200,
    "statusText": "OK",
    "headers": { "content-type": "…" },
    "body": "…" | null,
    "bodyEncoding": "utf8" | "base64"
  }
}
```

Files are written atomically (tmp + rename). Concurrent writes for the same hash are last-writer-wins; partial JSON files never appear.

## Hash collisions

The 16-char filename is the first 16 hex chars (64 bits) of SHA-256. At 100k recordings the collision probability is ~1 in 4 billion. Fine for agent iteration; not designed for adversarial inputs.

## CLI

```
factory-twin list                     [--dir <path>]
factory-twin inspect <hash>           [--dir <path>]
factory-twin prune --older-than <n>   [--dir <path>] [--dry-run]
```

Default `--dir` is `./recordings`.

- `list`: tab-separated `<hash>\t<method>\t<url>\t<recordedAt>`, sorted by `recordedAt` ascending. Corrupt files reported on stderr; exits 0 either way.
- `inspect`: pretty-prints the recording. Missing hash → exit 3 with `twin/recording-not-found <hash>` on stderr.
- `prune`: deletes recordings older than N×24h ago (UTC). `--dry-run` prints `would-prune` lines without unlinking. Corrupt neighbor files are reported on stderr but don't change the exit code — the deletion work is what matters.

Exit codes: `0` ok, `2` usage error, `3` operational error (target dir missing, `inspect` hash not found).

## Public API

```ts
import {
  wrapFetch,
  hashRequest,
  listRecordings,
  pruneRecordings,
  readRecording,
  writeRecording,
  TwinNoMatchError,
  TwinReplayError,
} from '@wifo/factory-twin';

import type {
  WrapFetchOptions,
  TwinMode,
  HashRequestInput,
  HashRequestOptions,
  PruneResult,
  Recording,
  RecordedRequest,
  RecordedResponse,
} from '@wifo/factory-twin';
```

## Errors

Both error classes expose a stable `code: string` for matching in user code:

| Class | `code` values |
|---|---|
| `TwinNoMatchError` | `'twin/no-match'` |
| `TwinReplayError` | `'twin/unsupported-body'`, `'twin/recording-not-found'`, `'twin/parse-error'`, `'twin/io-error'` |

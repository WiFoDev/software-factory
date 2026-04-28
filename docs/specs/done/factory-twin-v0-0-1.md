---
id: factory-twin-v0-0-1
classification: deep
type: feat
status: ready
exemplars:
  - path: packages/harness/src/cli.ts
    why: CLI pattern — manual subcommand dispatch, injectable CliIo, parseArgs per subcommand, exit-code mapping.
  - path: packages/harness/src/index.ts
    why: Public API surface pattern — explicit re-exports, `import type` for types, internal helpers stay unexported.
  - path: packages/core/src/cli.test.ts
    why: Subprocess-driven tests with `Bun.spawn` for end-to-end CLI verification.
  - path: packages/harness/src/runner.ts
    why: Operational-error pattern — never throw on recoverable state, surface failures as typed errors with `code:` prefix in `detail`.
---

# factory-twin-v0-0-1 — HTTP/fetch digital twin with record and replay modes

## Intent

Layer-2 of the factory: make external HTTP calls *replayable*. `@wifo/factory-twin` exports `wrapFetch(realFetch, options)` returning a fetch-compatible function. In **record** mode it forwards every request to the real fetch and persists the request/response pair to disk as one JSON file per interaction (filename = stable 16-char hex hash of method + url + body + selected headers). In **replay** mode it serves matching recordings from disk and throws `TwinNoMatchError` on a miss. Ships a `factory-twin {list|inspect|prune}` CLI for managing recordings on disk. Zero runtime dependencies; same monorepo conventions as `@wifo/factory-core` and `@wifo/factory-harness`.

## Scenarios

**S-1** — `wrapFetch` in record mode persists request/response and returns the real response unchanged
  Given a fake `realFetch` that returns `200 OK` with body `'{"ok":true}'` and an empty `recordingsDir`
  When the wrapped fetch is called with `POST https://api.x/y` and body `'{"a":1}'`
  Then `realFetch` is called exactly once, the returned `Response` has `.status === 200` and `.json()` returns `{ ok: true }`, and `<recordingsDir>/<hash>.json` exists with `version: 1`, the recorded request method/url/body, and the recorded response status/body
  Satisfaction:
    - test: `src/wrap-fetch.test.ts` "record mode persists and returns real response"

**S-2** — `wrapFetch` in replay mode serves a recorded response without calling `realFetch`
  Given a recordings directory containing one recording for `GET https://api.x/y`
  When the wrapped fetch is called with the same method+url+body+hashed-headers
  Then `realFetch` is **not** called, the returned `Response` has the recorded `status`, `statusText`, headers, and body, and `.text()` returns the recorded body verbatim
  Satisfaction:
    - test: `src/wrap-fetch.test.ts` "replay mode serves recording and skips realFetch"

**S-3** — `wrapFetch` in replay mode throws `TwinNoMatchError` on unknown request
  Given an empty `recordingsDir`
  When the wrapped fetch is called in replay mode
  Then it rejects with `TwinNoMatchError`, the error has `code === 'twin/no-match'`, `hash` matches the request, and `method`/`url` are populated; `realFetch` is not called
  Satisfaction:
    - test: `src/wrap-fetch.test.ts` "replay mode throws TwinNoMatchError on miss"
    - judge: "the error message names the hash, method, and URL so a developer can locate or generate the missing recording without re-running anything"

**S-4** — `hashRequest` is stable across runs and includes only configured `hashHeaders`
  Given the same `{ method, url, body, headers }` input on two separate calls (and a second input that differs only in a header NOT listed in `hashHeaders`)
  When `hashRequest` is called
  Then the first two calls produce the same 16-char hex hash, the third call also produces that same hash (the unlisted header doesn't affect it), and a fourth call differing in a hashed header produces a different hash
  Satisfaction:
    - test: `src/hash.test.ts` "stable across runs and only hashes configured headers"

**S-5** — `factory-twin list` emits one line per recording with hash, method, url, recordedAt
  Given a `recordingsDir` containing two recordings
  When `factory-twin list --dir <recordingsDir>` is invoked via `Bun.spawn`
  Then exit code is `0`, stdout has two lines (sorted by `recordedAt` ascending), each line is tab-separated `<hash>\t<method>\t<url>\t<recordedAt>`
  Satisfaction:
    - test: `src/cli.test.ts` "list emits one tab-separated line per recording"

**S-6** — `factory-twin inspect <hash>` pretty-prints recording JSON; missing hash exits 3
  Given a `recordingsDir` containing one recording with hash `H`
  When `factory-twin inspect H --dir <recordingsDir>` is invoked
  Then exit code is `0` and stdout is the pretty-printed JSON of that recording
  And when invoked with a hash that does not exist
  Then exit code is `3`, stderr contains `twin/recording-not-found  <hash>`, stdout is empty
  Satisfaction:
    - test: `src/cli.test.ts` "inspect prints recording JSON; missing hash exits 3"
    - judge: "the not-found error message is specific enough to act on without consulting source code"

**S-7** — `factory-twin prune --older-than <days>` removes recordings older than N days; `--dry-run` is non-destructive
  Given a `recordingsDir` with one recording recorded today and one recorded 10 days ago
  When `factory-twin prune --older-than 7 --dir <recordingsDir>` is invoked
  Then exit code is `0`, stdout reports one `pruned` line, the 10-day-old file is gone, the today file remains
  And when the same command is re-run with `--dry-run` after recreating the old file
  Then exit code is `0`, stdout reports one `would-prune` line, **both files remain on disk**
  Satisfaction:
    - test: `src/cli.test.ts` "prune deletes old recordings; --dry-run leaves them in place"

## Holdout Scenarios

**H-1** — Concurrent record-mode calls for the same hash never produce a partial/corrupt JSON file
  Given two record-mode calls with identical method+url+body+hashed-headers issued concurrently
  When both complete
  Then `<recordingsDir>/<hash>.json` exists, parses as valid JSON, and matches **one** of the two recordings exactly (last-writer-wins is acceptable; partial/corrupt content is not)

**H-2** — Response with non-utf8 bytes round-trips via base64 with byte-exact fidelity
  Given a `realFetch` that returns a response whose body is the raw bytes `\x89PNG\r\n\x1a\n...` (a PNG header)
  When the wrapped fetch records the response and a second wrapped fetch (replay mode) replays it
  Then the persisted recording has `bodyEncoding: 'base64'`, and the replay-mode `Response.arrayBuffer()` returns the exact same bytes the original `realFetch` returned

**H-3** — `factory-twin prune` over a directory containing a corrupt JSON file reports it as skipped instead of crashing, and exits 0
  Given a `recordingsDir` containing one valid old recording and one file (`<hash>.json`) whose contents are not valid JSON
  When `factory-twin prune --older-than 1 --dir <recordingsDir>` is invoked
  Then exit code is `0` (the deletion work completed), stdout reports the valid recording as `pruned`, stderr reports the corrupt file as `skipped` with a parse-error reason, and the corrupt file is left on disk untouched

## Constraints / Decisions

- No runtime dependencies. Source uses only `node:crypto`, `node:fs/promises`, `node:path`, `node:url`, `node:util`, and the global Fetch types (`Request`, `Response`, `Headers`, `fetch`).
- Both error classes expose a stable `code: string` property. The class is the type discriminator (matched via `instanceof`); `.code` is the machine-readable identifier for matching in user code and CLI output. `TwinNoMatchError.code === 'twin/no-match'`. `TwinReplayError.code ∈ { 'twin/unsupported-body', 'twin/recording-not-found', 'twin/parse-error', 'twin/io-error' }`. The set of `code` values is stable; adding one is a public-API change.
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. Every type import uses `import type`. Every array/object index access is guarded.
- Recording schema is versioned (`version: 1`). One JSON file per interaction at `<recordingsDir>/<hash>.json`. Filename stem equals the hash.
- Filename hash is the first 16 hex chars of `sha256(canonicalJson({method, url, body, headers}))`. `canonicalJson` sorts object keys recursively for deterministic serialization. Collision probability documented in README.
- Default `hashHeaders: []` — no headers participate in the hash. Explicit > magical. Header names are lowercased for the lookup; values are taken verbatim. **Footgun**: a caller who records with one bearer token and forgets to add `'authorization'` (or equivalent) to `hashHeaders` will replay that recording under a different token and never notice. The README must call this out explicitly with a copy-pasteable example.
- URL canonicalization is `new URL(input).toString()` only. Query order is significant (`?a=1&b=2` ≠ `?b=2&a=1`). Documented in README.
- Request body scope for v0.0.1: `string | URLSearchParams | null | undefined`. `URLSearchParams` is serialized via `.toString()`. Anything else (`FormData`, `Blob`, `ReadableStream`, typed arrays) throws `TwinReplayError({ code: 'twin/unsupported-body' })`.
- Response body scope: any bytes. Bytes that round-trip through `TextDecoder('utf-8', { fatal: true })` are stored as `bodyEncoding: 'utf8'`; otherwise as `bodyEncoding: 'base64'`. When `body: null`, `bodyEncoding` is canonically `'utf8'` (the value is unused but the field is required by the schema).
- Recording's `request.headers` stores the **hashed subset only** (auditable). Recording's `response.headers` stores all response headers, flattened to `Record<string, string>` with lowercased keys; duplicates resolve to last-wins (matches Fetch spec).
- Atomic writes: write to `<hash>.json.tmp.<rand>` then `rename` to `<hash>.json`. POSIX rename within the same FS is atomic. No locking; same hash → last-writer-wins.
- `wrapFetch` never silently swallows errors. Disk failures (`EACCES`, missing `recordingsDir`, parse failures of an existing recording) throw `TwinReplayError` with a `code` prefix.
- `pruneRecordings` and `listRecordings` skip files that fail to parse and surface them via their return values (`{ recordings, skipped }`), never throw on corrupt files.
- CLI: manual subcommand dispatch on `argv[0] ∈ {list, inspect, prune}`; `parseArgs` consumes the remainder. Injectable `CliIo`. Default `--dir` is `./recordings` relative to cwd.
- CLI exit codes: `0` ok, `2` usage error (unknown subcommand, missing required flag, malformed `--older-than`), `3` operational error (target dir missing, `inspect` hash not found). `prune` exits `0` whenever its own deletion work completed — corrupt/unparseable neighbor files are reported on **stderr** as `<hash>\tskipped\t<reason>` but do not change the exit code. Principle: the exit code reports the action, stderr reports the world.
- `list` output format: tab-separated `<hash>\t<method>\t<url>\t<recordedAt>`, one per line, sorted by `recordedAt` ascending.
- `prune --older-than <days>` interprets days as integer × 24h ago in UTC. `--dry-run` prints `would-prune` lines without unlinking.
- Only `record` and `replay` modes ship in v0.0.1. `auto`, `passthrough`, and `synthesize` are deferred.
- Public API surface from `src/index.ts` is fixed (see technical plan §2). Adding a name in v0.0.1 requires updating both the plan and this spec.

## Subtasks

- **T1** [config] — Bump `packages/twin/package.json` to `0.0.1`; set `"test": "bun test src"`; create empty source files (`types.ts`, `hash.ts`, `serialize.ts`, `store.ts`, `errors.ts`, `wrap-fetch.ts`, `cli.ts`); ensure `tsconfig.build.json` excludes test files. ~30 LOC.
- **T2** [feature] — `src/types.ts`: `Recording`, `RecordedRequest`, `RecordedResponse`, `TwinMode`. Pure type module. ~60 LOC.
- **T3** [feature] — `src/hash.ts` + tests: `hashRequest({method,url,body,headers}, {hashHeaders})` → 16-char hex; canonical-JSON helper sorts keys recursively; tests cover stability across calls, header subset behavior, lowercased lookup, body-null handling. **depends on T2**. ~100 LOC.
- **T4** [feature] — `src/serialize.ts` + tests: `Request → RecordedRequest` (read body once, support `string | URLSearchParams | null | undefined`, reject other shapes with `TwinReplayError`); `Response` capture (read body bytes once, classify utf8/base64); `RecordedResponse → Response` (decode base64 if needed, return fresh `Response`). **depends on T2**. ~180 LOC.
- **T5** [feature] — `src/errors.ts` + `src/store.ts` + tests: `TwinNoMatchError`, `TwinReplayError` classes with `code` field; `readRecording`, `writeRecording` (atomic via tmp+rename), `listRecordings`, `pruneRecordings` returning `{ recordings | pruned, skipped }`; tests cover atomic write, parse-error skip, prune cutoff math. **depends on T2**. ~180 LOC.
- **T6** [feature] — `src/wrap-fetch.ts` + tests: record path (forward → capture → persist → return reconstructed `Response`), replay path (read → reconstruct or throw `TwinNoMatchError`), unsupported-body rejection. Tests use a fake `realFetch` and a tmp `recordingsDir`. **depends on T3, T4, T5**. ~150 LOC.
- **T7** [feature] — `src/cli.ts` + tests via `Bun.spawn`: `list [--dir]`, `inspect <hash> [--dir]`, `prune --older-than <days> [--dir] [--dry-run]`; manual subcommand dispatch on `argv[0]`; injectable `CliIo`; exit-code mapping. **depends on T5**. ~220 LOC.
- **T8** [chore] — `src/index.ts` public re-exports matching technical plan §2; expand `packages/twin/README.md` with usage examples for `wrapFetch` (record + replay), the recording schema, the `hashHeaders` knob, the supported request-body shapes, and the URL-canonicalization caveat. **depends on T2..T7**. ~40 LOC.

## Definition of Done

- All visible scenarios pass (tests green; judge criteria met).
- All holdout scenarios pass at end-of-task review.
- `pnpm -C packages/twin typecheck` clean.
- `pnpm -C packages/twin test` green (`bun test`); `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/twin build` produces a working `dist/cli.js`.
- `node packages/twin/dist/cli.js list --dir <empty-tmp-dir>` exits 0 with empty stdout.
- Public API surface from `src/index.ts` matches the technical plan §2 exactly.
- README in `packages/twin/` documents: the two modes, the `hashHeaders` option **including the bearer-token footgun with a copy-pasteable example showing `hashHeaders: ['authorization']`**, supported request-body shapes (and the unsupported ones with a pointer to the error code), the URL-canonicalization caveat, the 64-bit hash collision note, and Node 22+ as the supported runtime.

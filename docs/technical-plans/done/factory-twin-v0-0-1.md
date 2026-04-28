# Technical Plan — `@wifo/factory-twin` v0.0.1

## 1. Context

- `@wifo/factory-core` and `@wifo/factory-harness` are shipped under conventions established across the monorepo: strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `node:util` `parseArgs` with manual subcommand dispatch, injectable `CliIo` for testability, `<file>.test.ts` next to source, `bun test`. The CLI exemplar is `packages/harness/src/cli.ts`; the public-API exemplar is `packages/harness/src/index.ts`.
- `packages/twin/` is scaffolded: `package.json` declares `bin.factory-twin → dist/cli.js`, `dependencies: {}`, ESM module, `bun test`. `tsconfig.json` and `tsconfig.build.json` mirror core/harness's split. `src/index.ts` is empty (`export {};`).
- Harness's empty test suite once made `pnpm test` fail because `bun test` exits non-zero when no test files match — `packages/twin/` will fail the same way today and v0.0.1 fixes it as a side effect.
- The package is a *runtime* utility (used inside agent processes), not just CLI tooling. It must run anywhere Web `fetch` is available — Node 22+, Bun, modern browsers in principle. So we restrict the runtime to standard Node modules (`node:crypto`, `node:fs/promises`, `node:path`, `node:url`, `node:util`) and the global Fetch types (`Request`, `Response`, `Headers`). No Bun-specific APIs in source.

## 2. Architecture decisions

### Error class contract

Both error classes expose a stable `code: string` field — the class is the type discriminator (matched with `instanceof`); `.code` is the machine-readable identifier for matching in user code, log lines, and CLI stderr output.

```ts
class TwinNoMatchError extends Error {
  readonly code: 'twin/no-match';
  readonly hash: string;
  readonly method: string;
  readonly url: string;
}

class TwinReplayError extends Error {
  readonly code:
    | 'twin/unsupported-body'
    | 'twin/recording-not-found'
    | 'twin/parse-error'
    | 'twin/io-error';
}
```

`code` values are stable; adding a new one is a public-API change.

### Module layout

```
packages/twin/src/
├── types.ts          # Recording, RecordedRequest, RecordedResponse, TwinMode
├── hash.ts           # hashRequest({method,url,body,headers}, {hashHeaders}) → 16-char hex
├── serialize.ts      # Request → RecordedRequest, RecordedResponse → Response
├── store.ts          # readRecording, writeRecording (atomic), listRecordings, pruneRecordings
├── errors.ts         # TwinNoMatchError, TwinReplayError
├── wrap-fetch.ts     # wrapFetch(realFetch, opts)
├── cli.ts            # factory-twin {list|inspect|prune}
└── index.ts          # public re-exports
```

Tests: `<module>.test.ts` next to source, mirroring `packages/core` and `packages/harness`.

### Public API

The full public surface from `src/index.ts`. The DoD's "matches §2" check is strict equality between this list and what `index.ts` re-exports. Every other symbol stays internal.

```ts
// fetch wrapper
export { wrapFetch } from './wrap-fetch.js';
export type { WrapFetchOptions, TwinMode } from './wrap-fetch.js';

// hashing
export { hashRequest } from './hash.js';
export type { HashRequestInput, HashRequestOptions } from './hash.js';

// store
export {
  listRecordings,
  readRecording,
  writeRecording,
  pruneRecordings,
} from './store.js';
export type { PruneResult } from './store.js';

// errors
export { TwinNoMatchError, TwinReplayError } from './errors.js';

// recording schema
export type { Recording, RecordedRequest, RecordedResponse } from './types.js';
```

**Intentionally not exported** (internal helpers): canonical-JSON helper, base64 codec, request-body reader, atomic-write helper, default `recordingsDir` constant. They keep their definitions in their files but don't surface from `index.ts` — every public name is a future refactor cost.

### Recording schema (v1)

```ts
type Recording = {
  version: 1;
  hash: string;            // 16 hex chars; equals the filename stem
  recordedAt: string;      // ISO-8601 UTC
  request: RecordedRequest;
  response: RecordedResponse;
};

type RecordedRequest = {
  method: string;          // uppercased
  url: string;             // canonical: new URL(input).toString()
  headers: Record<string, string>;  // ONLY hashed headers; lowercased keys
  body: string | null;     // utf8 text; null if no body
};

type RecordedResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;  // lowercased keys, single-valued (last wins)
  body: string | null;
  bodyEncoding: 'utf8' | 'base64';
};
```

One JSON file per interaction at `<recordingsDir>/<hash>.json`. Files are written atomically: write `<hash>.json.tmp.<rand>` then `rename` to `<hash>.json` (POSIX rename within the same FS is atomic).

### Hash inputs

```ts
sha256(canonicalJson({
  method: METHOD.toUpperCase(),
  url: new URL(input).toString(),
  body: bodyText ?? null,
  headers: headerSubset,    // sorted lowercase keys ∈ hashHeaders
})).slice(0, 16)
```

`canonicalJson` sorts object keys recursively so JSON serialization is deterministic. Default `hashHeaders: []` — no headers participate in the hash. `hashHeaders` entries are lowercased before lookup.

16 hex chars = 64 bits. Collision probability at 100k recordings ≈ 1 in 4 billion. Acceptable for v0.0.1; documented in README.

### `wrapFetch(realFetch, opts)` semantics

```ts
type TwinMode = 'record' | 'replay';

interface WrapFetchOptions {
  mode: TwinMode;
  recordingsDir: string;
  hashHeaders?: string[];   // default []
}

function wrapFetch(
  realFetch: typeof fetch,
  opts: WrapFetchOptions,
): typeof fetch;
```

Internal flow per call:

1. Normalize input to a `Request` (`new Request(input, init)`).
2. Read the request body to text **once**:
   - `string`, `URLSearchParams`, `null`, `undefined` are supported. `URLSearchParams` is serialized via `.toString()`.
   - Anything else (`FormData`, `Blob`, `ReadableStream`, typed arrays) throws `TwinReplayError({ code: 'twin/unsupported-body' })`. Documented as v0.0.1 scope.
3. Compute `hash` via `hashRequest({ method, url, body, headers }, { hashHeaders })`.
4. **record mode**: forward to `realFetch(req)`. Read response body once as bytes; classify as utf8 (round-trips through `TextDecoder('utf-8', { fatal: true })`) or base64. Persist `Recording`. Return a fresh `new Response(body, { status, statusText, headers })` reconstructed from captured bytes (so the caller can still call `.json()`/`.text()` on it).
5. **replay mode**: read `<recordingsDir>/<hash>.json`. On `ENOENT` throw `TwinNoMatchError({ hash, method, url })`. On hit, reconstruct and return a fresh `Response` from the recorded bytes (decoded from base64 if needed).

In both modes the returned `Response` is freshly constructed, so its body stream is unread.

### CLI

```
factory-twin list      [--dir <path>]
factory-twin inspect   <hash> [--dir <path>]
factory-twin prune     --older-than <days> [--dir <path>] [--dry-run]
```

- Default `--dir` is `./recordings` resolved from cwd.
- `list`: one line per recording, tab-separated: `<hash>\t<method>\t<url>\t<recordedAt>`. Sorted by `recordedAt` ascending. Empty directory prints nothing and exits 0.
- `inspect <hash>`: pretty-prints the recording JSON to stdout. Missing hash → exit 3, stderr `twin/recording-not-found  <hash>`.
- `prune --older-than <days>`: deletes recordings whose `recordedAt` is older than N×24h ago (UTC). `--dry-run` prints what would be deleted without unlinking. One line per recording on stdout: `<hash>\tpruned` (or `would-prune`). Corrupt/unparseable files are reported on **stderr** as `<hash>\tskipped\t<reason>` and do not affect the exit code — `prune` exits `0` if its own deletion work completed, regardless of how many neighbor files were skipped. The principle: exit code reports the action, stderr reports the world.
- Manual subcommand dispatch on `argv[0] ∈ {list, inspect, prune}`; `parseArgs` consumes the remainder per subcommand. Injectable `CliIo` matches harness.
- Exit codes: `0` ok (including `prune` runs with skipped neighbors), `2` usage error (unknown subcommand, missing required flag, malformed `--older-than`), `3` operational error (target dir missing, `inspect` hash not found).

### Dependency choices

| Dependency | Range | Why |
|---|---|---|
| (none) | — | Runtime is `node:*` + global Fetch only. |

Dev-only: `@types/bun` (already present).

### Confirmed constraints

- No runtime deps. Source uses only `node:crypto`, `node:fs/promises`, `node:path`, `node:url`, `node:util`, and the global Fetch types.
- URL canonicalization is `new URL().toString()` only — query order is significant (`?a=1&b=2` ≠ `?b=2&a=1`). Documented.
- Headers stored in the recording's `request.headers` are the **subset that was hashed** (auditable). Response headers are stored in full but flattened to `Record<string,string>` with lowercased keys; on duplicate header names the last value wins (matches Fetch spec).
- Body scope for v0.0.1: `string | URLSearchParams | null | undefined` for requests. Response bodies of any byte content are supported via base64 fallback.
- Atomic writes via tmp+rename. Same hash means same recording → record mode overwrites; last writer wins. No locking.
- `pruneRecordings` skips files that fail to parse and surfaces them in `PruneResult.skipped[]`. The function never throws on a corrupt file.
- `listRecordings` skips files that fail to parse and surfaces them via the return value (`{ recordings, skipped }`); the CLI maps that to stderr lines but exits 0 (corruption isn't a usage error for `list`).
- `wrapFetch` never silently swallows errors. Disk failures (`EACCES`, missing `recordingsDir`, etc.) are thrown as `TwinReplayError` with a `code`.
- Hash truncated to 16 hex chars. README documents collision probability.
- All type imports use `import type` (`verbatimModuleSyntax`). Every array/object index access is guarded.
- No `auto`/`passthrough`/`synthesize` modes in v0.0.1 — only `record` and `replay`.

## 3. Risk assessment

- **Body fidelity**: binary responses (images, gzip, protobuf) are common. Mitigated by base64 fallback after a `TextDecoder fatal` round-trip. Pinned by H-2.
- **Atomic write**: a crash mid-write must not produce a partial JSON file the next replay reads. Mitigated by tmp-file + rename. Pinned by H-1.
- **Hash collision**: 64 bits is fine at recording-set sizes typical of agent iteration (≪ 1M). Documented limit.
- **Fetch API portability**: relies on global `Request`, `Response`, `Headers`, `fetch` types. Node 22+ and Bun expose them; older Node would not. README pins Node 22+ as the supported runtime.
- **Non-string request bodies**: explicitly rejected with `twin/unsupported-body`. Easy to lift in a later version once we agree on `FormData` / stream serialization.
- **Concurrent writes**: two record-mode calls hashing to the same file race on rename. POSIX rename is atomic, so the file always reads as one of the two complete versions — never partial. Pinned by H-1.
- **Blast radius**: contained to `packages/twin/`. No changes to `factory-core` or `factory-harness`. `pnpm test` becomes green again as a side effect of T1 adding a real test file.

## 4. Subtask outline

Eight subtasks, ~750 LOC of source plus tests. Full breakdown with test pointers in `docs/specs/factory-twin-v0-0-1.md`.

- T1 [config] Bump version + scripts + scaffold source files
- T2 [feature] types
- T3 [feature] hashRequest
- T4 [feature] serialize (request/response ⇄ recording)
- T5 [feature] errors + store (atomic write, list, prune)
- T6 [feature] wrapFetch (depends on T3, T4, T5)
- T7 [feature] CLI (depends on T5)
- T8 [chore] index.ts public exports + README

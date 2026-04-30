---
id: factory-context-v0-0-1
classification: deep
type: feat
status: ready
exemplars:
  - path: packages/twin/src/store.ts
    why: Atomic-write + list + skipped-files pattern. Same on-disk shape (`<id>.json`); same `{ records, skipped }` return for listing.
  - path: packages/twin/src/hash.ts
    why: canonicalJson + sha256 + 16-hex-truncation pattern. Reuse the recursive-key-sort serializer; do not import from twin (keep packages standalone).
  - path: packages/twin/src/cli.ts
    why: Manual subcommand dispatch, injectable CliIo, parseArgs per subcommand, exit-code mapping (0/2/3), `<filename>\tskipped\t<reason>` stderr convention.
  - path: packages/twin/src/errors.ts
    why: Typed code-prefixed error class. v0.0.1 collapses to a single `ContextError` whose structured fields (`.issues`, `.missingParent`) hang directly off the class — analogous in spirit to `TwinNoMatchError`'s `hash`/`method`/`url`, just unified into one class because there's only one error class to begin with.
  - path: packages/harness/src/index.ts
    why: Public API surface convention — explicit re-exports, `import type` for types, internal helpers stay unexported.
---

# factory-context-v0-0-1 — Filesystem-first context store with content-addressable records and a DAG of provenance

## Intent

Layer-3 of the factory: make agent phases share *typed memory*. `@wifo/factory-context` exports `createContextStore({ dir })` returning an object with `register(type, zodSchema)`, `put(type, payload, { parents? })`, `get(id)`, `list({ type? })`, and `parents(id)`. Each `put` returns a content-addressable id (16-char hex of `sha256(canonicalJson({ type, parents (sorted), payload }))`). Records persist as one JSON file per record at `<dir>/<id>.json` with shape `{ version: 1, id, type, recordedAt, parents, payload }`. Ships a `factory-context {list|get|tree}` CLI for inspecting the store. Single runtime dependency: `zod`. Same monorepo conventions as `@wifo/factory-core`, `@wifo/factory-harness`, `@wifo/factory-twin`.

## Scenarios

**S-1** — `register` + `put` + `get` round-trip a record on disk
  Given a fresh `dir`, a store from `createContextStore({ dir })`, and a registered type `'note'` with schema `z.object({ text: z.string() })`
  When `put('note', { text: 'hello' })` is called
  Then it returns a 16-char lowercase hex id, the file `<dir>/<id>.json` exists with shape `{ version: 1, id, type: 'note', recordedAt: <iso>, parents: [], payload: { text: 'hello' } }`, and `get(id)` returns that record verbatim; `get('deadbeefdeadbeef')` (a non-existent id) returns `null`
  Satisfaction:
    - test: `src/store.test.ts` "put/get round-trips a record and get returns null on miss"

**S-2** — `put` rejects unregistered types and invalid payloads
  Given a store with `'note'` registered as `z.object({ text: z.string() })`
  When `put('comment', { text: 'x' })` is called (unregistered type)
  Then it rejects with a `ContextError` whose `code === 'context/unregistered-type'`
  And when `put('note', { text: 42 })` is called (invalid payload)
  Then it rejects with a `ContextError` whose `code === 'context/schema-validation-failed'` and `.issues` is a non-empty array of `ZodIssue`
  Satisfaction:
    - test: `src/store.test.ts` "put rejects unregistered types and invalid payloads"
    - judge: "the schema-validation error message and `.issues` make the offending field locatable without re-running anything"

**S-3** — `put` rejects when a declared parent id does not exist on disk
  Given a store with `'note'` registered and an empty `dir` (no records put yet)
  When `put('note', { text: 'x' }, { parents: ['0000000000000001'] })` is called
  Then it rejects with a `ContextError` whose `code === 'context/parent-missing'` and `.missingParent === '0000000000000001'`; no file is written
  Satisfaction:
    - test: `src/store.test.ts` "put rejects when a declared parent does not exist"

**S-4** — `id` is stable and varies with type, parents, and payload (but not recordedAt, parent order, or duplicate parents)
  Given a registered type `'note'`
  When `put('note', { text: 'x' })` is called twice in succession (different recordedAt values)
  Then both calls return the **same** id
  And when one record is put with `parents: ['<a>','<b>']`, another with `parents: ['<b>','<a>']`, and a third with `parents: ['<a>','<a>','<b>']` (same set, different insertion order, duplicates), all three return the **same** id; the persisted `parents` field on each is `['<a>','<b>']` (deduplicated, first-occurrence order from the third call collapses to `['<a>','<b>']` since that was its first-occurrence order)
  And when the type is changed (`'comment'` registered with the same schema, same payload, same parents) or the payload changes (`{text:'y'}`) or the parent set changes (`['<a>']` → `['<a>','<b>']`), the id is **different** in each case
  Satisfaction:
    - test: `src/hash.test.ts` "stable across recordedAt, parent order, and parent duplicates; varies with type, payload, parent-set"
    - test: `src/store.test.ts` "put deduplicates parents on disk preserving first-occurrence order"

**S-5** — `list({ type })` filters by type; `parents(id)` returns ids on hit and `null` on miss
  Given a store with `'note'` and `'comment'` registered, two `'note'` records put, one `'comment'` record put with `parents: [<note1Id>]`
  When `list()` is called
  Then it returns all three records sorted by `recordedAt` ascending (with `id` ascending as tie-break for any equal `recordedAt`)
  And when `list({ type: 'note' })` is called
  Then it returns only the two note records
  And when `parents(<commentId>)` is called
  Then it returns `[<note1Id>]` (single-element array, insertion order preserved)
  And when `parents('deadbeefdeadbeef')` is called (id does not exist)
  Then it returns `null` (symmetric with `get`'s null-on-miss)
  Satisfaction:
    - test: `src/store.test.ts` "list filters by type and tie-breaks by id; parents returns ids on hit and null on miss"

**S-6** — CLI `list` and `get` work against a directory written by the store
  Given a `dir` containing two records (one `'note'` recorded yesterday, one `'design'` recorded today) written via `writeRecord`
  When `factory-context list --dir <dir>` is invoked via `Bun.spawn`
  Then exit code is `0`, stdout has two tab-separated lines `<id>\t<type>\t<recordedAt>` sorted ascending by `recordedAt`
  And when `factory-context list --type design --dir <dir>` is invoked
  Then exit code is `0`, stdout has exactly one line for the `'design'` record
  And when `factory-context get <noteId> --dir <dir>` is invoked
  Then exit code is `0`, stdout is the pretty-printed JSON of that record
  And when `factory-context get deadbeefdeadbeef --dir <dir>` is invoked
  Then exit code is `3`, stderr contains `context/record-not-found  deadbeefdeadbeef`, stdout is empty
  Satisfaction:
    - test: `src/cli.test.ts` "list (with and without --type filter) and get (hit + miss)"
    - judge: "the not-found error message names the id so a developer can locate or generate the missing record without re-running anything"

**S-7** — CLI `tree <id>` renders an ASCII ancestry of the record and its parents
  Given a `dir` with three records: `A` (root, no parents), `B` (parents: `[A]`), `C` (parents: `[B]`)
  When `factory-context tree <C-id> --dir <dir>` is invoked
  Then exit code is `0`, stdout shows the root `<C-id>` line followed by indented child lines for `B` and then `A`, each line including the id and `[type=<type>]`, with `└──`/`├──` glyphs from a deterministic ASCII tree renderer
  And when `factory-context tree deadbeefdeadbeef --dir <dir>` is invoked (root id missing)
  Then exit code is `3`, stderr contains `context/record-not-found  deadbeefdeadbeef`
  Satisfaction:
    - test: `src/cli.test.ts` "tree renders ancestry; missing root exits 3"

## Holdout Scenarios

**H-1** — Concurrent `put` calls with identical `(type, parents, payload)` never produce a partial/corrupt JSON file
  Given two `put` calls with the same registered type and identical payload + parents issued concurrently from the same process
  When both complete
  Then `<dir>/<id>.json` exists, parses as a valid `ContextRecord`, has `version: 1`, and matches **one** of the two writes exactly (last-writer-wins is acceptable; partial/corrupt content is not). A subsequent `get(id)` returns the parsed record without throwing.

**H-2** — `factory-context tree` over a record whose declared parent does not exist on disk renders `<missing>` inline and exits 0
  Given a `dir` containing one record `X` whose `parents` array references `00000000deadbeef`, but `<dir>/00000000deadbeef.json` does not exist
  When `factory-context tree <X-id> --dir <dir>` is invoked
  Then exit code is `0`, stdout shows the line for `X`, and a child line where the missing ancestor renders as `00000000deadbeef <missing>` (no further recursion under it). No throw, no exit-3.

**H-3** — `factory-context tree` detects a cycle in corrupt records and stops without infinite recursion
  Given a `dir` containing two hand-crafted record files where each record's `parents` list references the other's id (a cycle that real `put` would never produce, but a hand-edited file can)
  When `factory-context tree <one-id> --dir <dir>` is invoked
  Then exit code is `0`, stdout shows each id at most twice (once as itself, once where the cycle is closed and rendered as `<id> <cycle>`), and the process terminates within a normal CLI timeout — never recurses infinitely.

## Constraints / Decisions

- One runtime dependency: `zod@^3.23.8` (already in `package.json`). Source uses only `node:crypto`, `node:fs/promises`, `node:path`, `node:url`, `node:util`, plus `zod`. No cross-package imports from the other three factory packages — keep this layer standalone.
- `ContextError` is a single class with a stable `code: string` field. The class is the type discriminator (matched via `instanceof`); `.code` is the machine-readable identifier. Codes: `context/unregistered-type`, `context/duplicate-registration`, `context/schema-validation-failed`, `context/parent-missing`, `context/io-error`, `context/parse-error`, `context/version-mismatch`. `schema-validation-failed` carries `.issues: ZodIssue[]`; `parent-missing` carries `.missingParent: string`. The set of `code` values is stable; adding one is a public-API change.
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. Every type import uses `import type`. Every array/object index access is guarded.
- Record schema is versioned (`version: 1`). One JSON file per record at `<dir>/<id>.json`. Filename stem equals the id. Reading a record with a different `version` → `ContextError('context/version-mismatch')`.
- Filename id is the first 16 hex chars of `sha256(canonicalJson({ type, parents: [...new Set(parents)].sort(), payload }))`. `canonicalJson` sorts object keys recursively (mirrors twin's serializer; reused logic, separate file). Collision probability documented in README.
- `recordedAt` is **excluded** from the hash. Two identical artifacts at different times collide intentionally — that is the point of content addressing.
- Caller-passed `parents` are **deduplicated** before hashing and before storage. The set of parents is what matters for identity, not order or multiplicity. `put('x', p, { parents: ['a','b'] })`, `put('x', p, { parents: ['b','a'] })`, and `put('x', p, { parents: ['a','a'] })` all produce the same id. The persisted `parents` array is the deduplicated input in first-occurrence order; the hash uses the same set sorted ascending.
- Registry is in-memory and per-store-instance. Not persisted to disk. Cross-process callers re-register at startup. `register` throws `context/duplicate-registration` if called twice for the same type.
- `put` requires the type to be registered (`context/unregistered-type`), validates the payload against the registered schema (`context/schema-validation-failed`), and verifies every parent in the deduplicated parent list exists on disk before the hash is computed (`context/parent-missing`). Order: type-check → schema-check → dedup-parents → parent-existence-check → hash → write.
- `get(id)` returns `null` on `ENOENT` (does not throw). `parents(id)` returns `null` on miss (symmetric with `get`); callers that want the lenient flavor write `(await store.parents(id)) ?? []`. Read errors other than missing-file (parse failure, version mismatch, IO) propagate as `ContextError`.
- Dynamic-registration ergonomics: `register<T>(type, schema)` and `put<T>(type, payload)` are independently parameterized — TS does not statically link the schema's `T` to the payload type at `put`. Runtime zod validation catches mismatches; static typing is best-effort. Stronger alternatives (typed handle returned by `register`, `Registry` generic on the store) are deferred — v0.0.1 favors API simplicity over static linkage.
- Atomic writes: write to `<id>.json.tmp.<rand>` then `rename` to `<id>.json`. POSIX rename within the same FS is atomic. No locking; same id → last-writer-wins.
- Store-FS layer (`store-fs.ts`) is schema-unaware — it validates the record envelope only. Payload validation is the registry's job (`store.ts`).
- `listRecords` (low-level, exported) returns `{ records, skipped }`; corrupt files are reported via `skipped[]` and never throw. Both `list` and `listRecords` sort ascending by `recordedAt` with `id` ascending as the tie-break — fully reproducible across platforms regardless of dir-read order. Store-level `list` filters silently for a clean type signature; the CLI uses `listRecords` directly to surface corruption on stderr.
- CLI: manual subcommand dispatch on `argv[0] ∈ {list, get, tree}`; `parseArgs` consumes the remainder. Injectable `CliIo`. Default `--dir` is `./context` relative to cwd. The CLI does NOT instantiate `createContextStore` — it operates on raw envelope data via `listRecords`/`readRecord`, since there are no schemas to register from the command line.
- CLI exit codes: `0` ok, `2` usage error (unknown subcommand, missing required positional like `<id>`), `3` operational error (target dir missing, root id not found). Corrupt/unparseable neighbor files surface on stderr as `<filename>\tskipped\t<reason>` and do not change the exit code (matches twin's "exit code reports the action, stderr reports the world" principle).
- `list` output format: tab-separated `<id>\t<type>\t<recordedAt>`, one per line, sorted by `recordedAt` ascending. With `--type <name>`, only records where `record.type === <name>`.
- `get <id>` output format: pretty-printed JSON (2-space indent, trailing newline) of the record.
- `tree <id>` output format: ASCII tree using `├──`/`└──`/`│  ` glyphs. Each node renders as `<id> [type=<type>] <recordedAt>`. Missing ancestors render as `<id> <missing>`. Cycle nodes render as `<id> <cycle>` with no further recursion. Parents of each node are rendered in the **insertion order stored on the record** (not the sorted order used in the hash) — `formatTree` is faithful to what was put.
- Public API surface from `src/index.ts` is fixed (see technical plan §2). Adding a name in v0.0.1 requires updating both the plan and this spec.

## Subtasks

- **T1** [config] — Bump `packages/context/package.json` to `0.0.1`; confirm `"test": "bun test src"`; create empty source files (`types.ts`, `hash.ts`, `errors.ts`, `store-fs.ts`, `store.ts`, `tree.ts`, `cli.ts`); confirm `tsconfig.build.json` excludes test files. ~30 LOC.
- **T2** [feature] — `src/types.ts`: `ContextRecord` (version: 1, id, type, recordedAt, parents, payload). Pure type module. ~30 LOC.
- **T3** [feature] — `src/hash.ts` + tests: `hashRecord({ type, parents, payload })` → 16-char hex; canonical-JSON helper sorts keys recursively (mirrors twin's, reused logic, no cross-package import); parents are deduplicated and sorted before hashing. Tests cover stability across calls, recordedAt independence, parent-order independence, parent-duplicate independence, type/payload/parent-set sensitivity. **depends on T2**. ~110 LOC.
- **T4** [feature] — `src/errors.ts` + `src/store-fs.ts` + tests: `ContextError` class with `code`, optional `.issues`, optional `.missingParent`; `readRecord`, `writeRecord` (atomic via tmp+rename), `listRecords` returning `{ records, skipped }`; envelope validation (`version: 1`, required fields). Tests cover atomic write, parse-error skip, version mismatch, ENOENT-returns-null. **depends on T2**. ~190 LOC.
- **T5** [feature] — `src/store.ts` + tests: `createContextStore({ dir })` returning the store object. Implements `register` (rejects duplicates), `put` (type-check → zod validation → dedup-parents → parent-existence check → hash → atomic write; persists deduplicated `parents` in first-occurrence order), `get`, `list({ type? })` (sort by recordedAt asc, id asc tie-break), `parents` (null on miss). Tests use a fake registry of two types, a tmp `dir`, and exercise every error path including parent dedup. **depends on T3, T4**. ~160 LOC.
- **T6** [feature] — `src/tree.ts` + tests: `buildTree(rootId, lookup)` traverses the parents DAG carrying an ancestor set for cycle detection; emits `marker: 'ok' | 'missing' | 'cycle'` per node. `formatTree(node)` renders a deterministic ASCII tree. Tests cover the linear chain (root → parent → grandparent), the missing-ancestor case, the cycle case, and a multi-parent diamond. **depends on T2, T4**. ~140 LOC.
- **T7** [feature] — `src/cli.ts` + tests via `Bun.spawn`: `list [--type] [--dir]`, `get <id> [--dir]`, `tree <id> [--dir]`; manual subcommand dispatch on `argv[0]`; injectable `CliIo`; exit-code mapping. Uses `listRecords`/`readRecord`/`buildTree`/`formatTree` directly (no `createContextStore`). **depends on T4, T6**. ~210 LOC.
- **T8** [chore] — `src/index.ts` public re-exports matching technical plan §2; expand `packages/context/README.md` with: usage examples for `register`/`put`/`get`/`list`/`parents`, the on-disk record schema, the hash-input definition (including the "parents sorted internally; insertion order preserved on disk" note), the v0.0.1 error-code list with example handling code, and Node 22+ as the supported runtime. **depends on T2..T7**. ~50 LOC.

## Definition of Done

- All visible scenarios pass (tests green; judge criteria met).
- All holdout scenarios pass at end-of-task review.
- `pnpm -C packages/context typecheck` clean.
- `pnpm -C packages/context test` green (`bun test`); `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/context build` produces a working `dist/cli.js`.
- `node packages/context/dist/cli.js list --dir <empty-tmp-dir>` exits 0 with empty stdout.
- Public API surface from `src/index.ts` matches the technical plan §2 exactly.
- README in `packages/context/` documents: the on-disk record schema, the hash-input definition with the parent-order/recordedAt-exclusion notes, the registry's in-memory-only nature, the full `context/*` error-code list, and Node 22+ as the supported runtime.

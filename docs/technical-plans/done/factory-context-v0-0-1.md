# Technical Plan — `@wifo/factory-context` v0.0.1

## 1. Context

- `@wifo/factory-core`, `@wifo/factory-harness`, and `@wifo/factory-twin` are shipped under conventions established across the monorepo: strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `node:util` `parseArgs` with manual subcommand dispatch, injectable `CliIo` for testability, `<file>.test.ts` next to source, `bun test`. The CLI exemplar is `packages/twin/src/cli.ts`; the public-API exemplar is `packages/twin/src/index.ts`. The atomic-write + content-addressed store exemplar is `packages/twin/src/store.ts`. The hashing exemplar is `packages/twin/src/hash.ts`.
- `packages/context/` is scaffolded: `package.json` declares `bin.factory-context → dist/cli.js`, `dependencies: { zod: ^3.23.8 }`, ESM module, `bun test`. `tsconfig.json` and `tsconfig.build.json` mirror the other three packages. `src/index.ts` is empty (`export {};`). The package is currently at `version: 0.0.0`.
- The package is a *runtime* utility (used inside agent processes to share typed memory between phases) and a CLI for human inspection. The runtime is restricted to `node:crypto`, `node:fs/promises`, `node:path`, `node:url`, `node:util`, and `zod`. No Bun-specific APIs in source. README will pin Node 22+.
- Empty `src/index.ts` makes `pnpm test` workspace-wide fail today (`bun test` exits non-zero when no test files match) — v0.0.1 fixes it as a side effect of T1 adding real test files.

## 2. Architecture decisions

### Error class contract

A single `ContextError extends Error` exposes a stable `code: string` field — the class is matched with `instanceof`; `.code` is the machine-readable identifier for matching in user code, log lines, and CLI stderr output.

```ts
type ContextErrorCode =
  | 'context/unregistered-type'
  | 'context/duplicate-registration'
  | 'context/schema-validation-failed'   // carries .issues from zod
  | 'context/parent-missing'             // carries .missingParent id
  | 'context/io-error'
  | 'context/parse-error'
  | 'context/version-mismatch';

class ContextError extends Error {
  readonly code: ContextErrorCode;
  readonly issues?: ZodIssue[];          // populated for schema-validation-failed
  readonly missingParent?: string;       // populated for parent-missing
}
```

A single class is sufficient for v0.0.1 — there is no analog to `TwinNoMatchError`'s structured fields beyond what fits on this one class. The set of `code` values is stable; adding one is a public-API change.

### Module layout

```
packages/context/src/
├── types.ts          # ContextRecord, RecordVersion = 1
├── hash.ts           # hashRecord({type, parents, payload}) → 16-char hex
├── errors.ts         # ContextError
├── store-fs.ts       # readRecord, writeRecord (atomic), listRecords
├── store.ts          # createContextStore({dir}) — registry + schema validation
├── tree.ts           # buildTree(rootId, lookup) + formatTree(node)
├── cli.ts            # factory-context {list|get|tree}
└── index.ts          # public re-exports
```

Tests: `<module>.test.ts` next to source, mirroring the other three packages.

### Public API

The full public surface from `src/index.ts`. The DoD's "matches §2" check is strict equality between this list and what `index.ts` re-exports. Every other symbol stays internal.

```ts
// store
export { createContextStore } from './store.js';
export type {
  ContextStore,
  CreateContextStoreOptions,
  PutOptions,
  ListOptions,
} from './store.js';

// hashing
export { hashRecord } from './hash.js';
export type { HashRecordInput } from './hash.js';

// fs (low level — used by CLI and external tooling that doesn't need the registry)
export { readRecord, writeRecord, listRecords } from './store-fs.js';
export type { ListRecordsResult, SkippedFile } from './store-fs.js';

// tree
export { buildTree, formatTree } from './tree.js';
export type { TreeNode } from './tree.js';

// errors
export { ContextError } from './errors.js';
export type { ContextErrorCode } from './errors.js';

// record schema
export type { ContextRecord } from './types.js';
```

**Intentionally not exported** (internal): canonical-JSON helper, atomic-write helper, the registry's internal map type. They keep their definitions in their files but don't surface from `index.ts` — every public name is a future refactor cost.

### Record schema (v1)

```ts
type ContextRecord = {
  version: 1;
  id: string;                  // 16 hex chars; equals filename stem
  type: string;                // registered type name
  recordedAt: string;          // ISO-8601 UTC
  parents: string[];           // ids of parents declared at put-time; empty array for roots
  payload: unknown;            // shape defined by the registered zod schema for `type`
};
```

One JSON file per record at `<dir>/<id>.json`. Files are written atomically: write `<id>.json.tmp.<rand>` then `rename` to `<id>.json` (POSIX rename within the same FS is atomic).

### Hash inputs

```ts
function canonicalParents(parents: string[]): string[] {
  // dedup preserving first occurrence, then sort for hash stability
  return [...new Set(parents)].sort();
}

hashRecord({ type, parents, payload }) =
  sha256(canonicalJson({
    type,
    parents: canonicalParents(parents),
    payload,
  })).slice(0, 16);
```

`canonicalJson` is the same recursive-key-sort serializer used by `@wifo/factory-twin`. Reused logic, separate file (no cross-package imports for v0.0.1 — keep packages standalone).

**Why include `type` and `parents` in the hash:**
- `type` is a discriminator. Putting the same payload as `'design-doc'` and as `'review-comment'` produces semantically different artifacts; they should not collide.
- `parents` is part of provenance. The same payload reached from two different reasoning paths is two different artifacts in the DAG.
- `recordedAt` is *excluded*: identical inputs at different times collide intentionally — that is what "content-addressed" means.

**Why dedup + sort parents:** the *set* of parents is what matters for identity, not the order or multiplicity. `put('x', p, { parents: ['a','b'] })`, `put('x', p, { parents: ['b','a'] })`, and `put('x', p, { parents: ['a','a'] })` must all produce the same id — they describe the same DAG edge set. Dedup happens before hashing **and before storage** (the stored `parents` is also de-duplicated), preserving each id's first occurrence to keep insertion order meaningful for the renderer. So the on-disk `parents` is `[...new Set(input)]` (insertion order, dedup), and the hash input is that array sorted.

16 hex chars = 64 bits. Collision probability at 100k records ≈ 1 in 4 billion. Acceptable for v0.0.1; documented in README.

### `createContextStore({ dir })` semantics

```ts
interface CreateContextStoreOptions {
  dir: string;
}

interface ContextStore {
  register: <T>(type: string, schema: ZodType<T>) => void;
  put: <T>(type: string, payload: T, opts?: PutOptions) => Promise<string>;
  get: (id: string) => Promise<ContextRecord | null>;
  list: (opts?: ListOptions) => Promise<ContextRecord[]>;
  parents: (id: string) => Promise<string[] | null>;
}

interface PutOptions {
  parents?: string[];
}

interface ListOptions {
  type?: string;
}
```

Behavior:

- `register(type, schema)` stores the zod schema under `type`. Registering the same type twice → throws `ContextError('context/duplicate-registration')`. The store does not persist the registry; it lives in-memory for the store's lifetime. Re-registering across processes is normal and expected.
- `put(type, payload, opts)`:
  1. If `type` is not registered → throws `ContextError('context/unregistered-type')`.
  2. `schema.safeParse(payload)`; on failure → throws `ContextError('context/schema-validation-failed')` with `.issues` populated from zod's `error.issues`.
  3. Dedup `opts.parents ?? []` preserving insertion order: `dedupedParents = [...new Set(input)]`. Then for each id in `dedupedParents`, verify `<dir>/<parentId>.json` exists. Missing → throws `ContextError('context/parent-missing')` with `.missingParent` populated.
  4. Compute `id = hashRecord({ type, parents: dedupedParents, payload })` (the hash function sorts internally; see Hash inputs).
  5. Build the record with `parents: dedupedParents` (insertion order preserved, duplicates collapsed) and write atomically to `<dir>/<id>.json`. Same id → last-writer-wins, no corruption.
  6. Return the id.
- `get(id)` reads `<dir>/<id>.json`. Missing → returns `null` (does not throw — matches the spec contract). Parse failure → throws `ContextError('context/parse-error')`. Version other than `1` → throws `ContextError('context/version-mismatch')`. IO error → throws `ContextError('context/io-error')`.
- `list({ type })` reads every `<dir>/*.json` whose stem looks like a 16-hex id, parses each, optionally filters by `type`, and returns an array sorted by `recordedAt` ascending with `id` ascending as the tie-break (so output is fully reproducible across platforms regardless of dir-read order). Files that fail to parse are skipped silently — to surface them to humans, callers use the lower-level `listRecords` which returns `{ records, skipped }`. (The store-level `list` keeps a clean type signature; the CLI uses `listRecords` directly.)
- `parents(id)` returns the `parents` array from the record on hit, **`null` on miss**. Symmetric with `get`'s null-on-miss; callers that want the lenient flavor write `(await store.parents(id)) ?? []`. Parse/version errors propagate as `ContextError`.

### Low-level FS (`store-fs.ts`)

```ts
function readRecord(dir: string, id: string): Promise<ContextRecord | null>;
function writeRecord(dir: string, record: ContextRecord): Promise<void>;
function listRecords(dir: string): Promise<ListRecordsResult>;

interface SkippedFile { filename: string; reason: string; }
interface ListRecordsResult { records: ContextRecord[]; skipped: SkippedFile[]; }
```

- `readRecord` returns `null` on `ENOENT`, throws `ContextError('context/io-error')` on other IO failures, `'context/parse-error'` on JSON failure, `'context/version-mismatch'` on `version !== 1`.
- `writeRecord` `mkdir -p` the dir, writes `<id>.json.tmp.<rand>`, renames to `<id>.json`. Errors → `ContextError('context/io-error')`.
- `listRecords` reads dir entries matching `/^[0-9a-f]{16}\.json$/`, returns parsed records sorted by `recordedAt` ascending with `id` ascending as the tie-break, plus a `skipped[]` array for files that fail to read/parse/version-check. Never throws on a single corrupt file. Throws `ContextError('context/io-error')` only if the dir itself is unreadable.

The store-FS layer is intentionally schema-unaware. It validates the record envelope (`version`, presence of fields) but never the payload — that's the registry's job.

### Tree (`tree.ts`)

```ts
interface TreeNode {
  id: string;
  type: string | null;       // null when missing
  recordedAt: string | null; // null when missing
  parents: TreeNode[];       // recursive; empty for roots and for missing/cycle leaves
  marker: 'ok' | 'missing' | 'cycle';
}

function buildTree(
  rootId: string,
  lookup: (id: string) => Promise<ContextRecord | null>,
): Promise<TreeNode>;

function formatTree(node: TreeNode): string;
```

- Cycle detection: traversal carries an ancestor set. If the next id is already in the set, the node is emitted with `marker: 'cycle'`, no children, recursion stops. (Content-addressing prevents cycles in honest data, but a corrupt or hand-edited record could create one — fail gracefully.)
- Missing parent: if `lookup(id)` returns `null`, the node is emitted with `marker: 'missing'`, `type: null`, no children.
- `formatTree` produces an ASCII tree:
  ```
  abc1234567890def [type=design] 2026-04-28T10:00:00.000Z
  ├── 0000000000000001 [type=brief] 2026-04-27T09:00:00.000Z
  └── 0000000000000002 [type=brief] 2026-04-26T09:00:00.000Z
      └── feed1234feed1234 [type=note] 2026-04-25T09:00:00.000Z
  ```
  - Missing nodes render as `0000000000000003 <missing>`.
  - Cycle nodes render as `abc1234567890def <cycle>`.
- Determinism: parents are rendered in *insertion order* (the order stored on the record), not sorted — so `formatTree` is faithful to what was put. The hash uses sorted parents internally for identity; the rendering uses stored order for fidelity to the put call.

### CLI

```
factory-context list           [--type <name>] [--dir <path>]
factory-context get <id>       [--dir <path>]
factory-context tree <id>      [--dir <path>]
```

- Default `--dir` is `./context` resolved from cwd.
- `list`: tab-separated `<id>\t<type>\t<recordedAt>`, one per line, sorted by `recordedAt` ascending. With `--type`, filters to records where `record.type === <name>`. Empty directory exits 0 with empty stdout.
- `get <id>`: pretty-prints the record JSON to stdout. Missing id → exit 3, stderr `context/record-not-found  <id>`.
- `tree <id>`: prints `formatTree(buildTree(id, ...))`. Missing root id → exit 3, stderr `context/record-not-found  <id>`. Missing/cyclic *ancestors* are rendered inline (see tree section) and do not change the exit code.
- Manual subcommand dispatch on `argv[0] ∈ {list, get, tree}`; `parseArgs` consumes the remainder per subcommand. Injectable `CliIo` matches twin/harness.
- The CLI uses `listRecords` / `readRecord` directly. It does NOT instantiate `createContextStore` because there are no schemas to register — it operates on raw envelope data.
- Exit codes: `0` ok, `2` usage error (unknown subcommand, missing required positional), `3` operational error (target dir missing, root id not found). Corrupt/unparseable files surface on stderr as `<filename>\tskipped\t<reason>` and do not change the exit code (matches twin's principle: exit code reports the action, stderr reports the world).

### Dependency choices

| Dependency | Range | Why |
|---|---|---|
| `zod` | `^3.23.8` | Schema validation in `register()`/`put()`. Already present in `package.json`. |

Dev-only: `@types/bun` (already present).

### Confirmed constraints

- One runtime dep: `zod`. Source uses only `node:crypto`, `node:fs/promises`, `node:path`, `node:url`, `node:util`, plus `zod`. No cross-package imports from `factory-core`/`factory-harness`/`factory-twin` — keep this layer standalone.
- One JSON file per record at `<dir>/<id>.json`, written atomically via tmp+rename.
- Hash inputs: `{ type, parents: [...new Set(parents)].sort(), payload }` → `sha256(canonicalJson(...)).slice(0, 16)`. `recordedAt` is **not** hashed.
- Caller-passed `parents` are **deduplicated** before hashing and before storage (first occurrence wins for ordering). Stored `parents` is the deduplicated array in caller insertion order; the hash uses the same set sorted ascending. So `parents: ['a','b']`, `['b','a']`, and `['a','a']` collide.
- `list` (and low-level `listRecords`) sorts ascending by `recordedAt` with `id` ascending as the tie-break — fully reproducible across platforms.
- `parents(id)` is symmetric with `get(id)`: returns `null` on miss, the array on hit. Callers wanting the lenient flavor write `(await store.parents(id)) ?? []`.
- Registry is in-memory and per-store-instance. Not persisted. Cross-process callers re-register.
- `register` rejects duplicates (`context/duplicate-registration`). `put` requires registration (`context/unregistered-type`). `get`/`list`/`parents` do not require registration.
- `put` validates the payload against the registered schema and verifies declared parents exist on disk. Both checks happen before the hash is computed.
- `get(id)` returns `null` on miss (no throw). `parents(id)` returns `null` on miss (symmetric with `get`). `list` filters silently for parse failures; the CLI uses `listRecords` to surface them.
- Dynamic-registration ergonomics: `register<T>` and `put<T>` are independently parameterized — TS does not statically link the registered schema's `T` to the payload type passed at `put`. Runtime zod validation catches mismatches; static typing is best-effort. Stronger alternatives (typed handle returned by `register`, `Registry` generic on the store) are deferred — v0.0.1 favors API simplicity over static linkage.
- Record envelope versioning: `version: 1`. Reading a record with a different version → `ContextError('context/version-mismatch')`.
- Tree handles missing ancestors with `<missing>` marker and detected cycles with `<cycle>` marker; both non-fatal.
- All type imports use `import type` (`verbatimModuleSyntax`). Every array/object index access is guarded (`noUncheckedIndexedAccess`).
- CLI exit codes: `0` ok, `2` usage error, `3` operational error.
- Public API surface is the §2 list above. Adding a name in v0.0.1 requires updating both this plan and the spec.

## 3. Risk assessment

- **Hash content choice**: including `type` and `parents` in the hash is a deliberate design call. Excluding them would mean two records with different lineage but identical payload collide. Pinned in §2. Documented in README so callers don't reverse-engineer.
- **Atomic write**: a crash mid-write must not produce a partial JSON file the next read sees. Mitigated by tmp+rename. Pinned by H-1.
- **DAG corruption**: a hand-edited or partially-synced repo can have records that reference parents that don't exist. The tree CLI must not crash on these. Pinned by H-2.
- **Cycles**: content addressing prevents cycles in honest data (a parent cannot reference its own child whose id depends on it). But corruption could create one. The tree builder carries an ancestor set and emits `<cycle>` rather than recursing infinitely. Pinned by H-3.
- **Schema-validation error surface**: zod errors are verbose. The `ContextError('context/schema-validation-failed')` carries the raw `issues[]`; callers format as needed. README will show a copy-pasteable example.
- **Registry strictness**: requiring `register()` before `put()` adds a startup step compared to a freeform `put`. The tradeoff is type safety and early failure. Pinned: required.
- **Hash collision**: 64 bits is fine at record-set sizes typical of agent context (≪ 1M). Documented limit.
- **Blast radius**: contained to `packages/context/`. No changes to the other three packages. `pnpm test` becomes green again as a side effect of T1+ adding real test files.

## 4. Subtask outline

Eight subtasks, ~870 LOC of source plus tests. Full breakdown with test pointers in `docs/specs/factory-context-v0-0-1.md`.

- T1 [config] Bump version + scripts + scaffold source files
- T2 [feature] types
- T3 [feature] hashRecord
- T4 [feature] errors + store-fs (atomic write, list, read)
- T5 [feature] store (createContextStore: registry, schema validation, parent check) — depends on T3, T4
- T6 [feature] tree (build + format) — depends on T2, T4
- T7 [feature] CLI — depends on T4, T6
- T8 [chore] index.ts public exports + README — depends on T2..T7

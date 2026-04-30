# @wifo/factory-context

Filesystem-first context store. Typed shared memory for agent phases, with content-addressable records and a DAG of provenance.

A **context store** is where agents leave evidence for later phases. Phase 1 (explore) writes findings; phase 2 (plan) reads them and writes a plan; phase 3 (implement) reads the plan and writes code paths; phase 4 (validate) reads code paths and runs the harness. Each record links back to its parents — if a holdout scenario fails, you can walk the DAG to see exactly which findings, plan, and implementation step led there.

## Why filesystem-first

1. **Cheap durability.** Phases can run minutes apart, in different processes, on different machines. A JSON-on-disk store survives crashes and restarts without a daemon.
2. **Diffable history.** Every record is a file. `git log -- .factory/` shows what the agent thought, when, and why — the same review surface you already have for code.

## Install

```sh
pnpm add @wifo/factory-context
```

Requires Node 22+ (or Bun). Single runtime dependency: `zod`.

## Usage

```ts
import { createContextStore } from '@wifo/factory-context';
import { z } from 'zod';

const Finding = z.object({ summary: z.string(), file: z.string() });
const Plan = z.object({ steps: z.array(z.string()) });

const store = createContextStore({ dir: './.factory/context' });
store.register('finding', Finding);
store.register('plan', Plan);

const findingId = await store.put('finding', {
  summary: 'auth uses MD5',
  file: 'src/auth.ts',
});

const planId = await store.put(
  'plan',
  { steps: ['swap to bcrypt', 'migrate existing hashes'] },
  { parents: [findingId] },
);

const plan = await store.get(planId);            // ContextRecord | null
const allPlans = await store.list({ type: 'plan' });
const planParents = await store.parents(planId); // [findingId]
```

## On-disk record schema

One JSON file per record at `<dir>/<id>.json`:

```jsonc
{
  "version": 1,
  "id": "1c0acb52e9e4f31a",        // 16 hex chars; equals filename stem
  "type": "plan",
  "recordedAt": "2026-04-29T10:30:00.000Z",
  "parents": ["3a8f4e9b7d2c1056"], // ids declared at put-time
  "payload": { /* shape from registered zod schema */ }
}
```

Files are written atomically: `<id>.json.tmp.<rand>` then `rename` to `<id>.json` (POSIX rename within the same FS is atomic). Same id → last-writer-wins; concurrent identical puts never produce a partial file.

## Content addressing

```ts
id = sha256(canonicalJson({
  type,
  parents: [...new Set(parents)].sort(),  // dedup + sort for stability
  payload,
})).slice(0, 16);
```

What this means in practice:

- Identical `(type, parents-as-set, payload)` always returns the **same** id, regardless of when it was put. `recordedAt` is *not* hashed — content addressing means same artifact, same id, even across time.
- Parent **order does not affect the id**: `parents: ['a','b']`, `['b','a']`, and `['a','a','b']` all produce the same id. The set of parents is what matters for identity.
- Parent **insertion order is preserved on disk** (with duplicates collapsed) so `formatTree` and `parents()` are faithful to the put call.
- `type` and the parent set are part of identity. The same payload as a `'design-doc'` and as a `'comment'` are distinct artifacts.

16 hex chars = 64 bits. At 100k records, collision probability is ≈ 1 in 4 billion. Acceptable for typical agent-context volumes.

## CLI

```
factory-context list           [--type <name>] [--dir <path>]
factory-context get  <id>      [--dir <path>]
factory-context tree <id>      [--dir <path>]
```

Default `--dir` is `./context`. The CLI works directly on the on-disk envelope — it does not need any types registered.

```sh
$ factory-context list --dir ./.factory/context
3a8f4e9b7d2c1056	finding	2026-04-29T10:25:00.000Z
1c0acb52e9e4f31a	plan	2026-04-29T10:30:00.000Z

$ factory-context tree 1c0acb52e9e4f31a --dir ./.factory/context
1c0acb52e9e4f31a [type=plan] 2026-04-29T10:30:00.000Z
└── 3a8f4e9b7d2c1056 [type=finding] 2026-04-29T10:25:00.000Z
```

`tree` is robust to corruption: missing ancestors render as `<id> <missing>`, detected cycles render as `<id> <cycle>`. Both are non-fatal (exit 0).

Exit codes: `0` ok, `2` usage error (unknown subcommand, missing positional), `3` operational error (target dir missing, root id not found). Corrupt neighbor files surface on stderr as `<filename>\tskipped\t<reason>` and do not change the exit code.

## Errors

`ContextError` is a single class with a stable `.code: ContextErrorCode` discriminator:

| Code | Where | Extra fields |
|---|---|---|
| `context/unregistered-type` | `put` with a type not passed to `register` | — |
| `context/duplicate-registration` | `register` called twice for the same type | — |
| `context/schema-validation-failed` | `put` payload fails zod validation | `.issues: ZodIssue[]` |
| `context/parent-missing` | `put` declares a parent id that does not exist on disk | `.missingParent: string` |
| `context/io-error` | filesystem failure (read, write, mkdir, etc.) | — |
| `context/parse-error` | record JSON malformed or envelope shape invalid | — |
| `context/version-mismatch` | record `version` is not `1` | — |

Example handling:

```ts
import { ContextError } from '@wifo/factory-context';

try {
  await store.put('plan', payload, { parents: [oldId] });
} catch (err) {
  if (err instanceof ContextError) {
    if (err.code === 'context/schema-validation-failed') {
      console.error('payload invalid:', err.issues);
    } else if (err.code === 'context/parent-missing') {
      console.error('missing parent:', err.missingParent);
    }
  }
  throw err;
}
```

## Registry semantics

The registry is **in-memory** and per-store-instance. It is *not* persisted to disk. Cross-process callers re-register their types at startup. This is deliberate: the on-disk records are self-describing (each carries its `type`), and callers may legitimately disagree about which schema corresponds to a given type name across versions of their code. The registry is a write-side gate, not a contract on the data at rest.

`get`, `list`, and `parents` do *not* require the type to be registered — they return raw `ContextRecord` envelopes. The CLI takes advantage of this: it reads the store without any schemas.

## Public API

```ts
import {
  createContextStore,
  hashRecord,
  readRecord, writeRecord, listRecords,
  buildTree, formatTree,
  ContextError,
} from '@wifo/factory-context';

import type {
  ContextStore, CreateContextStoreOptions, PutOptions, ListOptions,
  HashRecordInput,
  ListRecordsResult, SkippedFile,
  TreeNode,
  ContextErrorCode,
  ContextRecord,
} from '@wifo/factory-context';
```

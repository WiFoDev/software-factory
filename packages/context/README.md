# @wifo/factory-context

> The provenance store. Filesystem-first, content-addressable records that form a DAG of every run, phase, and report.

`@wifo/factory-context` is the runtime's memory. Every spec run, every phase, every implement/validate/DoD report becomes a JSON record on disk linked to its parents. After a run, `factory-context tree` walks the DAG so you can see exactly what produced what — every prompt, every file change, every test result, traceable end to end.

> **For AI agents:** start at **[`AGENTS.md`](../../AGENTS.md)** (top-level). This README is detailed reference.

## Why filesystem-first

1. **Cheap durability.** Phases can run minutes apart, in different processes, on different machines. JSON-on-disk survives crashes and restarts without a daemon.
2. **Diffable history.** Every record is a file. `git log -- .factory/` shows what the agent thought, when, and why — same review surface as your code.
3. **No coupling.** The runtime, harness, and reviewer all read/write the same store without sharing process state.

## Install

```sh
pnpm add @wifo/factory-context
```

Requires Node 22+ (or Bun). Single runtime dependency: `zod`.

Pre-installed via `factory init` (the scaffold's `factory-runtime run` writes here by default).

## When to reach for it

- **Inspect what a run produced.** `factory-context tree <runId> --direction down` walks every iteration's records as descendants of the run.
- **Inspect a sequence (multi-spec product).** `factory-context tree <factorySequenceId> --direction down` walks the entire product's DAG (sequence → runs → phases → reports).
- **Look up a specific record.** `factory-context get <recordId>` prints one record's full JSON body.
- **List records by type.** `factory-context list --type factory-implement-report` shows every implement run's metadata.
- **Programmatically read provenance.** Import `createContextStore`, `readRecord`, `listRecords`, `buildTree`, `formatTree` directly.

## What's inside

### CLI

```
factory-context tree <id> [--context-dir <path>] [--direction up|down]
factory-context list [--context-dir <path>] [--type <name>]
factory-context get <id> [--context-dir <path>]
```

| Flag | Default | Notes |
|---|---|---|
| `--context-dir <path>` | `./context` | Where records persist. Synonym for `--dir` (deprecated, removed in v0.1.0). |
| `--direction up\|down` | `up` | `up` walks ancestors via `parents[]`; `down` walks descendants by inverting the parent index. |
| `--type <name>` | all | Filter `list` by record type. |

`tree` exit codes:
- `0` — printed.
- `2` — invalid `--direction` value (`runtime/invalid-direction`).
- `3` — root id not found.

### Public API (18 exports)

```ts
import { createContextStore, readRecord, writeRecord, listRecords,
         buildTree, formatTree, hashRecord, ContextError }
  from '@wifo/factory-context';

import type {
  ContextStore, ContextRecord, ContextStoreOptions,
  ListRecordsResult, SkippedFile,
  HashRecordInput, TreeNode,
  ContextErrorCode,
} from '@wifo/factory-context';
```

`ContextErrorCode` (10 values): `context/{type-not-registered, duplicate-registration, invalid-record, invalid-id, invalid-parent, parent-missing, io-error, hash-mismatch, schema-mismatch, deserialization-failed}`.

### Concepts

**Records.** JSON files at `<context-dir>/<id>.json`. Each has:
- `id` — 16-char hex SHA-256 of the canonical record body. Content-addressable: same payload + same parents → same id.
- `type` — registered Zod schema name (e.g., `factory-run`, `factory-phase`, `factory-implement-report`).
- `recordedAt` — ISO timestamp.
- `parents` — array of ids; the DAG.
- `payload` — schema-typed body.

**Type registration.** Before `put()`, each type must be registered with a Zod schema via `store.register(type, schema)`. Registration is idempotent within the runtime's `tryRegister` wrapper.

**The factory's record schema.**

```
factory-sequence (root, v0.0.7+; only in run-sequence runs)
  ├── factory-run (per spec)
  │     ├── factory-phase (per phase per iteration)
  │     │     ├── factory-implement-report (implementPhase output)
  │     │     ├── factory-validate-report (validatePhase output)
  │     │     └── factory-dod-report (dodPhase output, v0.0.10+)
```

`factory-context tree <id> --direction down` walks this DAG from any record. Walking down from a sequence root shows the entire product's provenance; walking down from a run shows one spec's iterations; walking up from a leaf traces back to its run.

**Tree direction.**
- `--direction up` (default) — walks `record.parents[]` recursively. Cheap (each record knows its own parents).
- `--direction down` — inverts the index by scanning all records once via `listRecords`, then DFS from the root. O(n) per call.

Both directions render identically via `formatTree`. Cycles are marked `<cycle>`; missing parents `<missing>`.

## Worked example

```sh
# After a run-sequence converges:
$ pnpm exec factory-context tree 6429544d32ff9eea \
    --context-dir ./.factory --direction down

6429544d32ff9eea [type=factory-sequence] 2026-05-03T17:35:12.123Z
├── 8d7b095384824ec4 [type=factory-run] 2026-05-03T17:36:01.234Z
│   ├── 14a6838dee09896b [type=factory-phase phaseName=implement iter=1]
│   │   └── 3bb7dc422c7502d1 [type=factory-implement-report]
│   ├── 56cdefd692e7028b [type=factory-phase phaseName=validate iter=1]
│   │   └── 09ac451da8f6140c [type=factory-validate-report]
│   └── f12b7b0d06d5de02 [type=factory-phase phaseName=dod iter=1]
│       └── ... [type=factory-dod-report]
├── ... (3 more factory-run records, one per spec)
```

Programmatic:

```ts
import { createContextStore, listRecords } from '@wifo/factory-context';
import { z } from 'zod';

const store = createContextStore({ dir: './.factory' });
store.register('my-record', z.object({ value: z.string() }));

const id = await store.put('my-record', { value: 'hello' }, { parents: [] });
const rec = await store.get(id);
console.log(rec?.payload); // { value: 'hello' }

// Walk all factory-implement-reports across all runs:
const all = await listRecords('./.factory');
const reports = all.records.filter((r) => r.type === 'factory-implement-report');
```

## See also

- **[`AGENTS.md`](../../AGENTS.md)** — single doc for AI agents using the toolchain.
- **[`packages/runtime/README.md`](../runtime/README.md)** — the runtime that writes these records.
- **[`packages/core/README.md`](../core/README.md)** — spec format + scaffold.
- **[`CHANGELOG.md`](../../CHANGELOG.md)** — every release's deltas.

## Status

Pre-alpha. APIs may break in point releases until v0.1.0.

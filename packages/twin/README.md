# @wifo/factory-twin

> The HTTP record/replay layer. Record real `fetch` interactions to disk; replay them in tests and agent runs without burning quota or risking production.

`@wifo/factory-twin` wraps `globalThis.fetch` in either `record` mode (real HTTP, persists each pair to disk) or `replay` mode (deterministic replay, errors on miss). Used by tests + the runtime's `implementPhase` agent subprocess. Filename is a stable 16-char hex hash of `method + url + body + selected headers`.

> **For AI agents:** start at **[`AGENTS.md`](../../AGENTS.md)** (top-level). This README is detailed reference.

## Install

```sh
pnpm add @wifo/factory-twin
```

Requires Node 22+ (or Bun) for the global Fetch types.

Pre-installed via `factory init` (the scaffold's runtime depends on it).

## When to reach for it

- **Deterministic external HTTP in tests.** Wrap your code's `fetch` with `wrapFetch({ mode: 'replay', recordingsDir })` so tests pass against a recorded fixture, never the network.
- **Record once, replay forever.** Run with `mode: 'record'` first to populate the recordings dir, then commit those files. CI replays without API keys or rate limits.
- **Make agent runs reproducible.** The runtime's `implementPhase` threads `WIFO_TWIN_MODE` + `WIFO_TWIN_RECORDINGS_DIR` env vars to the spawned `claude -p` subprocess; the agent's test code calls `wrapFetch` against them. Agent decisions become reproducible across iterations.
- **Avoid burning paid API quota during development.** A real run records once; everything afterward replays.

## What's inside

### Modes

- **`record`** — wraps real `fetch`; persists each request/response pair to `recordingsDir` as one JSON file per interaction.
- **`replay`** — matches incoming requests against existing recordings via the stable hash. Miss → throws `TwinNoMatchError`. The real network is never touched.
- **`off`** — no-op pass-through (uses real `fetch`; no recording).

`auto`, `passthrough`, and `synthesize` modes are deferred past v0.1.0.

### Public API

```ts
import { wrapFetch, hashRequest,
         readRecordings, writeRecording, listRecordings, pruneRecordings,
         TwinNoMatchError, TwinReplayError } from '@wifo/factory-twin';

import type {
  WrapFetchOptions, TwinMode,
  HashRequestInput, HashRequestOptions,
  Recording, RecordedRequest, RecordedResponse, PruneResult,
} from '@wifo/factory-twin';
```

### Runtime integration (env vars)

The runtime's `implementPhase` reads two env vars and threads them to the spawned `claude -p` subprocess:

```
WIFO_TWIN_MODE=record|replay|off       # default: record
WIFO_TWIN_RECORDINGS_DIR=<path>         # default: <cwd>/.factory/twin-recordings
```

User code in tests does `wrapFetch(globalThis.fetch, { mode: process.env.WIFO_TWIN_MODE, recordingsDir: process.env.WIFO_TWIN_RECORDINGS_DIR })` — the env-var-driven config means the agent's test setup picks up the runtime's mode automatically.

CLI flags `--twin-mode <mode>` and `--twin-recordings-dir <path>` on `factory-runtime run` set these env vars.

### Concepts

**Stable request hash.** A 16-char hex SHA-256 of canonicalized `{ method, url, body, selectedHeaders }`. The selected-headers list excludes volatile fields (`User-Agent`, `Date`, `Authorization`) so recordings replay across machines.

**One file per interaction.** Each recording is a JSON file at `<recordingsDir>/<hash>.json` containing `{ request, response }`. Diffable, gittable, byte-stable. Pruning unused recordings happens via `pruneRecordings({ dir, usedHashes })`.

**Failure modes.** `TwinNoMatchError` (replay mode, request hash not found) and `TwinReplayError` (replay mode, file present but malformed). Both extend `Error`; check via `instanceof`.

## Worked example

Record once:

```ts
import { wrapFetch } from '@wifo/factory-twin';

const fetch = wrapFetch(globalThis.fetch, {
  mode: 'record',
  recordingsDir: './.twin-recordings',
});

const r = await fetch('https://api.example.com/users/123');
const data = await r.json();
// → recording written to ./.twin-recordings/<hash>.json
```

Replay in tests:

```ts
import { test, expect } from 'bun:test';
import { wrapFetch, TwinNoMatchError } from '@wifo/factory-twin';

const fetch = wrapFetch(globalThis.fetch, {
  mode: 'replay',
  recordingsDir: './.twin-recordings',
});

test('user lookup', async () => {
  const r = await fetch('https://api.example.com/users/123');
  expect((await r.json()).id).toBe(123);
});

test('unknown call → TwinNoMatchError', async () => {
  await expect(fetch('https://api.example.com/users/999'))
    .rejects.toBeInstanceOf(TwinNoMatchError);
});
```

In a factory-runtime run:

```sh
# First run records:
pnpm exec factory-runtime run docs/specs/api-feature.md \
  --twin-mode record --twin-recordings-dir ./.factory/twin-recordings

# Subsequent runs replay (no real HTTP):
pnpm exec factory-runtime run docs/specs/api-feature.md \
  --twin-mode replay
```

## See also

- **[`AGENTS.md`](../../AGENTS.md)** — single doc for AI agents using the toolchain.
- **[`packages/runtime/README.md`](../runtime/README.md)** — `implementPhase` threads the env vars.
- **[`packages/harness/README.md`](../harness/README.md)** — the harness's `bun test` invocations pick up env vars from the runtime.
- **[`CHANGELOG.md`](../../CHANGELOG.md)** — every release's deltas.

## Status

Pre-alpha. APIs may break in point releases until v0.1.0.

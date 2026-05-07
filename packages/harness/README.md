# @wifo/factory-harness

> The scenario runner. Executes `test:` and `judge:` lines against a parsed spec; produces a typed `HarnessReport`.

`@wifo/factory-harness` powers the runtime's `validatePhase`. Given a parsed `Spec` (from `@wifo/factory-core`), it walks each scenario's `Satisfaction:` block, runs `bun test` for `test:` lines and dispatches to an LLM judge for `judge:` lines, and returns a typed report. You usually don't reach for this package directly — the runtime does.

> **For AI agents:** start at **[`AGENTS.md`](../../AGENTS.md)** (top-level). This README is detailed reference.

## Install

```sh
pnpm add @wifo/factory-harness
```

Pre-installed via `factory init` (the scaffold's runtime depends on it).

## When to reach for it

- **Programmatically run a spec's scenarios** without going through the full runtime. Use `runHarness({ spec, ... })` to get a `HarnessReport`.
- **Build your own validate phase.** Compose `runTestSatisfaction` + a custom judge client to define a domain-specific `validatePhase`.
- **Implement a custom judge client.** The exported `JudgeClient` interface is what the runtime + spec-reviewer + dodPhase all consume. Provide your own (e.g., a different LLM provider) and pass it in.
- **Parse a `test:` line manually.** `parseTestLine` strips the locked syntax (file path + optional `"name"` filter) and tolerates stray backticks.

## What's inside

### CLI

```
factory-harness run <spec-path> [flags]
```

| Flag | Default | Notes |
|---|---|---|
| `--scenario <ids>` | all | Comma-separated scenario id filter (e.g., `S-1,S-2,H-1`). |
| `--visible` | off | Only visible scenarios (skip holdouts). |
| `--holdouts` | off | Only holdout scenarios. |
| `--no-judge` | off | Skip `judge:` lines (status `skipped`). |
| `--model <name>` | `claude-haiku-4-5` | Override judge model. |
| `--timeout-ms <n>` | 60000 | Per-judge timeout. |

The CLI is mostly used in tests + ad-hoc inspection. Production code reaches for `runHarness()` programmatically (or — more likely — uses the runtime's `validatePhase`).

### Public API

```ts
import { runHarness, runTestSatisfaction, parseTestLine, formatReport }
  from '@wifo/factory-harness';

import type {
  HarnessReport, HarnessScenarioResult, HarnessSatisfactionResult,
  HarnessOptions, JudgeClient, Judgment,
  TestRunnerOptions, ParsedTestLine, ReporterKind,
} from '@wifo/factory-harness';
```

### Concepts

**Two satisfaction kinds.**

- **`test: <path> "<name>"`** — spawns `bun test <path> [-t "<name>"]`. Pass/fail from exit code. The harness strips a leading + trailing backtick from both the path and the name (since v0.0.6) — bare paths are canonical but legacy backticked paths still work.
- **`judge: "<criterion>"`** — calls a `JudgeClient` (default: Anthropic Claude via `@anthropic-ai/sdk` with tool-use for structured pass/score/reasoning output). The reviewer + the runtime's `validatePhase` and `dodPhase` all reuse this client interface.

**Coverage trip detection (v0.0.13+).** Per-scenario `bun test --test-name-pattern <name>` runs only exercise a slice of a file, so a host repo's `bunfig.toml` coverage threshold trips on the slice and bun exits non-zero even though every scenario assertion passed. The harness parses bun's output: when bun exits non-zero AND the output contains `0 fail` AND the canonical `coverage threshold of <n> not met` marker, the satisfaction is classified as `pass` with detail prefix `harness/coverage-threshold-tripped: <marker>; <existing tail>` rather than `fail`. The conservative match requires both signals — a non-zero exit without the marker is still classified as `fail`. Coverage is a *holistic* property, meaningful only when the whole suite runs; the host's coverage gate runs separately at DoD time on the full suite. (v0.0.12 attempted the carve-out via `--coverage=false`, but bun 1.3.x rejects that flag — v0.0.13 ships the stdout-parse path instead.)

**Quote-char normalization in test-name patterns (v0.0.12+).** Stylistic apostrophes drift between a spec's `test:` line (e.g. `"v0.0.10's hash"`) and the test's actual `it()` name (e.g. `'v0.0.10s hash'` — auto-stylized during implementation), so an exact substring match no-matches correct work. The harness now normalizes quote-like characters (ASCII + curly apostrophes, ASCII + curly double-quotes, backticks) on the pattern before passing `-t` to bun. The companion `factory spec lint` rule `spec/test-name-quote-chars` catches non-ASCII quote chars at scoping time so authors can rewrite cleanly.

**`JudgeClient` interface.** A single method `judge(args)` that takes `{ criterion, scenario, artifact, model, timeoutMs }` and returns `{ pass, score, reasoning }`. The runtime ships `claudeCliJudgeClient` (subprocess-based) in `@wifo/factory-spec-review`; you can implement your own (e.g., for a different LLM provider).

**Status enum.** Each scenario's satisfaction lines aggregate into one of `pass`, `fail`, `error`, `skipped`. `runHarness` aggregates per-scenario results into the report.

## Worked example

```ts
import { runHarness } from '@wifo/factory-harness';
import { parseSpec } from '@wifo/factory-core';

const spec = parseSpec(await Bun.file('docs/specs/foo.md').text());

const report = await runHarness({
  spec,
  cwd: process.cwd(),
  noJudge: false,
  // optional: provide a custom judge client
  // judgeClient: myCustomJudgeClient,
});

console.log(report.summary); // { pass: 3, fail: 0, error: 0, skipped: 0 }
for (const scenario of report.scenarios) {
  console.log(scenario.id, scenario.status);
}
```

CLI:

```sh
$ pnpm exec factory-harness run docs/specs/foo.md --no-judge
spec=foo  scenarios=3
  S-1: pass
  S-2: pass
  S-3: pass
summary: 3 pass, 0 fail, 0 error, 0 skipped
```

## See also

- **[`AGENTS.md`](../../AGENTS.md)** — single doc for AI agents using the toolchain.
- **[`packages/runtime/README.md`](../runtime/README.md)** — the runtime's `validatePhase` is the primary harness consumer.
- **[`packages/core/README.md`](../core/README.md)** — spec format + parser.
- **[`packages/spec-review/README.md`](../spec-review/README.md)** — the spec reviewer reuses the harness's `JudgeClient` interface.
- **[`CHANGELOG.md`](../../CHANGELOG.md)** — every release's deltas.

## Status

Pre-alpha. APIs may break in point releases until v0.1.0.

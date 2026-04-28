# @wifo/factory-harness

Scenario runner for software-factory specs.

Reads a parsed `Spec` (via `@wifo/factory-core`), executes its `Satisfaction:` lines, and produces a typed `HarnessReport`. Two satisfaction kinds:

- **`test:`** — spawns `bun test <file> [-t <pattern>]`. Pass/fail from exit code.
- **`judge:`** — calls an LLM (Anthropic Claude, default `claude-haiku-4-5`) with the criterion + scenario context + spec body, returns a structured pass/score/reasoning judgment via tool-use.

## CLI

```
factory-harness run <spec-path> [flags]

Flags:
  --scenario <ids>       Comma-separated scenario ids (e.g. S-1,S-2,H-1)
  --visible              Only visible scenarios
  --holdouts             Only holdout scenarios
  --no-judge             Skip judge satisfaction lines (status=skipped)
  --model <name>         Override judge model (default: claude-haiku-4-5)
  --timeout-ms <n>       Per-satisfaction timeout (default: 30000)
  --reporter <text|json> Output format (default: text)
```

Exit codes: `0` pass, `1` fail, `2` usage error, `3` operational error.

## Prerequisites

- **`bun` on `PATH`** — the harness shells out to `bun test` regardless of which runtime invokes the CLI. The bundled `dist/cli.js` itself runs under Node.
- **`ANTHROPIC_API_KEY`** — required when any selected scenario has a `judge:` line and no custom `JudgeClient` is provided. Use `--no-judge` to skip judges entirely.

## Conventions

- `test:` paths are resolved relative to the directory of the spec file.
- Test patterns are passed verbatim to `bun test -t <pattern>` (Bun treats `-t` as a regex; users are responsible for escaping metacharacters).
- The judge artifact for v0.0.1 is the scenario text plus the spec body. Richer artifacts arrive with later layers.
- When more than 5 judge calls are queued for a run, the harness logs `<N> judge calls planned` to stderr before executing.

## Status

v0.0.1. Layer 1 of the factory.

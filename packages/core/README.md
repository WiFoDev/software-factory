# @wifo/factory-core

> The format and the front door. Spec parser, lint, scaffold, slash commands, and the unified `factory` CLI dispatch.

`@wifo/factory-core` is the package every agent and every other package depends on. It defines the canonical spec format (Zod schemas + parser), provides the format-floor lint, scaffolds new projects via `factory init`, ships the `/scope-project` slash command bundled in the npm tarball, and dispatches the `factory spec review` and `factory spec watch` subcommands. If you've used `factory <anything>`, you've used this package.

> **For AI agents:** start at **[`AGENTS.md`](../../AGENTS.md)** (top-level). This README is detailed reference for once you have the mental model.

## Install

```sh
pnpm add -D @wifo/factory-core
```

### bun is required for `pnpm test` only (v0.0.13+)

**bun is required for `pnpm test` only** — every workspace package's `scripts.test` is `bun test src` (the chosen test runner). `pnpm build` and `pnpm typecheck` are Node-native (Node 22+); the JSON-schema emitter runs via `tsx scripts/emit-json-schema.ts` with no bun on PATH at build time. `pnpm install` for consumers of the published packages does NOT require bun.

Or use without installing via `npx`:

```sh
npx -y @wifo/factory-core init --name my-project
```

`factory init` is the recommended bootstrap path — see the canonical workflow below.

### Peer dependency note (v0.0.13+)

`@wifo/factory-spec-review` is a **non-optional peer dependency** of
`@wifo/factory-core` — it powers `factory spec review` and the documented
happy path requires it.

- **pnpm 8+ / npm 7+** auto-install peer dependencies, so `pnpm add -D @wifo/factory-core`
  (or `npm i -D @wifo/factory-core`) brings in `@wifo/factory-spec-review` for free.
- **Legacy npm (< 7)** does NOT auto-install peers. Install both packages explicitly:

  ```sh
  npm i @wifo/factory-core @wifo/factory-spec-review
  ```

The shift from `dependencies` to `peerDependencies` in v0.0.13 breaks the
core ↔ spec-review workspace cycle that bit during the v0.0.12 publish.
The runtime resolution is unchanged: `import '@wifo/factory-spec-review/cli'`
works zero-config under any modern package manager.

## When to reach for it

- **Bootstrap a new factory project.** `factory init` drops a complete scaffold (`package.json` with deps + scripts pinned, `tsconfig.json`, `tsconfig.build.json`, `.gitignore`, `biome.json`, `factory.config.json`, `README.md`, `.claude/commands/scope-project.md`, and the `docs/{specs,technical-plans}/done/` skeleton). Idempotent + safe — exits 2 with a list of conflicts if any target file exists; never overwrites without consent.
- **Lint a spec.** `factory spec lint <path>` runs the format-floor check (frontmatter shape, scenario structure, satisfaction-line syntax, `depends-on` validation, wide-blast-radius warning). Fast, free, deterministic.
- **Review spec quality.** `factory spec review <path>` dispatches into `@wifo/factory-spec-review` to run 8 LLM judges scoring spec **quality** beyond format. Cache-backed; subscription-paid via `claude -p`.
- **Watch a directory tree continuously** (v0.0.10+). `factory spec watch <path>` re-runs lint (+ optionally review) on every `*.md` change. Companion to the PostToolUse hook recipe.
- **Programmatically parse / lint / watch specs.** Import `parseSpec`, `lintSpec`, `lintSpecFile`, `parseDodBullets`, `watchSpecs` directly.

## What's inside

### CLI commands

The `factory` binary dispatches into subcommands:

```
factory init [--name <pkg>] [--adopt]         # Scaffold a new factory project (--adopt: additive, for existing repos)
factory spec lint <path>                      # Format-floor lint (recurses on dirs)
factory spec review <path> [flags]            # Quality review (8 LLM judges)
factory spec watch <path> [--review] [...]    # Continuous lint+review on save (v0.0.10+)
factory spec schema                           # Emit JSON Schema for editor intellisense
factory finish-task <id> [--dir <p>] [--context-dir <p>]   # Move converged spec to done/ + emit factory-spec-shipped (v0.0.12+)
factory finish-task --all-converged [--since <factorySequenceId>] [--dir <p>] [--context-dir <p>]
                                              # Batch-ship every converged spec under a factory-sequence (v0.0.13+)
```

`factory init --adopt` (v0.0.12+) is the brownfield-adopter onramp: walks the same template plan as `factory init` but **skips** files in `IGNORE_IF_PRESENT` (`package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `README.md`) when they already exist, **appends** factory entries (`.factory`, `.factory-spec-review-cache`) to a pre-existing `.gitignore`, and **creates** only the factory-specific bits (`docs/specs/done/`, `docs/technical-plans/done/`, `factory.config.json`, `.claude/commands/scope-project.md`). Idempotent — running twice never duplicates `.gitignore` entries. Does NOT mutate your `package.json` (a future `--write-deps` will opt-in to that).

`factory finish-task <id>` (v0.0.12+) ships a converged spec: moves `<dir>/<id>.md` to `<dir>/done/<id>.md` (creating `done/` if missing) and emits a `factory-spec-shipped` context record parented on the converged `factory-run` so the lifecycle is reconstructible from the store alone. Refuses to run if no converged `factory-run` exists for the given spec id. The runtime emits a `factory-runtime: <id> converged → ship via 'factory finish-task <id>'` hint on stdout when a spec converges.

`factory finish-task --all-converged` (v0.0.13+) batch-ships every converged spec under a single `factory-sequence` — the natural counterpart to `factory-runtime run-sequence`, which already ships clusters of 4-6 specs in one invocation. With no flag, it walks the **most recent** factory-sequence (largest `recordedAt`; tie-break on lex-larger id). `--since <factorySequenceId>` overrides the default to target a specific sequence (full id only — no prefix matching). Mutually exclusive with the positional `<spec-id>` form (passing both exits 2). Errored specs in the same sequence stay at `<dir>/<id>.md` for the maintainer to retry; per-spec move failures abort the batch.

```sh
# Ship every converged spec from the most recent run-sequence:
factory finish-task --all-converged
# → factory: shipped core-store-and-slug → done/ (run aa000000)
#   factory: shipped shorten-endpoint → done/ (run bb000000)
#   factory: shipped 2 specs from sequence 00112233

# Retroactively ship from an earlier sequence:
factory finish-task --all-converged --since 00112233aabbccdd
```

Key flags (`spec review`):

| Flag | Default | Notes |
|---|---|---|
| `--cache-dir <path>` | `.factory-spec-review-cache` | Per-spec-bytes cache so unchanged specs are free to re-run. |
| `--no-cache` | off | Disable cache layer. |
| `--judges <a,b,c>` | all 8 | Comma-separated subset. |
| `--claude-bin <path>` | `claude` on PATH | Override (test injection). |
| `--technical-plan <path>` | auto-resolved | Override path to paired technical-plan. |
| `--timeout-ms <n>` | 60000 | Per-judge timeout. |

Key flags (`spec watch`, v0.0.10+):

| Flag | Default | Notes |
|---|---|---|
| `--review` | off | Also run `factory spec review --no-cache` per change. |
| `--debounce-ms <n>` | 200 | Per-file debounce window. |
| `--claude-bin <path>` | `claude` | Forwarded to review subprocess. |

### Public API (34 exports as of v0.0.12)

```ts
// Schema (Zod)
import {
  KEBAB_ID_REGEX,
  SpecFrontmatterSchema, SpecExemplarSchema, SpecClassificationSchema,
  SpecScenarioKindSchema, SpecScenarioSatisfactionKindSchema, SpecScenarioSatisfactionSchema,
  SpecStatusSchema, SpecTypeSchema,
} from '@wifo/factory-core';

import type {
  Spec, SpecFrontmatter, SpecExemplar,
  Scenario, ScenarioSatisfaction,
  SpecClassification, SpecScenarioKind, SpecScenarioSatisfactionKind,
  SpecStatus, SpecType,
} from '@wifo/factory-core';

// Parser
import { parseSpec, parseDodBullets, SpecParseError, splitFrontmatter } from '@wifo/factory-core';
import type { ParseSpecOptions, ParseIssue, DodBullet, FrontmatterSplit } from '@wifo/factory-core';

// Section slicer + scenario walker
import { findSection, parseScenarios } from '@wifo/factory-core';
import type { SectionExtract } from '@wifo/factory-core';

// Lint
import { lintSpec, lintSpecFile } from '@wifo/factory-core';
import type { LintError, LintOptions, LintSeverity } from '@wifo/factory-core';

// JSON Schema (editor intellisense)
import { getFrontmatterJsonSchema, SPEC_FRONTMATTER_SCHEMA_ID } from '@wifo/factory-core';

// Watch helper (v0.0.10+)
import { watchSpecs } from '@wifo/factory-core';
import type { WatchSpecsOptions } from '@wifo/factory-core';

// Spec lifecycle (v0.0.12+) — programmatic counterpart to `factory finish-task <id>`
import { finishTask } from '@wifo/factory-core';
import type { FinishTaskOptions, FinishTaskResult } from '@wifo/factory-core';

// Errors
import { FrontmatterError } from '@wifo/factory-core';
```

### Concepts

**Spec format.** YAML frontmatter (`id`, `classification`, `type`, `status`, `exemplars`, `depends-on`, `agent-timeout-ms`) + Markdown body sections (`## Intent`, `## Scenarios`, `## Constraints / Decisions`, `## Subtasks`, `## Definition of Done`, optionally `## Holdout Scenarios`). Strict — unknown frontmatter fields surface as warnings. See `docs/SPEC_TEMPLATE.md` for the canonical skeleton.

**`parseDodBullets` (v0.0.10+).** Walks a `## Definition of Done` section and classifies each bullet as `kind: 'shell'` (executable Bash from a locked allowlist) or `kind: 'judge'` (LLM-evaluated criterion). Powers the runtime's `dodPhase`. **The shell allowlist is closed:** `pnpm`, `bun`, `npm`, `node`, `tsc`, `git`, `npx`, `bash`, `sh`, `make`, `pwd`, `ls`, plus `./` and `../` paths.

**`watchSpecs` (v0.0.10+).** Long-running watcher returning `{ stop }`. Re-runs lint (+ optionally review) per-file with a 200ms debounce. SIGINT-aware in the CLI wrapper.

**Lint codes + NOQA.** Format-level errors block; quality-level warnings inform. Codes include `frontmatter/*`, `scenario/*`, `scenarios/*`, `spec/invalid-depends-on`, `spec/depends-on-missing`, `spec/wide-blast-radius`, `spec/test-name-quote-chars` (v0.0.12+ — `test:` patterns using curly `‘ ’ “ ”` get rewritten ASCII-clean before run-time), and `spec/dod-needs-explicit-command` (v0.0.12+ — DoD bullets that look like runtime gates but don't embed a backtick-wrapped shell command; pairs with the runtime's literal-command DoD contract). Suppress warnings via `<!-- NOQA: spec/<code> -->` HTML comment anywhere in the spec body (v0.0.10+; warnings only — errors cannot be suppressed). See [`AGENTS.md` § 6](../../AGENTS.md#6-the-full-primitives-reference) for the full code table.

## Slash commands

### `/scope-project` (v0.0.7+; auto-installed by `factory init` since v0.0.8)

Decompose a natural-language product description into 4-6 ordered LIGHT specs. Canonical source: [`packages/core/commands/scope-project.md`](./commands/scope-project.md). `factory init` writes the bundled file to `<cwd>/.claude/commands/scope-project.md` automatically.

For Claude Code sessions across all projects (user-level install):

```sh
cp node_modules/@wifo/factory-core/commands/scope-project.md ~/.claude/commands/scope-project.md
```

Invoke from any Claude Code session in a factory-bootstrapped project:

```text
/scope-project A URL shortener with click tracking and JSON stats.
               JSON-over-HTTP, in-memory storage, no auth.
```

Output: 4-6 spec files under `docs/specs/`, first `status: ready`, rest `status: drafting`, every spec populates `depends-on`. Worked-example output: [`docs/baselines/scope-project-fixtures/url-shortener/`](../../docs/baselines/scope-project-fixtures/url-shortener/).

**Smoke-boot extension (v0.0.12+).** When a generated spec mentions an HTTP entrypoint pattern (`createServer`, `listen(<port>)`, `app.listen`, `http.createServer`, `Bun.serve`, `serve(`), `/scope-project` appends a smoke-boot scenario that spawns `bun src/main.ts`, probes a route, and kills the process. The smoke-boot test forces the production entrypoint into existence — closing the v0.0.11 BASELINE gap where library code shipped but `bun src/main.ts` 404'd because no `test:` line ever forced the entrypoint to be written.

**Init-scaffold polishes (v0.0.13+).** Three first-contact frictions surfaced in the v0.0.12 BASELINE close in this release:

- **`biome.json` schema migrates to Biome 2.x.** The scaffold pins `@biomejs/biome ^2.4.4` (a 2.x release) but until v0.0.13 emitted the Biome 1.x `files.include` key, so `pnpm check` errored on first run. v0.0.13 emits `files.includes` (Biome 2.x) and adds `formatter.indentStyle: 'space'` so the JSON-stringified config is self-consistent. The schema major must stay locked to the pinned biome major.
- **`.factory/` is pre-created via `.gitkeep`.** Pre-v0.0.13, `.factory/` was created lazily by the runtime, so any pre-runtime tooling (e.g., `tee .factory/run-sequence.log`) failed until first run. v0.0.13 ships `.factory/.gitkeep` in the scaffold so the dir exists from `git clone` time. `.gitignore` now lists `.factory/worktrees/` and `.factory/twin-recordings/` (the per-record subdirs the runtime writes); `.factory/` itself is tracked so users see the dir without ambiguity.
- **`factory.config.json` gains `dod.template`.** A `string[]` of literal-command DoD bullet bodies derived from the scaffold's `package.json` scripts (typecheck, test, check). `/scope-project` reads this at spec-author time and emits the same block into every generated spec's `## Definition of Done`, so the v0.0.12 `spec/dod-needs-explicit-command` lint stays green from the very first author. `build` is intentionally excluded — build is a publish prereq, not a per-spec DoD gate. Override per-project by editing `factory.config.json.dod.template`.

### `/scope-task`

Single-task analog. Lives at `~/.claude/commands/scope-task.md` (predates the "ship in repo" convention).

## `factory.config.json`

Written by `factory init` at the scaffold root. Defaults the canonical run flags so `factory-runtime run` collapses to a flagless invocation:

```json
{
  "runtime": {
    "maxIterations": 5,
    "maxTotalTokens": 1000000,
    "maxPromptTokens": 100000,
    "noJudge": false,
    "maxSequenceTokens": 5000000,
    "continueOnFail": false,
    "includeDrafting": false,
    "skipDodPhase": false
  }
}
```

Precedence: **CLI flag > config file > built-in default**. Unknown keys are tolerated for forward-compatibility. Edit to taste; absent or malformed files are ignored silently.

## Harness-enforced spec linting + review (Claude Code hook recipe)

`factory spec lint` and `factory spec review` are most valuable when they run on every save — but agents forget. The fix is harness-enforced: a [`PostToolUse` hook](https://docs.claude.com/en/docs/claude-code/hooks) runs both whenever the agent writes a spec file.

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "if [ \"${CLAUDE_PROJECT_DIR}/${CLAUDE_FILE_PATH}\" = *docs/specs/*.md ]; then pnpm exec factory spec lint \"$CLAUDE_FILE_PATH\" && pnpm exec factory spec review \"$CLAUDE_FILE_PATH\" --no-cache; fi"
      }
    ]
  }
}
```

The shell guard fires only for `docs/specs/*.md` writes. Bash/zsh-portable. This recipe is intentionally **opt-in** — `factory init` does not touch `~/.claude/`, and there is no `factory hook install` command. The Claude-Code-independent companion is `factory spec watch` (v0.0.10+) — runs in a terminal, no hook needed.

## Worked example

```sh
mkdir my-app && cd my-app && git init -q
npx -y @wifo/factory-core init --name my-app
pnpm install

# Author a single spec (one-off feature)
echo "..." > docs/specs/my-feature.md   # or use /scope-task

pnpm exec factory spec lint docs/specs/
# → docs/specs/my-feature.md: OK

pnpm exec factory spec review docs/specs/my-feature.md

# Continuous watch in another terminal
pnpm exec factory spec watch docs/specs/ --review
```

## See also

- **[`AGENTS.md`](../../AGENTS.md)** — single doc for AI agents using the toolchain.
- **[`README.md`](../../README.md)** (top-level) — project overview + worked examples.
- **[`docs/SPEC_TEMPLATE.md`](../../docs/SPEC_TEMPLATE.md)** — canonical spec skeleton.
- **[`packages/runtime/README.md`](../runtime/README.md)** — the runtime that ships specs into code.
- **[`packages/spec-review/README.md`](../spec-review/README.md)** — the LLM judges `factory spec review` dispatches into.
- **[`CHANGELOG.md`](../../CHANGELOG.md)** — every release's deltas.

## Status

Pre-alpha. APIs may break in point releases until v0.1.0.

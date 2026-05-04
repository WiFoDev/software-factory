# @wifo/factory-core

> The format and the front door. Spec parser, lint, scaffold, slash commands, and the unified `factory` CLI dispatch.

`@wifo/factory-core` is the package every agent and every other package depends on. It defines the canonical spec format (Zod schemas + parser), provides the format-floor lint, scaffolds new projects via `factory init`, ships the `/scope-project` slash command bundled in the npm tarball, and dispatches the `factory spec review` and `factory spec watch` subcommands. If you've used `factory <anything>`, you've used this package.

> **For AI agents:** start at **[`AGENTS.md`](../../AGENTS.md)** (top-level). This README is detailed reference for once you have the mental model.

## Install

```sh
pnpm add -D @wifo/factory-core
```

Or use without installing via `npx`:

```sh
npx -y @wifo/factory-core init --name my-project
```

`factory init` is the recommended bootstrap path — see the canonical workflow below.

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
factory init [--name <pkg>]                   # Scaffold a new factory project
factory spec lint <path>                      # Format-floor lint (recurses on dirs)
factory spec review <path> [flags]            # Quality review (8 LLM judges)
factory spec watch <path> [--review] [...]    # Continuous lint+review on save (v0.0.10+)
factory spec schema                           # Emit JSON Schema for editor intellisense
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

### Public API (33 exports as of v0.0.10)

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

// Errors
import { FrontmatterError } from '@wifo/factory-core';
```

### Concepts

**Spec format.** YAML frontmatter (`id`, `classification`, `type`, `status`, `exemplars`, `depends-on`, `agent-timeout-ms`) + Markdown body sections (`## Intent`, `## Scenarios`, `## Constraints / Decisions`, `## Subtasks`, `## Definition of Done`, optionally `## Holdout Scenarios`). Strict — unknown frontmatter fields surface as warnings. See `docs/SPEC_TEMPLATE.md` for the canonical skeleton.

**`parseDodBullets` (v0.0.10+).** Walks a `## Definition of Done` section and classifies each bullet as `kind: 'shell'` (executable Bash from a locked allowlist) or `kind: 'judge'` (LLM-evaluated criterion). Powers the runtime's `dodPhase`. **The shell allowlist is closed:** `pnpm`, `bun`, `npm`, `node`, `tsc`, `git`, `npx`, `bash`, `sh`, `make`, `pwd`, `ls`, plus `./` and `../` paths.

**`watchSpecs` (v0.0.10+).** Long-running watcher returning `{ stop }`. Re-runs lint (+ optionally review) per-file with a 200ms debounce. SIGINT-aware in the CLI wrapper.

**Lint codes + NOQA.** Format-level errors block; quality-level warnings inform. Suppress warnings via `<!-- NOQA: spec/<code> -->` HTML comment anywhere in the spec body (v0.0.10+; warnings only — errors cannot be suppressed). See [`AGENTS.md` § 6](../../AGENTS.md#6-the-full-primitives-reference) for the full code table.

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

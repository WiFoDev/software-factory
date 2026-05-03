# @wifo/factory-core

Universal primitives for software factory specs.

- Frontmatter schema (zod)
- Markdown + YAML parser
- Scenario / Given-When-Then parser
- `factory init` — bootstrap a new factory project (v0.0.4+)
- `factory spec lint` CLI
- `factory spec review` — LLM-judged spec quality (v0.0.4+, requires `@wifo/factory-spec-review`)
- `factory spec schema` — JSON Schema export for editor intellisense

Project-agnostic. Domain specifics live in `@wifo/factory-pack-*`.

## Bootstrap a new project (v0.0.4+)

```sh
mkdir my-thing && cd my-thing
pnpm exec factory init                    # uses basename(cwd) as the package name
# or
pnpm exec factory init --name my-thing
```

Drops a minimal scaffold: `package.json` (semver deps), self-contained `tsconfig.json`, `.gitignore`, `README.md`, and the `docs/specs/done/`, `docs/technical-plans/done/`, `src/` directories with `.gitkeep`s.

Idempotent and safe by default: if any target file or directory already exists, exits `2` with a list of conflicts and does NOT write anything (no `--force` flag).

The scaffold's `package.json` pins `@wifo/factory-*` deps to `^0.0.8` — `pnpm install` resolves them from the public npm registry.

The scaffolded `README.md` includes a `## Multi-spec products` section documenting the canonical v0.0.7+ flow (`/scope-project` → `factory spec lint` → `factory-runtime run-sequence`) so a maintainer reading the generated project knows which command to reach for. The slash command source at `<cwd>/.claude/commands/scope-project.md` is dropped automatically — no manual `cp` step needed.

### factory.config.json (v0.0.5.1+)

`factory init` writes a `factory.config.json` at the repo root with the documented runtime defaults:

```json
{
  "runtime": {
    "maxIterations": 5,
    "maxTotalTokens": 1000000,
    "maxPromptTokens": 100000,
    "noJudge": false
  }
}
```

`factory-runtime run` reads this file from `cwd` if present and applies any subset of the `runtime.*` keys as defaults. Precedence is **CLI flag > config file > built-in default** — the canonical `--max-iterations 5 --max-total-tokens 1000000 --no-judge --max-prompt-tokens 100000` invocation collapses to a flagless `factory-runtime run <spec>`. Edit the file to taste; absent or malformed files are ignored silently (the file is OPTIONAL by design). Unknown keys are tolerated for forward-compatibility.

v0.0.7 adds two new optional keys:

| Key | Type | Default | Effect |
|---|---|---|---|
| `runtime.maxSequenceTokens` | number | unbounded | Whole-sequence cap on summed agent tokens for `factory-runtime run-sequence`. |
| `runtime.continueOnFail` | boolean | false | Continue running independent specs after a failure (transitive dependents still skip). |

## Slash commands

### `/scope-project` (v0.0.7)

A Claude Code slash command that takes a natural-language product description and writes 4-6 LIGHT specs in dependency order under `docs/specs/`. The first generated spec ships `status: ready`; the rest ship `status: drafting` so the maintainer flips them one at a time as each prior spec converges. Every generated spec populates the new `depends-on:` frontmatter field so `factory-runtime run-sequence` can walk the DAG.

**Install:**

`factory init` (v0.0.8+) drops the canonical `/scope-project` source at the project's `.claude/commands/scope-project.md` automatically — every fresh `factory init` picks up the slash command zero-config. The bundled source ships with `@wifo/factory-core` at `node_modules/@wifo/factory-core/commands/scope-project.md`.

For users who want the command available across all projects (user-level), copy it into your dotfiles:

```sh
# Copy the bundled source into your dotfiles. Symlink works too.
cp node_modules/@wifo/factory-core/commands/scope-project.md ~/.claude/commands/scope-project.md
```

**Invoke (inside a project repo, after `factory init`):**

```text
/scope-project A URL shortener with click tracking and a JSON stats endpoint.
               JSON-over-HTTP, in-memory storage, no auth.
```

The slash command writes 4-6 spec files under `docs/specs/`. Run `factory spec lint docs/specs/` (and `factory spec review docs/specs/<first-id>.md` on the first spec) before kicking off the runtime. See `docs/baselines/scope-project-fixtures/url-shortener/` for a worked-example output set against the canonical URL-shortener prompt.

### `/scope-task`

The single-task analog of `/scope-project`. Lives under `~/.claude/commands/scope-task.md` (predates v0.0.7's "ship in repo" pattern). Documents the canonical spec skeleton + tier classification (LIGHT vs DEEP).

## Harness-enforced spec linting + review (Claude Code hook recipe)

Both `factory spec lint` and `factory spec review` are most valuable when they run on every save — but agents forget to run them. The fix is harness-enforced: a [Claude Code `PostToolUse` hook](https://docs.claude.com/en/docs/claude-code/hooks) runs both checkers automatically whenever the agent writes a spec file. Harness-enforced means the hook fires regardless of whether the agent remembered to run the linter — drop this into your settings to make the agent literally unable to forget.

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

The shell guard ensures the hook only fires for writes under `docs/specs/*.md` — every other `Write`/`Edit` is a no-op. Bash/zsh-portable.

**Failure mode.** `PostToolUse` fires AFTER the write completes, so a failing review surfaces as a notification the agent sees on its next turn — it is not a blocked write. If the agent shipped a bad spec, the hook tells the user (and the agent), and the user can revert or trigger a fix on the next turn. The window between a bad write and the next agent turn is the only exposure.

This recipe is intentionally **opt-in** — `factory init` does not touch `~/.claude/`, and there is no `factory hook install` command. Drop the block in by hand if you want it; leave it out if you don't.

## Status

Pre-alpha — schema is being shaped against real specs. APIs will break.

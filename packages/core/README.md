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

The scaffold's `package.json` pins `@wifo/factory-*` deps to `^0.0.5` — `pnpm install` resolves them from the public npm registry.

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

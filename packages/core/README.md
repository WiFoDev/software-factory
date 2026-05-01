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

> **v0.0.4 caveat:** the `@wifo/factory-*` packages are not yet published to npm (deferred to v0.0.5). Until then, scaffolds work only inside the software-factory monorepo (or with pnpm overrides linking to the local packages).

## Status

Pre-alpha — schema is being shaped against real specs. APIs will break.

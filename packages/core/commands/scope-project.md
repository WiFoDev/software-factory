Scope the following product description: $ARGUMENTS

You are about to decompose a natural-language product description into a sequence of small, dependency-ordered specs that the `factory-runtime` toolkit can ship one at a time. The maintainer's role is to **review** each spec before it runs — your job is to do the mechanical decomposition.

You will produce 4-6 LIGHT-classification specs under `docs/specs/<id>.md` in dependency order. The first spec ships with `status: ready`; all subsequent specs ship with `status: drafting` so the maintainer flips them to `ready` one at a time as each prior spec converges.

## Step 1: Decompose

Read the product description carefully. Identify **dependency boundaries that match real module / package boundaries** and order them by dependency:

- **Core / helper modules** ship FIRST (no deps). These are the data shapes, error types, and pure functions that everything else uses.
- **Layer modules** (HTTP endpoints, CLI commands, storage adapters) ship NEXT, depending on the core.
- **Frontend / dashboard / cross-cutting** modules ship LAST, depending on the layers below them.

**Per-feature sweet spot (locked by v0.0.5 + v0.0.6 BASELINE evidence):** each generated spec must be small enough that `factory-runtime run` converges in 1-2 iterations under default budgets. Empirically, this is **~50-200 LOC including tests**. If you find yourself writing a spec that touches 10 files or 500+ LOC, **split it** — that's the signal.

**Shared constraints rule:** decisions that apply to MULTIPLE specs (data shape, error codes, public API conventions, default values) belong in the FIRST spec's `## Constraints / Decisions` block. Later specs **reference** those decisions by spec id (e.g., "uses the error code shape defined in `<first-id>`'s Constraints"). Do **not** paraphrase shared decisions across specs — that is exactly the friction `/scope-project` exists to remove.

**Decomposition discipline checklist:**

- Each spec covers ONE feature, not "feature + adjacent thing."
- Each spec has 2-4 `## Scenarios`, NOT 8+. If you have 8 scenarios for one feature, the feature is too big — split it.
- Each spec's `## Subtasks` has 3-6 subtasks. If you have 10 subtasks, the spec is too big.
- DEEP classification is allowed only for genuinely architectural specs (new data models, spans backend + frontend, schema migrations). The default is LIGHT.

## Step 2: Generate specs

For each spec in dependency order, write a file at `docs/specs/<id>.md` using the canonical skeleton:

```
---
id: <kebab-case-id>
classification: light
type: feat
status: ready | drafting
exemplars:
  - path: <relative/path/to/file>
    why: <one line>
depends-on:
  - <prior-spec-id>
  - <prior-spec-id>
---

# <id> — <one-line intent>

## Intent
<2-4 sentences>

## Scenarios
**S-1** — <short name>
  Given <state>
  When <action>
  Then <observable outcome>
  Satisfaction:
    - test: <bare path> "<test name>"

**S-2** — ...

## Constraints / Decisions
- <decision>

## Subtasks
- **T1** [feature] — ... ~80 LOC. **depends on nothing.**

## Definition of Done
- All scenarios pass.
- typecheck + lint + tests green.
```

**Field rules:**

- Each generated spec id matches the kebab-case pattern `^[a-z][a-z0-9-]*$`. Lowercase letters, digits, hyphens. Must start with a letter.
- The FIRST spec's `status: ready`. Every subsequent spec's `status: drafting`. The maintainer flips drafting → ready manually as each prior spec converges (`factory-runtime run-sequence` will read `status: ready` and walk forward; specs at `drafting` are a no-op until flipped).
- `depends-on:` is always emitted, even when empty (`depends-on: []` for the first spec). Each entry must be the id of an earlier-generated spec in the same set. **No forward references; no external ids.**
- Each spec is `classification: light` by default. Use `classification: deep` ONLY for genuinely architectural specs (then also produce a paired `docs/technical-plans/<id>.md`).
- Test paths in `Satisfaction:` lines are written **bare** (no backticks): `test: src/foo.test.ts "name"`, NOT `test: \`src/foo.test.ts\` "name"`.
- Each scenario has at least one `test:` line. `judge:` lines are optional and used for fuzzy criteria (log clarity, error UX) that unit tests can't capture.

#### Frontmatter quoting (v0.0.14+)

If a frontmatter value contains a colon (e.g., a generic type like `Map<string, T>`), wrap the value in single quotes to avoid YAML parsing it as a nested mapping. The unquoted form trips the `BLOCK_AS_IMPLICIT_KEY` parser path and the spec fails to load. The `spec/yaml-colon-needs-quoting` lint warning catches it at scoping time, but quoting at author time avoids the friction entirely.

- ✅ Quoted (parses as a single string value):

  ```yaml
  why: 'clicks: Map<string, Click[]>'
  ```

- ❌ Unquoted (parses incorrectly as a nested mapping, lint emits a warning):

  ```yaml
  why: `clicks: Map<string, Click[]>`
  ```

### Definition of Done — `dod.template` precedence (v0.0.13+)

If `factory.config.json` in `<cwd>` has a `dod.template` field (a `string[]` of literal-command DoD bullet bodies), use it as the body of every generated spec's `## Definition of Done` section: emit each entry as `- <entry>`, plus the `All scenarios pass.` line. **The literal backtick-wrapped commands in each entry MUST be preserved verbatim** — the v0.0.12 `spec/dod-needs-explicit-command` lint flags DoD bullets that name a runtime gate (typecheck, tests, biome) without embedding the shell command in backticks. `factory init` ships `dod.template` defaults derived from the scaffold's `package.json` scripts, so a freshly-scaffolded repo emits lint-clean DoD blocks from the very first `/scope-project` invocation.

If `factory.config.json` is missing, malformed, or has no `dod.template` field, fall back to the canonical defaults (typecheck/tests/biome). The maintainer can override per-project by editing `factory.config.json.dod.template`.

### HTTP entrypoint smoke-boot scenarios

If a spec introduces an HTTP entrypoint (mentions any of: `createServer`, `listen(<port>)`, `app.listen`, `http.createServer`, `Bun.serve`, `serve(`), append a smoke-boot scenario like the worked example below. This forces the production entrypoint (`src/main.ts` or the spec-named equivalent) into existence — without it, the implement phase tends to ship working library code while leaving `bun src/main.ts` 404'ing because the entrypoint never gets written.

The trigger keywords above are guidance for you (the LLM running this slash command), not a strict regex — substring-match against the spec's body during authoring. If any one matches, append the smoke-boot scenario.

**Worked example** (paste verbatim, then adapt the route + entrypoint path to whatever the spec actually defines):

```
**S-N** — boots the production entrypoint on the configured port
  Given the spec's public API exports
  When `bun src/main.ts` (or the entrypoint declared in Constraints) is spawned with PORT=<test-port>
  Then the process binds the configured port; a /health probe (or any defined route) returns 2xx; the process is killed cleanly
  Satisfaction:
    - test: src/main.test.ts "boots the production entrypoint on the configured port"
```

**Test-path convention.** `src/main.test.ts` is canonical (next to `src/main.ts` — the entrypoint it boots). If the spec names a different entrypoint in its Constraints (e.g., `src/server.ts`), the test path follows: `src/server.test.ts`. Defining `/health` is the spec's job, not this slash command's — if the spec's API doesn't have `/health`, the smoke-boot test asserts on whatever route the spec defines. The example uses `/health` as the canonical exemplar; substitute as appropriate.

## Step 3: Self-check

After writing all specs, run the format-floor lint:

```sh
node packages/core/dist/cli.js spec lint docs/specs/
# or, in a fresh repo with @wifo/factory-core installed:
pnpm exec factory spec lint docs/specs/
```

Expected: exit 0. Any error means a spec doesn't parse — fix the spec, don't fix the linter.

Then run the LLM-judged spec reviewer on the FIRST spec (the one with `status: ready`):

```sh
pnpm exec factory spec review docs/specs/<first-id>.md
```

Expected: any findings emerge as `review/...` warnings; the maintainer reviews them before kicking off the runtime. The reviewer's `cross-doc-consistency` judge will read declared `depends-on:` deps automatically when scoring.

Optionally run `factory spec watch docs/specs/ --review` in another terminal for continuous lint+review on every save.

## Step 4: Report

Print a summary table to the maintainer:

| # | id | depends-on | status | classification |
|---|---|---|---|---|
| 1 | `<id-1>` | `[]` | ready | light |
| 2 | `<id-2>` | `[<id-1>]` | drafting | light |
| ... | ... | ... | ... | ... |

Plus a one-line "ship order" reminder: `factory-runtime run-sequence docs/specs/` (when ready). The maintainer reviews the spec set; flips the first spec to `ready` and runs it; flips the next when it converges; and so on until the product ships.

**Do not implement anything.** The implementation step happens in a separate session driven by `factory-runtime` against each spec, after the maintainer has reviewed them.

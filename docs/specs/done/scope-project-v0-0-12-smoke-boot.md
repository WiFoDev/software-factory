---
id: scope-project-v0-0-12-smoke-boot
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/core/commands/scope-project.md
    why: "the canonical source of /scope-project. v0.0.12 extends Step 2's spec-generation guidance: when a spec introduces an HTTP entrypoint (mentions createServer/listen/app.listen patterns), append a smoke-boot scenario that imports + boots + closes the server, forcing src/main.ts (or equivalent) into existence."
  - path: packages/core/src/scope-project-source.test.ts
    why: "validates the scope-project source. Existing test surface — extend with assertions that the smoke-boot guidance is present, with worked example snippet, and references the trigger keywords."
  - path: packages/core/src/scope-project-fixture.test.ts
    why: "tests the worked URL-shortener fixture. v0.0.12 extends with a smoke-boot scenario coverage assertion (the URL-shortener cluster ships a smoke-boot scenario for the HTTP server spec)."
  - path: BACKLOG.md
    why: "v0.0.12 entry 'Production entrypoint missing when no test: line forces it' (short-url BASELINE friction #2). Closes the 'library shipped, server doesn't boot' gap that broke the curl cookbook."
depends-on:
  - factory-core-v0-0-12-brownfield
---

# scope-project-v0-0-12-smoke-boot — close the "library shipped, server doesn't boot" gap

## Intent

The v0.0.11 short-url BASELINE found that `/scope-project` produces specs whose Constraints declare `src/main.ts` calls `createServer({ port: 3000 })` for production, but no spec emits a `test:` line forcing the entrypoint's existence. Result: the implement phase ships working library code, but `bun src/main.ts` 404's because the entrypoint never gets written. v0.0.12 extends `/scope-project`'s prompt with smoke-boot guidance: when a spec introduces an HTTP entrypoint pattern (`createServer` / `listen(<port>)` / `app.listen` / similar), the scoper emits a smoke-boot scenario that imports + boots + closes the server. The test forces `src/main.ts` (or the spec-named entrypoint) into existence — closing the trust gap by extending what the test contract observes.

This spec is prompt-edits-only — touches `packages/core/commands/scope-project.md`. No code changes.

## Scenarios

**S-1** — `/scope-project` source contains explicit smoke-boot guidance + worked example
  Given the canonical `/scope-project` source at `packages/core/commands/scope-project.md`
  When read in v0.0.12+
  Then Step 2 (Generate specs) contains a new subsection `### HTTP entrypoint smoke-boot scenarios` with explicit guidance: "If a spec introduces an HTTP entrypoint (mentions any of: `createServer`, `listen(<port>)`, `app.listen`, `http.createServer`, `Bun.serve`, `serve(`), append a smoke-boot scenario like the worked example below." A worked example is shown verbatim:
  ```
  **S-N** — boots the production entrypoint on the configured port
    Given the spec's public API exports
    When `bun src/main.ts` (or the entrypoint declared in Constraints) is spawned with PORT=<test-port>
    Then the process binds the configured port; a /health probe (or any defined route) returns 2xx; the process is killed cleanly
    Satisfaction:
      - test: src/main.test.ts "boots the production entrypoint on the configured port"
  ```
  Satisfaction:
    - test: packages/core/src/scope-project-source.test.ts "scope-project source contains HTTP entrypoint smoke-boot guidance subsection"
    - test: packages/core/src/scope-project-source.test.ts "scope-project source's smoke-boot worked example references src/main.test.ts with verb-matching test title"

**S-2** — Trigger keyword list is present + matches the canonical pattern
  Given the canonical `/scope-project` source
  When parsed in v0.0.12+
  Then the smoke-boot subsection enumerates trigger keywords explicitly: `createServer`, `listen(<port>)`, `app.listen`, `http.createServer`, `Bun.serve`, `serve(`. The list is meant to guide the LLM running the slash command — not parsed mechanically. Each keyword is in a backtick code-span for clarity.
  Satisfaction:
    - test: packages/core/src/scope-project-source.test.ts "scope-project source enumerates HTTP entrypoint trigger keywords"

**S-3** — URL-shortener fixture demonstrates the smoke-boot scenario in its HTTP-introducing spec
  Given the worked example fixture under `docs/baselines/scope-project-fixtures/url-shortener/`
  When read in v0.0.12+
  Then the HTTP-introducing spec (e.g., `shorten-endpoint.md` or its equivalent) contains a smoke-boot scenario matching the canonical shape from S-1's guidance. The scenario tests `bun src/main.ts` boot + port-bind + /health probe. The fixture is the canonical reference for "what scope-project should produce" in v0.0.12+.
  Satisfaction:
    - test: packages/core/src/scope-project-fixture.test.ts "url-shortener fixture's HTTP spec contains a smoke-boot scenario"

## Constraints / Decisions

- **Trigger keyword list (locked for v0.0.12):** `createServer`, `listen(<port>)`, `app.listen`, `http.createServer`, `Bun.serve`, `serve(` — substring match against the spec's body during scope-project's authoring step. The list is illustrative; the LLM running the slash command uses it as guidance, not as a strict regex.
- **Smoke-boot scenario name pattern (locked):** `**S-<N>** — boots the production entrypoint on the configured port` — matches the canonical Given/When/Then idiom in the slash-command source. The agent running implement reads this and writes a corresponding test that boots + asserts.
- **Test file convention:** `src/main.test.ts` is canonical for the smoke-boot test (next to `src/main.ts` — the entrypoint it boots). Spec authors may use the spec-named entrypoint instead (e.g., `src/server.ts` + `src/server.test.ts`); the test path follows the entrypoint path.
- **No prompt-engineering complexity beyond keyword list + worked example.** The slash command's job is decomposition guidance, not pattern detection. A future v0.0.13 candidate could add LLM-judged pattern detection inside the scoper; v0.0.12 ships the simpler "show, don't engineer" path.
- **The worked example references a /health probe — but defining /health is the spec's job, not scope-project's.** If the spec's API doesn't have a /health endpoint, the test asserts on whatever route the spec defines. Scope-project's example uses /health as the canonical exemplar; spec authors substitute as appropriate.
- **No public API surface change.** This is a prompt-source edit; no code changes; `@wifo/factory-core`'s exported surface is unchanged.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.12 explicitly does NOT ship in this spec:** programmatic detection of HTTP entrypoint patterns inside scope-project's runtime (the slash command IS the runtime — guidance only, not code); auto-emission of smoke-boot tests in `factory-runtime` (separate concern; runtime doesn't author specs); CLI/queue/cron entrypoint smoke-tests (HTTP only — other product shapes deferred to v0.0.13+ for calibration).

## Subtasks

- **T1** [feature] — Edit `packages/core/commands/scope-project.md` Step 2: add `### HTTP entrypoint smoke-boot scenarios` subsection with: (a) trigger-keyword enumeration in backtick code-spans; (b) worked example scenario verbatim; (c) test-path convention guidance. ~30 LOC of prompt content. **depends on nothing.**
- **T2** [chore] — Update the URL-shortener fixture under `docs/baselines/scope-project-fixtures/url-shortener/`: ensure the HTTP-introducing spec contains a smoke-boot scenario matching the canonical shape. The fixture serves as the regression-pin reference for "what scope-project should produce." ~25 LOC across the fixture spec. **depends on T1.**
- **T3** [test] — `packages/core/src/scope-project-source.test.ts` covers S-1 + S-2 (3 tests pinning the new subsection, worked example, keyword list). `packages/core/src/scope-project-fixture.test.ts` covers S-3 (1 test pinning the URL-shortener fixture's smoke-boot scenario). ~70 LOC. **depends on T1, T2.**
- **T4** [chore] — Update top-level README's `/scope-project` description (if it has one) to mention the smoke-boot extension. Update `packages/core/README.md`'s scope-project section similarly. ~15 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.12 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/core build`).
- The URL-shortener fixture's HTTP-introducing spec contains a smoke-boot scenario that conforms to the canonical shape from S-1.
- Public API surface from every package is unchanged (this spec is prompt-source-only).
- v0.0.12 explicitly does NOT ship in this spec: programmatic HTTP-pattern detection inside scope-project's runtime; auto-emission in factory-runtime; CLI/queue/cron entrypoint smoke-tests. Deferred per Constraints.

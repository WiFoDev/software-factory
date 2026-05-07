---
id: factory-core-v0-0-13-schema-emitter-node-native
classification: light
type: refactor
status: drafting
exemplars:
  - path: packages/core/scripts/emit-json-schema.ts
    why: "currently uses bun-specific imports/APIs (e.g., Bun.file, top-level await with bun's loader). v0.0.13 rewrites to plain Node — `node:fs writeFileSync` + standard ESM. Drops bun as a hard build-time dep; build becomes Node-only. Test-time bun stays (intentional)."
  - path: packages/core/package.json
    why: "build script becomes `tsc -p tsconfig.build.json && tsx scripts/emit-json-schema.ts` (or equivalent Node-native invocation). tsx handles the TS compilation on-the-fly without needing a separate build pass for the script."
  - path: BACKLOG.md
    why: "v0.0.13 entry 'bun as a hidden build dependency — make it explicit or remove'. Closes the v0.0.12 tag-fire's setup-bun-required friction (the workflow's setup-bun was added retroactively after the build failed)."
depends-on:
  - factory-cycle-break-v0-0-13
---

# factory-core-v0-0-13-schema-emitter-node-native — rewrite the JSON schema emitter to Node

## Intent

`packages/core/scripts/emit-json-schema.ts` currently uses bun-specific APIs (likely `Bun.file().write()` or similar) — making bun an implicit hard build-time dep. The v0.0.12 tag-fire surfaced this when CI failed with `bun: not found` mid-build; the fix was adding `oven-sh/setup-bun` to the workflow. But brownfield adopters who only consume the published packages still hit this if they run `pnpm build` against `@wifo/factory-core` from source.

v0.0.13 rewrites the emitter to be Node-native (plain `node:fs writeFileSync` + standard ESM). Build script becomes `tsc && tsx scripts/emit-json-schema.ts` (tsx handles on-the-fly TS execution without bun). Test-time bun stays intentional and documented (`bun test src` is the workspace's test runner; not changing that).

This spec depends on factory-cycle-break-v0-0-13 to land first so the build graph is clean when the new tsx invocation slots in.

## Scenarios

**S-1** — `emit-json-schema.ts` uses Node APIs only (no bun-specific imports)
  Given `packages/core/scripts/emit-json-schema.ts` is read
  When the imports are inspected
  Then there are NO references to `Bun.*`, no `import * from 'bun'`, no `Bun.file`, no `Bun.write`. All file I/O uses `node:fs` (`writeFileSync`, `readFileSync`). All path manipulation uses `node:path` + `node:url`. The script is invokable via `node` (after tsx compilation) OR `tsx` directly.
  And given `tsx packages/core/scripts/emit-json-schema.ts` is run in a Node-only environment (no bun), it produces the expected schema file. Test: invoke the script via `child_process.spawnSync('npx', ['-y', 'tsx', script], { ... })`; verify the output file matches the existing snapshot.
  Satisfaction:
    - test: packages/core/src/json-schema.test.ts "emit-json-schema.ts uses node:fs APIs only (no Bun.* references)"
    - test: packages/core/src/json-schema.test.ts "emit-json-schema.ts produces canonical schema when run via tsx (Node)"

**S-2** — `packages/core/package.json` build script invokes `tsx`, not `bun`
  Given `packages/core/package.json` is parsed
  When the `scripts.build` field is inspected
  Then it equals (or substring-matches) `tsc -p tsconfig.build.json && tsx scripts/emit-json-schema.ts`. NO `bun run` reference. The `tsx` dep is in `devDependencies` (NOT `dependencies` — it's a build-time-only tool).
  And given a v0.0.12 build script (which was `tsc && bun run scripts/emit-json-schema.ts`), the test asserts the migration: `scripts.build` no longer contains `bun run` AND DOES contain `tsx`.
  Satisfaction:
    - test: packages/core/src/publish-meta.test.ts "factory-core build script uses tsx instead of bun run"
    - test: packages/core/src/publish-meta.test.ts "factory-core has tsx in devDependencies"

**S-3** — Documentation: bun is required for `pnpm test` only; build is Node-only
  Given the top-level README and `packages/core/README.md` are read
  When the bun-related sections are inspected
  Then there's a clear paragraph stating: "**bun is required for `pnpm test` only** — the workspace's test runner is `bun test src` per package. `pnpm build` and `pnpm typecheck` are Node-native (Node 22+); `pnpm install` for consumers of the published packages does NOT require bun." The same paragraph (or a brief equivalent) is in `AGENTS.md` for agent onboarding.
  And given the `factory init`-scaffolded README (in `init-templates.ts`'s `README_TEMPLATE`), it inherits the same caveat.
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "scaffold README documents bun-as-test-only requirement"
    - test: packages/core/src/json-schema.test.ts "top-level README contains the bun-as-test-only paragraph"

## Constraints / Decisions

- **`tsx` chosen over alternatives:**
  - `bun run` (current) — keeps the bun build-time dep, defeats the spec.
  - `tsx scripts/emit-json-schema.ts` (chosen) — runs TS directly via Node + esbuild; well-supported; ~5 LOC of devDep.
  - `tsc --emit` to compile the script then `node dist/scripts/...` (rejected) — adds a separate build pass; messier.
  - `node --loader ts-node/esm scripts/...` (rejected) — ts-node has known ESM friction; tsx is the modern replacement.
- **`tsx` dep version:** pin to `^4.0.0` (or whatever's the current major). devDependency only. Not a runtime dep; not exposed to consumers.
- **Schema-file output unchanged.** The emitter's OUTPUT (the JSON schema file at `packages/core/dist/spec.schema.json`) is byte-identical pre/post rewrite. The existing snapshot test pins the expected content; if the rewrite drifts the output, the snapshot test fails. Lock the snapshot.
- **Test-time bun stays.** Every package's `scripts.test` is `bun test src` — that's intentional and unchanged. Bun's test runner is the chosen testing framework for the workspace; v0.0.13 is NOT migrating tests to a Node-native runner. The workflow's `setup-bun` step also stays for the test phase.
- **No public API surface change.** Schema emitter is internal tooling. Public API of `@wifo/factory-core` unchanged at 34 exports.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.13 explicitly does NOT ship in this spec:** migrating tests off bun (out of scope — bun test is the chosen runner); removing setup-bun from the workflow (it's still needed for tests); a parallel Node-native test runner (overkill).

## Subtasks

- **T1** [refactor] — Rewrite `packages/core/scripts/emit-json-schema.ts` to use `node:fs writeFileSync` + standard Node ESM. Remove all `Bun.*` API references. Verify the output is byte-identical via the existing schema snapshot. ~30 LOC (mostly imports + I/O substitution). **depends on nothing.**
- **T2** [chore] — Update `packages/core/package.json`: change `scripts.build` from `tsc -p tsconfig.build.json && bun run scripts/emit-json-schema.ts` to `tsc -p tsconfig.build.json && tsx scripts/emit-json-schema.ts`. Add `tsx` to `devDependencies` at `^4.0.0` (or current major). ~5 LOC. **depends on T1.**
- **T3** [test] — `packages/core/src/json-schema.test.ts`: covers S-1 (script doesn't reference Bun.*; output via tsx is canonical) — 2 tests. `packages/core/src/publish-meta.test.ts`: covers S-2 (build script uses tsx; tsx in devDeps) — 2 tests. ~80 LOC. **depends on T1, T2.**
- **T4** [chore] — Update top-level `README.md` + `packages/core/README.md` + `AGENTS.md` + `init-templates.ts`'s `README_TEMPLATE`: add a "bun is required for `pnpm test` only" paragraph in each. ~30 LOC across files. **depends on T3.**
- **T5** [test] — `packages/core/src/init-templates.test.ts`: assert the scaffold README contains the bun-as-test-only language (1 test). `packages/core/src/json-schema.test.ts`: similarly assert the top-level README contains it (1 test). ~30 LOC. **depends on T4.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.13 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- `pnpm -C packages/core build` exits 0 in a Node-only environment (no bun on PATH at build time — verified by stubbing PATH or by running the script directly via tsx).
- A test verifies that `packages/core/scripts/emit-json-schema.ts` contains no `Bun.*` references (regression-pin against future drift).
- A test verifies that the build script in `packages/core/package.json` uses `tsx` (not `bun run`).
- The schema file at `packages/core/dist/spec.schema.json` is byte-identical pre/post the rewrite (the existing snapshot test passes).
- Top-level README + AGENTS.md + scaffold README + `packages/core/README.md` all document the bun-as-test-only convention.
- Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.12's 34 names.
- v0.0.13 explicitly does NOT ship in this spec: migrating tests off bun; removing setup-bun from the workflow; Node-native test runner. Deferred per Constraints.

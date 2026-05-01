---
id: factory-context-v0-0-4
classification: light
type: feat
status: ready
exemplars:
  - path: packages/context/src/tree.ts
    why: "Existing `buildTree` (ancestors via `record.parents[]`, recursive DFS, cycle-guard via Set, missing-parent marker). v0.0.4 adds an internal `buildDescendantTree(rootId, allRecords)` alongside it — same TreeNode shape, but the `parents` field literally holds children (it's the walk frontier in either direction). `formatTree` is direction-agnostic and reused as-is."
  - path: packages/context/src/cli.ts
    why: "Existing `tree <id>` CLI command — exit codes 0/2/3, `--dir <path>` flag, positional `<id>`. v0.0.4 adds `--direction <up|down>` flag with the same positive-string-validation pattern as v0.0.3's `--max-total-tokens` (bad value → exit 2 with stderr label `context/invalid-direction:`)."
  - path: packages/context/src/store-fs.ts
    why: "`listRecords(dir)` is the only 'all records' primitive. `buildDescendantTree` calls it once, builds an inverted child-index map (parentId → ContextRecord[]), then walks down from rootId. O(n) per call — fine for typical sizes."
  - path: docs/specs/done/factory-context-v0-0-1.md
    why: "Original spec for `@wifo/factory-context`. v0.0.4 adds zero new exports — public surface stays at 18 names. The new `buildDescendantTree` is internal; only the CLI is the consumer."
---

# factory-context-v0-0-4 — `factory-context tree --direction <up|down>`: descendants traversal

## Intent

Add a `--direction <up|down>` flag to `factory-context tree` so users can walk **down** the DAG from a record (descendants), not just up (ancestors). Today, `tree <runId>` shows only the run itself because the run is a root with no parents — the most natural question after `factory-runtime run` ("what was produced under this run?") requires the user to flip the question backwards (list + grep). v0.0.4 fixes that. Default `--direction up` preserves backward-compatible behavior. New internal helper `buildDescendantTree(rootId, allRecords)` builds an inverted child-index from `listRecords()` once and DFSes down. Public API surface stays at **18 names** — `buildDescendantTree` is not exported (only the CLI consumes it). `formatTree` is direction-agnostic and reused as-is.

## Scenarios

**S-1** — `tree <id> --direction down` walks descendants from the root; default `--direction up` matches v0.0.3 behavior
  Given a tmp context dir populated with a 3-record DAG: `runId` (root, no parents), `phaseId` (parents=[runId]), `reportId` (parents=[runId, phaseId])
  When `factory-context tree <runId> --dir <tmp> --direction down` is invoked
  Then exit code `0`; stdout shows the descendant tree rooted at `runId`: top line is `<runId> [type=factory-run] <recordedAt>`; child lines are `<phaseId> [type=factory-phase] ...` and `<reportId> [type=factory-implement-report] ...` (sort order: by `recordedAt` then `id`); the descendant of `phaseId` includes `reportId` (since `reportId.parents` contains `phaseId`); each tree edge uses the existing `├──` / `└──` rendering from `formatTree`.
  And given `factory-context tree <runId> --dir <tmp>` (no `--direction` flag), exit code `0`; stdout shows ONLY the root `<runId>` line (the v0.0.3 behavior — root has no ancestors). Default direction is `up`.
  And given `factory-context tree <reportId> --dir <tmp> --direction up`, exit code `0`; stdout walks ancestors `reportId → runId` AND `reportId → phaseId → runId` (the existing `buildTree` behavior).
  Satisfaction:
    - test: `src/tree.test.ts` "buildDescendantTree: 3-record DAG, root with 1 + transitive 1 child"
    - test: `src/cli.test.ts` "default direction is up; explicit --direction up matches v0.0.3"
    - test: `src/cli.test.ts` "--direction down on root walks all descendants in recordedAt+id sort order"

**S-2** — `--direction <bad>` → exit 2 with stderr label `context/invalid-direction:`; missing root → exit 3 (mirrors v0.0.3)
  Given a tmp context dir
  When `factory-context tree <id> --dir <tmp> --direction sideways` is invoked
  Then exit code `2`; stderr contains `context/invalid-direction: --direction must be 'up' or 'down' (got 'sideways')\n` (string label, NOT a `ContextErrorCode` value); zero records read.
  And given a tmp dir with no record at `<id>` and `--direction down`, exit code `3` with stderr from the existing `ContextError` path (mirrors v0.0.3 — "root not found" is a 3, not 2).
  And given an empty `--direction ` (empty string), exit code `2` with the same label and `(got '')`.
  Satisfaction:
    - test: `src/cli.test.ts` "--direction sideways → exit 2 with stderr label context/invalid-direction"
    - test: `src/cli.test.ts` "--direction with missing root → exit 3 (root-not-found from descendant lookup mirrors ancestor lookup)"

**S-3** — Cycle and missing-parent markers work in both directions
  Given a tmp context dir with a 2-record cycle (`A.parents=[B]`, `B.parents=[A]` — though disallowed at write time, simulated by direct file writes for the test)
  When `factory-context tree A --dir <tmp> --direction up` is invoked
  Then output marks the cycle: the second occurrence of `A` (or `B`) under itself is rendered with the `<cycle>` marker (existing behavior; pinned in v0.0.1).
  And given the same setup with `--direction down`, the descendant walk also marks cycles via the same `Set<string>` of ancestors-on-current-path mechanism (mirrors `buildTree`'s cycle guard).
  And given a record with `parents: ['nonexistent-id']` and `--direction up`, the missing parent is marked `<missing>` (existing behavior). The same record visited as a descendant (i.e., a record claims a parent that doesn't exist; descendants of the existing parent should still be discoverable; the missing-parent issue surfaces only on ancestor walks) — the descendant tree walks normally; nothing extra to mark.
  Satisfaction:
    - test: `src/tree.test.ts` "buildDescendantTree: cycle guard via path-set marks <cycle> on revisit"
    - test: `src/tree.test.ts` "buildTree (existing): cycle and missing markers unchanged from v0.0.1"

## Constraints / Decisions

- New CLI flag `--direction <up|down>` on `factory-context tree`. Default `up` (backward-compat). Bad value → exit 2 with stderr label `context/invalid-direction: --direction must be 'up' or 'down' (got '<raw>')` (string label only, NOT a `ContextErrorCode` value).
- New internal function `buildDescendantTree(rootId: string, allRecords: ContextRecord[]): TreeNode` in `packages/context/src/tree.ts`. Algorithm:
  1. Build a `Map<parentId: string, children: ContextRecord[]>` by scanning `allRecords` and inverting `record.parents[]` (each record contributes one entry per parent id).
  2. Sort each child list by `recordedAt` ASC then `id` ASC (deterministic output).
  3. DFS from `rootId`: locate the root record (if not in `allRecords`, return `{ id: rootId, type: null, recordedAt: null, parents: [], marker: 'missing' }`); push children into `TreeNode.parents` (the field name is reused since `formatTree` walks it regardless of semantic direction); track visited path-set for cycle detection.
- `buildDescendantTree` is **internal-only** — NOT exported from `packages/context/src/index.ts`. Public surface stays at **18 names** (zero new exports in v0.0.4). The CLI is the only consumer.
- `formatTree(node)` is reused unchanged — it walks `node.parents[]` regardless of whether those are ancestors or descendants. Output rendering is identical in both directions.
- CLI dispatch in `packages/context/src/cli.ts`'s `tree` subcommand:
  - Parse `--direction`; default `'up'`; validate against `['up', 'down']`; bad → exit 2 with stderr label.
  - `direction === 'up'` → existing path: `await buildTree(rootId, (id) => readRecord(dir, id))`.
  - `direction === 'down'` → new path: `const allRecords = (await listRecords(dir)).records; const tree = buildDescendantTree(rootId, allRecords);`. If the root isn't in `allRecords`, exit 3 (mirrors v0.0.3's "root not found" behavior — the existing `tree` command exits 3 when `readRecord` returns null).
  - Print via `formatTree(tree)` to stdout; exit 0.
- Cycle and missing markers: `buildDescendantTree` reuses the same `marker: 'cycle' | 'missing' | undefined` field on `TreeNode`. Cycle detection via `Set<string>` of ancestor-path ids (mirrors `buildTree`'s mechanism; pinned in v0.0.1).
- Sort order for descendant children: `recordedAt` ASC then `id` ASC. Deterministic across runs.
- Performance: `buildDescendantTree` reads the entire context dir once via `listRecords` (O(n) where n = total records). Acceptable for typical context-store sizes (≤ 10_000 records). NOT optimized for huge stores in v0.0.4.
- README in `packages/context/`: document the `--direction` flag with one example each for `up` and `down`. Note the `TreeNode.parents` field name is direction-agnostic (it's the walk frontier, not necessarily ancestors) — to avoid confusing readers in `--direction down` mode.
- Public API surface from `packages/context/src/index.ts` strictly equal to v0.0.1's 18 names: 7 functions (`createContextStore`, `hashRecord`, `readRecord`, `writeRecord`, `listRecords`, `buildTree`, `formatTree`) + 1 class (`ContextError`) + 10 types. `buildDescendantTree` is internal-only.
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere.
- v0.0.4 explicitly does **not** ship: a `descendants` sibling subcommand (we use `--direction` instead — zero new commands, one well-scoped flag); on-disk child-index for incremental descendant traversal (overkill for current store sizes); renaming `TreeNode.parents` to `TreeNode.edges` (would be a breaking public-surface change; defer until a v1.0 surface revisit).

## Subtasks

- **T1** [feature] — `packages/context/src/tree.ts`: add `buildDescendantTree(rootId, allRecords)` alongside the existing `buildTree`. Inverted child-index Map; DFS down with cycle guard. Reuse `TreeNode` type as-is (no new export). `formatTree` unchanged. Tests in `src/tree.test.ts`:
  - 3-record linear DAG (root → mid → leaf); descendants from root walks both; descendants from mid walks one.
  - 4-record diamond (root → A, root → B, A → leaf, B → leaf); descendants from root visits leaf twice (path-distinct, NOT marked as cycle since the path-set tracks ancestors-on-current-path, and the two paths to leaf have different ancestor sets).
  - cycle: descendants walk marks `<cycle>` on revisit via path-set.
  - root not in `allRecords` → returns missing-marker node.
  - sort order: children list sorted by `recordedAt` ASC then `id` ASC; verified against a fixture with 3 children at the same parent with different timestamps.
  **depends on nothing**. ~150 LOC including tests.
- **T2** [feature + chore] — `packages/context/src/cli.ts`: extend the `tree` subcommand's `parseArgs` to accept `--direction <up|down>` (default `up`); validate; bad value → exit 2 with stderr label. Dispatch on direction: `up` → existing `buildTree` path; `down` → new path that calls `listRecords(dir)` then `buildDescendantTree(rootId, records)`; exit 3 on root-not-found (mirrors `up` mode's `readRecord` returning null). Tests in `src/cli.test.ts`:
  - default direction is up (no flag → existing behavior).
  - `--direction up` explicit → identical output to no flag.
  - `--direction down` on root → walks descendants, shows full tree, exit 0.
  - `--direction down` on missing root → exit 3.
  - `--direction sideways` → exit 2 with stderr label `context/invalid-direction:`.
  - `--direction ''` (empty) → exit 2 with same label.
  README updates in `packages/context/README.md`: add a `--direction` flag section with two examples (one up, one down); add a one-line note explaining `TreeNode.parents` is the walk frontier (not necessarily ancestors). USAGE string in `cli.ts` updates to list `--direction <up|down>` (default: up). Top-level `README.md` v0.0.4 release notes mention the new flag.
  **depends on T1**. ~120 LOC including README touches.

## Definition of Done

- All scenarios (S-1..S-3) pass (tests green).
- `pnpm -C packages/context typecheck` clean.
- `pnpm -C packages/context test` green (`bun test`); `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/context build` produces a working `dist/cli.js`.
- **Deterministic smoke (CI-gated)**: a Bun test creates a tmp context dir, writes 3 records (one root, one child, one grandchild) via the existing `writeRecord`, then runs the CLI: `factory-context tree <rootId> --dir <tmp> --direction down` → stdout contains all 3 record ids; `factory-context tree <leafId> --dir <tmp> --direction up` → stdout contains all 3 record ids; both exit 0.
- Public API surface from `packages/context/src/index.ts` is **strictly equal** to v0.0.1's 18 names. `buildDescendantTree` is internal-only (verified by surface-lock test — `Object.keys(await import('../src/index.js'))` count === 18).
- README in `packages/context/` documents `--direction <up|down>` with examples.
- Top-level `README.md` v0.0.4 release notes mention `tree --direction down` alongside the reviewer + `factory init`.
- v0.0.4 explicitly does **not** ship: `descendants` sibling subcommand, on-disk child-index, `TreeNode.parents` → `TreeNode.edges` rename. Deferred or rejected per Constraints.

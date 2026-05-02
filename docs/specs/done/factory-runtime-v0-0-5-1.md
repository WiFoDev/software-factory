---
id: factory-runtime-v0-0-5-1
classification: light
type: fix
status: ready
exemplars:
  - path: packages/runtime/src/phases/implement.ts
    why: "the file with the existing post-implement file-diff capture logic. v0.0.5.1 replaces the simple post-run `git diff` with a pre/post snapshot diff."
  - path: packages/runtime/src/phases/implement.test.ts
    why: "existing pattern for fake-claude-driven implement tests. v0.0.5.1 adds 3-4 tests for the new-file / pre-dirty / deleted-file cases."
  - path: BASELINE.md
    why: "the v0.0.5 URL-shortener entry's friction #3 + surprises section. Two failure modes documented: false negative (spec 2 created src/server.ts but reported empty filesChanged) + false positive (spec 1's filesChanged included JOURNAL.md because it had pre-run uncommitted edits)."
---

# factory-runtime-v0-0-5-1 — `factory-implement-report.filesChanged` audit-reliability fix

## Intent

Today the runtime captures `filesChanged` post-implement via a single `git diff` call. Two failure modes both surfaced in the v0.0.5 URL-shortener BASELINE run:

1. **False negative on new-file-only runs.** Spec 2 (`url-shortener-redirect`) created `src/server.ts` from scratch — purely new files, no modifications to tracked code. The implement-report's `filesChanged` came back empty even though the agent created multiple files. Plain `git diff` doesn't report untracked files.
2. **False positive on pre-run uncommitted changes.** Spec 1's `filesChanged` included `JOURNAL.md` because that file had uncommitted edits in the working tree before the run started — and the post-run diff couldn't distinguish "agent touched it" from "was already dirty."

The audit contract is broken: the field cannot be trusted as "what did the agent touch this iteration." Provenance trail integrity is the factory's central trust mechanism (cf. `factory-context tree`); fix it.

The fix: snapshot the working-tree state PRE-implement (tracked + untracked file inventory), diff against the post-implement state, and filter out paths that were already dirty before the run started.

## Scenarios

**S-1** — New-file-only run: agent CREATES files, filesChanged reports them
  Given a clean git working tree at HEAD, a spec whose implementation requires creating a new file `src/foo.ts` (does NOT modify any tracked file), and the fake-claude success mode configured to write `src/foo.ts` with arbitrary content
  When `implementPhase` runs
  Then the resulting `factory-implement-report.payload.filesChanged` includes `src/foo.ts` (formerly empty under the v0.0.5 buggy behavior)
  Satisfaction:
    - test: src/phases/implement.test.ts "filesChanged includes newly created files"

**S-2** — Modify-existing-file run: existing tracked file modified, filesChanged reports it
  Given a clean git working tree at HEAD with `src/foo.ts` already tracked, and the fake-claude mode configured to overwrite `src/foo.ts` with new content
  When `implementPhase` runs
  Then `filesChanged` includes `src/foo.ts` (this is the v0.0.5 behavior; v0.0.5.1 must preserve it — regression gate)
  Satisfaction:
    - test: src/phases/implement.test.ts "filesChanged includes modified tracked files (regression gate)"

**S-3** — Pre-dirty file is excluded from filesChanged even when the agent also modifies it
  Given a working tree with `JOURNAL.md` uncommitted (modified content not in HEAD), and the fake-claude mode configured to additionally write to `JOURNAL.md`
  When `implementPhase` runs
  Then `filesChanged` does NOT include `JOURNAL.md` — the pre-implement snapshot already had it dirty, so the runtime cannot honestly attribute "the agent modified it" (the modification could have been the maintainer's pre-existing edit). Documenting this as a deliberate trade-off: false negatives (under-attributing the agent's work on pre-dirty files) are preferable to false positives (over-attributing). The maintainer keeps a clean tree if they want full audit fidelity.
  Satisfaction:
    - test: src/phases/implement.test.ts "filesChanged excludes pre-dirty files"

**S-4** — Deleted file: tracked file removed by the agent, filesChanged reports it
  Given a clean working tree with `src/old.ts` tracked, and the fake-claude mode configured to delete `src/old.ts`
  When `implementPhase` runs
  Then `filesChanged` includes `src/old.ts` (with a deletion marker if the schema supports it; otherwise the path string is sufficient)
  Satisfaction:
    - test: src/phases/implement.test.ts "filesChanged includes deleted files"

## Constraints / Decisions

- New internal helper `captureFileSnapshot(cwd: string): Map<string, string>` (path → content-hash) — invoked BEFORE the agent spawn. Implementation: walk the working tree (tracked + untracked, respecting `.gitignore`), hash each file's content (sha256 hex). The map is the pre-state.
- After the agent spawn, capture the post-state with the same helper. Diff:
  - `path in post && !(path in pre)` → CREATED
  - `path in pre && !(path in post)` → DELETED
  - `path in pre && path in post && pre.get(path) !== post.get(path)` → MODIFIED
- Filter out paths whose pre-state was already dirty (i.e., the file existed in the working tree but its content didn't match HEAD). Capture this dirty set via `git status --porcelain` at the same time as the snapshot.
- `filesChanged` schema field stays as `string[]` (path list). NO new fields on `FactoryImplementReportSchema` — purely internal logic change. Future enhancement (per-file action: created/modified/deleted) deferred.
- Public API surface unchanged — the snapshot helper is internal to `implement.ts`. `@wifo/factory-runtime/src/index.ts` exports stay at 19 names.
- Performance note: walking the working tree adds O(n) reads. For the URL-shortener BASELINE shape (~10 files), negligible. For larger repos (1000s of files), may need to scope to a per-spec subdir hint in v0.0.6+; out of scope here.
- `packages/runtime/package.json` bumps to `0.0.5.1`.

## Subtasks

- **T1** [fix] — Add `captureFileSnapshot` helper in `packages/runtime/src/phases/implement.ts`. Replace the existing post-run `git diff` filesChanged path with: pre-snapshot before spawn → post-snapshot after spawn → diff → filter pre-dirty. ~70 LOC. **depends on nothing.**
- **T2** [test] — Add 4 new tests in `packages/runtime/src/phases/implement.test.ts` covering S-1..S-4. Use `mkdtempSync` for the test working trees so each test has a clean git state. ~120 LOC. **depends on T1.**
- **T3** [chore] — Bump `packages/runtime/package.json` to `0.0.5.1`. Update `packages/runtime/README.md` with a one-paragraph "v0.0.5.1 release notes" section. ~20 LOC. **depends on T2.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green; `pnpm test` workspace-wide green.
- `pnpm check` clean.
- Public API surface from `@wifo/factory-runtime/src/index.ts` is **strictly equal** to v0.0.5's 19 names.
- The v0.0.5 URL-shortener BASELINE run's friction #3 is verifiably resolved by the new tests.
- `packages/runtime/package.json` is at `0.0.5.1`.

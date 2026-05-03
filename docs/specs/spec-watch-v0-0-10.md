---
id: spec-watch-v0-0-10
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/core/src/cli.ts
    why: "Existing factory CLI subcommand dispatch (init, spec lint, spec review). v0.0.10 adds factory spec watch <path> as a sibling subcommand. Same dispatch shape; same parseArgs pattern."
  - path: packages/core/src/lint.ts
    why: "lintSpec + lintSpecFile — the watch helper invokes lintSpec on each changed *.md file. Reuses existing lint output formatting."
  - path: BACKLOG.md
    why: "PostToolUse hook recipe for spec lint — deferred from v0.0.7. v0.0.10 adds the recipe to packages/core/README.md (already there in part) + a long-running CLI companion (factory spec watch) for users who don't run Claude Code or want both."
depends-on: []
---

# spec-watch-v0-0-10 — `factory spec watch <path>` CLI + PostToolUse hook recipe documentation

## Intent

Add `factory spec watch <path>` — a long-running CLI subcommand that watches a directory tree for `*.md` file changes and re-runs `factory spec lint` (and optionally `factory spec review --no-cache` if `--review` flag is passed) on every change. Independent of Claude Code; usable as a terminal-companion that catches spec-quality issues at save time. Pairs with the existing `~/.claude/settings.json` PostToolUse hook recipe (already documented in `packages/core/README.md` since v0.0.6) — the watch helper is the non-Claude-Code path to the same enforcement.

Adds 1 new exported function (`watchSpecs`) from `@wifo/factory-core` + 1 new CLI lifecycle (`spec watch`). Field-level CLI extension; minimal new export surface.

## Scenarios

**S-1** — `factory spec watch <path>` runs lint on every `*.md` file change under the watched tree
  Given a tmp directory containing `docs/specs/foo.md` (lint-clean)
  When `factory spec watch <tmp>/docs/specs/` is invoked (long-running) and someone modifies `foo.md` to introduce a lint error (e.g., remove the `id:` field)
  Then within 500ms, the watch process emits the lint output to stdout in the canonical format (`<file>:<line>  <severity>  <code>  <message>`); exit code is NOT changed (the watch process keeps running). The change is detected via Node's `fs.watch` (or `chokidar`-equivalent — implementation choice).
  And given a fresh `*.md` file is created in the watched tree, `factory spec watch` lints it on its first save event.
  And given a `*.md` file is DELETED, the watch emits a one-line stderr notice (`<file>: deleted`) and continues watching.
  Satisfaction:
    - test: packages/core/src/watch.test.ts "factory spec watch lints on file change"
    - test: packages/core/src/watch.test.ts "factory spec watch lints on file create"
    - test: packages/core/src/watch.test.ts "factory spec watch ignores non-md files"

**S-2** — `factory spec watch --review` also runs `factory spec review --no-cache` on each change
  Given a tmp directory + a fake-judge-fixture binary path
  When `factory spec watch --review --claude-bin <fake> <tmp>/docs/specs/` is invoked + someone saves a spec
  Then the watch runs lint (always) AND review (because `--review`). Review output (findings + summary) appended to stdout AFTER the lint output. The `--no-cache` flag is implicit in watch mode (every change is fresh; the watch skips cache reads).
  And given `--review` is NOT passed, only lint runs.
  And given the spec has a lint error (frontmatter parse failure), review is SKIPPED for that change (lint-fail blocks review; same semantics as the existing CLI).
  Satisfaction:
    - test: packages/core/src/watch.test.ts "watch --review runs lint then review on each change"
    - test: packages/core/src/watch.test.ts "watch skips review when lint fails"

**S-3** — `factory spec watch` is graceful: SIGINT exits 0; ignores non-md files; debounces rapid changes
  Given a running `factory spec watch <path>` process
  When the process receives SIGINT (Ctrl-C)
  Then it exits with code 0 and a single stdout line: `factory spec watch: stopping`. No partial output corruption.
  And given non-`*.md` files change in the tree (e.g., `package.json`, `src/foo.ts`), the watch ignores them — no lint output.
  And given a single file is saved 5 times in 200ms (e.g., editor batch-save), the watch debounces to a single lint invocation per file (200ms window — last-write-wins). Avoids spamming stdout.
  Satisfaction:
    - test: packages/core/src/watch.test.ts "SIGINT exits 0 cleanly"
    - test: packages/core/src/watch.test.ts "non-md file changes are ignored"
    - test: packages/core/src/watch.test.ts "debounces rapid changes within 200ms window"

**S-4** — README + slash-command sources document the PostToolUse hook recipe alongside `factory spec watch`
  Given the v0.0.10 build
  When `packages/core/README.md` is read
  Then it contains a `## Harness-enforced spec linting + review` section that documents BOTH:
  - The `~/.claude/settings.json` PostToolUse hook recipe (already there from v0.0.7 in part — v0.0.10 polishes it).
  - The `factory spec watch <path>` CLI helper as the Claude-Code-independent companion.
  The section explicitly notes: hook fires on every `Write` (Claude Code path); watch runs continuously (terminal path). Both are opt-in.
  And given `docs/commands/scope-project.md` and `~/.claude/commands/scope-task.md`, both gain a one-line note pointing at the hook recipe AND `factory spec watch` for users who want enforcement.
  Satisfaction:
    - test: packages/core/src/cli.test.ts "factory spec watch is documented in packages/core/README.md"
    - test: packages/core/src/cli.test.ts "Hook recipe is documented in packages/core/README.md"

## Constraints / Decisions

- **CLI subcommand shape (locked):** `factory spec watch <path> [flags]`. Positional `<path>` is the watched tree (recursive). Flags:
  - `--review` (boolean, default off) — also run `factory spec review --no-cache` per change.
  - `--claude-bin <path>` — passed through to `factory spec review` when `--review` is set.
  - `--debounce-ms <n>` — debounce window per file. Default 200. Positive integer or fail with exit 2.
- **Debounce semantics (locked):** per-file. Saving file A 5 times in 200ms → 1 lint of A. Saving file A and file B in 100ms → 2 lints (each file has its own debounce timer).
- **Watch implementation:** `fs.watch` from Node `node:fs/promises`. Recursive (`{ recursive: true }`). Polling fallback only on platforms where `fs.watch`'s recursive mode is unreliable (locked: macOS + Linux supported; Windows tested-but-best-effort). Test fixture uses simulated change events to avoid platform-specific watch quirks.
- **NEW exported function:** `watchSpecs(opts: WatchSpecsOptions): { stop: () => Promise<void> }` from `@wifo/factory-core`. Returns a handle that can be `stop()`'d programmatically (used by tests + future SDK consumers).
- **`WatchSpecsOptions` (locked):** `{ rootPath: string; debounceMs?: number; review?: boolean; claudeBin?: string; logLine: (line: string) => void }`. Caller provides the log sink; the CLI passes `process.stdout.write`-bound function.
- **Output format (locked):** lint output in the existing canonical lint format (`<file>:<line>  <severity>  <code>  <message>`). Review output in the existing `formatFindings` shape (review/<code> namespace). One-line summary per file change (e.g., `<file>: 0 errors, 1 warning` after lint runs cleanly).
- **Non-`*.md` files ignored** — the watcher receives change events for everything in the tree but only lints files matching the existing `lintSpec`-applicable extensions (only `*.md`).
- **`<path>/done/` IS watched** — but the watch only invokes lint on its files (review on each is also valid because `done/` specs may still need review for future v0.0.X audits). No special-casing.
- **SIGINT handling (locked):** the watch installs a SIGINT handler that calls `stop()` on its `fs.watch` instance, awaits cleanup, prints a one-line `stopping` notice, and exits 0.
- **PostToolUse hook recipe** is documented in `packages/core/README.md`'s `## Harness-enforced spec linting + review` section (already there from v0.0.7's commits). v0.0.10 adds:
  - One-line note pointing at `factory spec watch` as the non-Claude-Code companion.
  - Updated hook command snippet to include `factory spec review --no-cache "$CLAUDE_FILE_PATH"` (currently the hook has it; v0.0.10 polishes the wording).
- **Slash-command source notes (locked):** `docs/commands/scope-project.md` (canonical at `packages/core/commands/scope-project.md` since v0.0.8) gains a one-line addition under Step 3 (Self-check): `Optionally run \`factory spec watch docs/specs/ --review\` in another terminal for continuous lint+review on every save.` The user-level `~/.claude/commands/scope-task.md` is NOT touched (it's outside the repo since v0.0.7 convention).
- **Public API surface from `@wifo/factory-core/src/index.ts`:** 31 → **33** names (assuming `dod-verifier-v0-0-10` ships first; that spec adds `parseDodBullets` + `DodBullet` taking it from 29 → 31). v0.0.10's running surface count adds `watchSpecs` (function) + `WatchSpecsOptions` (type). NET v0.0.10 → 33 names. (If specs ship out of order, the closing `chore` in `wide-blast-calibration-v0-0-10` reconciles the count in CHANGELOG.)
- **Coordinated package version bump deferred to spec 5** (`wide-blast-calibration-v0-0-10`'s chore subtask).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.10 explicitly does NOT ship in this spec:** Windows-fallback polling implementation (best-effort only); a `factory spec watch --once` mode (just use `factory spec lint` for one-shot); programmatic event subscription (consumers use `watchSpecs`'s return handle directly); auto-spawn `claude` for review (the user provides `--claude-bin` if they want review).

## Subtasks

- **T1** [feature] — `packages/core/src/watch.ts` (NEW FILE): `watchSpecs(opts)` function. Uses `fs.watch` recursively; debounces per-file via `setTimeout`; invokes `lintSpec` (and conditionally `runReview` if `review: true`); writes output to `opts.logLine`. Returns `{ stop }` handle. ~80 LOC. **depends on nothing.**
- **T2** [feature] — `packages/core/src/cli.ts`: add `factory spec watch <path>` subcommand. parseArgs for `--review`, `--claude-bin`, `--debounce-ms`. Constructs `watchSpecs` opts; binds `logLine: process.stdout.write`. Installs SIGINT handler. ~50 LOC. **depends on T1.**
- **T3** [feature] — `packages/core/src/index.ts`: re-export `watchSpecs` + `WatchSpecsOptions` type. Surface count grows by 2. ~3 LOC. **depends on T1.**
- **T4** [chore] — Update `packages/core/README.md`: polish the existing `## Harness-enforced spec linting + review` section; add a `## factory spec watch` subsection documenting the new CLI; document the relationship (Claude Code path vs terminal path). ~30 LOC. **depends on T2.**
- **T5** [chore] — Update `docs/commands/scope-project.md` (canonical at `packages/core/commands/scope-project.md`): add one-line note under Step 3 pointing at `factory spec watch`. ~3 LOC. **depends on T1, T2.**
- **T6** [test] — `packages/core/src/watch.test.ts` (NEW): 6 tests covering S-1 (3 cases: change, create, ignore-non-md), S-2 (review on each), S-3 (SIGINT, debounce, ignore). Uses Bun's test runner + simulated `fs.watch` events. ~150 LOC. `packages/core/src/cli.test.ts`: 2 tests covering S-4 (README + slash-command documentation). ~30 LOC. **depends on T1, T2, T3, T4, T5.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.10 cluster.
- `pnpm -C packages/core build` produces a working `dist/cli.js`; `factory spec watch <path>` is wired in the CLI dispatch.
- Public API surface from `@wifo/factory-core/src/index.ts` is **33 names** (was 31 after the dod-verifier spec ships; +2 from this spec: `watchSpecs` + `WatchSpecsOptions`).
- READMEs document `factory spec watch` + the PostToolUse hook recipe.
- v0.0.10 explicitly does NOT ship in this spec: Windows polling fallback; `--once` mode; programmatic event subscription beyond the `stop()` handle. Deferred per Constraints.

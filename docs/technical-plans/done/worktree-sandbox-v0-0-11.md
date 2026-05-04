# Technical plan — worktree-sandbox-v0-0-11

## 1. Context

### What exists today

- `factory-runtime run` mutates the maintainer's working tree directly. The implement phase spawns `claude -p` with the project's cwd; the agent uses `Read/Edit/Write/Bash` tools and changes land in-place. Validate + dod phases run from the same cwd. **One mistake by the agent = touched files in the user's tree.** The `filesChanged` audit (v0.0.6) gives visibility but not undo.
- `validatePhase` / `dodPhase` execute against `process.cwd()` by convention. `implementPhase` accepts an `opts.cwd` field but the CLI threads `process.cwd()` to all three phases.
- Context store records (`factory-run`, `factory-phase`, `factory-implement-report`, etc.) persist to `--context-dir` (default `./context`). They include `cwd` strings but don't track whether the cwd is a sandbox.
- `RunArgs.runParents?: string[]` (v0.0.7) and `RunOptions.skipDodPhase?: boolean` (v0.0.10) are field-level extensions. v0.0.11 adds `RunOptions.worktree?` similarly.
- Git worktrees (`git worktree add <path> -b <branch>`) are a first-class git feature: independent working dirs sharing the same `.git` repo. Each worktree has its own HEAD and index but reuses pack files. `git worktree remove <path>` cleans up; `git worktree prune` GCs orphaned entries.

### Patterns to follow

- **Internal-only by default.** v0.0.11 ships worktree as **opt-in** via `--worktree` flag. The flag becomes opt-out post-v0.1.0 once it's soaked.
- **Field-level on existing exported types** when possible. `RunOptions.worktree?` is field-level. New `factory-worktree` context record is field-level on the existing record-type registry (mirrors `factory-sequence` from v0.0.7).
- **CLI flag > config > built-in default precedence.** `--worktree` opts in; `factory.config.json runtime.worktree: true` is the persistent opt-in; built-in default is `false` (off).
- **One worktree per `factory-runtime run`** (NOT per phase). The implement, validate, and dod phases all share the same worktree for that run. The maintainer reviews the diff once at the end.

### Constraints the existing architecture imposes

- `implementPhase` already takes `opts.cwd`. v0.0.11 reuses this — no API change. The CLI swaps the cwd it threads through.
- `validatePhase` and `dodPhase` also accept `opts.cwd`. Same swap pattern.
- The context store is shared across the maintainer's repo + every worktree (records persist to `--context-dir` outside the worktree by design — provenance survives worktree cleanup). Default `./context` works fine; the worktree's process gets `--context-dir <abs-path>` so the cwd swap doesn't break record-store IO.
- Workspace install: a worktree shares the maintainer's `node_modules/` via the same `.git` parent. `pnpm install` does not need to re-run inside the worktree (pnpm's symlink-to-store pattern resolves correctly through git worktrees on every modern OS we support — macOS / Linux / Windows in WSL).
- Bun + biome are the test/lint runners. Both run from cwd; both work in a worktree (no special setup needed).
- The `claude -p` subprocess inherits env from its spawner. v0.0.11 sets `WIFO_TWIN_RECORDINGS_DIR` to an absolute path so twin recordings land in a shared location across worktrees (otherwise each run gets its own recording, defeating replay determinism).

## 2. Architecture decisions

### One git worktree per `factory-runtime run`

```ts
// packages/runtime/src/worktree.ts (NEW)
export interface WorktreeOptions {
  /** Where to root all worktrees. Default: `<projectRoot>/.factory/worktrees`. */
  rootDir?: string;
  /** Base branch / ref. Default: HEAD of the maintainer's current branch. */
  baseRef?: string;
  /** Custom branch name template. Default: `factory-run/<runId>`. */
  branchTemplate?: (runId: string) => string;
}

export interface CreatedWorktree {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Branch name created for this worktree. */
  branch: string;
  /** SHA of the base ref the worktree was created from. */
  baseSha: string;
  /** Commit SHA inside the worktree at creation (== baseSha initially). */
  initialSha: string;
}

export async function createWorktree(runId: string, opts?: WorktreeOptions): Promise<CreatedWorktree>;
export async function removeWorktree(path: string): Promise<void>;
export async function listWorktrees(rootDir?: string): Promise<CreatedWorktree[]>;
```

Implementation: shells out to `git worktree add <path> -b <branch>` from the project root. Captures `git rev-parse HEAD` for `baseSha`. Failures (worktree already exists, base ref invalid, git not on PATH) → throw `RuntimeError({ code: 'runtime/worktree-failed' })`.

### `RunOptions.worktree?` field

```ts
// packages/runtime/src/types.ts
export interface RunOptions {
  // ... existing fields ...

  /**
   * v0.0.11 — opt-in worktree sandbox. When set, runtime.run() creates an
   * isolated git worktree at `<options.worktree.rootDir>/<runId>/` (or
   * `<projectRoot>/.factory/worktrees/<runId>/` by default), threads cwd
   * for all phases into the worktree, and persists a `factory-worktree`
   * record. On convergence: worktree left intact for review. On
   * no-converge or error: worktree left intact for forensic inspection.
   * Cleanup via `factory-runtime worktree clean [--keep-failed]`.
   */
  worktree?: boolean | WorktreeOptions;
}
```

### CLI changes

New flag: `--worktree` (boolean) on `factory-runtime run` and `factory-runtime run-sequence`. When set, the runtime creates a worktree per spec's run().

New subcommand: `factory-runtime worktree clean [--keep-failed] [--rootDir <path>]`. Walks worktrees under `rootDir` (default `./.factory/worktrees`); for each, looks up the corresponding `factory-run` record by `runId` (extracted from the worktree's path); if `runReport.status === 'converged'`, removes via `git worktree remove`. With `--keep-failed`, only converged worktrees are pruned.

### New context record: `factory-worktree`

```ts
// packages/runtime/src/records.ts
export const FactoryWorktreeSchema = z.object({
  runId: z.string(),
  worktreePath: z.string(),    // absolute path
  branch: z.string(),
  baseSha: z.string(),          // SHA the worktree was created from
  baseRef: z.string(),          // human-readable ref name (e.g., 'main')
  createdAt: z.string(),
  status: z.enum(['active', 'converged', 'no-converge', 'error', 'removed']),
});
```

Persisted by the runtime when the worktree is created (status: `'active'`); updated post-run with the final status. `removeWorktree` updates to `'removed'`.

### Cwd threading through phases

The runtime reads `args.options?.worktree` BEFORE constructing the phase graph in the CLI. When set:
1. Generate `runId` early (or use a placeholder + rename worktree on `factory-run` persist).
2. Call `createWorktree(runId, opts)` → `{ path, branch, baseSha }`.
3. Persist `factory-worktree` record (parents=`[runId]`).
4. Invoke `run()` with the phase graph constructed using `opts.cwd = worktree.path` for implement/validate/dod.
5. After `run()` returns, update the `factory-worktree` record's status + persist.

For `runSequence`, the same pattern applies per spec — each spec gets its own worktree (different runIds → different paths).

### Cleanup semantics

`factory-runtime worktree clean`:
- Default: removes only converged worktrees (safe default; preserves failed runs for inspection).
- `--keep-failed`: same as default (alias for clarity in commit messages).
- `--all`: removes ALL worktrees (including failed). Destructive — requires explicit flag.
- `--rootDir <path>`: override the worktree root.
- Idempotent. Skips paths that aren't worktrees.

### Maintainer review flow

After `factory-runtime run --worktree docs/specs/foo.md`:

```sh
# Review the agent's work:
git diff main..factory-run/<runId>

# Cherry-pick if happy:
git checkout main
git merge --squash factory-run/<runId>
git commit -m "ship factory-run/<runId>"

# Or just keep the worktree around for parallel runs:
factory-runtime run --worktree docs/specs/bar.md  # creates a SECOND worktree

# Cleanup converged worktrees:
factory-runtime worktree clean
```

## 3. Risk assessment

### Blast radius

- **Existing `factory-runtime run` callers without `--worktree`:** zero behavior change. The flag is opt-in.
- **Programmatic callers passing `RunOptions`:** field-level addition. Existing callers passing `{ maxIterations, maxTotalTokens, ... }` without `worktree` get the v0.0.10 behavior unchanged.
- **The maintainer's tree:** untouched when `--worktree` is on. The agent runs in the worktree; the maintainer's main branch is never modified by the agent. **Strong undo by construction.**
- **CI workflows running `factory-runtime run` without `--worktree`:** unaffected.

### Migration concerns

- New `factory-worktree` record type registers via `tryRegister` at runtime startup. No migration needed for existing context stores (records are additive).
- Existing `factory-run` records don't gain a `worktree?` field — the `factory-worktree` record is a sibling, linked via `parents=[runId]`. Provenance walks via `factory-context tree --direction down <runId>` show the worktree record as a descendant.

### Performance

- `git worktree add` is O(1) for the worktree itself + a few hundred ms to create the working dir + checkout. Negligible vs the agent's wall-clock.
- Disk space: each worktree is a full checkout (modulo pack-file sharing with the parent repo). For a small project (~10 MB on disk) and 10 worktrees, ~100 MB. Acceptable; cleanup is one command.
- Validate/dod tests run from the worktree's cwd — `bun test` finds the test files in the worktree's copy. No performance impact vs running from the maintainer's cwd.
- `pnpm install` is NOT re-run per worktree — the worktree shares `node_modules/` via the parent repo's link semantics. `bun test` and `pnpm typecheck` resolve correctly.

### External dependencies

- `git` >= 2.5 (when `git worktree` shipped). `git --version` check at first invocation; missing → `RuntimeError({ code: 'runtime/worktree-failed', message: 'git worktree requires git >= 2.5' })`.
- `node:child_process` for shelling out to `git worktree`. Already a runtime dep transitively.

### Failure modes worth pinning in tests

- `git` not on PATH → fail-fast with informative error (don't leave partial state).
- Worktree dir already exists from a prior aborted run → `git worktree add` fails with "already exists"; runtime catches + suggests `factory-runtime worktree clean`.
- Worktree created but `factory-run` persist fails → leave the worktree (forensic value); the maintainer can `git worktree remove` manually OR re-run cleanup.
- Worktree removal during `clean` fails (uncommitted changes in the worktree) → log + skip; don't error out the whole sweep.
- Two parallel `factory-runtime run --worktree` invocations → each gets its own runId → its own worktree → no conflict. Concurrency is supported by design.

## 4. Public API surface deltas

- `@wifo/factory-runtime/src/index.ts`: 23 → **26** names. Three new exports:
  - `createWorktree` (function)
  - `WorktreeOptions` (type)
  - `CreatedWorktree` (type)
  Note: `removeWorktree` and `listWorktrees` stay internal (the CLI subcommand uses them; programmatic callers can shell out to `git` directly if they need that level of control).
- `RunOptions.worktree?: boolean | WorktreeOptions` — field-level addition on already-exported type.
- New `RuntimeErrorCode` value: `'runtime/worktree-failed'` (14 → 15).
- New context record `factory-worktree` registered in `packages/runtime/src/records.ts`.

## 5. Locked decisions worth pinning in the spec

- **Default worktree root: `<projectRoot>/.factory/worktrees/<runId>/`.** Keeps worktrees adjacent to the existing `.factory/` context-store dir. Configurable via `WorktreeOptions.rootDir`.
- **Branch naming: `factory-run/<runId>`.** Branches are throwaway; they're under the `factory-run/` namespace so `git branch | grep ^factory-run` shows them all.
- **Base ref: HEAD of the maintainer's current branch by default.** Configurable via `WorktreeOptions.baseRef`. The runtime captures the base SHA so the maintainer can `git diff <baseSha>..factory-run/<runId>` reproducibly.
- **`--worktree` is opt-in for v0.0.11.** Default `false`. Becomes opt-out (default `true`) post-v0.1.0 once soaked in production usage.
- **One worktree per `run()` invocation.** Implement, validate, and dod phases share the same worktree for that run. The maintainer reviews the diff at the end.
- **Cleanup is opt-in via `factory-runtime worktree clean`.** No automatic cleanup on run end (preserves forensic value of failed runs).
- **`factory-worktree` record schema is finalized in this spec.** Future fields (e.g., `mergedAt`, `mergedShaTo`) deferred to follow-on releases.
- **No support for worktrees on non-git projects.** The runtime will fail-fast with a clear error if `--worktree` is set in a non-git project.

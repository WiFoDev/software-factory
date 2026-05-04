import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { RuntimeError } from './errors.js';

/**
 * v0.0.11 — Options for creating a per-run git worktree.
 *
 * `rootDir` overrides the default `<projectRoot>/.factory/worktrees/`
 * location; `<runId>/` is always appended to whatever rootDir resolves to.
 * `projectRoot` lets callers point at a project other than `process.cwd()`
 * (the runtime threads its current cwd by default).
 */
export interface WorktreeOptions {
  rootDir?: string;
  projectRoot?: string;
}

/**
 * v0.0.11 — Output of `createWorktree`.
 *
 * `path` is the absolute path the runtime threads as `cwd` into every phase
 * for the run. `branch` is the throwaway branch under the `factory-run/`
 * namespace. `baseSha` / `baseRef` are the project's `HEAD` at creation
 * time, captured for forensic / audit value on the persisted
 * `factory-worktree` record.
 */
export interface CreatedWorktree {
  runId: string;
  path: string;
  branch: string;
  baseSha: string;
  baseRef: string;
  projectRoot: string;
}

const DEFAULT_WORKTREE_ROOT = '.factory/worktrees';
const BRANCH_PREFIX = 'factory-run/';

function isGitRepo(projectRoot: string): boolean {
  if (!existsSync(projectRoot)) return false;
  // Walk up looking for a `.git` directory or file (worktree linked file).
  let cur = resolve(projectRoot);
  while (true) {
    if (existsSync(join(cur, '.git'))) return true;
    const parent = resolve(cur, '..');
    if (parent === cur) return false;
    cur = parent;
  }
}

function git(
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

/**
 * v0.0.11 — Create an isolated git worktree at
 * `<rootDir>/<runId>/` on a throwaway branch `factory-run/<runId>`. The
 * runtime threads the returned `path` as `cwd` into every phase for the
 * run, so the agent's edits + the harness's tests + the DoD shell bullets
 * resolve against the worktree's checkout — never the maintainer's main
 * tree.
 *
 * Throws `RuntimeError({ code: 'runtime/worktree-failed' })` when the
 * project is not a git repo, when `git` is missing on PATH, or when
 * `git worktree add` fails (disk full, permission denied, conflicting
 * path). Atomic: a partial create (worktree dir present without an
 * accompanying branch, or vice-versa) is rolled back before the error
 * propagates so no orphan filesystem state survives.
 */
export function createWorktree(runId: string, opts: WorktreeOptions = {}): CreatedWorktree {
  const projectRoot = resolve(opts.projectRoot ?? process.cwd());
  if (!isGitRepo(projectRoot)) {
    throw new RuntimeError('runtime/worktree-failed', `not a git repository: ${projectRoot}`);
  }

  const rootDirRaw = opts.rootDir ?? join(projectRoot, DEFAULT_WORKTREE_ROOT);
  const rootDir = isAbsolute(rootDirRaw) ? rootDirRaw : resolve(projectRoot, rootDirRaw);
  const path = join(rootDir, runId);
  const branch = `${BRANCH_PREFIX}${runId}`;

  // Capture HEAD before mutating — caller may want this on the
  // factory-worktree record for forensic value.
  const headSha = git(['rev-parse', 'HEAD'], projectRoot);
  if (headSha.status !== 0) {
    throw new RuntimeError(
      'runtime/worktree-failed',
      `failed to read HEAD: ${headSha.stderr.trim()}`,
    );
  }
  const baseSha = headSha.stdout.trim();
  const headRef = git(['symbolic-ref', '--quiet', 'HEAD'], projectRoot);
  const baseRef = headRef.status === 0 ? headRef.stdout.trim() : baseSha;

  // Capture pre-existing state so a failed `git worktree add` doesn't
  // tear down a tree we didn't create (H-2: cleanup applies to OUR
  // partial create, never to pre-existing worktrees / branches).
  const pathExistedBefore = existsSync(path);
  const branchExistedBefore =
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], projectRoot).status === 0;

  const add = git(['worktree', 'add', path, '-b', branch], projectRoot);
  if (add.status !== 0) {
    // Best-effort cleanup: prune any partial state we may have created.
    // `git worktree add` is mostly atomic, but a half-create (e.g. branch
    // made but checkout failed) needs explicit teardown. Skip cleanup
    // when the path / branch existed pre-call so we don't clobber them.
    if (!pathExistedBefore) {
      git(['worktree', 'remove', '--force', path], projectRoot);
    }
    if (!branchExistedBefore) {
      git(['branch', '-D', branch], projectRoot);
    }
    throw new RuntimeError(
      'runtime/worktree-failed',
      `git worktree add failed: ${add.stderr.trim()}`,
    );
  }

  return { runId, path, branch, baseSha, baseRef, projectRoot };
}

/**
 * v0.0.11 — Remove a previously-created worktree. Internal-only; callers
 * go through the `factory-runtime worktree clean` CLI subcommand. Best-
 * effort: returns the git stderr on failure rather than throwing so the
 * subcommand can keep iterating across multiple worktrees.
 */
export function removeWorktree(
  worktreePath: string,
  projectRoot: string,
): { ok: boolean; stderr: string } {
  const result = git(['worktree', 'remove', '--force', worktreePath], projectRoot);
  return { ok: result.status === 0, stderr: result.stderr.trim() };
}

/**
 * v0.0.11 — Internal helper for `factory-runtime worktree list`. Parses
 * `git worktree list --porcelain` and yields `{ path, branch }` for each
 * factory-run worktree (filtered to the `factory-run/` branch namespace).
 * Throws `RuntimeError({ code: 'runtime/worktree-failed' })` when the git
 * subprocess fails (missing on PATH, corrupted index).
 */
export function listWorktrees(projectRoot: string): { path: string; branch: string }[] {
  if (!isGitRepo(projectRoot)) {
    throw new RuntimeError('runtime/worktree-failed', `not a git repository: ${projectRoot}`);
  }
  const result = git(['worktree', 'list', '--porcelain'], projectRoot);
  if (result.status !== 0) {
    throw new RuntimeError(
      'runtime/worktree-failed',
      `failed to enumerate git worktrees: ${result.stderr.trim()}`,
    );
  }
  const blocks = result.stdout.split('\n\n');
  const out: { path: string; branch: string }[] = [];
  for (const block of blocks) {
    let path: string | undefined;
    let branch: string | undefined;
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim();
      else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length).trim();
        // refs/heads/factory-run/<id> — strip the refs/heads/ prefix.
        branch = ref.replace(/^refs\/heads\//, '');
      }
    }
    if (path !== undefined && branch !== undefined && branch.startsWith(BRANCH_PREFIX)) {
      out.push({ path, branch });
    }
  }
  return out;
}

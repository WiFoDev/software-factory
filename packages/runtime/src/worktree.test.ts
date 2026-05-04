import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createContextStore } from '@wifo/factory-context';
import type { Spec } from '@wifo/factory-core';
import { RuntimeError } from './errors.js';
import { definePhase, definePhaseGraph } from './graph.js';
import { run } from './runtime.js';
import { createWorktree } from './worktree.js';

let projectRoot: string;
let ctxDir: string;

async function initGitRepo(dir: string): Promise<void> {
  await Bun.$`git init -q ${dir}`.quiet();
  await Bun.$`git -C ${dir} config user.email "test@example.com"`.quiet();
  await Bun.$`git -C ${dir} config user.name "test"`.quiet();
  await Bun.$`git -C ${dir} config commit.gpgsign false`.quiet();
  await Bun.write(join(dir, 'README.md'), '# fixture\n');
  await Bun.$`git -C ${dir} add -A`.quiet();
  await Bun.$`git -C ${dir} commit -q -m "init"`.quiet();
}

beforeEach(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wt-proj-'));
  ctxDir = mkdtempSync(join(tmpdir(), 'wt-ctx-'));
  await initGitRepo(projectRoot);
});

afterEach(async () => {
  await Bun.$`rm -rf ${projectRoot} ${ctxDir}`.quiet().nothrow();
});

function makeSpec(id = 'wt-spec'): Spec {
  return {
    frontmatter: {
      id,
      classification: 'light',
      type: 'feat',
      status: 'ready',
      exemplars: [],
      'depends-on': [],
    },
    body: '',
    scenarios: [],
    holdouts: [],
    raw: { source: '' },
  };
}

describe('createWorktree (T1) — S-1 + H-2', () => {
  test('createWorktree creates a git worktree at .factory/worktrees/<runId>/', () => {
    const runId = 'abc123abc123abc1';
    const wt = createWorktree(runId, { projectRoot });
    expect(wt.runId).toBe(runId);
    expect(wt.path).toBe(resolve(projectRoot, '.factory/worktrees', runId));
    expect(wt.branch).toBe(`factory-run/${runId}`);
    expect(wt.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(wt.path)).toBe(true);
    // The worktree's checkout includes the seeded README from the
    // initial commit (proves git materialized the tree, not just an
    // empty directory).
    expect(existsSync(join(wt.path, 'README.md'))).toBe(true);
  });

  test('createWorktree honors WorktreeOptions.rootDir override', () => {
    const altRoot = mkdtempSync(join(tmpdir(), 'wt-alt-root-'));
    try {
      const runId = '0000111122223333';
      const wt = createWorktree(runId, { projectRoot, rootDir: altRoot });
      expect(wt.path).toBe(join(altRoot, runId));
      expect(existsSync(wt.path)).toBe(true);
    } finally {
      // The git worktree command created a checkout under altRoot.
      // Best-effort cleanup; the parent afterEach won't reach here.
      Bun.$`git -C ${projectRoot} worktree remove --force ${join(altRoot, '0000111122223333')}`
        .quiet()
        .nothrow();
      Bun.$`rm -rf ${altRoot}`.quiet().nothrow();
    }
  });

  test('non-git project + createWorktree → runtime/worktree-failed', () => {
    const nonGit = mkdtempSync(join(tmpdir(), 'wt-nongit-'));
    try {
      let caught: unknown;
      try {
        createWorktree('runid000runid000', { projectRoot: nonGit });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).code).toBe('runtime/worktree-failed');
    } finally {
      Bun.$`rm -rf ${nonGit}`.quiet().nothrow();
    }
  });

  test('parallel createWorktree calls produce distinct worktrees (H-1)', () => {
    const wt1 = createWorktree('aaaa1111aaaa1111', { projectRoot });
    const wt2 = createWorktree('bbbb2222bbbb2222', { projectRoot });
    expect(wt1.path).not.toBe(wt2.path);
    expect(wt1.branch).not.toBe(wt2.branch);
    expect(existsSync(wt1.path)).toBe(true);
    expect(existsSync(wt2.path)).toBe(true);
  });

  test('atomic on conflict (H-2): re-using a path → runtime/worktree-failed; existing tree unaffected', () => {
    const runId = 'cccc3333cccc3333';
    const wt = createWorktree(runId, { projectRoot });
    expect(existsSync(wt.path)).toBe(true);

    // Re-attempt with same runId → conflict.
    let caught: unknown;
    try {
      createWorktree(runId, { projectRoot });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).code).toBe('runtime/worktree-failed');

    // The first worktree still on disk — H-2's "no orphan" guarantee
    // applies to the FAILED creation, not pre-existing trees.
    expect(existsSync(wt.path)).toBe(true);
  });
});

// S-1 — `factory-runtime run --worktree <spec>` threads cwd through phases ---

describe('run() with options.worktree (S-1)', () => {
  test('factory-runtime run --worktree threads cwd through all phases', async () => {
    const store = createContextStore({ dir: ctxDir });
    const seenCwds: string[] = [];
    const phase = definePhase('p', async (ctx) => {
      // ctx.cwd is set by the runtime when worktree is enabled.
      if (ctx.cwd !== undefined) seenCwds.push(ctx.cwd);
      return { status: 'pass', records: [] };
    });
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { worktree: { projectRoot } },
    });
    expect(report.status).toBe('converged');
    expect(seenCwds.length).toBe(1);
    expect(seenCwds[0]).toBe(resolve(projectRoot, '.factory/worktrees', report.runId));
    // Worktree dir actually exists after the run.
    expect(existsSync(seenCwds[0] as string)).toBe(true);
  });

  test('factory-worktree record persists with runId/path/branch/baseSha/status', async () => {
    const store = createContextStore({ dir: ctxDir });
    const phase = definePhase('p', async () => ({ status: 'pass', records: [] }));
    const graph = definePhaseGraph([phase], []);
    const report = await run({
      spec: makeSpec(),
      graph,
      contextStore: store,
      options: { worktree: { projectRoot } },
    });

    const wtRecs = await store.list({ type: 'factory-worktree' });
    expect(wtRecs.length).toBe(1);
    const payload = wtRecs[0]?.payload as {
      runId: string;
      worktreePath: string;
      branch: string;
      baseSha: string;
      baseRef: string;
      status: string;
    };
    expect(payload.runId).toBe(report.runId);
    expect(payload.worktreePath).toBe(resolve(projectRoot, '.factory/worktrees', report.runId));
    expect(payload.branch).toBe(`factory-run/${report.runId}`);
    expect(payload.baseSha).toMatch(/^[0-9a-f]{40}$/);
    // Run converged (single passing phase) → final status mirrors run status.
    expect(payload.status).toBe('converged');

    // factory-worktree record's parents include the runId so it's
    // reachable via `factory-context tree --direction down <runId>`.
    expect(wtRecs[0]?.parents).toContain(report.runId);
  });

  test('non-git project + --worktree → runtime/worktree-failed; no factory-run persists (H-2)', async () => {
    const nonGit = mkdtempSync(join(tmpdir(), 'wt-nongit-run-'));
    try {
      const store = createContextStore({ dir: ctxDir });
      const phase = definePhase('p', async () => ({ status: 'pass', records: [] }));
      const graph = definePhaseGraph([phase], []);
      let caught: unknown;
      try {
        await run({
          spec: makeSpec(),
          graph,
          contextStore: store,
          options: { worktree: { projectRoot: nonGit } },
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).code).toBe('runtime/worktree-failed');

      // No factory-run record persisted (run never started).
      const all = await store.list();
      expect(all.length).toBe(0);
    } finally {
      Bun.$`rm -rf ${nonGit}`.quiet().nothrow();
    }
  });
});

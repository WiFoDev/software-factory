import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'publish.yml');
const RELEASING_PATH = join(REPO_ROOT, 'RELEASING.md');
const ROOT_PKG_PATH = join(REPO_ROOT, 'package.json');

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  if?: string;
}

interface WorkflowJob {
  'runs-on'?: string;
  steps?: WorkflowStep[];
  permissions?: Record<string, string>;
}

interface Workflow {
  name?: string;
  on?: Record<string, unknown> | true;
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
}

function loadWorkflow(): Workflow {
  expect(existsSync(WORKFLOW_PATH)).toBe(true);
  const raw = readFileSync(WORKFLOW_PATH, 'utf8');
  // yaml.parse throws on malformed YAML — surfacing the parse error as a test
  // failure is the desired behavior.
  return parseYaml(raw) as Workflow;
}

describe('ci-publish — workflow structure (S-1)', () => {
  test('.github/workflows/publish.yml exists with the canonical structure', () => {
    const wf = loadWorkflow();

    // on.push.tags matches the exact regex pattern from the spec
    const on = wf.on as Record<string, unknown>;
    expect(on).toBeDefined();
    const push = on.push as { tags?: string[] };
    expect(push).toBeDefined();
    expect(Array.isArray(push.tags)).toBe(true);
    expect(push.tags).toContain('v[0-9]+.[0-9]+.[0-9]+');

    // exactly one job named "publish"
    expect(wf.jobs).toBeDefined();
    const jobNames = Object.keys(wf.jobs ?? {});
    expect(jobNames).toEqual(['publish']);

    const job = wf.jobs?.publish;
    expect(job).toBeDefined();
    if (!job) return;
    expect(job['runs-on']).toBe('ubuntu-latest');

    const steps = job.steps ?? [];
    // Find each canonical step in order. We don't pin step `name:` values —
    // we identify by `uses:` for action steps and by `run:` substring for
    // script steps. The assertion is: indices are strictly increasing.
    function findIndex(predicate: (s: WorkflowStep) => boolean): number {
      return steps.findIndex(predicate);
    }

    const checkoutIdx = findIndex(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@v'),
    );
    const setupPnpmIdx = findIndex(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('pnpm/action-setup@v'),
    );
    const setupNodeIdx = findIndex(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('actions/setup-node@v'),
    );
    const installIdx = findIndex(
      (s) => typeof s.run === 'string' && s.run.includes('pnpm install --frozen-lockfile'),
    );
    const typecheckIdx = findIndex((s) => s.run === 'pnpm typecheck');
    const testIdx = findIndex((s) => s.run === 'pnpm test');
    const checkIdx = findIndex((s) => s.run === 'pnpm check');
    // v0.0.13.x — peerDeps cycle-break didn't escape pnpm's cycle detector
    // (peer deps form build-graph edges in pnpm). Build step accepts EITHER
    // `pnpm -r build` OR per-package `pnpm --filter` lines (the cycle
    // workaround inherited from v0.0.12). Match either shape.
    const buildIdx = findIndex(
      (s) =>
        typeof s.run === 'string' &&
        (/^pnpm\s+-r\s+(--workspace-concurrency=\d+\s+)?build\s*$/.test(s.run) ||
          /pnpm\s+--filter\s+@wifo\/factory-\S+\s+build/.test(s.run)),
    );
    // v0.0.13.x — publish step is idempotent (per-package loop with `npm view`
    // skip-if-published guard). Accepts either `pnpm publish -r ...`,
    // `pnpm publish ...`, or `pnpm --filter <name> publish ...` shapes.
    const publishIdx = findIndex(
      (s) =>
        typeof s.run === 'string' &&
        /pnpm\s+(--filter\s+\S+\s+)?publish/.test(s.run) &&
        s.run.includes('--access public'),
    );

    expect(checkoutIdx).toBeGreaterThanOrEqual(0);
    expect(setupPnpmIdx).toBeGreaterThan(checkoutIdx);
    expect(setupNodeIdx).toBeGreaterThan(setupPnpmIdx);
    expect(installIdx).toBeGreaterThan(setupNodeIdx);
    // v0.0.13 — build runs BEFORE typecheck so cross-package type resolution
    // (e.g., harness → @wifo/factory-core) finds workspace-linked dist/.
    expect(buildIdx).toBeGreaterThan(installIdx);
    expect(typecheckIdx).toBeGreaterThan(buildIdx);
    expect(testIdx).toBeGreaterThan(typecheckIdx);
    expect(checkIdx).toBeGreaterThan(testIdx);
    expect(publishIdx).toBeGreaterThan(checkIdx);

    // setup-node pins node 22
    const nodeStep = steps[setupNodeIdx];
    const nodeWith = (nodeStep?.with ?? {}) as { 'node-version'?: number | string };
    const nodeVersion = String(nodeWith['node-version'] ?? '');
    expect(nodeVersion).toBe('22');
  });

  test('publish workflow declares OIDC id-token permission for Trusted Publishing', () => {
    const wf = loadWorkflow();

    // workflow-level permissions: contents:read for checkout, id-token:write
    // for the OIDC token npm Trusted Publishing verifies against each
    // package's Trusted Publishers config on npmjs.com.
    const perms = wf.permissions ?? {};
    expect(perms.contents).toBe('read');
    expect(perms['id-token']).toBe('write');

    // The publish step uses --provenance (required by Trusted Publishing)
    // and does NOT carry an NPM_TOKEN env binding (long-lived secrets
    // were replaced by OIDC short-lived tokens in v0.0.13.x).
    const steps = wf.jobs?.publish?.steps ?? [];
    const publishStep = steps.find(
      (s) => typeof s.run === 'string' && /pnpm\s+(--filter\s+\S+\s+)?publish/.test(s.run),
    );
    expect(publishStep).toBeDefined();
    const cmd = publishStep?.run ?? '';
    expect(cmd).toContain('--provenance');
    const env = publishStep?.env ?? {};
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.NODE_AUTH_TOKEN).toBeUndefined();
  });
});

describe('ci-publish — v0.0.13.x build sequence (cycle workaround)', () => {
  test('publish.yml build step uses per-package sequence to sidestep peer-dep cycle', () => {
    // The v0.0.13 cycle-break (move spec-review to peerDependencies of core)
    // expressed the right runtime semantic but did NOT eliminate the
    // build-graph cycle from pnpm's POV — pnpm treats peer deps as cycle
    // edges. The per-package build sequence inherited from v0.0.12 stays.
    const wf = loadWorkflow();
    const steps = wf.jobs?.publish?.steps ?? [];
    const buildStep = steps.find(
      (s) =>
        typeof s.run === 'string' && /pnpm\s+--filter\s+@wifo\/factory-\S+\s+build/.test(s.run),
    );
    expect(buildStep).toBeDefined();
    // Sequence covers all 6 packages.
    const cmd = buildStep?.run ?? '';
    expect(cmd).toContain('@wifo/factory-context');
    expect(cmd).toContain('@wifo/factory-twin');
    expect(cmd).toContain('@wifo/factory-core');
    expect(cmd).toContain('@wifo/factory-harness');
    expect(cmd).toContain('@wifo/factory-spec-review');
    expect(cmd).toContain('@wifo/factory-runtime');
  });
});

describe('ci-publish — manual fallback preserved (S-2)', () => {
  test('top-level package.json release script unchanged from v0.0.10', () => {
    const pkg = JSON.parse(readFileSync(ROOT_PKG_PATH, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const release = pkg.scripts?.release;
    expect(release).toBe(
      'pnpm typecheck && pnpm test && pnpm check && pnpm -r build && pnpm publish -r --access public',
    );
  });

  test('RELEASING.md exists at repo root with canonical sections', () => {
    expect(existsSync(RELEASING_PATH)).toBe(true);
    const contents = readFileSync(RELEASING_PATH, 'utf8');
    expect(contents).toContain('## CI flow (canonical)');
    expect(contents).toContain('## Manual flow (fallback)');
    // v0.0.13.x — Trusted Publishing replaced the NPM_TOKEN-secret approach.
    expect(contents).toContain('## Setting up Trusted Publishing');
    expect(contents).toContain('## After publish: verify + GitHub release');
    expect(contents).toContain('## Why `--no-git-checks` in CI but not manual');

    // Trusted-publisher setup is documented (npmjs.com → Trusted Publishers)
    expect(contents).toMatch(/Trusted Publisher/);
    // Tag-driven trigger is documented
    expect(contents).toMatch(/v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+|vX\.Y\.Z|v0\.0\.X/);
    // Manual fallback command is documented
    expect(contents).toContain('pnpm release');
  });
});

describe('ci-publish — gates + flags (S-3)', () => {
  test('workflow uses --no-git-checks flag', () => {
    const wf = loadWorkflow();
    const steps = wf.jobs?.publish?.steps ?? [];
    const publishStep = steps.find(
      (s) => typeof s.run === 'string' && /pnpm\s+(--filter\s+\S+\s+)?publish/.test(s.run),
    );
    expect(publishStep).toBeDefined();
    const cmd = publishStep?.run ?? '';
    // v0.0.13.x — accepts either `-r` (single-shot) or `--filter <name>`
    // (idempotent per-package loop) shapes.
    expect(/(\s-r\s|--filter\s)/.test(cmd)).toBe(true);
    expect(cmd).toContain('--access public');
    expect(cmd).toContain('--no-git-checks');
  });

  test('RELEASING.md documents --no-git-checks rationale', () => {
    const contents = readFileSync(RELEASING_PATH, 'utf8');
    expect(contents).toContain('--no-git-checks');
    // The rationale section explicitly explains CI vs manual divergence.
    const rationaleSectionIdx = contents.indexOf('## Why `--no-git-checks` in CI but not manual');
    expect(rationaleSectionIdx).toBeGreaterThanOrEqual(0);
    const rationale = contents.slice(rationaleSectionIdx);
    expect(rationale).toMatch(/CI/);
    expect(rationale).toMatch(/manual/i);
  });
});

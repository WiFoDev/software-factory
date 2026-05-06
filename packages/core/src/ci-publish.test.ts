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
    // v0.0.12 — build step accepts an optional `--workspace-concurrency=<n>`
    // flag (added to handle the core ↔ spec-review cyclic workspace dep).
    const buildIdx = findIndex(
      (s) => typeof s.run === 'string' && /pnpm\s+-r\s+(--workspace-concurrency=\d+\s+)?build\b/.test(s.run),
    );
    // v0.0.12 — publish step is idempotent (per-package loop with `npm view`
    // skip-if-published guard) instead of `pnpm publish -r`. Match either
    // shape to keep the invariant assertion stable across the change.
    const publishIdx = findIndex(
      (s) =>
        typeof s.run === 'string' &&
        s.run.includes('pnpm publish') &&
        s.run.includes('--access public'),
    );

    expect(checkoutIdx).toBeGreaterThanOrEqual(0);
    expect(setupPnpmIdx).toBeGreaterThan(checkoutIdx);
    expect(setupNodeIdx).toBeGreaterThan(setupPnpmIdx);
    expect(installIdx).toBeGreaterThan(setupNodeIdx);
    // v0.0.12 — build runs BEFORE typecheck so cross-package type resolution
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

  test('publish workflow declares NPM_TOKEN secret + id-token permission', () => {
    const wf = loadWorkflow();

    // workflow-level permissions
    const perms = wf.permissions ?? {};
    expect(perms.contents).toBe('read');
    expect(perms['id-token']).toBe('write');

    // publish step's env contains NPM_TOKEN bound to the secret
    const steps = wf.jobs?.publish?.steps ?? [];
    const publishStep = steps.find(
      (s) => typeof s.run === 'string' && s.run.includes('pnpm publish'),
    );
    expect(publishStep).toBeDefined();
    const env = publishStep?.env ?? {};
    expect(env.NPM_TOKEN).toBe('${{ secrets.NPM_TOKEN }}');
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
    expect(contents).toContain('## Setting up `NPM_TOKEN`');
    expect(contents).toContain('## After publish: verify + GitHub release');
    expect(contents).toContain('## Why `--no-git-checks` in CI but not manual');

    // Secret-setup step is documented (gh secret set NPM_TOKEN ...)
    expect(contents).toMatch(/gh secret set NPM_TOKEN/);
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
      (s) => typeof s.run === 'string' && s.run.includes('pnpm publish'),
    );
    expect(publishStep).toBeDefined();
    const cmd = publishStep?.run ?? '';
    expect(cmd).toContain('-r');
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

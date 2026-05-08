import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

const WORKSPACE_PACKAGES = [
  'core',
  'context',
  'harness',
  'runtime',
  'spec-review',
  'twin',
] as const;

interface PackageJson {
  name: string;
  version: string;
  license?: string;
  author?: string;
  homepage?: string;
  bugs?: { url?: string };
  repository?: { type?: string; url?: string; directory?: string };
  keywords?: string[];
  publishConfig?: { access?: string };
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(rel: string): PackageJson {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8')) as PackageJson;
}

describe('publish-meta — workspace package metadata (S-1)', () => {
  test('every workspace package has v0.0.14 + publishConfig + npm metadata fields', () => {
    for (const name of WORKSPACE_PACKAGES) {
      const pkgPath = `packages/${name}/package.json`;
      const pkg = readPackageJson(pkgPath);

      expect(pkg.version).toMatch(/^0\.0\.14$/);
      expect(pkg.license).toBe('MIT');
      expect(pkg.author).toBe('Luis (WiFoDev)');

      expect(pkg.publishConfig).toBeDefined();
      expect(pkg.publishConfig?.access).toBe('public');

      expect(pkg.repository).toBeDefined();
      expect(pkg.repository?.type).toBe('git');
      expect(pkg.repository?.url).toBe('git+https://github.com/WiFoDev/software-factory.git');
      expect(pkg.repository?.directory).toBe(`packages/${name}`);

      expect(pkg.homepage).toBe(
        `https://github.com/WiFoDev/software-factory/tree/main/packages/${name}#readme`,
      );
      expect(pkg.bugs?.url).toBe('https://github.com/WiFoDev/software-factory/issues');

      expect(Array.isArray(pkg.keywords)).toBe(true);
      const keywords = pkg.keywords ?? [];
      expect(keywords).toContain('software-factory');
      expect(keywords).toContain('agents');
      expect(keywords).toContain('spec-driven');
    }
  });
});

describe('publish-meta — pnpm pack --dry-run (S-2)', () => {
  const FORBIDDEN_PATH_PATTERNS: readonly RegExp[] = [
    /^src\//,
    /\.test\.[jt]sx?$/,
    /^tsconfig.*\.json$/,
    /^test-fixtures\//,
    /^node_modules\//,
  ];

  test('pnpm pack --dry-run for factory-core includes commands/scope-project.md', () => {
    const pkgDir = join(REPO_ROOT, 'packages', 'core');
    const distDir = join(pkgDir, 'dist');

    if (!existsSync(distDir)) {
      // Build hasn't run; skip the tarball assertion. CI runs `pnpm -r build`
      // before this suite, so the skip path is only for ad-hoc bun runs.
      return;
    }

    const stdout = execSync('npm pack --dry-run --json', {
      cwd: pkgDir,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout) as Array<{
      name: string;
      version: string;
      files: Array<{ path: string }>;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    const tarball = parsed[0];
    expect(tarball).toBeDefined();
    if (!tarball) return;

    expect(tarball.name).toBe('@wifo/factory-core');
    const paths = tarball.files.map((f) => f.path);
    expect(paths).toContain('commands/scope-project.md');
  });

  test('pnpm pack --dry-run produces clean tarballs across all packages', () => {
    for (const name of WORKSPACE_PACKAGES) {
      const pkgDir = join(REPO_ROOT, 'packages', name);
      const distDir = join(pkgDir, 'dist');

      if (!existsSync(distDir)) {
        // Skip the file-list check when builds haven't run; metadata is still
        // covered by S-1. CI runs `pnpm -r build` before this suite, so the
        // skip path is only for ad-hoc bun test runs against an unbuilt tree.
        continue;
      }

      const stdout = execSync('npm pack --dry-run --json', {
        cwd: pkgDir,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(stdout) as Array<{
        name: string;
        version: string;
        files: Array<{ path: string }>;
      }>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      const tarball = parsed[0];
      expect(tarball).toBeDefined();
      if (!tarball) continue;

      expect(tarball.name).toBe(`@wifo/factory-${name}`);
      expect(tarball.version).toMatch(/^0\.0\.14$/);

      const paths = tarball.files.map((f) => f.path);
      expect(paths).toContain('README.md');
      expect(paths).toContain('LICENSE');
      expect(paths.some((p) => p.startsWith('dist/'))).toBe(true);

      // factory-core ships the bundled `/scope-project` slash-command source
      // at `commands/scope-project.md` so `factory init` can read it at
      // install time and write it into a fresh project's `.claude/commands/`.
      if (name === 'core') {
        expect(paths).toContain('commands/scope-project.md');
      }

      for (const p of paths) {
        for (const forbidden of FORBIDDEN_PATH_PATTERNS) {
          if (forbidden.test(p)) {
            throw new Error(`package @wifo/factory-${name} tarball contains forbidden path: ${p}`);
          }
        }
      }
    }
  });
});

describe('publish-meta — caveat sweep (S-4)', () => {
  const FORBIDDEN_STRINGS = ['monorepo-only', 'v0.0.4 caveat', 'not yet published to npm'];

  const SWEPT_DOCS = [
    'README.md',
    'packages/core/README.md',
    'packages/spec-review/README.md',
    'examples/slugify/README.md',
    'examples/gh-stars/README.md',
    'examples/parse-size/README.md',
  ];

  test('no doc references the v0.0.4 monorepo-only caveat after v0.0.5 publish', () => {
    for (const rel of SWEPT_DOCS) {
      const abs = join(REPO_ROOT, rel);
      if (!existsSync(abs)) continue;
      const contents = readFileSync(abs, 'utf8');
      for (const needle of FORBIDDEN_STRINGS) {
        if (contents.includes(needle)) {
          throw new Error(`${rel} still contains the forbidden caveat string: "${needle}"`);
        }
      }
    }
  });

  test('init-templates README_TEMPLATE lacks the v0.0.4 monorepo-only caveat', async () => {
    const { README_TEMPLATE } = await import('./init-templates.js');
    for (const needle of FORBIDDEN_STRINGS) {
      expect(README_TEMPLATE).not.toContain(needle);
    }
  });
});

describe('publish-meta — v0.0.14 cycle-break (S-1)', () => {
  test('factory-core declares @wifo/factory-spec-review as a non-optional peer dependency', () => {
    const pkg = readPackageJson('packages/core/package.json') as PackageJson & {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    expect(pkg.peerDependencies).toBeDefined();
    expect(pkg.peerDependencies?.['@wifo/factory-spec-review']).toBe('workspace:*');
    expect(pkg.peerDependenciesMeta).toBeDefined();
    expect(pkg.peerDependenciesMeta?.['@wifo/factory-spec-review']).toBeDefined();
    expect(pkg.peerDependenciesMeta?.['@wifo/factory-spec-review']?.optional).toBe(false);
  });

  test('factory-core does NOT declare @wifo/factory-spec-review under dependencies', () => {
    const pkg = readPackageJson('packages/core/package.json');
    expect(pkg.dependencies?.['@wifo/factory-spec-review']).toBeUndefined();
  });
});

describe('publish-meta — v0.0.14 schema-emitter Node-native (S-2)', () => {
  test('factory-core build script uses tsx instead of bun run', () => {
    const pkg = readPackageJson('packages/core/package.json');
    const build = pkg.scripts?.build ?? '';
    expect(build).toContain('tsx');
    expect(build).toContain('scripts/emit-json-schema.ts');
    expect(build).not.toContain('bun run');
  });

  test('factory-core has tsx in devDependencies', () => {
    const pkg = readPackageJson('packages/core/package.json');
    expect(pkg.devDependencies).toBeDefined();
    expect(pkg.devDependencies?.tsx).toBeDefined();
    expect(pkg.devDependencies?.tsx).toMatch(/^\^?4\./);
    // tsx is a build-time-only tool; must NOT leak into runtime dependencies.
    expect(pkg.dependencies?.tsx).toBeUndefined();
  });
});

describe('publish-meta — release script (S-5)', () => {
  test('top-level package.json has a release script that gates on typecheck/test/check before publish', () => {
    const root = readPackageJson('package.json');
    expect(root.scripts).toBeDefined();
    const release = root.scripts?.release ?? '';
    expect(release).toContain('pnpm typecheck');
    expect(release).toContain('pnpm test');
    expect(release).toContain('pnpm check');
    expect(release).toMatch(/pnpm -r build/);
    expect(release).toContain('pnpm publish -r');
    expect(release).toContain('--access public');

    const typecheckIdx = release.indexOf('pnpm typecheck');
    const testIdx = release.indexOf('pnpm test');
    const checkIdx = release.indexOf('pnpm check');
    const buildIdx = release.search(/pnpm -r build/);
    const publishIdx = release.indexOf('pnpm publish');
    expect(typecheckIdx).toBeLessThan(testIdx);
    expect(testIdx).toBeLessThan(checkIdx);
    expect(checkIdx).toBeLessThan(buildIdx);
    expect(buildIdx).toBeLessThan(publishIdx);
  });
});

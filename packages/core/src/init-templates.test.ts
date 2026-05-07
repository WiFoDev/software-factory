import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BIOME_JSON_TEMPLATE,
  FACTORY_CONFIG_TEMPLATE,
  GITIGNORE_TEMPLATE,
  PACKAGE_JSON_TEMPLATE,
  README_TEMPLATE,
  TSCONFIG_TEMPLATE,
  readScopeProjectCommandTemplate,
} from './init-templates.js';

describe('init-templates', () => {
  test('PACKAGE_JSON_TEMPLATE has the expected keys + workspace-stripped semver deps', () => {
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-core']).toBe('^0.0.13');
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-runtime']).toBe('^0.0.13');
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-context']).toBe('^0.0.13');
    expect(PACKAGE_JSON_TEMPLATE.type).toBe('module');
    expect(PACKAGE_JSON_TEMPLATE.private).toBe(true);
  });

  test('PACKAGE_JSON_TEMPLATE pins @wifo/factory-* deps at ^0.0.13', () => {
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-context']).toBe('^0.0.13');
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-core']).toBe('^0.0.13');
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-runtime']).toBe('^0.0.13');
    expect(PACKAGE_JSON_TEMPLATE.devDependencies['@wifo/factory-spec-review']).toBe('^0.0.13');
  });

  test('TSCONFIG_TEMPLATE is self-contained — does NOT extend a relative path', () => {
    expect(TSCONFIG_TEMPLATE).not.toHaveProperty('extends');
    expect(TSCONFIG_TEMPLATE.compilerOptions.strict).toBe(true);
    expect(TSCONFIG_TEMPLATE.compilerOptions.verbatimModuleSyntax).toBe(true);
    expect(TSCONFIG_TEMPLATE.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(TSCONFIG_TEMPLATE.compilerOptions.types).toEqual(['bun']);
  });

  test('GITIGNORE_TEMPLATE matches examples/slugify/.gitignore byte-for-byte', () => {
    const slugifyGitignore = join(
      import.meta.dir,
      '..',
      '..',
      '..',
      'examples',
      'slugify',
      '.gitignore',
    );
    if (!existsSync(slugifyGitignore)) {
      return;
    }
    const slugifyContents = readFileSync(slugifyGitignore, 'utf8');
    expect(GITIGNORE_TEMPLATE).toBe(slugifyContents);
  });

  test('scaffold README documents bun-as-test-only requirement', () => {
    expect(README_TEMPLATE).toContain('bun is required for `pnpm test` only');
  });

  test('README_TEMPLATE has a {{name}} placeholder and lacks the v0.0.4 caveat', () => {
    expect(README_TEMPLATE).toContain('{{name}}');
    expect(README_TEMPLATE).not.toContain('v0.0.4 caveat');
    expect(README_TEMPLATE).not.toContain('not yet published to npm');
    expect(README_TEMPLATE).not.toContain('monorepo-only');
    expect(README_TEMPLATE).toContain('factory spec lint');
    expect(README_TEMPLATE).toContain('factory-runtime run');
  });

  test('README_TEMPLATE includes Multi-spec products section', () => {
    expect(README_TEMPLATE).toContain('## Multi-spec products');
    // Section is concise — the body between the heading and the next ## should
    // stay under ~30 lines so the scaffold README stays scannable.
    const startIdx = README_TEMPLATE.indexOf('## Multi-spec products');
    expect(startIdx).toBeGreaterThan(-1);
    const after = README_TEMPLATE.slice(startIdx + '## Multi-spec products'.length);
    const nextHeadingIdx = after.indexOf('\n## ');
    const sectionBody = nextHeadingIdx === -1 ? after : after.slice(0, nextHeadingIdx);
    const lineCount = sectionBody.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(30);
  });

  test('README_TEMPLATE Multi-spec section names /scope-project, run-sequence, and the auto-installed slash command', () => {
    const startIdx = README_TEMPLATE.indexOf('## Multi-spec products');
    const after = README_TEMPLATE.slice(startIdx);
    const nextHeadingIdx = after.indexOf('\n## ', '## Multi-spec products'.length);
    const section = nextHeadingIdx === -1 ? after : after.slice(0, nextHeadingIdx);
    expect(section).toContain('/scope-project');
    expect(section).toContain('factory-runtime run-sequence');
    expect(section).toContain('.claude/commands/scope-project.md');
    expect(section).toContain('factory init');
  });

  test('readScopeProjectCommandTemplate resolves the bundled markdown source', () => {
    const contents = readScopeProjectCommandTemplate();
    expect(typeof contents).toBe('string');
    expect(contents.length).toBeGreaterThan(0);
    expect(contents).toContain('Scope the following product description: $ARGUMENTS');
    expect(contents).toContain('## Step 1: Decompose');
    expect(contents).toContain('## Step 2: Generate specs');
    expect(contents).toContain('## Step 3: Self-check');
    expect(contents).toContain('## Step 4: Report');
  });

  test('readScopeProjectCommandTemplate returns content matching the canonical packages/core/commands/scope-project.md', () => {
    const canonical = readFileSync(
      join(import.meta.dir, '..', 'commands', 'scope-project.md'),
      'utf8',
    );
    expect(readScopeProjectCommandTemplate()).toBe(canonical);
  });

  test('PACKAGE_JSON_TEMPLATE.scripts has the four canonical entries', () => {
    expect(PACKAGE_JSON_TEMPLATE.scripts).toEqual({
      typecheck: 'tsc --noEmit',
      test: 'bun test src',
      check: 'biome check --no-errors-on-unmatched',
      build: 'tsc -p tsconfig.build.json',
    });
    // Insertion-order ⇒ JSON.stringify order matches the natural CI sequence.
    expect(Object.keys(PACKAGE_JSON_TEMPLATE.scripts)).toEqual([
      'typecheck',
      'test',
      'check',
      'build',
    ]);
  });

  test('PACKAGE_JSON_TEMPLATE.devDependencies includes @biomejs/biome at the canonical version range', () => {
    expect(PACKAGE_JSON_TEMPLATE.devDependencies['@biomejs/biome']).toBe('^2.4.4');
    expect(PACKAGE_JSON_TEMPLATE.devDependencies.typescript).toBe('^5.6.0');
  });

  test('BIOME_JSON_TEMPLATE has the minimal canonical shape', () => {
    expect(BIOME_JSON_TEMPLATE.$schema).toBe('https://biomejs.dev/schemas/2.4.4/schema.json');
    expect(BIOME_JSON_TEMPLATE.linter).toEqual({ enabled: true, rules: { recommended: true } });
    expect(BIOME_JSON_TEMPLATE.formatter).toEqual({
      enabled: true,
      indentStyle: 'space',
      indentWidth: 2,
      lineWidth: 100,
    });
    expect(BIOME_JSON_TEMPLATE.files).toEqual({
      includes: ['src/**/*.ts', 'src/**/*.tsx'],
    });
  });

  test('BIOME_JSON_TEMPLATE uses the includes key matching the pinned Biome major', () => {
    // Spec S-1: schema major must stay in lockstep with @biomejs/biome major.
    // Today: pin = ^2.4.4 → Biome 2.x → key = `includes` (NOT `include`, which
    // was the Biome 1.x spelling). Regression-pin the keys explicitly so any
    // future drift surfaces in this test, not at user-side `pnpm check` time.
    const keys = Object.keys(BIOME_JSON_TEMPLATE);
    expect(keys).toEqual(['$schema', 'linter', 'formatter', 'files']);
    expect(BIOME_JSON_TEMPLATE.files).toHaveProperty('includes');
    expect(BIOME_JSON_TEMPLATE.files).not.toHaveProperty('include');
    // Schema URL major matches the pinned biome major.
    const biomePin = PACKAGE_JSON_TEMPLATE.devDependencies['@biomejs/biome'];
    const biomeMajor = biomePin.replace(/^\^/, '').split('.')[0];
    expect(BIOME_JSON_TEMPLATE.$schema).toContain(`/schemas/${biomeMajor}.`);
  });

  test('FACTORY_CONFIG_TEMPLATE includes dod.template derived from package.json scripts', () => {
    // Spec S-3: dod.template is `string[]`; entries are literal-command DoD
    // bullets backed by the scaffold's typecheck/test/check scripts. Order
    // matches PACKAGE_JSON_TEMPLATE.scripts (typecheck → test → check); `build`
    // is intentionally excluded (publish prereq, not a DoD gate).
    expect(FACTORY_CONFIG_TEMPLATE.dod).toBeDefined();
    expect(FACTORY_CONFIG_TEMPLATE.dod.template).toEqual([
      'typecheck clean (`pnpm typecheck`)',
      'tests green (`pnpm test`)',
      'biome clean (`pnpm check`)',
    ]);
    // Each entry embeds the literal shell command in backticks (v0.0.13
    // spec/dod-needs-explicit-command lint contract).
    for (const entry of FACTORY_CONFIG_TEMPLATE.dod.template) {
      expect(entry).toMatch(/`pnpm (typecheck|test|check)`/);
    }
    // Three entries map 1:1 to the typecheck/test/check scripts; `build` is
    // intentionally excluded.
    expect(FACTORY_CONFIG_TEMPLATE.dod.template).toHaveLength(3);
    const scriptNames = Object.keys(PACKAGE_JSON_TEMPLATE.scripts);
    expect(scriptNames).toContain('typecheck');
    expect(scriptNames).toContain('test');
    expect(scriptNames).toContain('check');
    expect(scriptNames).toContain('build');
    // build is NOT in the DoD template.
    expect(FACTORY_CONFIG_TEMPLATE.dod.template.join('\n')).not.toContain('pnpm build');
  });
});

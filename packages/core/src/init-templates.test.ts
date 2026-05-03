import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GITIGNORE_TEMPLATE,
  PACKAGE_JSON_TEMPLATE,
  README_TEMPLATE,
  TSCONFIG_TEMPLATE,
} from './init-templates.js';

describe('init-templates', () => {
  test('PACKAGE_JSON_TEMPLATE has the expected keys + workspace-stripped semver deps', () => {
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-core']).toBe('^0.0.7');
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-runtime']).toBe('^0.0.7');
    expect(PACKAGE_JSON_TEMPLATE.dependencies['@wifo/factory-context']).toBe('^0.0.7');
    expect(PACKAGE_JSON_TEMPLATE.type).toBe('module');
    expect(PACKAGE_JSON_TEMPLATE.private).toBe(true);
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

  test('README_TEMPLATE has a {{name}} placeholder and lacks the v0.0.4 caveat', () => {
    expect(README_TEMPLATE).toContain('{{name}}');
    expect(README_TEMPLATE).not.toContain('v0.0.4 caveat');
    expect(README_TEMPLATE).not.toContain('not yet published to npm');
    expect(README_TEMPLATE).not.toContain('monorepo-only');
    expect(README_TEMPLATE).toContain('factory spec lint');
    expect(README_TEMPLATE).toContain('factory-runtime run');
  });
});

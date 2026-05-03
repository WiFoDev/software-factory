import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const SLASH_COMMAND = resolve(REPO_ROOT, 'docs/commands/scope-project.md');
const CORE_README = resolve(REPO_ROOT, 'packages/core/README.md');

describe('/scope-project slash command source', () => {
  test('docs/commands/scope-project.md exists and contains the required structural sections', () => {
    expect(existsSync(SLASH_COMMAND)).toBe(true);
    const source = readFileSync(SLASH_COMMAND, 'utf8');
    expect(source).toContain('Scope the following product description: $ARGUMENTS');
    expect(source).toContain('## Step 1: Decompose');
    expect(source).toContain('## Step 2: Generate specs');
    expect(source).toContain('## Step 3: Self-check');
    expect(source).toContain('factory spec lint');
  });

  test('source file documents status assignment + depends-on rules', () => {
    const source = readFileSync(SLASH_COMMAND, 'utf8');
    expect(source).toContain('status: ready');
    expect(source).toContain('status: drafting');
    expect(source).toContain('depends-on');
    // The first-ready / rest-drafting rule is documented somewhere.
    expect(source).toMatch(/FIRST.*ready/i);
  });

  test('source file enumerates the kebab-case id pattern', () => {
    const source = readFileSync(SLASH_COMMAND, 'utf8');
    expect(source).toContain('^[a-z][a-z0-9-]*$');
  });

  test('source file documents the per-feature sweet spot and decomposition discipline', () => {
    const source = readFileSync(SLASH_COMMAND, 'utf8');
    expect(source).toMatch(/50.*200 LOC/);
    expect(source).toMatch(/dependency boundar/);
  });
});

describe('packages/core/README.md documents /scope-project', () => {
  test('README mentions /scope-project install + invocation', () => {
    const source = readFileSync(CORE_README, 'utf8');
    expect(source).toContain('/scope-project');
    // Install snippet of some form (cp / symlink to ~/.claude/commands/).
    expect(source).toMatch(/~\/\.claude\/commands\/scope-project\.md/);
  });
});

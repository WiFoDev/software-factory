import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const SLASH_COMMAND = resolve(REPO_ROOT, 'packages/core/commands/scope-project.md');
const LEGACY_SLASH_COMMAND = resolve(REPO_ROOT, 'docs/commands/scope-project.md');
const REPO_SYMLINK = resolve(REPO_ROOT, '.claude/commands/scope-project.md');
const CORE_PKG_JSON = resolve(REPO_ROOT, 'packages/core/package.json');
const CORE_README = resolve(REPO_ROOT, 'packages/core/README.md');

describe('/scope-project slash command source', () => {
  test('canonical slash command source lives at packages/core/commands/scope-project.md', () => {
    expect(existsSync(SLASH_COMMAND)).toBe(true);
    const source = readFileSync(SLASH_COMMAND, 'utf8');
    expect(source).toContain('Scope the following product description: $ARGUMENTS');
    expect(source).toContain('## Step 1: Decompose');
    expect(source).toContain('## Step 2: Generate specs');
    expect(source).toContain('## Step 3: Self-check');
    expect(source).toContain('## Step 4: Report');
    expect(source).toContain('factory spec lint');
    // Plain markdown — no YAML frontmatter wrapping the content.
    expect(source.startsWith('---')).toBe(false);
  });

  test('in-repo .claude/commands/scope-project.md symlink resolves to packages/core/commands/', () => {
    const target = readlinkSync(REPO_SYMLINK);
    expect(target.endsWith('packages/core/commands/scope-project.md')).toBe(true);
    // The symlink content matches the canonical source byte-for-byte.
    const viaSymlink = readFileSync(REPO_SYMLINK, 'utf8');
    const viaCanonical = readFileSync(SLASH_COMMAND, 'utf8');
    expect(viaSymlink).toBe(viaCanonical);
  });

  test('docs/commands/scope-project.md no longer exists', () => {
    expect(existsSync(LEGACY_SLASH_COMMAND)).toBe(false);
  });

  test('packages/core/package.json files glob includes commands', () => {
    const pkg = JSON.parse(readFileSync(CORE_PKG_JSON, 'utf8')) as { files?: string[] };
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain('commands');
    // Existing entries preserved alongside.
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('LICENSE');
    expect(pkg.files).toContain('README.md');
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

  test('scope-project source contains HTTP entrypoint smoke-boot guidance subsection', () => {
    const source = readFileSync(SLASH_COMMAND, 'utf8');
    expect(source).toContain('### HTTP entrypoint smoke-boot scenarios');
    // The subsection lives inside Step 2 (Generate specs).
    const step2Index = source.indexOf('## Step 2: Generate specs');
    const step3Index = source.indexOf('## Step 3:');
    const subsectionIndex = source.indexOf('### HTTP entrypoint smoke-boot scenarios');
    expect(step2Index).toBeGreaterThan(-1);
    expect(step3Index).toBeGreaterThan(-1);
    expect(subsectionIndex).toBeGreaterThan(step2Index);
    expect(subsectionIndex).toBeLessThan(step3Index);
  });

  test('scope-project sources smoke-boot worked example references src/main.test.ts with verb-matching test title', () => {
    const source = readFileSync(SLASH_COMMAND, 'utf8');
    // The worked example scenario name + matching test title use the verb "boots".
    expect(source).toContain('boots the production entrypoint on the configured port');
    expect(source).toContain(
      'test: src/main.test.ts "boots the production entrypoint on the configured port"',
    );
    // The worked example mentions the canonical entrypoint path.
    expect(source).toMatch(/`bun src\/main\.ts`/);
  });

  test('scope-project source enumerates HTTP entrypoint trigger keywords', () => {
    const source = readFileSync(SLASH_COMMAND, 'utf8');
    // Each trigger keyword is shown in a backtick code-span for clarity.
    expect(source).toContain('`createServer`');
    expect(source).toContain('`listen(<port>)`');
    expect(source).toContain('`app.listen`');
    expect(source).toContain('`http.createServer`');
    expect(source).toContain('`Bun.serve`');
    expect(source).toContain('`serve(`');
  });

  test('scope-project source documents dod.template precedence over canonical defaults', () => {
    // v0.0.13 — `/scope-project` reads `factory.config.json.dod.template` and
    // emits it as the body of every generated spec's `## Definition of Done`.
    // The slash-command source must document this precedence so a future
    // model running this slash command knows to prefer the per-project
    // template over the canonical typecheck/test/check defaults.
    const source = readFileSync(SLASH_COMMAND, 'utf8');
    expect(source).toContain('factory.config.json');
    expect(source).toContain('dod.template');
    // The fallback path is documented when the field is missing/empty.
    expect(source).toMatch(/(canonical defaults|fall back)/i);
    // Precedence guidance lives inside Step 2 (Generate specs) so the model
    // sees it while writing the DoD section.
    const step2Index = source.indexOf('## Step 2: Generate specs');
    const step3Index = source.indexOf('## Step 3:');
    const dodTemplateIndex = source.indexOf('dod.template');
    expect(step2Index).toBeGreaterThan(-1);
    expect(step3Index).toBeGreaterThan(-1);
    expect(dodTemplateIndex).toBeGreaterThan(step2Index);
    expect(dodTemplateIndex).toBeLessThan(step3Index);
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

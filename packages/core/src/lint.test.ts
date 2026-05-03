import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lintSpec, lintSpecFile } from './lint';

const REPO_ROOT = resolve(import.meta.dir, '../../..');

const validSpec = (): string =>
  [
    '---',
    'id: demo-1',
    'classification: light',
    'type: feat',
    'status: ready',
    '---',
    '',
    '## Scenarios',
    '**S-1** — happy',
    '  Given a',
    '  When b',
    '  Then c',
    '  Satisfaction:',
    '    - test: src/foo.test.ts',
    '',
  ].join('\n');

describe('lintSpec', () => {
  test('returns no errors for a clean spec', () => {
    expect(lintSpec(validSpec())).toEqual([]);
  });

  test('reports missing frontmatter id', () => {
    const broken = validSpec().replace('id: demo-1\n', '');
    const errs = lintSpec(broken, { filename: 'docs/specs/example.md' });
    const missing = errs.find((e) => e.code === 'frontmatter/missing-field');
    expect(missing).toBeDefined();
    if (!missing) return;
    expect(missing.message).toContain('id');
    expect(missing.file).toBe('docs/specs/example.md');
    expect(typeof missing.line).toBe('number');
    expect(missing.severity).toBe('error');
  });

  test('reports invalid enum value', () => {
    const broken = validSpec().replace('classification: light', 'classification: medium');
    const errs = lintSpec(broken);
    const invalid = errs.find((e) => e.code === 'frontmatter/invalid-enum');
    expect(invalid).toBeDefined();
    if (!invalid) return;
    expect(invalid.message).toContain('classification');
  });

  test('warns on unknown frontmatter field but does not fail-error', () => {
    const broken = validSpec().replace('status: ready\n', 'status: ready\nowner: wifo\n');
    const errs = lintSpec(broken);
    const unknown = errs.find((e) => e.code === 'frontmatter/unknown-field');
    expect(unknown).toBeDefined();
    if (!unknown) return;
    expect(unknown.severity).toBe('warning');
    expect(unknown.message).toContain('owner');
  });

  test('scenario without test satisfaction', () => {
    const broken = validSpec().replace('  Satisfaction:\n    - test: src/foo.test.ts\n', '');
    const errs = lintSpec(broken);
    const missing = errs.find((e) => e.code === 'scenario/missing-test');
    expect(missing).toBeDefined();
    if (!missing) return;
    expect(missing.message).toContain('S-1');
    expect(missing.severity).toBe('error');
  });

  test('scenario missing Given/When/Then', () => {
    const broken = [
      '---',
      'id: demo-2',
      'classification: light',
      'type: feat',
      'status: ready',
      '---',
      '## Scenarios',
      '**S-1** — empty',
      '  Satisfaction:',
      '    - test: x',
    ].join('\n');
    const errs = lintSpec(broken);
    expect(errs.some((e) => e.code === 'scenario/missing-given')).toBe(true);
    expect(errs.some((e) => e.code === 'scenario/missing-when')).toBe(true);
    expect(errs.some((e) => e.code === 'scenario/missing-then')).toBe(true);
  });

  test('warns when Scenarios section is empty', () => {
    const broken = [
      '---',
      'id: demo-3',
      'classification: light',
      'type: feat',
      'status: ready',
      '---',
      '## Scenarios',
      '',
      '## Definition of Done',
      '- ok',
    ].join('\n');
    const errs = lintSpec(broken);
    const empty = errs.find((e) => e.code === 'scenarios/empty-section');
    expect(empty).toBeDefined();
    if (!empty) return;
    expect(empty.severity).toBe('warning');
  });

  test('holdouts do not require test satisfaction', () => {
    const sample = [
      '---',
      'id: demo-h',
      'classification: deep',
      'type: feat',
      'status: ready',
      '---',
      '## Scenarios',
      '**S-1** — visible',
      '  Given a',
      '  When b',
      '  Then c',
      '  Satisfaction:',
      '    - test: x',
      '',
      '## Holdout Scenarios',
      '**H-1** — secret',
      '  Given a',
      '  When b',
      '  Then c',
    ].join('\n');
    const errs = lintSpec(sample);
    expect(errs).toEqual([]);
  });

  test('handles malformed YAML without throwing', () => {
    const broken = ['---', 'id: [unclosed', '---', 'body'].join('\n');
    const errs = lintSpec(broken);
    expect(errs.some((e) => e.code === 'frontmatter/yaml')).toBe(true);
  });

  test('lintSpec emits spec/invalid-depends-on for non-kebab-case entries', () => {
    const broken = validSpec().replace(
      'status: ready\n',
      'status: ready\ndepends-on:\n  - GoodId\n  - 1starts-with-digit\n  - good-one\n',
    );
    const errs = lintSpec(broken);
    const invalid = errs.filter((e) => e.code === 'spec/invalid-depends-on');
    expect(invalid).toHaveLength(2);
    expect(invalid[0]?.message).toContain("depends-on[0]: 'GoodId'");
    expect(invalid[0]?.severity).toBe('error');
    expect(invalid[1]?.message).toContain("depends-on[1]: '1starts-with-digit'");
  });

  test('lintSpec accepts kebab-case depends-on entries without error', () => {
    const ok = validSpec().replace(
      'status: ready\n',
      'status: ready\ndepends-on:\n  - good-id\n  - also-good\n',
    );
    const errs = lintSpec(ok);
    expect(errs.filter((e) => e.code === 'spec/invalid-depends-on')).toHaveLength(0);
  });

  test('lintSpec with empty depends-on emits no error', () => {
    const ok = validSpec().replace('status: ready\n', 'status: ready\ndepends-on: []\n');
    const errs = lintSpec(ok);
    expect(errs).toEqual([]);
  });

  test('lintSpec with cwd option warns when depends-on entry has no matching file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-deps-'));
    try {
      mkdirSync(join(dir, 'docs', 'specs'), { recursive: true });
      const parent = validSpec().replace(
        'status: ready\n',
        'status: ready\ndepends-on:\n  - missing-dep\n',
      );
      writeFileSync(join(dir, 'docs', 'specs', 'parent.md'), parent);
      const errs = lintSpec(parent, { cwd: dir });
      const warning = errs.find((e) => e.code === 'spec/depends-on-missing');
      expect(warning).toBeDefined();
      if (!warning) return;
      expect(warning.severity).toBe('warning');
      expect(warning.message).toContain("'missing-dep'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lintSpec with cwd option finds dep under docs/specs/done/ subdirectory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-deps-'));
    try {
      mkdirSync(join(dir, 'docs', 'specs', 'done'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'specs', 'done', 'child.md'), validSpec());
      const parent = validSpec().replace(
        'status: ready\n',
        'status: ready\ndepends-on:\n  - child\n',
      );
      const errs = lintSpec(parent, { cwd: dir });
      expect(errs.filter((e) => e.code === 'spec/depends-on-missing')).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lintSpec with cwd option finds dep under active docs/specs/ directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-deps-'));
    try {
      mkdirSync(join(dir, 'docs', 'specs'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'specs', 'child.md'), validSpec());
      const parent = validSpec().replace(
        'status: ready\n',
        'status: ready\ndepends-on:\n  - child\n',
      );
      const errs = lintSpec(parent, { cwd: dir });
      expect(errs.filter((e) => e.code === 'spec/depends-on-missing')).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lintSpec without cwd option does not check file existence', () => {
    const parent = validSpec().replace(
      'status: ready\n',
      'status: ready\ndepends-on:\n  - any-name\n',
    );
    const errs = lintSpec(parent);
    expect(errs.filter((e) => e.code === 'spec/depends-on-missing')).toHaveLength(0);
  });

  test('lintSpec skips file existence check for entries that fail id-format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-deps-'));
    try {
      mkdirSync(join(dir, 'docs', 'specs'), { recursive: true });
      const parent = validSpec().replace(
        'status: ready\n',
        'status: ready\ndepends-on:\n  - BadId\n',
      );
      const errs = lintSpec(parent, { cwd: dir });
      // Only the id-format error fires; no missing-file warning for invalid ids.
      expect(errs.some((e) => e.code === 'spec/invalid-depends-on')).toBe(true);
      expect(errs.some((e) => e.code === 'spec/depends-on-missing')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('lintSpecFile', () => {
  test('reads a file and lints it with default cwd inferred', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-file-'));
    try {
      mkdirSync(join(dir, 'docs', 'specs'), { recursive: true });
      const filePath = join(dir, 'docs', 'specs', 'demo.md');
      writeFileSync(filePath, validSpec());
      expect(lintSpecFile(filePath)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lintSpecFile resolves dep files relative to inferred cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-file-'));
    try {
      mkdirSync(join(dir, 'docs', 'specs'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'specs', 'child.md'), validSpec());
      const parent = validSpec().replace(
        'status: ready\n',
        'status: ready\ndepends-on:\n  - child\n',
      );
      const parentPath = join(dir, 'docs', 'specs', 'parent.md');
      writeFileSync(parentPath, parent);
      const errs = lintSpecFile(parentPath);
      expect(errs.filter((e) => e.code === 'spec/depends-on-missing')).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('lintSpec — SPEC_TEMPLATE remains canonical', () => {
  test('SPEC_TEMPLATE.md is canonical (lints clean)', () => {
    // The SPEC_TEMPLATE.md file documents the format using fenced code blocks
    // — it is NOT itself a spec. Build a representative spec from the
    // template's example and assert it lints clean. This guards against the
    // schema drifting from the documented shape.
    const template = readFileSync(resolve(REPO_ROOT, 'docs/SPEC_TEMPLATE.md'), 'utf8');
    expect(template).toContain('id: <ticket-or-slug>');
    expect(template).toContain('classification: light | deep');
    expect(template).toContain('## Scenarios');
    expect(template).toContain('Given <state>');
    expect(template).toContain('When <action>');
    expect(template).toContain('Then <observable outcome>');

    // A minimal spec that follows the template's shape must lint clean.
    const sample = [
      '---',
      'id: example',
      'classification: light',
      'type: feat',
      'status: ready',
      '---',
      '',
      '## Intent',
      'do x for y',
      '',
      '## Scenarios',
      '**S-1** — golden',
      '  Given a',
      '  When b',
      '  Then c',
      '  Satisfaction:',
      '    - test: src/foo.test.ts',
      '',
      '## Definition of Done',
      '- tests green',
      '',
    ].join('\n');
    expect(lintSpec(sample)).toEqual([]);
  });
});

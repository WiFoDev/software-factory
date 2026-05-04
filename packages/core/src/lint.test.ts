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

  test('lintSpec wide-blast-radius threshold is 12 not 8', () => {
    // 11 distinct paths — below the v0.0.10 threshold of 12, so NO warning
    // (under the v0.0.9 threshold of 8 this would have fired).
    const elevenPaths = [
      '---',
      'id: demo-11',
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
      '## Subtasks',
      '- T1 — `packages/core/src/a.ts`',
      '- T2 — `packages/core/src/b.ts`',
      '- T3 — `packages/core/src/c.ts`',
      '- T4 — `packages/core/src/d.ts`',
      '- T5 — `packages/core/src/e.ts`',
      '- T6 — `packages/core/src/f.ts`',
      '- T7 — `packages/core/src/g.ts`',
      '- T8 — `packages/core/src/h.ts`',
      '- T9 — `packages/core/src/i.ts`',
      '- T10 — `packages/core/src/j.ts`',
      '- T11 — `packages/core/src/k.ts`',
      '',
    ].join('\n');
    const errs = lintSpec(elevenPaths);
    expect(errs.filter((e) => e.code === 'spec/wide-blast-radius')).toHaveLength(0);
  });

  test('lintSpec emits warning at exactly 12 paths', () => {
    const twelvePaths = [
      '---',
      'id: demo-12',
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
      '## Subtasks',
      '- T1 — `packages/core/src/a.ts`',
      '- T2 — `packages/core/src/b.ts`',
      '- T3 — `packages/core/src/c.ts`',
      '- T4 — `packages/core/src/d.ts`',
      '- T5 — `packages/core/src/e.ts`',
      '- T6 — `packages/core/src/f.ts`',
      '- T7 — `packages/core/src/g.ts`',
      '- T8 — `packages/core/src/h.ts`',
      '- T9 — `packages/core/src/i.ts`',
      '- T10 — `packages/core/src/j.ts`',
      '- T11 — `packages/core/src/k.ts`',
      '- T12 — `packages/core/src/l.ts`',
      '',
    ].join('\n');
    const errs = lintSpec(twelvePaths);
    const warnings = errs.filter((e) => e.code === 'spec/wide-blast-radius');
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    if (!w) return;
    expect(w.severity).toBe('warning');
    expect(w.message).toBe(
      '## Subtasks references 12 distinct file paths; specs touching >= 12 files commonly exceed the 600s implement-phase budget. Consider splitting or setting agent-timeout-ms in frontmatter.',
    );
  });

  test('NOQA directive suppresses wide-blast-radius warning', () => {
    const sample = [
      '---',
      'id: demo-noqa-wbr',
      'classification: light',
      'type: feat',
      'status: ready',
      '---',
      '',
      '<!-- NOQA: spec/wide-blast-radius -->',
      '',
      '## Scenarios',
      '**S-1** — happy',
      '  Given a',
      '  When b',
      '  Then c',
      '  Satisfaction:',
      '    - test: src/foo.test.ts',
      '',
      '## Subtasks',
      '- T1 — `packages/core/src/a.ts`',
      '- T2 — `packages/core/src/b.ts`',
      '- T3 — `packages/core/src/c.ts`',
      '- T4 — `packages/core/src/d.ts`',
      '- T5 — `packages/core/src/e.ts`',
      '- T6 — `packages/core/src/f.ts`',
      '- T7 — `packages/core/src/g.ts`',
      '- T8 — `packages/core/src/h.ts`',
      '- T9 — `packages/core/src/i.ts`',
      '- T10 — `packages/core/src/j.ts`',
      '- T11 — `packages/core/src/k.ts`',
      '- T12 — `packages/core/src/l.ts`',
      '- T13 — `packages/core/src/m.ts`',
      '- T14 — `packages/core/src/n.ts`',
      '- T15 — `packages/core/src/o.ts`',
      '- T16 — `packages/core/src/p.ts`',
      '- T17 — `packages/core/src/q.ts`',
      '- T18 — `packages/core/src/r.ts`',
      '',
    ].join('\n');
    const errs = lintSpec(sample);
    expect(errs.filter((e) => e.code === 'spec/wide-blast-radius')).toHaveLength(0);
  });

  test('NOQA is per-code (different code does not suppress)', () => {
    const sample = [
      '---',
      'id: demo-noqa-other',
      'classification: light',
      'type: feat',
      'status: ready',
      '---',
      '',
      '<!-- NOQA: spec/different-code -->',
      '',
      '## Scenarios',
      '**S-1** — happy',
      '  Given a',
      '  When b',
      '  Then c',
      '  Satisfaction:',
      '    - test: src/foo.test.ts',
      '',
      '## Subtasks',
      '- T1 — `packages/core/src/a.ts`',
      '- T2 — `packages/core/src/b.ts`',
      '- T3 — `packages/core/src/c.ts`',
      '- T4 — `packages/core/src/d.ts`',
      '- T5 — `packages/core/src/e.ts`',
      '- T6 — `packages/core/src/f.ts`',
      '- T7 — `packages/core/src/g.ts`',
      '- T8 — `packages/core/src/h.ts`',
      '- T9 — `packages/core/src/i.ts`',
      '- T10 — `packages/core/src/j.ts`',
      '- T11 — `packages/core/src/k.ts`',
      '- T12 — `packages/core/src/l.ts`',
      '',
    ].join('\n');
    const errs = lintSpec(sample);
    // Different-code NOQA does NOT suppress wide-blast-radius — it still fires.
    expect(errs.filter((e) => e.code === 'spec/wide-blast-radius')).toHaveLength(1);
  });

  test('blank NOQA suppresses all spec warnings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-noqa-blanket-'));
    try {
      mkdirSync(join(dir, 'docs', 'specs'), { recursive: true });
      // Spec with TWO spec/* warnings: wide-blast-radius (>=12 paths) AND
      // depends-on-missing (entry that does not resolve under cwd).
      const sample = [
        '---',
        'id: demo-noqa-blanket',
        'classification: light',
        'type: feat',
        'status: ready',
        'depends-on:',
        '  - missing-dep-noqa',
        '---',
        '',
        '<!-- NOQA -->',
        '',
        '## Scenarios',
        '**S-1** — happy',
        '  Given a',
        '  When b',
        '  Then c',
        '  Satisfaction:',
        '    - test: src/foo.test.ts',
        '',
        '## Subtasks',
        '- T1 — `packages/core/src/a.ts`',
        '- T2 — `packages/core/src/b.ts`',
        '- T3 — `packages/core/src/c.ts`',
        '- T4 — `packages/core/src/d.ts`',
        '- T5 — `packages/core/src/e.ts`',
        '- T6 — `packages/core/src/f.ts`',
        '- T7 — `packages/core/src/g.ts`',
        '- T8 — `packages/core/src/h.ts`',
        '- T9 — `packages/core/src/i.ts`',
        '- T10 — `packages/core/src/j.ts`',
        '- T11 — `packages/core/src/k.ts`',
        '- T12 — `packages/core/src/l.ts`',
        '',
      ].join('\n');
      writeFileSync(join(dir, 'docs', 'specs', 'demo.md'), sample);
      const errs = lintSpec(sample, { cwd: dir });
      expect(errs.filter((e) => e.code === 'spec/wide-blast-radius')).toHaveLength(0);
      expect(errs.filter((e) => e.code === 'spec/depends-on-missing')).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lintSpec emits spec/wide-blast-radius regardless of agent-timeout-ms declaration', () => {
    const sample = [
      '---',
      'id: demo-timeout-set',
      'classification: light',
      'type: feat',
      'status: ready',
      'agent-timeout-ms: 1800000',
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
      '## Subtasks',
      '- T1 — `packages/core/src/a.ts`',
      '- T2 — `packages/core/src/b.ts`',
      '- T3 — `packages/core/src/c.ts`',
      '- T4 — `packages/core/src/d.ts`',
      '- T5 — `packages/core/src/e.ts`',
      '- T6 — `packages/runtime/src/f.ts`',
      '- T7 — `packages/runtime/src/g.ts`',
      '- T8 — `packages/runtime/src/h.ts`',
      '- T9 — `packages/runtime/src/i.ts`',
      '- T10 — `packages/runtime/src/j.ts`',
      '- T11 — `packages/runtime/src/k.ts`',
      '- T12 — `packages/runtime/src/l.ts`',
      '',
    ].join('\n');
    const errs = lintSpec(sample);
    const warnings = errs.filter((e) => e.code === 'spec/wide-blast-radius');
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    if (!w) return;
    expect(w.message).toContain('12 distinct file paths');
  });

  test('wide-blast-radius scanner detects backtick-wrapped paths in Subtasks', () => {
    const sample = [
      '---',
      'id: demo-bt',
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
      '## Subtasks',
      '- T1 — touches `packages/core/src/a.ts`',
      '- T2 — touches `packages/core/src/b.ts`',
      '- T3 — touches `packages/core/src/c.ts`',
      '- T4 — touches `packages/core/src/d.ts`',
      '- T5 — touches `packages/core/src/e.ts`',
      '- T6 — touches `packages/core/src/f.ts`',
      '- T7 — touches `packages/core/src/g.ts`',
      '- T8 — touches `packages/core/src/h.ts`',
      '- T9 — touches `packages/core/src/i.ts`',
      '- T10 — touches `packages/core/src/j.ts`',
      '- T11 — touches `packages/core/src/k.ts`',
      '- T12 — touches `packages/core/src/l.ts`',
      '',
    ].join('\n');
    const errs = lintSpec(sample);
    const warnings = errs.filter((e) => e.code === 'spec/wide-blast-radius');
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    if (!w) return;
    expect(w.message).toContain('12 distinct file paths');
  });

  test('wide-blast-radius scanner detects plain-prose paths in Subtasks', () => {
    const sample = [
      '---',
      'id: demo-prose',
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
      '## Subtasks',
      '- T1 — touches packages/core/src/a.ts',
      '- T2 — touches packages/core/src/b.ts',
      '- T3 — touches packages/core/src/c.ts',
      '- T4 — touches packages/core/src/d.ts',
      '- T5 — touches packages/runtime/src/e.ts',
      '- T6 — touches packages/runtime/src/f.ts',
      '- T7 — touches packages/runtime/src/g.ts',
      '- T8 — touches packages/runtime/src/h.ts',
      '- T9 — touches packages/runtime/src/i.ts',
      '- T10 — touches docs/specs/f.md',
      '- T11 — touches README.md and CHANGELOG.md',
      '- T12 — touches BACKLOG.md',
      '',
    ].join('\n');
    const errs = lintSpec(sample);
    const warnings = errs.filter((e) => e.code === 'spec/wide-blast-radius');
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    if (!w) return;
    expect(w.message).toContain('13 distinct file paths');
  });

  test('wide-blast-radius scanner deduplicates repeated paths', () => {
    const sample = [
      '---',
      'id: demo-dedup',
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
      '## Subtasks',
      '- T1 — touches `package.json` and again `package.json`',
      '- T2 — touches `package.json`',
      '- T3 — touches `package.json`',
      '- T4 — touches `package.json`',
      '- T5 — touches `package.json`',
      '- T6 — touches `package.json`',
      '- T7 — touches `package.json`',
      '- T8 — touches `package.json`',
      '- T9 — touches `package.json`',
      '- T10 — touches `package.json`',
      '- T11 — touches `package.json`',
      '- T12 — touches `package.json`',
      '',
    ].join('\n');
    const errs = lintSpec(sample);
    expect(errs.filter((e) => e.code === 'spec/wide-blast-radius')).toHaveLength(0);
  });

  test('wide-blast-radius scanner returns 0 for prose-only Subtasks', () => {
    const sample = [
      '---',
      'id: demo-prose-only',
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
      '## Subtasks',
      '- T1 — update the README',
      '- T2 — add tests',
      '- T3 — write the docs',
      '- T4 — refactor the helper',
      '- T5 — wire up the runner',
      '- T6 — fix the bug',
      '- T7 — bump version',
      '- T8 — release notes',
      '- T9 — celebrate',
      '',
    ].join('\n');
    const errs = lintSpec(sample);
    expect(errs.filter((e) => e.code === 'spec/wide-blast-radius')).toHaveLength(0);
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

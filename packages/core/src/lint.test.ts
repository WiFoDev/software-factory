import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lintSpec } from './lint';

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

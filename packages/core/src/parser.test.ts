import { describe, expect, test } from 'bun:test';
import { FrontmatterError, splitFrontmatter } from './frontmatter';
import { SpecParseError, parseSpec } from './parser';

const VALID_SPEC = [
  '---',
  'id: demo-1',
  'classification: light',
  'type: feat',
  'status: ready',
  '---',
  '',
  '# demo-1 — example spec',
  '',
  '## Intent',
  'Doing the thing.',
  '',
  '## Scenarios',
  '**S-1** — happy path',
  '  Given a state',
  '  When something happens',
  '  Then it works',
  '  Satisfaction:',
  '    - test: src/foo.test.ts "happy path"',
  '',
  '## Definition of Done',
  '- tests green',
  '',
].join('\n');

describe('splitFrontmatter', () => {
  test('splits a normal document', () => {
    const out = splitFrontmatter(VALID_SPEC);
    expect(out.fenceStartLine).toBe(1);
    expect(out.yamlStartLine).toBe(2);
    expect(out.bodyStartLine).toBe(7);
    expect(out.yaml).toContain('id: demo-1');
    expect(out.body.startsWith('\n# demo-1')).toBe(true);
  });

  test('throws when the document does not start with `---`', () => {
    expect(() => splitFrontmatter('# Not a spec\n')).toThrow(FrontmatterError);
  });

  test('throws when the closing fence is missing', () => {
    const broken = '---\nid: demo\nclassification: light\n# no close';
    expect(() => splitFrontmatter(broken)).toThrow(FrontmatterError);
  });

  test('skips leading blank lines before the opening fence', () => {
    const out = splitFrontmatter(
      '\n\n---\nid: demo\nclassification: light\ntype: feat\nstatus: ready\n---\nbody',
    );
    expect(out.fenceStartLine).toBe(3);
  });
});

describe('parseSpec', () => {
  test('parses a complete spec', () => {
    const spec = parseSpec(VALID_SPEC, { filename: 'demo.md' });
    expect(spec.frontmatter.id).toBe('demo-1');
    expect(spec.frontmatter.classification).toBe('light');
    expect(spec.scenarios).toHaveLength(1);
    expect(spec.holdouts).toHaveLength(0);
    expect(spec.raw.filename).toBe('demo.md');
  });

  test('parseSpec exposes depends-on on frontmatter (defaults to empty array)', () => {
    const spec = parseSpec(VALID_SPEC, { filename: 'demo.md' });
    expect(spec.frontmatter['depends-on']).toEqual([]);
  });

  test('parseSpec exposes depends-on on frontmatter (populated)', () => {
    const withDeps = VALID_SPEC.replace(
      'status: ready\n',
      'status: ready\ndepends-on:\n  - foo-bar\n  - baz-qux\n',
    );
    const spec = parseSpec(withDeps, { filename: 'demo.md' });
    expect(spec.frontmatter['depends-on']).toEqual(['foo-bar', 'baz-qux']);
  });

  test('throws SpecParseError on schema failure with line pointing into YAML block', () => {
    const broken = VALID_SPEC.replace('id: demo-1\n', '');
    let caught: SpecParseError | null = null;
    try {
      parseSpec(broken);
    } catch (err) {
      caught = err as SpecParseError;
    }
    expect(caught).toBeInstanceOf(SpecParseError);
    if (!caught) return;
    expect(caught.issues.some((i) => i.code.startsWith('frontmatter/'))).toBe(true);
    expect(caught.issues.every((i) => typeof i.line === 'number' && i.line >= 1)).toBe(true);
  });

  test('throws SpecParseError on malformed YAML with line number from YAML', () => {
    const broken = ['---', 'id: demo', 'classification: [unclosed', '---', 'body'].join('\n');
    let caught: SpecParseError | null = null;
    try {
      parseSpec(broken);
    } catch (err) {
      caught = err as SpecParseError;
    }
    expect(caught).toBeInstanceOf(SpecParseError);
    if (!caught) return;
    expect(caught.issues[0]?.code).toBe('frontmatter/yaml');
  });

  test('throws SpecParseError when frontmatter is missing entirely', () => {
    expect(() => parseSpec('# just a body\n')).toThrow(SpecParseError);
  });

  test('returns empty scenarios when no Scenarios section is present', () => {
    const noScenarios = [
      '---',
      'id: demo-2',
      'classification: light',
      'type: feat',
      'status: ready',
      '---',
      '# Body',
    ].join('\n');
    const spec = parseSpec(noScenarios);
    expect(spec.scenarios).toEqual([]);
  });

  test('parses both scenarios and holdouts', () => {
    const both = [
      '---',
      'id: demo-3',
      'classification: deep',
      'type: feat',
      'status: ready',
      '---',
      '## Scenarios',
      '**S-1** — visible',
      '  Given a',
      '  When b',
      '  Then c',
      '',
      '## Holdout Scenarios',
      '**H-1** — secret',
      '  Given d',
      '  When e',
      '  Then f',
    ].join('\n');
    const spec = parseSpec(both);
    expect(spec.scenarios.map((s) => s.id)).toEqual(['S-1']);
    expect(spec.holdouts.map((s) => s.id)).toEqual(['H-1']);
  });
});

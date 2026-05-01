import { describe, expect, test } from 'bun:test';
import { parseSpec } from '@wifo/factory-core';
import { sliceSections } from './slice-sections.js';

const FRONTMATTER = [
  '---',
  'id: demo',
  'classification: light',
  'type: feat',
  'status: ready',
  '---',
  '',
].join('\n');

function build(body: string): string {
  return FRONTMATTER + body;
}

describe('sliceSections', () => {
  test('extracts all 4 main sections + scenarios with absolute heading lines', () => {
    const source = build(
      [
        '# title',
        '',
        '## Intent',
        'do a thing.',
        '',
        '## Constraints / Decisions',
        '- one',
        '- two',
        '',
        '## Scenarios',
        '**S-1** — happy',
        '  Given x',
        '  When y',
        '  Then z',
        '  Satisfaction:',
        '    - test: src/foo.test.ts',
        '',
        '## Subtasks',
        '- T1 — do it',
        '',
        '## Definition of Done',
        '- all tests pass',
      ].join('\n'),
    );
    const spec = parseSpec(source);
    const sliced = sliceSections(spec);
    expect(sliced.intent).toContain('do a thing');
    expect(sliced.constraints).toContain('- one');
    expect(sliced.subtasks).toContain('T1 — do it');
    expect(sliced.dod).toContain('all tests pass');
    expect(sliced.scenarios).toContain('S-1');
    expect(typeof sliced.headingLines.intent).toBe('number');
    // Intent appears on body line 3; frontmatter is 7 lines (---, 5 fields, ---, blank);
    // body starts at source line 8. Intent = body line 3 → absolute line 10.
    expect(sliced.headingLines.intent).toBeGreaterThan(7);
  });

  test('missing section returns undefined for that key', () => {
    const source = build(
      [
        '## Intent',
        'do a thing.',
        '',
        '## Scenarios',
        '**S-1** — x',
        '  Given a',
        '  When b',
        '  Then c',
        '  Satisfaction:',
        '    - test: src/foo.test.ts',
      ].join('\n'),
    );
    const spec = parseSpec(source);
    const sliced = sliceSections(spec);
    expect(sliced.intent).toBeDefined();
    expect(sliced.dod).toBeUndefined();
    expect(sliced.headingLines.dod).toBeUndefined();
  });

  test('does NOT split on ### subheadings', () => {
    const source = build(
      [
        '## Intent',
        'do a thing.',
        '',
        '### A subheading inside intent',
        'still part of intent.',
        '',
        '## Subtasks',
        '- T1',
      ].join('\n'),
    );
    const spec = parseSpec(source);
    const sliced = sliceSections(spec);
    expect(sliced.intent).toContain('### A subheading inside intent');
    expect(sliced.intent).toContain('still part of intent');
  });

  test('fenced code block: `## Heading` inside ``` is NOT a section heading', () => {
    const source = build(
      [
        '## Intent',
        'see code:',
        '',
        '```md',
        '## Subtasks',
        '- inside the fence',
        '```',
        '',
        'real text continues.',
        '',
        '## Subtasks',
        '- T1 — real subtask',
      ].join('\n'),
    );
    const spec = parseSpec(source);
    const sliced = sliceSections(spec);
    expect(sliced.intent).toContain('see code');
    expect(sliced.intent).toContain('inside the fence');
    expect(sliced.intent).toContain('real text continues');
    expect(sliced.subtasks).toBe('- T1 — real subtask');
  });

  test('trailing whitespace on heading is tolerated', () => {
    const source = build(
      ['## Intent   ', 'with trailing spaces.', '', '## Definition of Done\t', '- ok'].join('\n'),
    );
    const spec = parseSpec(source);
    const sliced = sliceSections(spec);
    expect(sliced.intent).toContain('with trailing spaces');
    expect(sliced.dod).toBe('- ok');
  });

  test('lowercase canonical heading is NOT recognized (case-sensitive)', () => {
    const source = build(
      ['## intent', 'lowercase.', '', '## definition of done', '- ok'].join('\n'),
    );
    const spec = parseSpec(source);
    const sliced = sliceSections(spec);
    expect(sliced.intent).toBeUndefined();
    expect(sliced.dod).toBeUndefined();
  });

  test('alternative separator `## Constraints/Decisions` (no spaces) is NOT recognized', () => {
    const source = build(['## Constraints/Decisions', 'no spaces around slash.'].join('\n'));
    const spec = parseSpec(source);
    const sliced = sliceSections(spec);
    expect(sliced.constraints).toBeUndefined();
  });

  test('empty section content → key omitted (no empty string slice)', () => {
    const source = build(['## Intent', '', '## Definition of Done', '- has content'].join('\n'));
    const spec = parseSpec(source);
    const sliced = sliceSections(spec);
    expect(sliced.intent).toBeUndefined();
    expect(sliced.dod).toBe('- has content');
  });
});

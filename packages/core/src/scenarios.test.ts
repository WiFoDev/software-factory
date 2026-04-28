import { describe, expect, test } from 'bun:test';
import { findSection, parseScenarios } from './scenarios';

describe('findSection', () => {
  test('finds a section and returns its lines + heading line', () => {
    const source = ['# Title', '', '## Scenarios', 'a', 'b', '## Other', 'c'].join('\n');
    const section = findSection(source, 'Scenarios');
    expect(section).not.toBeNull();
    if (!section) return;
    expect(section.headingLine).toBe(3);
    expect(section.lines).toEqual(['a', 'b']);
  });

  test('returns null when the heading is missing', () => {
    expect(findSection('# Title\n\nbody', 'Scenarios')).toBeNull();
  });

  test('runs to EOF when no following heading exists', () => {
    const section = findSection('## Scenarios\nfoo\nbar', 'Scenarios');
    expect(section?.lines).toEqual(['foo', 'bar']);
  });
});

describe('parseScenarios', () => {
  test('parses a single well-formed scenario', () => {
    const source = [
      '## Scenarios',
      '**S-1** — happy path',
      '  Given some state',
      '  When an action occurs',
      '  Then an outcome is observed',
      '  Satisfaction:',
      '    - test: src/foo.test.ts "happy path"',
    ].join('\n');
    const section = findSection(source, 'Scenarios');
    expect(section).not.toBeNull();
    if (!section) return;
    const scenarios = parseScenarios(section, 'scenario');
    expect(scenarios).toHaveLength(1);
    const first = scenarios[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.id).toBe('S-1');
    expect(first.name).toBe('happy path');
    expect(first.given).toBe('some state');
    expect(first.when).toBe('an action occurs');
    expect(first.then).toBe('an outcome is observed');
    expect(first.line).toBe(2);
    expect(first.kind).toBe('scenario');
    expect(first.satisfaction).toHaveLength(1);
    const sat = first.satisfaction[0];
    if (!sat) return;
    expect(sat.kind).toBe('test');
    expect(sat.value).toBe('src/foo.test.ts "happy path"');
  });

  test('parses multiple scenarios', () => {
    const source = [
      '## Scenarios',
      '**S-1** — first',
      '  Given a',
      '  When b',
      '  Then c',
      '',
      '**S-2** — second',
      '  Given d',
      '  When e',
      '  Then f',
    ].join('\n');
    const section = findSection(source, 'Scenarios');
    if (!section) throw new Error('section missing');
    const scenarios = parseScenarios(section, 'scenario');
    expect(scenarios.map((s) => s.id)).toEqual(['S-1', 'S-2']);
  });

  test('joins multi-line Given continuations', () => {
    const source = [
      '## Scenarios',
      '**S-1** — multiline',
      '  Given a base state',
      '    that spans two lines',
      '    and even three',
      '  When something happens',
      '  Then nothing breaks',
    ].join('\n');
    const section = findSection(source, 'Scenarios');
    if (!section) throw new Error('section missing');
    const scenarios = parseScenarios(section, 'scenario');
    const first = scenarios[0];
    if (!first) throw new Error('scenario missing');
    expect(first.given).toBe('a base state that spans two lines and even three');
    expect(first.when).toBe('something happens');
  });

  test('parses holdouts with kind=holdout', () => {
    const source = [
      '## Holdout Scenarios',
      '**H-1** — windows endings',
      '  Given a CRLF file',
      '  When parsed',
      '  Then it works',
    ].join('\n');
    const section = findSection(source, 'Holdout Scenarios');
    if (!section) throw new Error('section missing');
    const scenarios = parseScenarios(section, 'holdout');
    const first = scenarios[0];
    if (!first) throw new Error('scenario missing');
    expect(first.id).toBe('H-1');
    expect(first.kind).toBe('holdout');
  });

  test('returns empty array when section has no scenario markers', () => {
    const source = ['## Scenarios', 'no scenarios here'].join('\n');
    const section = findSection(source, 'Scenarios');
    if (!section) throw new Error('section missing');
    expect(parseScenarios(section, 'scenario')).toEqual([]);
  });

  test('strips surrounding double-quotes from judge values', () => {
    const source = [
      '## Scenarios',
      '**S-1** — judge',
      '  Given x',
      '  When y',
      '  Then z',
      '  Satisfaction:',
      '    - judge: "fuzzy criterion"',
    ].join('\n');
    const section = findSection(source, 'Scenarios');
    if (!section) throw new Error('section missing');
    const scenarios = parseScenarios(section, 'scenario');
    const first = scenarios[0];
    if (!first) throw new Error('scenario missing');
    const sat = first.satisfaction[0];
    if (!sat) throw new Error('satisfaction missing');
    expect(sat.kind).toBe('judge');
    expect(sat.value).toBe('fuzzy criterion');
  });

  test('handles double-dash variant of scenario marker', () => {
    const source = [
      '## Scenarios',
      '**S-1** -- dash variant',
      '  Given a',
      '  When b',
      '  Then c',
    ].join('\n');
    const section = findSection(source, 'Scenarios');
    if (!section) throw new Error('section missing');
    const scenarios = parseScenarios(section, 'scenario');
    expect(scenarios[0]?.name).toBe('dash variant');
  });
});

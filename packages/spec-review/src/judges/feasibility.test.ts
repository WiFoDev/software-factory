import { describe, expect, test } from 'bun:test';
import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import { FEASIBILITY_JUDGE } from './feasibility.js';
import type { JudgeApplicabilityCtx } from './index.js';

function stubSpec(body: string): Spec {
  return {
    frontmatter: {
      id: 'demo',
      classification: 'deep',
      type: 'feat',
      status: 'ready',
      exemplars: [],
      'depends-on': [],
    },
    body,
    scenarios: [],
    holdouts: [],
    raw: { source: body },
  };
}

const CTX: JudgeApplicabilityCtx = { hasTechnicalPlan: false, hasDod: true, depsCount: 0 };

describe('feasibility judge — applies()', () => {
  test('applies returns true when Subtasks section has LOC estimates', () => {
    const body = [
      '## Subtasks',
      '',
      '- T1 [feature] — Add the foo. ~30 LOC.',
      '- T2 [test] — Tests for foo. ~20 LOC.',
    ].join('\n');
    expect(FEASIBILITY_JUDGE.applies(stubSpec(body), CTX)).toBe(true);
  });

  test('applies returns false when Subtasks has no LOC estimates', () => {
    const body = [
      '## Subtasks',
      '',
      '- T1 [feature] — Add the foo without numbers.',
      '- T2 [test] — Tests for foo, also no numbers.',
    ].join('\n');
    expect(FEASIBILITY_JUDGE.applies(stubSpec(body), CTX)).toBe(false);
  });

  test('applies returns false when Subtasks section is missing entirely', () => {
    const body = '## Intent\n\nSome intent text.\n';
    expect(FEASIBILITY_JUDGE.applies(stubSpec(body), CTX)).toBe(false);
  });

  test('applies ignores LOC estimates that appear outside the Subtasks section', () => {
    const body = [
      '## Intent',
      '',
      'We expect ~50 LOC of work overall.',
      '',
      '## Subtasks',
      '',
      '- T1 [feature] — Add foo without estimates.',
    ].join('\n');
    expect(FEASIBILITY_JUDGE.applies(stubSpec(body), CTX)).toBe(false);
  });
});

describe('feasibility judge — buildPrompt()', () => {
  test('criterion mentions LOC-vs-path-count ratio for subtasks', () => {
    const sliced: SlicedSections = {
      subtasks: '- T1 [feature] — Add foo. ~30 LOC.',
      headingLines: { subtasks: 5 },
    };
    const out = FEASIBILITY_JUDGE.buildPrompt(stubSpec('## Subtasks\n\n- T1: foo'), sliced, {});
    expect(out.criterion).toContain('LOC');
    expect(out.criterion.toLowerCase()).toContain('ratio');
    expect(out.criterion.toLowerCase()).toContain('file');
    expect(out.criterion.toLowerCase()).toContain('subtask');
  });

  test('artifact contains the Subtasks section', () => {
    const sliced: SlicedSections = {
      subtasks: '- T1 [feature] — Add foo. ~30 LOC referencing src/foo.ts',
      headingLines: { subtasks: 5 },
    };
    const out = FEASIBILITY_JUDGE.buildPrompt(stubSpec('## Subtasks\n\n- T1: foo'), sliced, {});
    expect(out.artifact).toContain('## Subtasks');
    expect(out.artifact).toContain('~30 LOC');
    expect(out.line).toBe(5);
  });
});

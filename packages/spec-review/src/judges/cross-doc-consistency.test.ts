import { describe, expect, test } from 'bun:test';
import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import { CROSS_DOC_CONSISTENCY_JUDGE } from './cross-doc-consistency.js';
import type { JudgeApplicabilityCtx, JudgePromptCtx } from './index.js';

function stubSpec(body = '## Spec body'): Spec {
  return {
    frontmatter: {
      id: 'demo',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      exemplars: [],
      'depends-on': [],
    },
    body,
    scenarios: [],
    holdouts: [],
    raw: { source: '' },
  };
}

const EMPTY_SLICED: SlicedSections = { headingLines: {} };

describe('cross-doc-consistency judge — applies()', () => {
  test('returns true when hasTechnicalPlan is true', () => {
    const ctx: JudgeApplicabilityCtx = {
      hasTechnicalPlan: true,
      hasDod: true,
      depsCount: 0,
    };
    expect(CROSS_DOC_CONSISTENCY_JUDGE.applies(stubSpec(), ctx)).toBe(true);
  });

  test('applies returns true when depends-on is non-empty even without technical-plan', () => {
    const ctx: JudgeApplicabilityCtx = {
      hasTechnicalPlan: false,
      hasDod: true,
      depsCount: 2,
    };
    expect(CROSS_DOC_CONSISTENCY_JUDGE.applies(stubSpec(), ctx)).toBe(true);
  });

  test('returns false when both hasTechnicalPlan is false and depsCount is 0', () => {
    const ctx: JudgeApplicabilityCtx = {
      hasTechnicalPlan: false,
      hasDod: true,
      depsCount: 0,
    };
    expect(CROSS_DOC_CONSISTENCY_JUDGE.applies(stubSpec(), ctx)).toBe(false);
  });
});

describe('cross-doc-consistency judge — buildPrompt()', () => {
  test('emits Spec section only when neither plan nor deps are provided', () => {
    const out = CROSS_DOC_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, {});
    expect(out.artifact).toContain('## Spec\nSPEC BODY');
    expect(out.artifact).not.toContain('## Technical Plan');
    expect(out.artifact).not.toContain('## Deps');
  });

  test('emits Technical Plan section when technicalPlan is provided', () => {
    const ctx: JudgePromptCtx = { technicalPlan: 'PLAN BODY' };
    const out = CROSS_DOC_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, ctx);
    expect(out.artifact).toContain('## Spec\nSPEC BODY');
    expect(out.artifact).toContain('## Technical Plan\nPLAN BODY');
    expect(out.artifact).not.toContain('## Deps');
  });

  test('buildPrompt artifact includes Deps section when deps are provided', () => {
    const ctx: JudgePromptCtx = {
      deps: [
        { id: 'helper-a', body: 'HELPER A BODY' },
        { id: 'helper-b', body: 'HELPER B BODY' },
      ],
    };
    const out = CROSS_DOC_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, ctx);
    expect(out.artifact).toContain('## Spec\nSPEC BODY');
    expect(out.artifact).toContain('## Deps');
    expect(out.artifact).toContain('### helper-a\nHELPER A BODY');
    expect(out.artifact).toContain('### helper-b\nHELPER B BODY');
    expect(out.artifact).not.toContain('## Technical Plan');
  });

  test('emits all three sections when plan AND deps are provided', () => {
    const ctx: JudgePromptCtx = {
      technicalPlan: 'PLAN BODY',
      deps: [{ id: 'helper', body: 'HELPER BODY' }],
    };
    const out = CROSS_DOC_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, ctx);
    expect(out.artifact).toContain('## Spec\nSPEC BODY');
    expect(out.artifact).toContain('## Technical Plan\nPLAN BODY');
    expect(out.artifact).toContain('## Deps');
    expect(out.artifact).toContain('### helper\nHELPER BODY');
  });

  test('buildPrompt artifact respects 100 KB cap when deps push total over limit', () => {
    // The capBytes truncator is O(n²); sizing pieces just over the cap so
    // iteration is bounded and the truncation marker still fires.
    const big = 'x'.repeat(40_000);
    const ctx: JudgePromptCtx = {
      technicalPlan: big,
      deps: [
        { id: 'a', body: big },
        { id: 'b', body: big },
      ],
    };
    const out = CROSS_DOC_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, ctx);
    expect(Buffer.byteLength(out.artifact, 'utf8')).toBeLessThanOrEqual(100_000 + 200);
    expect(out.artifact).toContain('[... truncated to fit cap; further content omitted ...]');
  }, 30_000);

  test('empty deps array behaves the same as undefined deps', () => {
    const ctx: JudgePromptCtx = { deps: [] };
    const out = CROSS_DOC_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, ctx);
    expect(out.artifact).not.toContain('## Deps');
  });
});

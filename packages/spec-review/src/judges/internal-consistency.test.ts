import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Spec, parseSpec, splitFrontmatter } from '@wifo/factory-core';
import { sliceSections } from '../slice-sections.js';
import type { JudgeApplicabilityCtx, JudgePromptCtx } from './index.js';
import { INTERNAL_CONSISTENCY_JUDGE } from './internal-consistency.js';

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

const EMPTY_SLICED = { headingLines: {} } as ReturnType<typeof sliceSections>;

describe('internal-consistency judge — applies()', () => {
  test('applies returns true for spec with non-empty depends-on', () => {
    const ctx: JudgeApplicabilityCtx = {
      hasTechnicalPlan: false,
      hasDod: true,
      depsCount: 2,
    };
    expect(INTERNAL_CONSISTENCY_JUDGE.applies(stubSpec(), ctx)).toBe(true);
  });

  test('applies returns true for spec with empty depends-on (existing behavior preserved)', () => {
    const ctx: JudgeApplicabilityCtx = {
      hasTechnicalPlan: false,
      hasDod: true,
      depsCount: 0,
    };
    expect(INTERNAL_CONSISTENCY_JUDGE.applies(stubSpec(), ctx)).toBe(true);
  });
});

describe('internal-consistency judge — buildPrompt()', () => {
  test('buildPrompt includes Deps Constraints section when deps are provided', () => {
    const ctx: JudgePromptCtx = {
      deps: [
        {
          id: 'parent-spec',
          body: [
            '# parent-spec',
            '',
            '## Constraints / Decisions',
            '',
            '- Public exports from `src/core.ts`: `generateSlug(url: string): string`.',
            '- Error codes: `invalid-url`, `slug-not-found`.',
            '',
            '## Subtasks',
            '',
            '- T1: implement core.',
          ].join('\n'),
        },
      ],
    };
    const out = INTERNAL_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, ctx);
    expect(out.artifact).toContain('## Deps Constraints (referenced via depends-on)');
    expect(out.artifact).toContain('### parent-spec');
    expect(out.artifact).toContain('generateSlug(url: string): string');
    expect(out.artifact).toContain('invalid-url');
    // The Subtasks heading from the dep body must NOT be included — only its
    // Constraints / Decisions section is sliced in.
    expect(out.artifact).not.toContain('T1: implement core.');
  });

  test('buildPrompt artifact does not emit Deps Constraints section when deps is undefined', () => {
    const out = INTERNAL_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, {});
    expect(out.artifact).not.toContain('## Deps Constraints');
  });

  test('buildPrompt artifact does not emit Deps Constraints section when deps is empty', () => {
    const ctx: JudgePromptCtx = { deps: [] };
    const out = INTERNAL_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, ctx);
    expect(out.artifact).not.toContain('## Deps Constraints');
  });

  test('criterion text mentions depends-on context when deps are provided', () => {
    const ctx: JudgePromptCtx = {
      deps: [{ id: 'parent', body: '## Constraints / Decisions\n\n- foo' }],
    };
    const out = INTERNAL_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, ctx);
    expect(out.criterion).toContain('depends-on');
  });

  test('dep without a Constraints / Decisions section yields a one-line note', () => {
    const ctx: JudgePromptCtx = {
      deps: [{ id: 'no-constraints', body: '# only intro\n\nsome prose' }],
    };
    const out = INTERNAL_CONSISTENCY_JUDGE.buildPrompt(stubSpec('SPEC BODY'), EMPTY_SLICED, ctx);
    expect(out.artifact).toContain('### no-constraints\n(no constraints section in this dep)');
  });

  test('artifact respects 100 KB cap when deps push total over limit', () => {
    const big = 'x'.repeat(40_000);
    const depBody = `## Constraints / Decisions\n\n${big}`;
    const ctx: JudgePromptCtx = {
      deps: [
        { id: 'a', body: depBody },
        { id: 'b', body: depBody },
        { id: 'c', body: depBody },
      ],
    };
    const out = INTERNAL_CONSISTENCY_JUDGE.buildPrompt(stubSpec(big), EMPTY_SLICED, ctx);
    expect(Buffer.byteLength(out.artifact, 'utf8')).toBeLessThanOrEqual(100_000 + 200);
    expect(out.artifact).toContain('[... truncated to fit cap; further content omitted ...]');
  }, 30_000);
});

describe('internal-consistency judge — URL-shortener fixture', () => {
  test('URL-shortener fixture: redirect spec passes internal-consistency when run with deps loaded', () => {
    const fixturesRoot = resolve(
      import.meta.dir,
      '..',
      '..',
      '..',
      '..',
      'docs',
      'baselines',
      'scope-project-fixtures',
      'url-shortener',
    );
    const redirectSource = readFileSync(resolve(fixturesRoot, 'url-shortener-redirect.md'), 'utf8');
    const coreSource = readFileSync(resolve(fixturesRoot, 'url-shortener-core.md'), 'utf8');
    const redirectSpec = parseSpec(redirectSource, { filename: 'url-shortener-redirect.md' });
    const coreBody = splitFrontmatter(coreSource).body;

    const sliced = sliceSections(redirectSpec);
    const ctx: JudgePromptCtx = {
      deps: [{ id: 'url-shortener-core', body: coreBody }],
    };
    const out = INTERNAL_CONSISTENCY_JUDGE.buildPrompt(redirectSpec, sliced, ctx);

    // The artifact wires in the parent's constraints, so the LLM judge can
    // see that `Storage`, `invalid-url`, and the `createServer` shape live in
    // the parent's Constraints / Decisions block — no longer flagged as
    // unreferenced shared constraints.
    expect(out.artifact).toContain('## Deps Constraints (referenced via depends-on)');
    expect(out.artifact).toContain('### url-shortener-core');
    expect(out.artifact).toContain('Storage');
    expect(out.artifact).toContain('invalid-url');
    // The redirect spec's own scenarios still get sliced into the artifact.
    expect(out.artifact).toContain('## Scenarios');
  });
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../..');

const readDoc = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');

describe('docs hygiene (factory-docs-v0-0-5)', () => {
  test('SPEC_TEMPLATE references the parallel-tree convention and not the obsolete single-tree filename', () => {
    const body = readDoc('docs/SPEC_TEMPLATE.md');

    expect(body).toContain('docs/specs/<id>.md');
    expect(body).toContain('docs/technical-plans/<id>.md');

    expect(body).not.toContain('<id>.technical-plan.md');
    expect(body).not.toContain('single-tree');

    expect(body).toContain(
      'specs and technical plans live in parallel directories so `factory spec lint docs/specs/` recurses without tripping over technical plans.',
    );
  });

  test('SPEC_TEMPLATE recommends both factory spec lint and factory spec review', () => {
    const body = readDoc('docs/SPEC_TEMPLATE.md');

    expect(body).toMatch(/##\s+(Validating|Workflow)/);
    expect(body).toContain('factory spec lint docs/specs/<id>.md');
    expect(body).toContain('factory spec review docs/specs/<id>.md');

    expect(body).toMatch(/lint[^\n]*format/i);
    expect(body).toMatch(/review[^\n]*(quality|judges|subscription)/i);
  });

  test('harness README references @wifo/factory-spec-review', () => {
    const body = readDoc('packages/harness/README.md');

    expect(body).toContain('@wifo/factory-spec-review');
    expect(body).toContain('../spec-review/README.md');
    expect(body).toContain('JudgeClient');
    expect(body).toMatch(/##\s+(Related|See also)/);
  });

  test('runtime README references @wifo/factory-spec-review', () => {
    const body = readDoc('packages/runtime/README.md');

    expect(body).toContain('@wifo/factory-spec-review');
    expect(body).toContain('../spec-review/README.md');
    expect(body).toContain('factory spec lint');
    expect(body).toContain('factory spec review');
    expect(body).toContain('factory-runtime run');
  });

  test('core README contains the PostToolUse hook recipe with both lint and review commands', () => {
    const body = readDoc('packages/core/README.md');

    expect(body).toContain('## Harness-enforced spec linting + review');
    expect(body).toContain('PostToolUse');
    expect(body).toContain('Write|Edit');
    expect(body).toContain('matcher');
    expect(body).toContain('command');
    expect(body).toContain('factory spec lint');
    expect(body).toContain('factory spec review');
    expect(body).toContain('docs/specs/');
    expect(body).toContain('~/.claude/settings.json');
    expect(body).toMatch(/opt[- ]in/i);
  });
});

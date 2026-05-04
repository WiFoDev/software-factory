import { describe, expect, test } from 'bun:test';
import { defaultEnabledJudges, loadJudgeRegistry, ruleSetHash } from './index.js';

// Hash captured from v0.0.9's registry (5 judges: internal-consistency,
// judge-parity, dod-precision, holdout-distinctness, cross-doc-consistency).
// v0.0.10 adds 3 new judges, which must change the hash so v0.0.9 cache
// entries miss correctly on first run after upgrade.
const V0_0_9_RULE_SET_HASH = 'b8b86fbd98650e5f6ac69886c19fe1f052f944dceb5007f882ed8d580fe3ff91';

describe('judges/index — registry extension at v0.0.10', () => {
  test('registry has 8 entries after v0.0.10 (5 v0.0.4 + 3 v0.0.10)', () => {
    const registry = loadJudgeRegistry();
    expect(Object.keys(registry).length).toBe(8);
  });

  test('defaultEnabledJudges includes all 3 new codes', () => {
    const enabled = defaultEnabledJudges();
    expect(enabled).toContain('review/api-surface-drift');
    expect(enabled).toContain('review/feasibility');
    expect(enabled).toContain('review/scope-creep');
  });

  test('defaultEnabledJudges returns the 8 codes in canonical order', () => {
    const enabled = defaultEnabledJudges();
    expect(enabled).toEqual([
      'review/internal-consistency',
      'review/judge-parity',
      'review/dod-precision',
      'review/holdout-distinctness',
      'review/cross-doc-consistency',
      'review/api-surface-drift',
      'review/feasibility',
      'review/scope-creep',
    ]);
  });

  test('ruleSetHash is different between v0.0.9 and v0.0.10', () => {
    expect(ruleSetHash()).not.toBe(V0_0_9_RULE_SET_HASH);
  });
});

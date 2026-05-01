import { describe, expect, test } from 'bun:test';
import * as api from './index.js';

describe('public API surface', () => {
  test('exports exactly 10 names (4 functions + 6 types — types invisible at runtime)', () => {
    // Runtime-visible exports: the 4 functions only. Type-only exports are
    // erased at runtime. Strict-equality gate: 4 runtime names.
    const exported = Object.keys(api).sort();
    expect(exported).toEqual(
      ['claudeCliJudgeClient', 'formatFindings', 'loadJudgeRegistry', 'runReview'].sort(),
    );
  });
});

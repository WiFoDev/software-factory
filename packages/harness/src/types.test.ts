import { describe, expect, test } from 'bun:test';
import { aggregateStatus, reportStatusFrom } from './types';

describe('aggregateStatus', () => {
  test('empty list is skipped', () => {
    expect(aggregateStatus([])).toBe('skipped');
  });

  test('error wins over fail and pass', () => {
    expect(aggregateStatus(['pass', 'fail', 'error'])).toBe('error');
    expect(aggregateStatus(['error', 'pass'])).toBe('error');
  });

  test('fail beats pass', () => {
    expect(aggregateStatus(['pass', 'fail', 'pass'])).toBe('fail');
  });

  test('all pass is pass', () => {
    expect(aggregateStatus(['pass', 'pass'])).toBe('pass');
  });

  test('all skipped is skipped', () => {
    expect(aggregateStatus(['skipped', 'skipped'])).toBe('skipped');
  });

  test('mix of pass and skipped is pass', () => {
    expect(aggregateStatus(['pass', 'skipped'])).toBe('pass');
  });
});

describe('reportStatusFrom', () => {
  test('error short-circuits', () => {
    expect(reportStatusFrom(['pass', 'error'])).toBe('error');
  });

  test('fail beats pass', () => {
    expect(reportStatusFrom(['pass', 'fail'])).toBe('fail');
  });

  test('only-skipped reports pass (no failures)', () => {
    expect(reportStatusFrom(['skipped', 'skipped'])).toBe('pass');
  });

  test('empty input is pass', () => {
    expect(reportStatusFrom([])).toBe('pass');
  });
});

import { describe, expect, test } from 'bun:test';
import { parseSize } from './parse-size.js';

describe('parseSize', () => {
  test('SI parsing: 1.5 KB → 1500', () => {
    expect(parseSize('1.5 KB')).toBe(1500);
  });

  test('IEC parsing: 3.5 GiB → 3758096384', () => {
    expect(parseSize('3.5 GiB')).toBe(3758096384);
  });

  test('bare numeric: 1024 → 1024', () => {
    expect(parseSize('1024')).toBe(1024);
  });

  test('malformed throws with token in message', () => {
    expect(() => parseSize('42 zorp')).toThrow(/zorp/);
  });

  test('empty throws with empty in message', () => {
    expect(() => parseSize('')).toThrow(/empty/i);
  });

  test('case-insensitive units', () => {
    expect(parseSize('1kb')).toBe(1000);
    expect(parseSize('1KB')).toBe(1000);
    expect(parseSize('1 Kb')).toBe(1000);
  });

  // Holdouts
  test('H-1: negative bare numeric throws', () => {
    expect(() => parseSize('-5')).toThrow(/negative/i);
  });

  test('H-2: SI vs IEC discrimination — KB is 1000, KiB is 1024', () => {
    expect(parseSize('1 KB')).toBe(1000);
    expect(parseSize('1 KiB')).toBe(1024);
    // The key invariant: they must NOT collapse to the same number.
    expect(parseSize('1 KB')).not.toBe(parseSize('1 KiB'));
  });

  // Boundary checks from DoD
  test('zero is exactly zero', () => {
    expect(parseSize('0')).toBe(0);
  });

  test('whitespace between number and unit is optional', () => {
    expect(parseSize('1KB')).toBe(1000);
    expect(parseSize('1 KB')).toBe(1000);
    expect(parseSize('1  KB')).toBe(1000);
  });

  test('fractional results round to integer', () => {
    // 1.5 KiB = 1536 exactly. Use a value that would produce a fraction
    // pre-rounding: 1.001 KB = 1001 bytes (rounds from 1001.0).
    expect(parseSize('1.001 KB')).toBe(1001);
    expect(Number.isInteger(parseSize('3.5 GiB'))).toBe(true);
  });
});

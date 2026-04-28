import { expect, test } from 'bun:test';

test('passing-greeting returns hello', () => {
  expect('hello').toBe('hello');
});

test('passing-arithmetic adds correctly', () => {
  expect(2 + 2).toBe(4);
});

import { expect, test } from 'bun:test';

test('failing-arithmetic adds wrong', () => {
  expect(2 + 2).toBe(5);
});

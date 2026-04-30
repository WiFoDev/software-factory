import { expect, test } from 'bun:test';

test('impl returns 42', async () => {
  // The implementPhase fake-claude (mode=success) writes src/needs-impl.ts
  // alongside this fixture. Resolve relative to this test file's dir.
  const here = new URL('.', import.meta.url).pathname;
  const mod = (await import(`${here}src/needs-impl.ts`)) as { impl?: () => number };
  expect(mod.impl?.()).toBe(42);
});

import { expect, test } from 'bun:test';

test('iter2 returns 42', async () => {
  // The implementPhase fake-claude (mode=fail-then-pass / fail-fail-then-pass)
  // eventually writes src/needs-iter2.ts alongside this fixture. Resolve
  // relative to this test file's dir.
  const here = new URL('.', import.meta.url).pathname;
  const mod = (await import(`${here}src/needs-iter2.ts`)) as { iter2?: () => number };
  expect(mod.iter2?.()).toBe(42);
});

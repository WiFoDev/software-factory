import { test } from 'bun:test';

test('slow-test exceeds timeout', async () => {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
});

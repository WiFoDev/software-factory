import { beforeEach, expect, test } from 'bun:test';
import {
  GhStarsRateLimitError,
  __clearCache,
  getStargazers,
} from './gh-stars';

beforeEach(() => {
  __clearCache();
});

function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

test('returns parsed stargazers on 200 OK', async () => {
  const payload = [
    { login: 'alice', html_url: 'https://github.com/alice', extra: 'x' },
    { login: 'bob', html_url: 'https://github.com/bob' },
  ];
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    calls.push(typeof input === 'string' ? input : (input as Request).url);
    return makeJsonResponse(payload);
  };

  const result = await getStargazers('wifo/example', { fetch: fakeFetch });

  expect(calls).toHaveLength(1);
  expect(calls[0]).toBe('https://api.github.com/repos/wifo/example/stargazers');
  expect(result).toEqual([
    { login: 'alice', html_url: 'https://github.com/alice' },
    { login: 'bob', html_url: 'https://github.com/bob' },
  ]);
});

test('second call within TTL serves from cache', async () => {
  const payload = [{ login: 'alice', html_url: 'https://github.com/alice' }];
  let networkCalls = 0;
  const fakeFetch: typeof fetch = async () => {
    networkCalls++;
    return makeJsonResponse(payload);
  };

  let currentTime = 1_000_000;
  const now = () => currentTime;

  const first = await getStargazers('wifo/example', {
    fetch: fakeFetch,
    now,
    ttlMs: 5 * 60 * 1000,
  });
  expect(networkCalls).toBe(1);

  // 1 minute later — within TTL
  currentTime += 60 * 1000;
  const second = await getStargazers('wifo/example', {
    fetch: fakeFetch,
    now,
    ttlMs: 5 * 60 * 1000,
  });
  expect(networkCalls).toBe(1);
  expect(second).toEqual(first);

  // Past TTL — refetches
  currentTime += 5 * 60 * 1000 + 1;
  await getStargazers('wifo/example', {
    fetch: fakeFetch,
    now,
    ttlMs: 5 * 60 * 1000,
  });
  expect(networkCalls).toBe(2);
});

test('403 with rate-limit headers throws GhStarsRateLimitError with resetAt', async () => {
  const resetSeconds = Math.floor(new Date('2030-01-01T12:00:00Z').getTime() / 1000);
  const fakeFetch: typeof fetch = async () =>
    new Response('rate limited', {
      status: 403,
      headers: {
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(resetSeconds),
      },
    });

  let caught: unknown;
  try {
    await getStargazers('wifo/example', { fetch: fakeFetch });
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(GhStarsRateLimitError);
  const err = caught as GhStarsRateLimitError;
  expect(err.name).toBe('GhStarsRateLimitError');
  expect(err.resetAt).toBeInstanceOf(Date);
  expect(err.resetAt.getTime()).toBe(resetSeconds * 1000);
  expect(err.message).toContain('2030');
  expect(err.message.toLowerCase()).toMatch(/retry|try again|after/);
});

test('rejects malformed repo input', async () => {
  await expect(
    getStargazers('not-a-valid-repo', { fetch: (async () => makeJsonResponse([])) as typeof fetch }),
  ).rejects.toThrow(/Invalid repo/);
});

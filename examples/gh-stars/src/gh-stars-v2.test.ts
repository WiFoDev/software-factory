import { beforeEach, expect, test } from 'bun:test';
import { __clearCache, getStargazers } from './gh-stars';

// Test scaffolding for v0.0.3 demo — gh-stars-v2.md scenarios.
// The agent's job is to extend src/gh-stars.ts to satisfy these. v1's tests
// (src/gh-stars.test.ts) must keep passing after v2 lands — backwards compat.

beforeEach(() => {
  __clearCache();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

// ----- S-1: pagination ---------------------------------------------------

test('pagination: concatenates pages until rel=next absent', async () => {
  const page1 = [
    { login: 'alice', html_url: 'https://github.com/alice' },
    { login: 'bob', html_url: 'https://github.com/bob' },
  ];
  const page2 = [{ login: 'carol', html_url: 'https://github.com/carol' }];

  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push(url);
    if (url.includes('page=2')) {
      // Last page — no rel=next
      return jsonResponse(page2);
    }
    // First page — Link header points at page 2
    return jsonResponse(page1, {
      headers: {
        'Content-Type': 'application/json',
        Link: `<https://api.github.com/repos/wifo/popular/stargazers?page=2>; rel="next"`,
      },
    });
  };

  const result = await getStargazers('wifo/popular', { fetch: fakeFetch });

  expect(calls.length).toBe(2);
  expect(result).toEqual([
    { login: 'alice', html_url: 'https://github.com/alice' },
    { login: 'bob', html_url: 'https://github.com/bob' },
    { login: 'carol', html_url: 'https://github.com/carol' },
  ]);
});

// ----- S-2: ETag conditional caching -------------------------------------

test('ETag: 304 short-circuits to cached body with If-None-Match header sent', async () => {
  const payload = [{ login: 'alice', html_url: 'https://github.com/alice' }];
  const headersSeen: Headers[] = [];
  let callCount = 0;
  const fakeFetch: typeof fetch = async (_input, init) => {
    callCount++;
    const headers = new Headers(init?.headers);
    headersSeen.push(headers);
    if (callCount === 1) {
      return jsonResponse(payload, {
        headers: {
          'Content-Type': 'application/json',
          ETag: '"abc123"',
        },
      });
    }
    // Second call — server says 304 Not Modified
    return new Response(null, { status: 304 });
  };

  let currentTime = 1_000_000;
  const now = () => currentTime;
  const ttlMs = 5 * 60 * 1000;

  const first = await getStargazers('wifo/repo', { fetch: fakeFetch, now, ttlMs });
  expect(first).toEqual(payload);
  expect(callCount).toBe(1);

  // Advance past TTL so v1's cache short-circuit doesn't apply; the ETag path is
  // what spares the round-trip's body parsing.
  currentTime += ttlMs + 1;

  const second = await getStargazers('wifo/repo', { fetch: fakeFetch, now, ttlMs });
  expect(callCount).toBe(2);
  // The second request sent the If-None-Match header
  expect(headersSeen[1]?.get('If-None-Match')).toBe('"abc123"');
  // 304 served the prior cached body — equal to the first response
  expect(second).toEqual(payload);
});

// ----- S-3: retry-with-backoff -------------------------------------------

test('retry-with-backoff: succeeds after 1 retry on 503', async () => {
  let callCount = 0;
  const fakeFetch: typeof fetch = async () => {
    callCount++;
    if (callCount === 1) return new Response('Service Unavailable', { status: 503 });
    return jsonResponse([{ login: 'alice', html_url: 'https://github.com/alice' }]);
  };

  const sleepCalls: number[] = [];
  const sleep = async (ms: number) => {
    sleepCalls.push(ms);
  };

  const result = await getStargazers('wifo/repo', {
    fetch: fakeFetch,
    sleep,
  } as Parameters<typeof getStargazers>[1]);

  expect(callCount).toBe(2);
  expect(sleepCalls).toEqual([100]);
  expect(result).toEqual([{ login: 'alice', html_url: 'https://github.com/alice' }]);
});

test('retry-with-backoff: gives up after 2 retries on persistent 503', async () => {
  let callCount = 0;
  const fakeFetch: typeof fetch = async () => {
    callCount++;
    return new Response('Service Unavailable', { status: 503 });
  };

  const sleepCalls: number[] = [];
  const sleep = async (ms: number) => {
    sleepCalls.push(ms);
  };

  let caught: unknown;
  try {
    await getStargazers('wifo/repo', {
      fetch: fakeFetch,
      sleep,
    } as Parameters<typeof getStargazers>[1]);
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(Error);
  expect(callCount).toBe(3);
  expect(sleepCalls).toEqual([100, 200]);
  const message = (caught as Error).message;
  // Must be informative — judge criterion in S-3 covers this; the test asserts
  // structural minima (mentions 503 OR 'retries' OR 'unavailable').
  expect(message.toLowerCase()).toMatch(/503|retr(y|ies)|unavailable/);
});

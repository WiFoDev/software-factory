import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TwinNoMatchError, TwinReplayError } from './errors.js';
import { hashRequest } from './hash.js';
import { writeRecording } from './store.js';
import type { Recording } from './types.js';
import { type FetchLike, wrapFetch } from './wrap-fetch.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'twin-wrap-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

describe('wrapFetch — record mode', () => {
  test('persists request/response and returns the real response', async () => {
    let callCount = 0;
    const fakeFetch: FetchLike = async () => {
      callCount++;
      return new Response('{"ok":true}', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      });
    };

    const wrapped = wrapFetch(fakeFetch, { mode: 'record', recordingsDir: dir });
    const res = await wrapped('https://api.x/y', { method: 'POST', body: '{"a":1}' });

    expect(callCount).toBe(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const entries = await readdir(dir);
    expect(entries).toHaveLength(1);
    const filename = entries[0] ?? '';
    expect(filename).toMatch(/^[0-9a-f]{16}\.json$/);

    const rec = JSON.parse(await readFile(join(dir, filename), 'utf8')) as Recording;
    expect(rec.version).toBe(1);
    expect(rec.request.method).toBe('POST');
    expect(rec.request.url).toBe('https://api.x/y');
    expect(rec.request.body).toBe('{"a":1}');
    expect(rec.response.status).toBe(200);
    expect(rec.response.body).toBe('{"ok":true}');
    expect(rec.response.bodyEncoding).toBe('utf8');
    expect(rec.response.headers['content-type']).toBe('application/json');
  });

  test('persists binary response body as base64 with byte-exact fidelity', async () => {
    const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
    const fakeFetch: FetchLike = async () =>
      new Response(original, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });

    const recordWrap = wrapFetch(fakeFetch, { mode: 'record', recordingsDir: dir });
    await recordWrap('https://api.x/img.png');

    const entries = await readdir(dir);
    const rec = JSON.parse(await readFile(join(dir, entries[0] ?? ''), 'utf8')) as Recording;
    expect(rec.response.bodyEncoding).toBe('base64');

    const replayWrap = wrapFetch(
      async () => {
        throw new Error('should not be called');
      },
      { mode: 'replay', recordingsDir: dir },
    );
    const replayRes = await replayWrap('https://api.x/img.png');
    const buf = await replayRes.arrayBuffer();
    expect(Array.from(new Uint8Array(buf))).toEqual(Array.from(original));
  });
});

describe('wrapFetch — replay mode', () => {
  test('serves recording without calling realFetch', async () => {
    const method = 'GET';
    const url = 'https://api.x/y';
    const hash = hashRequest({ method, url, body: null, headers: {} });
    await writeRecording(dir, {
      version: 1,
      hash,
      recordedAt: '2026-04-28T10:00:00.000Z',
      request: { method, url, headers: {}, body: null },
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        body: 'hello replay',
        bodyEncoding: 'utf8',
      },
    });

    let realCalled = false;
    const fakeFetch: FetchLike = async () => {
      realCalled = true;
      return new Response('should not be used');
    };
    const wrapped = wrapFetch(fakeFetch, { mode: 'replay', recordingsDir: dir });
    const res = await wrapped(url);
    expect(realCalled).toBe(false);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe('OK');
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('hello replay');
  });

  test('throws TwinNoMatchError on miss with hash, method, and url', async () => {
    const fakeFetch: FetchLike = async () => {
      throw new Error('should not be called');
    };
    const wrapped = wrapFetch(fakeFetch, { mode: 'replay', recordingsDir: dir });

    let caught: unknown;
    try {
      await wrapped('https://api.x/missing', { method: 'POST', body: 'x' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TwinNoMatchError);
    const err = caught as TwinNoMatchError;
    expect(err.code).toBe('twin/no-match');
    expect(err.method).toBe('POST');
    expect(err.url).toBe('https://api.x/missing');
    expect(err.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(err.message).toContain('POST');
    expect(err.message).toContain('https://api.x/missing');
    expect(err.message).toContain(err.hash);
  });

  test('rejects unsupported request bodies', async () => {
    const wrapped = wrapFetch(async () => new Response('x'), {
      mode: 'record',
      recordingsDir: dir,
    });
    let caught: unknown;
    try {
      await wrapped('https://api.x/y', { method: 'POST', body: new Blob(['x']) });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TwinReplayError);
    expect((caught as TwinReplayError).code).toBe('twin/unsupported-body');
  });
});

describe('wrapFetch — round trip', () => {
  test('record then replay returns the same body', async () => {
    const fakeFetch: FetchLike = async () => new Response('payload', { status: 200 });
    const recordWrap = wrapFetch(fakeFetch, { mode: 'record', recordingsDir: dir });
    await recordWrap('https://api.x/y');

    const replayWrap = wrapFetch(
      async () => {
        throw new Error('should not be called');
      },
      { mode: 'replay', recordingsDir: dir },
    );
    const res = await replayWrap('https://api.x/y');
    expect(await res.text()).toBe('payload');
  });

  test('hashHeaders option distinguishes recordings by header value', async () => {
    let callCount = 0;
    const fakeFetch: FetchLike = async (_input, init) => {
      callCount++;
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';
      return new Response(`auth=${auth}`, { status: 200 });
    };

    const wrapped = wrapFetch(fakeFetch, {
      mode: 'record',
      recordingsDir: dir,
      hashHeaders: ['authorization'],
    });

    await wrapped('https://api.x/y', { headers: { authorization: 'Bearer t1' } });
    await wrapped('https://api.x/y', { headers: { authorization: 'Bearer t2' } });

    const entries = await readdir(dir);
    expect(entries).toHaveLength(2);
    expect(callCount).toBe(2);
  });
});

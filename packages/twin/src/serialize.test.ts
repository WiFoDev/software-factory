import { describe, expect, test } from 'bun:test';
import { TwinReplayError } from './errors.js';
import {
  buildRecordedRequest,
  captureResponse,
  extractRequestBody,
  extractRequestHeaders,
  extractRequestMethod,
  extractRequestUrl,
  reconstructResponse,
} from './serialize.js';

describe('extractRequestBody', () => {
  test('returns null when no body', async () => {
    expect(await extractRequestBody('https://api.x/', undefined)).toBe(null);
    expect(await extractRequestBody('https://api.x/', {})).toBe(null);
  });

  test('returns init.body when string', async () => {
    expect(await extractRequestBody('https://api.x/', { body: 'hello' })).toBe('hello');
  });

  test('serializes URLSearchParams to string', async () => {
    const body = new URLSearchParams({ a: '1', b: '2' });
    expect(await extractRequestBody('https://api.x/', { body })).toBe('a=1&b=2');
  });

  test('init.body=null returns null', async () => {
    expect(await extractRequestBody('https://api.x/', { body: null })).toBe(null);
  });

  test('throws TwinReplayError for unsupported body types', async () => {
    const blob = new Blob(['x']);
    let caught: unknown;
    try {
      await extractRequestBody('https://api.x/', { body: blob });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TwinReplayError);
    expect((caught as TwinReplayError).code).toBe('twin/unsupported-body');
    expect((caught as Error).message).toContain('Blob');
  });

  test('throws for FormData', async () => {
    const fd = new FormData();
    fd.append('a', '1');
    let caught: unknown;
    try {
      await extractRequestBody('https://api.x/', { body: fd });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TwinReplayError);
  });

  test('drains body from Request input', async () => {
    const req = new Request('https://api.x/', { method: 'POST', body: 'hello' });
    expect(await extractRequestBody(req, undefined)).toBe('hello');
  });
});

describe('extractRequestUrl', () => {
  test('canonicalizes string URL', () => {
    expect(extractRequestUrl('https://api.x/y')).toBe('https://api.x/y');
  });

  test('reads .url from Request', () => {
    const req = new Request('https://api.x/y');
    expect(extractRequestUrl(req)).toBe('https://api.x/y');
  });

  test('serializes URL object', () => {
    expect(extractRequestUrl(new URL('https://api.x/y'))).toBe('https://api.x/y');
  });
});

describe('extractRequestMethod', () => {
  test('defaults to GET', () => {
    expect(extractRequestMethod('https://api.x/', undefined)).toBe('GET');
  });

  test('uppercases method', () => {
    expect(extractRequestMethod('https://api.x/', { method: 'post' })).toBe('POST');
  });

  test('reads method from Request when init missing', () => {
    const req = new Request('https://api.x/', { method: 'DELETE' });
    expect(extractRequestMethod(req, undefined)).toBe('DELETE');
  });
});

describe('extractRequestHeaders', () => {
  test('merges Request headers and init headers, init takes precedence', () => {
    const req = new Request('https://api.x/', { headers: { 'X-A': 'fromReq', 'X-B': 'b' } });
    const merged = extractRequestHeaders(req, { headers: { 'x-a': 'fromInit' } });
    expect(merged['x-a']).toBe('fromInit');
    expect(merged['x-b']).toBe('b');
  });

  test('keys are lowercased', () => {
    const headers = extractRequestHeaders('https://api.x/', { headers: { 'X-Foo': 'v' } });
    expect(headers['x-foo']).toBe('v');
    expect(headers['X-Foo']).toBeUndefined();
  });
});

describe('buildRecordedRequest', () => {
  test('only includes hashed headers in subset', () => {
    const rec = buildRecordedRequest({
      method: 'POST',
      url: 'https://api.x/',
      body: '{}',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
      hashHeaders: ['content-type'],
    });
    expect(rec.headers).toEqual({ 'content-type': 'application/json' });
    expect(rec.method).toBe('POST');
    expect(rec.body).toBe('{}');
  });

  test('empty hashHeaders → empty subset', () => {
    const rec = buildRecordedRequest({
      method: 'GET',
      url: 'https://api.x/',
      body: null,
      headers: { authorization: 'Bearer t' },
      hashHeaders: [],
    });
    expect(rec.headers).toEqual({});
  });

  test('uppercases method', () => {
    const rec = buildRecordedRequest({
      method: 'post',
      url: 'https://api.x/',
      body: null,
      headers: {},
      hashHeaders: [],
    });
    expect(rec.method).toBe('POST');
  });
});

describe('captureResponse', () => {
  test('captures utf8 body', async () => {
    const res = new Response('hello world', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
    });
    const rec = await captureResponse(res);
    expect(rec.status).toBe(200);
    expect(rec.statusText).toBe('OK');
    expect(rec.body).toBe('hello world');
    expect(rec.bodyEncoding).toBe('utf8');
    expect(rec.headers['content-type']).toBe('text/plain');
  });

  test('captures empty body as null with bodyEncoding utf8', async () => {
    const res = new Response(null, { status: 204 });
    const rec = await captureResponse(res);
    expect(rec.body).toBe(null);
    expect(rec.bodyEncoding).toBe('utf8');
  });

  test('captures binary body as base64', async () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
    const res = new Response(pngHeader, { status: 200 });
    const rec = await captureResponse(res);
    expect(rec.bodyEncoding).toBe('base64');
    expect(rec.body).not.toBe(null);
    if (rec.body !== null) {
      const decoded = Buffer.from(rec.body, 'base64');
      expect(Array.from(decoded)).toEqual(Array.from(pngHeader));
    }
  });

  test('does not consume the source response (uses clone)', async () => {
    const res = new Response('once', { status: 200 });
    await captureResponse(res);
    const text = await res.text();
    expect(text).toBe('once');
  });
});

describe('reconstructResponse', () => {
  test('round-trips utf8 body', () => {
    const res = reconstructResponse({
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
      bodyEncoding: 'utf8',
    });
    expect(res.status).toBe(201);
    expect(res.statusText).toBe('Created');
    expect(res.headers.get('content-type')).toBe('text/plain');
  });

  test('round-trips base64 body byte-exactly', async () => {
    const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);
    const res = reconstructResponse({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: Buffer.from(original).toString('base64'),
      bodyEncoding: 'base64',
    });
    const buf = await res.arrayBuffer();
    expect(Array.from(new Uint8Array(buf))).toEqual(Array.from(original));
  });

  test('null body produces a response with no body', async () => {
    const res = reconstructResponse({
      status: 204,
      statusText: 'No Content',
      headers: {},
      body: null,
      bodyEncoding: 'utf8',
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });
});

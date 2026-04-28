import { describe, expect, test } from 'bun:test';
import { hashRequest } from './hash.js';

describe('hashRequest', () => {
  test('stable across runs and only hashes configured headers', () => {
    const base = {
      method: 'POST',
      url: 'https://api.x/y',
      body: '{"a":1}',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t1' },
    };

    const a = hashRequest(base, { hashHeaders: ['content-type'] });
    const b = hashRequest(base, { hashHeaders: ['content-type'] });
    expect(a).toBe(b);

    const differentUnhashedHeader = hashRequest(
      { ...base, headers: { ...base.headers, authorization: 'Bearer t2' } },
      { hashHeaders: ['content-type'] },
    );
    expect(differentUnhashedHeader).toBe(a);

    const differentHashedHeader = hashRequest(
      { ...base, headers: { ...base.headers, 'content-type': 'text/plain' } },
      { hashHeaders: ['content-type'] },
    );
    expect(differentHashedHeader).not.toBe(a);
  });

  test('returns 16-char lowercase hex', () => {
    const h = hashRequest({
      method: 'GET',
      url: 'https://api.x/y',
      body: null,
      headers: {},
    });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  test('uppercases method before hashing', () => {
    const lower = hashRequest({
      method: 'post',
      url: 'https://api.x/y',
      body: null,
      headers: {},
    });
    const upper = hashRequest({
      method: 'POST',
      url: 'https://api.x/y',
      body: null,
      headers: {},
    });
    expect(lower).toBe(upper);
  });

  test('header lookup is case-insensitive on both sides', () => {
    const a = hashRequest(
      {
        method: 'GET',
        url: 'https://api.x/y',
        body: null,
        headers: { 'X-Trace-Id': 'abc' },
      },
      { hashHeaders: ['x-trace-id'] },
    );
    const b = hashRequest(
      {
        method: 'GET',
        url: 'https://api.x/y',
        body: null,
        headers: { 'x-trace-id': 'abc' },
      },
      { hashHeaders: ['X-Trace-Id'] },
    );
    expect(a).toBe(b);
  });

  test('body=null differs from body=""', () => {
    const nullBody = hashRequest({
      method: 'POST',
      url: 'https://api.x/y',
      body: null,
      headers: {},
    });
    const emptyBody = hashRequest({
      method: 'POST',
      url: 'https://api.x/y',
      body: '',
      headers: {},
    });
    expect(nullBody).not.toBe(emptyBody);
  });

  test('default hashHeaders is empty (no headers participate)', () => {
    const a = hashRequest({
      method: 'GET',
      url: 'https://api.x/y',
      body: null,
      headers: { authorization: 'Bearer t1' },
    });
    const b = hashRequest({
      method: 'GET',
      url: 'https://api.x/y',
      body: null,
      headers: { authorization: 'Bearer t2' },
    });
    expect(a).toBe(b);
  });

  test('different urls produce different hashes', () => {
    const a = hashRequest({
      method: 'GET',
      url: 'https://api.x/a',
      body: null,
      headers: {},
    });
    const b = hashRequest({
      method: 'GET',
      url: 'https://api.x/b',
      body: null,
      headers: {},
    });
    expect(a).not.toBe(b);
  });

  test('query order matters (no canonicalization)', () => {
    const a = hashRequest({
      method: 'GET',
      url: 'https://api.x/y?a=1&b=2',
      body: null,
      headers: {},
    });
    const b = hashRequest({
      method: 'GET',
      url: 'https://api.x/y?b=2&a=1',
      body: null,
      headers: {},
    });
    expect(a).not.toBe(b);
  });
});

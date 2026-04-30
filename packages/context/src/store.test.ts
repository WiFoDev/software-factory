import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ContextError } from './errors.js';
import { createContextStore } from './store.js';
import type { ContextRecord } from './types.js';

const Note = z.object({ text: z.string() });
const Comment = z.object({ body: z.string() });

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'context-store-'));
});

afterEach(async () => {
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

describe('createContextStore — register', () => {
  test('rejects duplicate registration', () => {
    const store = createContextStore({ dir });
    store.register('note', Note);
    expect(() => store.register('note', Note)).toThrow(ContextError);
    try {
      store.register('note', Note);
    } catch (err) {
      expect((err as ContextError).code).toBe('context/duplicate-registration');
    }
  });
});

describe('createContextStore — put/get round-trip and miss semantics', () => {
  test('put/get round-trips a record and get returns null on miss', async () => {
    const store = createContextStore({ dir });
    store.register('note', Note);

    const id = await store.put('note', { text: 'hello' });
    expect(id).toMatch(/^[0-9a-f]{16}$/);

    const got = await store.get(id);
    expect(got).not.toBe(null);
    const rec = got as ContextRecord;
    expect(rec.version).toBe(1);
    expect(rec.id).toBe(id);
    expect(rec.type).toBe('note');
    expect(rec.parents).toEqual([]);
    expect(rec.payload).toEqual({ text: 'hello' });
    expect(typeof rec.recordedAt).toBe('string');

    const missing = await store.get('deadbeefdeadbeef');
    expect(missing).toBe(null);
  });
});

describe('createContextStore — put validation', () => {
  test('put rejects unregistered types and invalid payloads', async () => {
    const store = createContextStore({ dir });
    store.register('note', Note);

    let unreg: unknown;
    try {
      await store.put('comment', { text: 'x' });
    } catch (err) {
      unreg = err;
    }
    expect(unreg).toBeInstanceOf(ContextError);
    expect((unreg as ContextError).code).toBe('context/unregistered-type');

    let bad: unknown;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: deliberate runtime mismatch
      await store.put('note', { text: 42 } as any);
    } catch (err) {
      bad = err;
    }
    expect(bad).toBeInstanceOf(ContextError);
    expect((bad as ContextError).code).toBe('context/schema-validation-failed');
    expect((bad as ContextError).issues).toBeDefined();
    expect((bad as ContextError).issues?.length ?? 0).toBeGreaterThan(0);
  });

  test('put rejects when a declared parent does not exist', async () => {
    const store = createContextStore({ dir });
    store.register('note', Note);

    let caught: unknown;
    try {
      await store.put('note', { text: 'x' }, { parents: ['0000000000000001'] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ContextError);
    expect((caught as ContextError).code).toBe('context/parent-missing');
    expect((caught as ContextError).missingParent).toBe('0000000000000001');
  });
});

describe('createContextStore — id stability and parent dedup', () => {
  test('put deduplicates parents on disk preserving first-occurrence order', async () => {
    const store = createContextStore({ dir });
    store.register('note', Note);

    const a = await store.put('note', { text: 'a' });
    const b = await store.put('note', { text: 'b' });

    const id1 = await store.put('note', { text: 'c' }, { parents: [a, b] });
    const id2 = await store.put('note', { text: 'c' }, { parents: [b, a] });
    const id3 = await store.put('note', { text: 'c' }, { parents: [a, a, b] });
    expect(id1).toBe(id2);
    expect(id1).toBe(id3);

    const rec1 = (await store.get(id1)) as ContextRecord;
    expect(rec1.parents).toEqual([a, b]);

    // Re-put with [b, a, a]: still collides but on-disk parents reflects last writer
    const id4 = await store.put('note', { text: 'c' }, { parents: [b, a, a] });
    expect(id4).toBe(id1);
    const rec4 = (await store.get(id4)) as ContextRecord;
    expect(rec4.parents).toEqual([b, a]);
  });
});

describe('createContextStore — list filtering and tie-break', () => {
  test('list filters by type and tie-breaks by id; parents returns ids on hit and null on miss', async () => {
    const store = createContextStore({ dir });
    store.register('note', Note);
    store.register('comment', Comment);

    const n1 = await store.put('note', { text: 'first' });
    const n2 = await store.put('note', { text: 'second' });
    const c1 = await store.put('comment', { body: 'reply' }, { parents: [n1] });

    const all = await store.list();
    expect(all.map((r) => r.id).sort()).toEqual([n1, n2, c1].sort());

    const notes = await store.list({ type: 'note' });
    expect(notes.map((r) => r.id).sort()).toEqual([n1, n2].sort());

    const comments = await store.list({ type: 'comment' });
    expect(comments.map((r) => r.id)).toEqual([c1]);

    const parents = await store.parents(c1);
    expect(parents).toEqual([n1]);

    const noParents = await store.parents('deadbeefdeadbeef');
    expect(noParents).toBe(null);
  });

  test('list ordering: ascending recordedAt with id ascending tie-break', async () => {
    const store = createContextStore({ dir });
    store.register('note', Note);
    // Force three records that may end up with very close recordedAt; just
    // verify the result is sorted by (recordedAt, id) ascending.
    const a = await store.put('note', { text: '1' });
    const b = await store.put('note', { text: '2' });
    const c = await store.put('note', { text: '3' });
    const result = await store.list();
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      const cur = result[i];
      if (!prev || !cur) continue;
      const t = prev.recordedAt.localeCompare(cur.recordedAt);
      if (t === 0) {
        expect(prev.id < cur.id).toBe(true);
      } else {
        expect(t).toBeLessThanOrEqual(0);
      }
    }
    expect(result.map((r) => r.id).sort()).toEqual([a, b, c].sort());
  });
});

describe('createContextStore — atomic write under concurrent identical puts (H-1)', () => {
  test('concurrent puts of identical (type, parents, payload) never produce a corrupt JSON file', async () => {
    const store = createContextStore({ dir });
    store.register('note', Note);

    const ids = await Promise.all([
      store.put('note', { text: 'concurrent' }),
      store.put('note', { text: 'concurrent' }),
    ]);
    expect(ids[0]).toBe(ids[1]);

    const got = await store.get(ids[0] as string);
    expect(got).not.toBe(null);
    const raw = await readFile(join(dir, `${ids[0]}.json`), 'utf8');
    const parsed = JSON.parse(raw) as ContextRecord;
    expect(parsed.version).toBe(1);
    expect(parsed.id).toBe(ids[0] as string);
    expect(parsed.payload).toEqual({ text: 'concurrent' });
  });
});

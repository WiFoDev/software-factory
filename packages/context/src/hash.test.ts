import { describe, expect, test } from 'bun:test';
import { hashRecord } from './hash.js';

describe('hashRecord', () => {
  test('returns a 16-char lowercase hex string', () => {
    const id = hashRecord({ type: 'note', parents: [], payload: { text: 'x' } });
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  test('stable across recordedAt, parent order, and parent duplicates; varies with type, payload, parent-set', () => {
    const a = hashRecord({ type: 'note', parents: [], payload: { text: 'x' } });
    const b = hashRecord({ type: 'note', parents: [], payload: { text: 'x' } });
    expect(a).toBe(b);

    const orderAB = hashRecord({ type: 'note', parents: ['a', 'b'], payload: { text: 'x' } });
    const orderBA = hashRecord({ type: 'note', parents: ['b', 'a'], payload: { text: 'x' } });
    const dupAAB = hashRecord({ type: 'note', parents: ['a', 'a', 'b'], payload: { text: 'x' } });
    expect(orderAB).toBe(orderBA);
    expect(orderAB).toBe(dupAAB);

    const otherType = hashRecord({ type: 'comment', parents: [], payload: { text: 'x' } });
    expect(otherType).not.toBe(a);

    const otherPayload = hashRecord({ type: 'note', parents: [], payload: { text: 'y' } });
    expect(otherPayload).not.toBe(a);

    const oneParent = hashRecord({ type: 'note', parents: ['a'], payload: { text: 'x' } });
    const twoParents = hashRecord({ type: 'note', parents: ['a', 'b'], payload: { text: 'x' } });
    expect(oneParent).not.toBe(twoParents);
  });

  test('payload object key order does not affect the hash', () => {
    const a = hashRecord({ type: 'note', parents: [], payload: { a: 1, b: 2 } });
    const b = hashRecord({ type: 'note', parents: [], payload: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });

  test('null vs missing payload field produces a different hash', () => {
    const withNull = hashRecord({ type: 'note', parents: [], payload: { x: null } });
    const without = hashRecord({ type: 'note', parents: [], payload: {} });
    expect(withNull).not.toBe(without);
  });

  test('empty-array parents and missing-array-equivalent stay stable', () => {
    const a = hashRecord({ type: 'note', parents: [], payload: 1 });
    const b = hashRecord({ type: 'note', parents: [], payload: 1 });
    expect(a).toBe(b);
  });
});

import { describe, expect, test } from 'bun:test';
import { buildDescendantTree, buildTree, formatTree } from './tree.js';
import type { ContextRecord } from './types.js';

function rec(overrides: Partial<ContextRecord> & Pick<ContextRecord, 'id'>): ContextRecord {
  return {
    version: 1,
    type: 'note',
    recordedAt: '2026-04-29T10:00:00.000Z',
    parents: [],
    payload: {},
    ...overrides,
  };
}

function fakeLookup(records: ContextRecord[]): (id: string) => Promise<ContextRecord | null> {
  const map = new Map(records.map((r) => [r.id, r]));
  return async (id: string) => map.get(id) ?? null;
}

describe('buildTree', () => {
  test('linear chain root → parent → grandparent', async () => {
    const a = rec({ id: 'aaaaaaaaaaaaaaaa' });
    const b = rec({ id: 'bbbbbbbbbbbbbbbb', parents: [a.id] });
    const c = rec({ id: 'cccccccccccccccc', parents: [b.id] });
    const tree = await buildTree(c.id, fakeLookup([a, b, c]));
    expect(tree.id).toBe(c.id);
    expect(tree.marker).toBe('ok');
    expect(tree.parents).toHaveLength(1);
    expect(tree.parents[0]?.id).toBe(b.id);
    expect(tree.parents[0]?.parents[0]?.id).toBe(a.id);
    expect(tree.parents[0]?.parents[0]?.parents).toEqual([]);
  });

  test('multi-parent (diamond): node with two parents both rendered', async () => {
    const root = rec({ id: 'aaaaaaaaaaaaaaaa' });
    const left = rec({ id: 'bbbbbbbbbbbbbbbb', parents: [root.id] });
    const right = rec({ id: 'cccccccccccccccc', parents: [root.id] });
    const child = rec({ id: 'dddddddddddddddd', parents: [left.id, right.id] });
    const tree = await buildTree(child.id, fakeLookup([root, left, right, child]));
    expect(tree.parents.map((p) => p.id)).toEqual([left.id, right.id]);
  });

  test('missing parent is rendered with marker=missing and no further recursion', async () => {
    const x = rec({ id: 'aaaaaaaaaaaaaaaa', parents: ['bbbbbbbbbbbbbbbb'] });
    const tree = await buildTree(x.id, fakeLookup([x]));
    expect(tree.marker).toBe('ok');
    expect(tree.parents[0]?.id).toBe('bbbbbbbbbbbbbbbb');
    expect(tree.parents[0]?.marker).toBe('missing');
    expect(tree.parents[0]?.parents).toEqual([]);
  });

  test('cycle is detected and emitted with marker=cycle without infinite recursion', async () => {
    // Hand-crafted cycle: a's parent is b; b's parent is a.
    const a = rec({ id: 'aaaaaaaaaaaaaaaa', parents: ['bbbbbbbbbbbbbbbb'] });
    const b = rec({ id: 'bbbbbbbbbbbbbbbb', parents: ['aaaaaaaaaaaaaaaa'] });
    const tree = await buildTree(a.id, fakeLookup([a, b]));
    expect(tree.id).toBe(a.id);
    expect(tree.marker).toBe('ok');
    expect(tree.parents[0]?.id).toBe(b.id);
    expect(tree.parents[0]?.marker).toBe('ok');
    // The cycle closes here: b's parent is a, which is in the ancestor set.
    expect(tree.parents[0]?.parents[0]?.id).toBe(a.id);
    expect(tree.parents[0]?.parents[0]?.marker).toBe('cycle');
    expect(tree.parents[0]?.parents[0]?.parents).toEqual([]);
  });

  test('root that does not exist returns a missing node', async () => {
    const tree = await buildTree('aaaaaaaaaaaaaaaa', fakeLookup([]));
    expect(tree.marker).toBe('missing');
    expect(tree.parents).toEqual([]);
  });
});

describe('formatTree', () => {
  test('renders root + indented parents with deterministic glyphs', async () => {
    const a = rec({ id: 'aaaaaaaaaaaaaaaa', recordedAt: '2026-04-25T00:00:00.000Z' });
    const b = rec({
      id: 'bbbbbbbbbbbbbbbb',
      type: 'brief',
      recordedAt: '2026-04-26T00:00:00.000Z',
      parents: [a.id],
    });
    const c = rec({
      id: 'cccccccccccccccc',
      type: 'design',
      recordedAt: '2026-04-27T00:00:00.000Z',
      parents: [b.id],
    });
    const tree = await buildTree(c.id, fakeLookup([a, b, c]));
    const out = formatTree(tree);
    expect(out).toBe(
      [
        'cccccccccccccccc [type=design] 2026-04-27T00:00:00.000Z',
        '└── bbbbbbbbbbbbbbbb [type=brief] 2026-04-26T00:00:00.000Z',
        '    └── aaaaaaaaaaaaaaaa [type=note] 2026-04-25T00:00:00.000Z',
        '',
      ].join('\n'),
    );
  });

  test('renders ├── for non-last sibling and └── for last sibling', async () => {
    const root = rec({ id: 'aaaaaaaaaaaaaaaa' });
    const sibA = rec({ id: 'bbbbbbbbbbbbbbbb', parents: [root.id] });
    const sibB = rec({ id: 'cccccccccccccccc', parents: [root.id] });
    const child = rec({ id: 'dddddddddddddddd', parents: [sibA.id, sibB.id] });
    const tree = await buildTree(child.id, fakeLookup([root, sibA, sibB, child]));
    const out = formatTree(tree);
    expect(out).toContain('├── bbbbbbbbbbbbbbbb');
    expect(out).toContain('└── cccccccccccccccc');
  });

  test('missing ancestor renders <missing>', async () => {
    const x = rec({ id: 'aaaaaaaaaaaaaaaa', parents: ['bbbbbbbbbbbbbbbb'] });
    const tree = await buildTree(x.id, fakeLookup([x]));
    const out = formatTree(tree);
    expect(out).toContain('bbbbbbbbbbbbbbbb <missing>');
  });

  test('cycle renders <cycle>', async () => {
    const a = rec({ id: 'aaaaaaaaaaaaaaaa', parents: ['bbbbbbbbbbbbbbbb'] });
    const b = rec({ id: 'bbbbbbbbbbbbbbbb', parents: ['aaaaaaaaaaaaaaaa'] });
    const tree = await buildTree(a.id, fakeLookup([a, b]));
    const out = formatTree(tree);
    expect(out).toContain('aaaaaaaaaaaaaaaa <cycle>');
  });
});

describe('buildDescendantTree', () => {
  test('linear chain root → mid → leaf walks both children', () => {
    const root = rec({ id: 'aaaaaaaaaaaaaaaa', recordedAt: '2026-04-25T00:00:00.000Z' });
    const mid = rec({
      id: 'bbbbbbbbbbbbbbbb',
      recordedAt: '2026-04-26T00:00:00.000Z',
      parents: [root.id],
    });
    const leaf = rec({
      id: 'cccccccccccccccc',
      recordedAt: '2026-04-27T00:00:00.000Z',
      parents: [mid.id],
    });
    const tree = buildDescendantTree(root.id, [root, mid, leaf]);
    expect(tree.id).toBe(root.id);
    expect(tree.marker).toBe('ok');
    expect(tree.parents).toHaveLength(1);
    expect(tree.parents[0]?.id).toBe(mid.id);
    expect(tree.parents[0]?.parents[0]?.id).toBe(leaf.id);
    expect(tree.parents[0]?.parents[0]?.parents).toEqual([]);
  });

  test('descendants from mid walks only the leaf — root is NOT visited', () => {
    const root = rec({ id: 'aaaaaaaaaaaaaaaa' });
    const mid = rec({ id: 'bbbbbbbbbbbbbbbb', parents: [root.id] });
    const leaf = rec({ id: 'cccccccccccccccc', parents: [mid.id] });
    const tree = buildDescendantTree(mid.id, [root, mid, leaf]);
    expect(tree.id).toBe(mid.id);
    expect(tree.parents).toHaveLength(1);
    expect(tree.parents[0]?.id).toBe(leaf.id);
  });

  test('diamond: descendant visited via two paths is rendered twice (path-distinct, not cycle)', () => {
    const root = rec({ id: 'aaaaaaaaaaaaaaaa' });
    const left = rec({ id: 'bbbbbbbbbbbbbbbb', parents: [root.id] });
    const right = rec({ id: 'cccccccccccccccc', parents: [root.id] });
    const leaf = rec({ id: 'dddddddddddddddd', parents: [left.id, right.id] });
    const tree = buildDescendantTree(root.id, [root, left, right, leaf]);
    // root has two children (left, right); each has the leaf as its only child;
    // the path-set tracks ancestors, so leaf is NOT a cycle on either path.
    expect(tree.parents.map((p) => p.id).sort()).toEqual([left.id, right.id]);
    expect(tree.parents[0]?.parents[0]?.id).toBe(leaf.id);
    expect(tree.parents[0]?.parents[0]?.marker).toBe('ok');
    expect(tree.parents[1]?.parents[0]?.id).toBe(leaf.id);
    expect(tree.parents[1]?.parents[0]?.marker).toBe('ok');
  });

  test('cycle: descendant walk marks <cycle> on revisit via path-set', () => {
    // Hand-crafted cycle: a's parent is b; b's parent is a. Descending from a:
    // a → (children including b) → b → (children including a) → a is now in the
    // ancestor-path set, so it's marked cycle.
    const a = rec({ id: 'aaaaaaaaaaaaaaaa', parents: ['bbbbbbbbbbbbbbbb'] });
    const b = rec({ id: 'bbbbbbbbbbbbbbbb', parents: ['aaaaaaaaaaaaaaaa'] });
    const tree = buildDescendantTree(a.id, [a, b]);
    expect(tree.id).toBe(a.id);
    expect(tree.marker).toBe('ok');
    // a's child is b (because b.parents includes a)
    expect(tree.parents[0]?.id).toBe(b.id);
    // b's child is a, but a is on the path → cycle
    expect(tree.parents[0]?.parents[0]?.id).toBe(a.id);
    expect(tree.parents[0]?.parents[0]?.marker).toBe('cycle');
  });

  test('root not in allRecords returns missing-marker node', () => {
    const tree = buildDescendantTree('aaaaaaaaaaaaaaaa', []);
    expect(tree.marker).toBe('missing');
    expect(tree.parents).toEqual([]);
  });

  test('children sorted by recordedAt ASC then id ASC', () => {
    const root = rec({ id: 'aaaaaaaaaaaaaaaa' });
    const c1 = rec({
      id: 'dddddddddddddddd',
      recordedAt: '2026-04-29T00:00:00.000Z',
      parents: [root.id],
    });
    const c2 = rec({
      id: 'bbbbbbbbbbbbbbbb',
      recordedAt: '2026-04-27T00:00:00.000Z',
      parents: [root.id],
    });
    const c3 = rec({
      id: 'cccccccccccccccc',
      recordedAt: '2026-04-28T00:00:00.000Z',
      parents: [root.id],
    });
    // Same recordedAt as c2 — should sort after c2 by id (cccc... > bbbb...).
    const c4 = rec({
      id: 'eeeeeeeeeeeeeeee',
      recordedAt: '2026-04-27T00:00:00.000Z',
      parents: [root.id],
    });
    const tree = buildDescendantTree(root.id, [root, c1, c2, c3, c4]);
    expect(tree.parents.map((p) => p.id)).toEqual([
      'bbbbbbbbbbbbbbbb', // 04-27
      'eeeeeeeeeeeeeeee', // 04-27 (after by id)
      'cccccccccccccccc', // 04-28
      'dddddddddddddddd', // 04-29
    ]);
  });

  test('formatTree works identically on descendant trees (direction-agnostic)', () => {
    const root = rec({ id: 'aaaaaaaaaaaaaaaa', recordedAt: '2026-04-25T00:00:00.000Z' });
    const mid = rec({
      id: 'bbbbbbbbbbbbbbbb',
      type: 'brief',
      recordedAt: '2026-04-26T00:00:00.000Z',
      parents: [root.id],
    });
    const tree = buildDescendantTree(root.id, [root, mid]);
    const out = formatTree(tree);
    expect(out).toBe(
      [
        'aaaaaaaaaaaaaaaa [type=note] 2026-04-25T00:00:00.000Z',
        '└── bbbbbbbbbbbbbbbb [type=brief] 2026-04-26T00:00:00.000Z',
        '',
      ].join('\n'),
    );
  });
});

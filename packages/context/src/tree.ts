import type { ContextRecord } from './types.js';

export type TreeNodeMarker = 'ok' | 'missing' | 'cycle';

export interface TreeNode {
  id: string;
  type: string | null;
  recordedAt: string | null;
  parents: TreeNode[];
  marker: TreeNodeMarker;
}

export type RecordLookup = (id: string) => Promise<ContextRecord | null>;

export async function buildTree(rootId: string, lookup: RecordLookup): Promise<TreeNode> {
  return walk(rootId, lookup, new Set<string>());
}

async function walk(id: string, lookup: RecordLookup, ancestors: Set<string>): Promise<TreeNode> {
  if (ancestors.has(id)) {
    return { id, type: null, recordedAt: null, parents: [], marker: 'cycle' };
  }
  const rec = await lookup(id);
  if (rec === null) {
    return { id, type: null, recordedAt: null, parents: [], marker: 'missing' };
  }
  const next = new Set(ancestors);
  next.add(id);
  const parents: TreeNode[] = [];
  for (const parentId of rec.parents) {
    parents.push(await walk(parentId, lookup, next));
  }
  return {
    id,
    type: rec.type,
    recordedAt: rec.recordedAt,
    parents,
    marker: 'ok',
  };
}

/**
 * Walk the DAG **down** from `rootId`, returning a tree of descendants. Records
 * know their parents but not their children, so we invert the parents list
 * across `allRecords` once into a child index, then DFS down. Children of each
 * node are sorted by `recordedAt` ASC then `id` ASC for deterministic output.
 *
 * The returned `TreeNode.parents` field literally holds the next edges to walk
 * — for descendant trees, that's children. The field name is reused so
 * `formatTree` works identically in either direction.
 */
export function buildDescendantTree(rootId: string, allRecords: ContextRecord[]): TreeNode {
  const childIndex = new Map<string, ContextRecord[]>();
  for (const rec of allRecords) {
    for (const parentId of rec.parents) {
      const list = childIndex.get(parentId);
      if (list === undefined) childIndex.set(parentId, [rec]);
      else list.push(rec);
    }
  }
  for (const list of childIndex.values()) {
    list.sort((a, b) => {
      if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
  }
  const byId = new Map(allRecords.map((r) => [r.id, r]));
  return walkDown(rootId, byId, childIndex, new Set<string>());
}

function walkDown(
  id: string,
  byId: Map<string, ContextRecord>,
  childIndex: Map<string, ContextRecord[]>,
  ancestors: Set<string>,
): TreeNode {
  if (ancestors.has(id)) {
    return { id, type: null, recordedAt: null, parents: [], marker: 'cycle' };
  }
  const rec = byId.get(id);
  if (rec === undefined) {
    return { id, type: null, recordedAt: null, parents: [], marker: 'missing' };
  }
  const next = new Set(ancestors);
  next.add(id);
  const children: TreeNode[] = [];
  for (const child of childIndex.get(id) ?? []) {
    children.push(walkDown(child.id, byId, childIndex, next));
  }
  return {
    id,
    type: rec.type,
    recordedAt: rec.recordedAt,
    parents: children,
    marker: 'ok',
  };
}

function nodeLabel(node: TreeNode): string {
  if (node.marker === 'missing') return `${node.id} <missing>`;
  if (node.marker === 'cycle') return `${node.id} <cycle>`;
  return `${node.id} [type=${node.type}] ${node.recordedAt}`;
}

export function formatTree(node: TreeNode): string {
  const lines: string[] = [];
  lines.push(nodeLabel(node));
  appendChildren(node.parents, '', lines);
  return `${lines.join('\n')}\n`;
}

function appendChildren(children: TreeNode[], prefix: string, lines: string[]): void {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    const isLast = i === children.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    lines.push(`${prefix}${branch}${nodeLabel(child)}`);
    appendChildren(child.parents, prefix + childPrefix, lines);
  }
}

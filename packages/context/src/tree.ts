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

import { createHash } from 'node:crypto';

export interface HashRecordInput {
  type: string;
  parents: readonly string[];
  payload: unknown;
}

const HASH_LENGTH = 16;

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    const parts = value.map((item) => canonicalJson(item));
    return `[${parts.join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

export function hashRecord(input: HashRecordInput): string {
  const dedupedSorted = [...new Set(input.parents)].sort();
  const canonical = canonicalJson({
    type: input.type,
    parents: dedupedSorted,
    payload: input.payload,
  });
  const digest = createHash('sha256').update(canonical).digest('hex');
  return digest.slice(0, HASH_LENGTH);
}

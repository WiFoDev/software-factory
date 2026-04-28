import { createHash } from 'node:crypto';

export interface HashRequestInput {
  method: string;
  url: string;
  body: string | null;
  headers: Record<string, string>;
}

export interface HashRequestOptions {
  hashHeaders?: string[];
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

function pickHeaderSubset(
  headers: Record<string, string>,
  hashHeaders: readonly string[],
): Record<string, string> {
  if (hashHeaders.length === 0) return {};
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lowered[k.toLowerCase()] = v;
  }
  const subset: Record<string, string> = {};
  for (const name of hashHeaders) {
    const key = name.toLowerCase();
    const value = lowered[key];
    if (value !== undefined) subset[key] = value;
  }
  return subset;
}

export function hashRequest(input: HashRequestInput, options: HashRequestOptions = {}): string {
  const hashHeaders = options.hashHeaders ?? [];
  const canonical = canonicalJson({
    method: input.method.toUpperCase(),
    url: input.url,
    body: input.body,
    headers: pickHeaderSubset(input.headers, hashHeaders),
  });
  const digest = createHash('sha256').update(canonical).digest('hex');
  return digest.slice(0, HASH_LENGTH);
}

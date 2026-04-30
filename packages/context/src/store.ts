import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import { ContextError } from './errors.js';
import { hashRecord } from './hash.js';
import { listRecords, readRecord, writeRecord } from './store-fs.js';
import type { ContextRecord } from './types.js';

export interface CreateContextStoreOptions {
  dir: string;
}

export interface PutOptions {
  parents?: string[];
}

export interface ListOptions {
  type?: string;
}

export interface ContextStore {
  register: <T>(type: string, schema: ZodType<T>) => void;
  put: <T>(type: string, payload: T, opts?: PutOptions) => Promise<string>;
  get: (id: string) => Promise<ContextRecord | null>;
  list: (opts?: ListOptions) => Promise<ContextRecord[]>;
  parents: (id: string) => Promise<string[] | null>;
}

function dedupePreserveOrder(parents: readonly string[]): string[] {
  return [...new Set(parents)];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function createContextStore(options: CreateContextStoreOptions): ContextStore {
  const dir = options.dir;
  const registry = new Map<string, ZodType<unknown>>();

  const store: ContextStore = {
    register<T>(type: string, schema: ZodType<T>): void {
      if (registry.has(type)) {
        throw new ContextError(
          'context/duplicate-registration',
          `type already registered: ${type}`,
        );
      }
      registry.set(type, schema as ZodType<unknown>);
    },

    async put<T>(type: string, payload: T, opts: PutOptions = {}): Promise<string> {
      const schema = registry.get(type);
      if (schema === undefined) {
        throw new ContextError('context/unregistered-type', `type not registered: ${type}`);
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new ContextError(
          'context/schema-validation-failed',
          `payload failed validation for type '${type}'`,
          { issues: parsed.error.issues },
        );
      }
      const dedupedParents = dedupePreserveOrder(opts.parents ?? []);
      for (const parentId of dedupedParents) {
        const parentPath = join(dir, `${parentId}.json`);
        if (!(await fileExists(parentPath))) {
          throw new ContextError(
            'context/parent-missing',
            `declared parent does not exist: ${parentId}`,
            { missingParent: parentId },
          );
        }
      }
      const id = hashRecord({ type, parents: dedupedParents, payload: parsed.data });
      const record: ContextRecord = {
        version: 1,
        id,
        type,
        recordedAt: new Date().toISOString(),
        parents: dedupedParents,
        payload: parsed.data,
      };
      await writeRecord(dir, record);
      return id;
    },

    async get(id: string): Promise<ContextRecord | null> {
      return readRecord(dir, id);
    },

    async list(opts: ListOptions = {}): Promise<ContextRecord[]> {
      const result = await listRecords(dir);
      if (opts.type === undefined) return result.records;
      return result.records.filter((r) => r.type === opts.type);
    },

    async parents(id: string): Promise<string[] | null> {
      const rec = await readRecord(dir, id);
      if (rec === null) return null;
      return rec.parents;
    },
  };

  return store;
}

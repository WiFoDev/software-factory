import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getFrontmatterJsonSchema } from '../src/json-schema';

const out = resolve(import.meta.dir, '../dist/spec.schema.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(getFrontmatterJsonSchema(), null, 2)}\n`);
console.log(`Wrote ${out}`);

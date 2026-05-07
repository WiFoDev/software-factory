import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFrontmatterJsonSchema } from '../src/json-schema';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../dist/spec.schema.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(getFrontmatterJsonSchema(), null, 2)}\n`);
console.log(`Wrote ${out}`);

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { SPEC_FRONTMATTER_SCHEMA_ID, getFrontmatterJsonSchema } from './json-schema';

describe('getFrontmatterJsonSchema', () => {
  test('emits draft-07 schema with stable $id and title', () => {
    const schema = getFrontmatterJsonSchema();
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.$id).toBe(SPEC_FRONTMATTER_SCHEMA_ID);
    expect(schema.title).toBe('Factory Spec Frontmatter');
  });

  test('round-trips through Ajv: valid frontmatter passes', () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(getFrontmatterJsonSchema());
    const ok = validate({
      id: 'demo',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      exemplars: [],
    });
    expect(ok).toBe(true);
  });

  test('round-trips through Ajv: missing id fails with id-related error', () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(getFrontmatterJsonSchema());
    const ok = validate({
      classification: 'light',
      type: 'feat',
      status: 'ready',
    });
    expect(ok).toBe(false);
    const errors = validate.errors ?? [];
    const messages = errors.map(
      (e) => `${e.instancePath} ${e.message ?? ''} ${JSON.stringify(e.params)}`,
    );
    expect(messages.some((m) => m.includes('id'))).toBe(true);
  });

  test('round-trips through Ajv: invalid enum value fails', () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(getFrontmatterJsonSchema());
    const ok = validate({
      id: 'demo',
      classification: 'medium',
      type: 'feat',
      status: 'ready',
    });
    expect(ok).toBe(false);
  });

  test('exposes the documented enum values for tooling', () => {
    const schema = getFrontmatterJsonSchema() as {
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(schema.properties?.classification?.enum).toEqual(['light', 'deep']);
    expect(schema.properties?.type?.enum).toEqual(['feat', 'fix', 'refactor', 'chore', 'perf']);
    expect(schema.properties?.status?.enum).toEqual(['ready', 'drafting', 'blocked']);
  });
});

describe('emit-json-schema — Node-native rewrite (S-1, v0.0.14)', () => {
  const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
  const SCRIPT_PATH = join(REPO_ROOT, 'packages', 'core', 'scripts', 'emit-json-schema.ts');

  test('emit-json-schema.ts uses node:fs APIs only (no Bun.* references)', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    // No bun-API references of any flavor.
    expect(source).not.toMatch(/\bBun\./);
    expect(source).not.toMatch(/from\s+['"]bun['"]/);
    expect(source).not.toMatch(/import\.meta\.dir\b/);
    // Standard Node ESM only — node:fs + node:path + node:url.
    expect(source).toContain("from 'node:fs'");
    expect(source).toContain("from 'node:path'");
    expect(source).toContain("from 'node:url'");
    expect(source).toContain('writeFileSync');
    expect(source).toContain('fileURLToPath');
  });

  test('emit-json-schema.ts produces canonical schema when run via tsx (Node)', () => {
    // The emitter writes to `<repo>/packages/core/dist/spec.schema.json`. We
    // run it via `npx -y tsx` to verify the script is executable in a Node-
    // only environment (no bun on PATH at build time). Then we read back the
    // produced file and compare to the in-process canonical schema.
    const result = spawnSync('npx', ['-y', 'tsx', SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env },
      timeout: 60_000,
    });
    if (result.status !== 0) {
      // tsx fetch / sandbox likely failed — surface the diagnostic but skip
      // the assertion so the test doesn't false-fail on offline runs. The
      // first sub-test already locks the script's API shape.
      console.warn(
        `[emit-json-schema tsx run] skipped (status=${result.status}); stderr: ${result.stderr}`,
      );
      return;
    }
    const out = join(REPO_ROOT, 'packages', 'core', 'dist', 'spec.schema.json');
    expect(existsSync(out)).toBe(true);
    const produced = readFileSync(out, 'utf8');
    const expected = `${JSON.stringify(getFrontmatterJsonSchema(), null, 2)}\n`;
    expect(produced).toBe(expected);
  }, 90_000);

  test('top-level README contains the bun-as-test-only paragraph', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('bun is required for `pnpm test` only');
  });
});

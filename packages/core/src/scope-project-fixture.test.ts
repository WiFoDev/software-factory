import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSpec } from './parser.js';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const FIXTURE_DIR = resolve(REPO_ROOT, 'docs/baselines/scope-project-fixtures/url-shortener');

describe('scope-project URL-shortener fixture', () => {
  test('url-shortener fixture: 4 specs in linear dep order', () => {
    expect(existsSync(FIXTURE_DIR)).toBe(true);
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(4);
    const ids = files.map((f) => {
      const source = readFileSync(resolve(FIXTURE_DIR, f), 'utf8');
      return parseSpec(source).frontmatter.id;
    });
    // The 4 fixture ids match the canonical URL-shortener decomposition.
    expect(new Set(ids)).toEqual(
      new Set([
        'url-shortener-core',
        'url-shortener-redirect',
        'url-shortener-tracking',
        'url-shortener-stats',
      ]),
    );
  });

  test('url-shortener fixture: status assignment matches first-ready / rest-drafting rule', () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.md'));
    const specs = files.map((f) => {
      const source = readFileSync(resolve(FIXTURE_DIR, f), 'utf8');
      return parseSpec(source);
    });
    const readyCount = specs.filter((s) => s.frontmatter.status === 'ready').length;
    const draftingCount = specs.filter((s) => s.frontmatter.status === 'drafting').length;
    expect(readyCount).toBe(1);
    expect(draftingCount).toBe(3);
    // The single ready spec is the root of the dep chain.
    const readySpec = specs.find((s) => s.frontmatter.status === 'ready');
    expect(readySpec?.frontmatter['depends-on']).toEqual([]);
  });

  test('url-shortener fixture: depends-on edges form an acyclic chain ending at url-shortener-core', () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.md'));
    const specs = files.map((f) => {
      const source = readFileSync(resolve(FIXTURE_DIR, f), 'utf8');
      return parseSpec(source);
    });
    const byId = new Map(specs.map((s) => [s.frontmatter.id, s]));
    // Walk from each spec's deps until we reach the root (`url-shortener-core`)
    // or detect a cycle. With a 4-spec linear chain, max walk depth is 4.
    for (const spec of specs) {
      const seen = new Set<string>([spec.frontmatter.id]);
      const queue = [...spec.frontmatter['depends-on']];
      let reachedRoot = spec.frontmatter.id === 'url-shortener-core';
      while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined) break;
        expect(seen.has(id)).toBe(false); // No cycle.
        seen.add(id);
        if (id === 'url-shortener-core') {
          reachedRoot = true;
        }
        const dep = byId.get(id);
        if (dep === undefined) continue;
        for (const d of dep.frontmatter['depends-on']) queue.push(d);
      }
      expect(reachedRoot).toBe(true);
    }
  });

  test('url-shortener fixture: every spec is LIGHT classification', () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const source = readFileSync(resolve(FIXTURE_DIR, f), 'utf8');
      const spec = parseSpec(source);
      expect(spec.frontmatter.classification).toBe('light');
    }
  });

  test('url-shortener fixture: every depends-on entry references a fixture-set id', () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.md'));
    const specs = files.map((f) => {
      const source = readFileSync(resolve(FIXTURE_DIR, f), 'utf8');
      return parseSpec(source);
    });
    const ids = new Set(specs.map((s) => s.frontmatter.id));
    for (const spec of specs) {
      for (const dep of spec.frontmatter['depends-on']) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });

  test('url-shortener fixtures HTTP spec contains a smoke-boot scenario', () => {
    // url-shortener-redirect is the HTTP-introducing spec — it should ship a
    // smoke-boot scenario matching the canonical shape from the slash command's
    // worked example.
    const httpSpecPath = resolve(FIXTURE_DIR, 'url-shortener-redirect.md');
    expect(existsSync(httpSpecPath)).toBe(true);
    const source = readFileSync(httpSpecPath, 'utf8');
    expect(source).toContain('boots the production entrypoint on the configured port');
    expect(source).toContain(
      'test: src/main.test.ts "boots the production entrypoint on the configured port"',
    );
    // The smoke-boot scenario triggers off the `createServer` / `Bun.serve` patterns
    // present in the redirect spec.
    expect(source).toMatch(/createServer/);
  });
});

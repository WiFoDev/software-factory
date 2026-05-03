import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const ARCHIVED_PROMPT = resolve(REPO_ROOT, 'docs/baselines/url-shortener-prompt-v0.0.5-v0.0.7.md');
const CURRENT_PROMPT = resolve(REPO_ROOT, 'docs/baselines/url-shortener-prompt.md');
const BASELINE_DOC = resolve(REPO_ROOT, 'BASELINE.md');

const ARCHIVE_MARKER =
  '# URL shortener — canonical baseline prompt (v0.0.5–v0.0.7 era; archived 2026-05-03)';

describe('baseline-reset v0.0.8 — archived prompt (S-1)', () => {
  test('archived prompt exists at versioned path with byte-identical body', () => {
    expect(existsSync(ARCHIVED_PROMPT)).toBe(true);
    const source = readFileSync(ARCHIVED_PROMPT, 'utf8');
    // Body = everything after the prepended dated marker. The pre-reset prompt
    // (canonical from v0.0.5 ship through v0.0.7 ship) was preserved verbatim
    // below the marker. These anchor strings span the original prompt's setup,
    // body, JOURNAL.md template, and rules sections — collectively they pin
    // that the archived body is the v0.0.5-v0.0.7 prompt, not a rewrite.
    const body = source.slice(source.indexOf('\n') + 1);
    // Original first line (v0.0.5-v0.0.7 era heading) is preserved verbatim.
    expect(body.startsWith('# URL shortener — canonical baseline prompt\n')).toBe(true);
    // Setup section preserved verbatim.
    expect(body).toContain('mkdir ~/dev/url-shortener-v<X.Y.Z> && cd ~/dev/url-shortener-v<X.Y.Z>');
    expect(body).toContain('Use a **fresh directory outside the software-factory monorepo**');
    // Product description preserved verbatim.
    expect(body).toContain('A JSON-over-HTTP URL shortener. In-memory storage.');
    expect(body).toContain('`POST /shorten { url }` → `{ slug }`');
    expect(body).toContain('`GET /:slug` → 302 redirect');
    expect(body).toContain(
      'Bun + native `Bun.serve` only. No Express, no DB, no frontend, no auth.',
    );
    // The archived (v0.0.5-v0.0.7) era's manual-decomposition framing is preserved.
    // (Anchor strings chosen to be line-wrap-stable: the original prompt body
    // line-wraps mid-phrase in places, so these are the contiguous segments.)
    expect(body).toContain("### Why we're decomposing manually");
    expect(body).toContain("it doesn't ship until later");
    expect(body).toContain('### The four specs, in dependency order');
    expect(body).toContain('url-shortener-core');
    expect(body).toContain('url-shortener-redirect');
    expect(body).toContain('url-shortener-tracking');
    expect(body).toContain('url-shortener-stats');
    // Per-spec workflow + JOURNAL.md header + rules preserved.
    expect(body).toContain('`pnpm exec factory spec lint`');
    expect(body).toContain('# url-shortener — factory baseline run');
    expect(body).toContain('## Decomposition (manual; /scope-project ships in v0.0.6)');
    expect(body).toContain('Use Bun for tests (`bun test src`).');
    expect(body).toContain('friction\n  IS the artifact.');
  });

  test("archived prompt's first line is the dated archive marker", () => {
    const source = readFileSync(ARCHIVED_PROMPT, 'utf8');
    const firstLine = source.split('\n')[0];
    expect(firstLine).toBe(ARCHIVE_MARKER);
  });
});

describe('baseline-reset v0.0.8 — new canonical prompt (S-2)', () => {
  test('new prompt contains /scope-project entry point + run-sequence convergence step', () => {
    const source = readFileSync(CURRENT_PROMPT, 'utf8');
    expect(source).toContain(
      '/scope-project A URL shortener with click tracking and JSON stats. JSON-over-HTTP, in-memory, no auth.',
    );
    expect(source).toContain('factory-runtime run-sequence docs/specs/');
  });

  test('new prompt does not contain v0.0.7-future-tense biases', () => {
    const source = readFileSync(CURRENT_PROMPT, 'utf8');
    // None of the archived prompt's "the new tools don't ship yet" framings.
    expect(source).not.toContain('is a v0.0.6 deliverable');
    expect(source).not.toContain("it doesn't ship until later");
    expect(source).not.toContain("decomposition is the maintainer's job");
    // Specifically: the four-spec list must not appear as a prescribed
    // decomposition (the four ids mentioned together would re-create the
    // archived prompt's manual-decomposition shortcut). It is enough to
    // assert that none of the four spec ids appear individually — the new
    // canonical instructs the agent to invoke /scope-project and review
    // whatever the slash command emits, never naming specific spec ids.
    expect(source).not.toContain('url-shortener-core');
    expect(source).not.toContain('url-shortener-redirect');
    expect(source).not.toContain('url-shortener-tracking');
    expect(source).not.toContain('url-shortener-stats');
    // No v0.0.5.x backtick-stripping warning (v0.0.6 fixed that — relitigating
    // it here would re-introduce noise the runtime no longer needs).
    expect(source).not.toContain('backtick-stripping');
    expect(source).not.toMatch(/known backtick.{0,40}bug/i);
  });

  test('new prompt preserves the product description from the archived version', () => {
    const newSrc = readFileSync(CURRENT_PROMPT, 'utf8');
    const archivedSrc = readFileSync(ARCHIVED_PROMPT, 'utf8');
    // The "What we're building" section block (verbatim across archive +
    // new canonical) — the four endpoints + Bun + no-Express constraint.
    const productDescription = [
      "### What we're building",
      '',
      'A JSON-over-HTTP URL shortener. In-memory storage. Four endpoints, four specs, four runs.',
      '',
      '1. `POST /shorten { url }` → `{ slug }`     (6-char base62; idempotent on the same URL)',
      '2. `GET /:slug` → 302 redirect              (404 if missing)',
      '3. Click tracking on every redirect          (timestamp + user-agent, in-memory log)',
      '4. `GET /stats/:slug` → `{ clicks, lastClickedAt }`',
      '',
      'Bun + native `Bun.serve` only. No Express, no DB, no frontend, no auth.',
    ].join('\n');
    expect(archivedSrc).toContain(productDescription);
    expect(newSrc).toContain(productDescription);
  });
});

describe('baseline-reset v0.0.8 — BASELINE.md methodology section (S-3)', () => {
  test('BASELINE.md methodology section names the v0.0.8 reset event + archived path', () => {
    const source = readFileSync(BASELINE_DOC, 'utf8');
    // The methodology section gained a "Baseline reset events" subsection.
    expect(source).toContain('### Baseline reset events');
    // The forward-compat invariant for every reset is documented.
    expect(source).toMatch(/<product>-prompt-vX\.Y\.Z-vA\.B\.C\.md/);
    // The v0.0.8 reset event is named with date, trigger, archived path, new entry point.
    expect(source).toContain('v0.0.8 reset');
    expect(source).toContain('2026-05-03');
    // Trigger references the v0.0.7 cluster (/scope-project + depends-on + run-sequence).
    expect(source).toContain('/scope-project');
    expect(source).toContain('depends-on');
    expect(source).toContain('run-sequence');
    // Archived path is named.
    expect(source).toContain('docs/baselines/url-shortener-prompt-v0.0.5-v0.0.7.md');
    // New canonical's entry point is named (the literal /scope-project invocation).
    expect(source).toContain(
      '/scope-project A URL shortener with click tracking and JSON stats. JSON-over-HTTP, in-memory, no auth.',
    );
  });
});

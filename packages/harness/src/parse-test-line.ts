export interface ParsedTestLine {
  /** Test file path. Undefined when the satisfaction value is pattern-only. */
  file?: string;
  /** Pattern passed to `bun test -t <pattern>`. */
  pattern?: string;
}

const TEST_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'] as const;

// v0.0.12: stylistic apostrophes drift between a spec's `test:` line and the
// test's actual `it()` name (curly vs ASCII; with vs without). Strip every
// quote-like character on BOTH sides of the substring comparison so the match
// is robust to that drift. Locked set: ASCII apostrophe + double-quote, curly
// singles + doubles (U+2018/U+2019/U+201C/U+201D), and backticks.
const QUOTE_CHARS_RE = /['"`‘’“”]/g;

/**
 * Normalize a test-name pattern for substring comparison: strips quote-like
 * characters (apostrophes, smart quotes, backticks) so a stylistic drop
 * between spec and code doesn't cause a no-match. Apply to BOTH the pattern
 * and the candidate test name before comparing.
 */
export function normalizeTestNamePattern(s: string): string {
  return s.replace(QUOTE_CHARS_RE, '');
}

function looksLikeFile(token: string): boolean {
  if (token.includes('/') || token.includes('\\')) return true;
  return TEST_EXTENSIONS.some((ext) => token.endsWith(ext));
}

function stripQuotes(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripBackticks(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse a `test:` satisfaction value into `{ file?, pattern? }`.
 *
 * Accepted forms:
 *   - `src/foo.test.ts`                → { file: 'src/foo.test.ts' }
 *   - `src/foo.test.ts "happy path"`   → { file, pattern: 'happy path' }
 *   - `src/foo.test.ts happy path`     → { file, pattern: 'happy path' }
 *   - `"happy path"` or `happy path`   → { pattern: 'happy path' }  (no file)
 *
 * Surrounding double quotes are stripped from the pattern. The pattern is
 * passed verbatim to `bun test -t <pattern>`; users are responsible for
 * regex-escaping metacharacters.
 */
export function parseTestLine(value: string): ParsedTestLine {
  const trimmed = value.trim();
  if (trimmed === '') return {};

  // Pattern-only: leading double quote → entire value is a quoted pattern.
  if (trimmed.startsWith('"')) {
    const pattern = stripQuotes(trimmed);
    return pattern === '' ? {} : { pattern };
  }

  const firstSpace = trimmed.search(/\s/);
  if (firstSpace < 0) {
    const token = stripBackticks(trimmed);
    if (looksLikeFile(token)) return { file: token };
    return { pattern: token };
  }

  const head = stripBackticks(trimmed.slice(0, firstSpace));
  const tail = trimmed.slice(firstSpace + 1).trim();

  if (looksLikeFile(head)) {
    const pattern = stripBackticks(stripQuotes(tail));
    if (pattern === '') return { file: head };
    return { file: head, pattern };
  }

  return { pattern: stripBackticks(stripQuotes(trimmed)) };
}

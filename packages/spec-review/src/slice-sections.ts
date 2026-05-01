// Regex-walk a spec body for the canonical `## ` headings used in every spec
// in this repo today. Reviewer judges that depend on a specific section read
// from the returned slice. Missing section → undefined → caller emits
// `review/section-missing` (info severity) rather than crashing.

import type { Spec } from '@wifo/factory-core';

export interface SlicedSections {
  intent?: string;
  constraints?: string;
  subtasks?: string;
  dod?: string;
  scenarios?: string;
  holdouts?: string;
  headingLines: {
    intent?: number;
    constraints?: number;
    subtasks?: number;
    dod?: number;
    scenarios?: number;
    holdouts?: number;
  };
}

const CANONICAL_HEADINGS: Record<string, keyof Omit<SlicedSections, 'headingLines'>> = {
  '## Intent': 'intent',
  '## Constraints / Decisions': 'constraints',
  '## Subtasks': 'subtasks',
  '## Definition of Done': 'dod',
  '## Scenarios': 'scenarios',
  '## Holdout Scenarios': 'holdouts',
};

/**
 * Extract canonical sections from `spec.body`, with fenced code block
 * awareness (a `## Heading` inside a fenced block is NOT a section heading).
 *
 * Heading line numbers are absolute 1-based with respect to the original
 * source — to compute them we count newlines in `spec.raw.source` up to the
 * heading's location. Since `spec.body` strips the frontmatter, we add the
 * frontmatter line count back to get an absolute position.
 */
export function sliceSections(spec: Spec): SlicedSections {
  const result: SlicedSections = { headingLines: {} };
  const body = spec.body;
  // Count the leading lines in raw.source up to the body so we can convert
  // body-relative line numbers to absolute. Find the body's offset in source.
  const source = spec.raw.source;
  const bodyStart = source.indexOf(body);
  const bodyStartLine = bodyStart === -1 ? 1 : source.slice(0, bodyStart).split('\n').length;

  const lines = body.split('\n');
  let inFence = false;

  // Track which sections we've seen + the line number where they start, so a
  // second pass can slice [headingLine .. nextHeadingLine).
  const found: Array<{ key: keyof Omit<SlicedSections, 'headingLines'>; lineIdx: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line.startsWith('## ')) continue;
    // Trim trailing whitespace before matching (tolerant per H-3 case b).
    const trimmed = line.replace(/\s+$/, '');
    const key = CANONICAL_HEADINGS[trimmed];
    if (key !== undefined) {
      found.push({ key, lineIdx: i });
    }
  }

  for (let f = 0; f < found.length; f++) {
    const cur = found[f];
    if (!cur) continue;
    const next = found[f + 1];
    // Slice excludes the heading line itself; includes everything up to (but
    // not including) the next heading line, or end-of-body.
    const sliceStart = cur.lineIdx + 1;
    const sliceEnd = next?.lineIdx ?? lines.length;
    const slice = lines.slice(sliceStart, sliceEnd).join('\n').trim();
    if (slice.length > 0) {
      result[cur.key] = slice;
    }
    // Heading line is absolute (body line + body's offset in source).
    result.headingLines[cur.key] = bodyStartLine + cur.lineIdx;
  }

  return result;
}

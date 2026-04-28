export interface FrontmatterSplit {
  /** YAML text between the opening and closing `---` fences. */
  yaml: string;
  /** Markdown body following the closing fence. */
  body: string;
  /** 1-based line number of the opening `---` fence. */
  fenceStartLine: number;
  /** 1-based line number of the first YAML line inside the fences. */
  yamlStartLine: number;
  /** 1-based line number of the first body line after the closing fence. */
  bodyStartLine: number;
}

export class FrontmatterError extends Error {
  readonly line: number | undefined;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'FrontmatterError';
    this.line = line;
  }
}

const FENCE = /^---\s*$/;

/**
 * Split a markdown document into YAML frontmatter and body.
 *
 * Strict: the document must begin with `---` (optionally preceded by blank lines)
 * and a matching closing `---` must exist. Throws FrontmatterError otherwise.
 *
 * Line numbers are 1-based and absolute to the input source so callers can map
 * downstream errors back to the original file.
 */
export function splitFrontmatter(source: string): FrontmatterSplit {
  const lines = source.split(/\r?\n/);

  let openIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.trim() === '') continue;
    if (FENCE.test(line)) {
      openIdx = i;
      break;
    }
    throw new FrontmatterError('document must start with `---` frontmatter fence', i + 1);
  }
  if (openIdx < 0) {
    throw new FrontmatterError('document is empty or contains no frontmatter');
  }

  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (FENCE.test(line)) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) {
    throw new FrontmatterError('frontmatter fence is not closed', openIdx + 1);
  }

  const yamlLines = lines.slice(openIdx + 1, closeIdx);
  const bodyLines = lines.slice(closeIdx + 1);

  return {
    yaml: yamlLines.join('\n'),
    body: bodyLines.join('\n'),
    fenceStartLine: openIdx + 1,
    yamlStartLine: openIdx + 2,
    bodyStartLine: closeIdx + 2,
  };
}

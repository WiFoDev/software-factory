import { YAMLParseError, parse as parseYaml } from 'yaml';
import { FrontmatterError, splitFrontmatter } from './frontmatter.js';
import { findSection, parseScenarios } from './scenarios.js';
import { type Spec, SpecFrontmatterSchema } from './schema.js';

export interface ParseSpecOptions {
  filename?: string;
}

export interface ParseIssue {
  message: string;
  line?: number;
  code: string;
}

export class SpecParseError extends Error {
  readonly issues: ParseIssue[];
  constructor(issues: ParseIssue[]) {
    super(issues.map((i) => i.message).join('; ') || 'spec parse failed');
    this.name = 'SpecParseError';
    this.issues = issues;
  }
}

/**
 * Parse a complete spec document. Throws SpecParseError when the document is
 * structurally unreadable, when the YAML cannot be parsed, or when the
 * frontmatter does not satisfy the schema.
 *
 * Use the lower-level primitives (`splitFrontmatter`, `findSection`,
 * `parseScenarios`, `SpecFrontmatterSchema.safeParse`) when partial recovery
 * is needed — that's what `lintSpec` does to aggregate every error in one pass.
 */
export function parseSpec(source: string, opts: ParseSpecOptions = {}): Spec {
  const issues: ParseIssue[] = [];

  let split: ReturnType<typeof splitFrontmatter>;
  try {
    split = splitFrontmatter(source);
  } catch (err) {
    if (err instanceof FrontmatterError) {
      throw new SpecParseError([
        { message: err.message, line: err.line, code: 'frontmatter/structural' },
      ]);
    }
    throw err;
  }

  let yamlValue: unknown;
  try {
    yamlValue = parseYaml(split.yaml, { prettyErrors: true });
  } catch (err) {
    if (err instanceof YAMLParseError) {
      const offset = split.yamlStartLine - 1;
      const yamlLine = err.linePos?.[0]?.line;
      const line = typeof yamlLine === 'number' ? yamlLine + offset : split.fenceStartLine;
      throw new SpecParseError([
        { message: `YAML parse error: ${err.message}`, line, code: 'frontmatter/yaml' },
      ]);
    }
    throw err;
  }

  const parsed = SpecFrontmatterSchema.safeParse(yamlValue);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        message: `${issue.path.join('.') || '<root>'}: ${issue.message}`,
        line: split.yamlStartLine,
        code: `frontmatter/${issue.code}`,
      });
    }
    throw new SpecParseError(issues);
  }

  const scenariosSection = findSection(source, 'Scenarios');
  const holdoutsSection = findSection(source, 'Holdout Scenarios');

  return {
    frontmatter: parsed.data,
    body: split.body,
    scenarios: scenariosSection ? parseScenarios(scenariosSection, 'scenario') : [],
    holdouts: holdoutsSection ? parseScenarios(holdoutsSection, 'holdout') : [],
    raw: { source, ...(opts.filename !== undefined ? { filename: opts.filename } : {}) },
  };
}

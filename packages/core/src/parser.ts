import { YAMLParseError, parse as parseYaml } from 'yaml';
import { FrontmatterError, splitFrontmatter } from './frontmatter.js';
import { type SectionExtract, findSection, parseScenarios } from './scenarios.js';
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

/**
 * v0.0.10 — A `## Definition of Done` bullet, classified for `dodPhase`
 * dispatch. `kind: 'shell'` bullets are run via Bash from the run's cwd;
 * `kind: 'judge'` bullets are dispatched to the harness judge client.
 */
export type DodBullet =
  | { kind: 'shell'; command: string; line: number; raw: string }
  | { kind: 'judge'; criterion: string; line: number; raw: string };

// Conservative allowlist (locked v0.0.10): only commands whose first
// whitespace-separated word is one of these — or that begin with `./` or
// `../` (relative-path script) — are classified as `shell`. Everything else
// → `judge`. New runners require a point-release update.
const DOD_SHELL_ALLOWLIST = new Set([
  'pnpm',
  'bun',
  'npm',
  'node',
  'tsc',
  'git',
  'npx',
  'bash',
  'sh',
  'make',
  'pwd',
  'ls',
]);

const DOD_BULLET_LINE = /^\s*[-*]\s+(.*)$/;
const DOD_BACKTICK_TOKEN = /`([^`]+)`/g;

/**
 * v0.0.10 — Parse the `## Definition of Done` section into classified
 * bullets. Returns `[]` when the section is absent. Each `- ` (or `* `)
 * top-level bullet becomes one `DodBullet`. Classification rules:
 *
 *   - Exactly ONE backtick-wrapped token AND its first word is in the locked
 *     allowlist (or starts with `./` / `../`) → `kind: 'shell'`, `command`
 *     is the inner text.
 *   - Multiple backtick-wrapped tokens → `kind: 'judge'` (ambiguous).
 *   - Zero backticks → `kind: 'judge'` (plain prose).
 *   - Single backtick whose first word is NOT allowlisted → `kind: 'judge'`
 *     (conservative; prevents accidental shell injection from prose).
 *
 * `line` is 1-indexed within the spec's full source — derived from
 * `section.headingLine` so a `findSection(spec.body, ...)` walked source
 * line-numbers up to v0.0.10's caller (validatePhase / dodPhase) and
 * `findSection(spec.raw.source, ...)` indexes from the source's true
 * top. The DoD section is parsed against whatever input `findSection`
 * was given.
 */
export function parseDodBullets(section: SectionExtract | null): DodBullet[] {
  if (section === null) return [];
  const bullets: DodBullet[] = [];
  for (let idx = 0; idx < section.lines.length; idx++) {
    const rawLine = section.lines[idx];
    if (rawLine === undefined) continue;
    const m = DOD_BULLET_LINE.exec(rawLine);
    if (!m || m[1] === undefined) continue;
    const body = m[1];
    const line = section.headingLine + 1 + idx;
    const tokens = [...body.matchAll(DOD_BACKTICK_TOKEN)]
      .map((t) => t[1])
      .filter((t): t is string => t !== undefined);
    if (tokens.length === 1) {
      const command = (tokens[0] ?? '').trim();
      const firstWord = command.split(/\s+/)[0] ?? '';
      const isAllowlisted =
        DOD_SHELL_ALLOWLIST.has(firstWord) ||
        firstWord.startsWith('./') ||
        firstWord.startsWith('../');
      if (isAllowlisted) {
        bullets.push({ kind: 'shell', command, line, raw: rawLine });
        continue;
      }
    }
    bullets.push({ kind: 'judge', criterion: body.trim(), line, raw: rawLine });
  }
  return bullets;
}

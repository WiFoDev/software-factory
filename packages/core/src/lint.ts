import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { YAMLParseError, parse as parseYaml } from 'yaml';
import { FrontmatterError, splitFrontmatter } from './frontmatter.js';
import { findSection, parseScenarios } from './scenarios.js';
import { KEBAB_ID_REGEX, type Scenario, SpecFrontmatterSchema } from './schema.js';

export type LintSeverity = 'error' | 'warning';

export interface LintError {
  file?: string;
  line?: number;
  severity: LintSeverity;
  code: string;
  message: string;
}

export interface LintOptions {
  filename?: string;
  /**
   * v0.0.7 — when set, `lintSpec` validates each `depends-on` entry resolves
   * to a file under `<cwd>/docs/specs/<id>.md` or `<cwd>/docs/specs/done/<id>.md`,
   * emitting a `spec/depends-on-missing` warning when missing. Absent → only
   * id-format checks run. CLI sets this; programmatic callers may opt out.
   */
  cwd?: string;
}

export function lintSpec(source: string, opts: LintOptions = {}): LintError[] {
  const errors: LintError[] = [];
  const filename = opts.filename;

  const push = (err: Omit<LintError, 'file'>) => {
    errors.push({ ...err, ...(filename !== undefined ? { file: filename } : {}) });
  };

  const noqa = parseNoqaDirectives(source);

  let split: ReturnType<typeof splitFrontmatter>;
  try {
    split = splitFrontmatter(source);
  } catch (err) {
    if (err instanceof FrontmatterError) {
      push({
        line: err.line,
        severity: 'error',
        code: 'frontmatter/structural',
        message: err.message,
      });
      return errors;
    }
    throw err;
  }

  let yamlValue: unknown = null;
  try {
    yamlValue = parseYaml(split.yaml, { prettyErrors: true });
  } catch (err) {
    if (err instanceof YAMLParseError) {
      const offset = split.yamlStartLine - 1;
      const yamlLine = err.linePos?.[0]?.line;
      push({
        line: typeof yamlLine === 'number' ? yamlLine + offset : split.fenceStartLine,
        severity: 'error',
        code: 'frontmatter/yaml',
        message: `YAML parse error: ${err.message}`,
      });
    } else {
      throw err;
    }
  }

  let parsedFrontmatter: ReturnType<typeof SpecFrontmatterSchema.safeParse> | undefined;
  if (yamlValue !== null && yamlValue !== undefined) {
    const parsed = SpecFrontmatterSchema.safeParse(yamlValue);
    parsedFrontmatter = parsed;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || '<root>';
        let code = 'frontmatter/invalid';
        let message = `${path}: ${issue.message}`;
        if (issue.code === 'invalid_type' && issue.message.includes('Required')) {
          code = 'frontmatter/missing-field';
          message = `Missing required field: ${path}`;
        } else if (issue.code === 'invalid_enum_value') {
          code = 'frontmatter/invalid-enum';
        } else if (issue.code === 'unrecognized_keys') {
          // Surfaces below as a warning instead.
          continue;
        }
        push({
          line: split.yamlStartLine,
          severity: 'error',
          code,
          message,
        });
      }
      // Surface unknown-field issues as warnings (separate pass for clarity).
      for (const issue of parsed.error.issues) {
        if (issue.code !== 'unrecognized_keys') continue;
        const keys = (issue as { keys?: string[] }).keys ?? [];
        for (const key of keys) {
          push({
            line: split.yamlStartLine,
            severity: 'warning',
            code: 'frontmatter/unknown-field',
            message: `Unknown frontmatter field: ${key}`,
          });
        }
      }
    }
  }

  // v0.0.7 — depends-on validation. Runs only when frontmatter parsed cleanly.
  if (parsedFrontmatter?.success === true) {
    const deps = parsedFrontmatter.data['depends-on'];
    for (let i = 0; i < deps.length; i++) {
      const entry = deps[i];
      if (entry === undefined) continue;
      if (!KEBAB_ID_REGEX.test(entry)) {
        push({
          line: split.yamlStartLine,
          severity: 'error',
          code: 'spec/invalid-depends-on',
          message: `depends-on[${i}]: '${entry}' does not match kebab-case id pattern (^[a-z][a-z0-9-]*$)`,
        });
      }
    }
    if (opts.cwd !== undefined) {
      const cwd = opts.cwd;
      for (const entry of deps) {
        if (!KEBAB_ID_REGEX.test(entry)) continue;
        const activePath = resolve(cwd, 'docs', 'specs', `${entry}.md`);
        const donePath = resolve(cwd, 'docs', 'specs', 'done', `${entry}.md`);
        if (!existsSync(activePath) && !existsSync(donePath)) {
          push({
            line: split.yamlStartLine,
            severity: 'warning',
            code: 'spec/depends-on-missing',
            message: `depends-on: '${entry}' not found under docs/specs/ or docs/specs/done/`,
          });
        }
      }
    }
  }

  const dodSection = findSection(source, 'Definition of Done');
  if (dodSection) {
    for (let idx = 0; idx < dodSection.lines.length; idx++) {
      const line = dodSection.lines[idx];
      if (line === undefined) continue;
      const m = DOD_BULLET_RE.exec(line);
      if (!m || m[1] === undefined) continue;
      const body = m[1];
      if (!DOD_GATE_KEYWORDS_RE.test(body)) continue;
      if (DOD_BACKTICK_SPAN_RE.test(body)) continue;
      push({
        line: dodSection.headingLine + 1 + idx,
        severity: 'warning',
        code: 'spec/dod-needs-explicit-command',
        message:
          "DoD bullet looks like a runtime gate but doesn't embed a backtick-wrapped shell command. Add the literal command, e.g.: 'typecheck clean (`pnpm typecheck`)'",
      });
    }
  }

  const subtasksSection = findSection(source, 'Subtasks');
  if (subtasksSection) {
    const body = subtasksSection.lines.join('\n');
    const PATH_REGEX =
      /(?:(?:packages|docs|src|examples|test-fixtures|scripts)\/[\w./\-]+|\b\w[\w./\-]*\.(?:md|ts|tsx|js|jsx|json|sh|yaml|yml|toml))/g;
    const matches = body.match(PATH_REGEX) ?? [];
    const seen = new Set<string>();
    for (const m of matches) {
      seen.add(m.toLowerCase());
    }
    if (seen.size >= 12) {
      push({
        line: subtasksSection.headingLine,
        severity: 'warning',
        code: 'spec/wide-blast-radius',
        message: `## Subtasks references ${seen.size} distinct file paths; specs touching >= 12 files commonly exceed the 600s implement-phase budget. Consider splitting or setting agent-timeout-ms in frontmatter.`,
      });
    }
  }

  const scenariosSection = findSection(source, 'Scenarios');
  if (!scenariosSection) {
    push({
      severity: 'warning',
      code: 'scenarios/missing-section',
      message: 'No `## Scenarios` section found.',
    });
  } else {
    const scenarios = parseScenarios(scenariosSection, 'scenario');
    if (scenarios.length === 0) {
      push({
        line: scenariosSection.headingLine,
        severity: 'warning',
        code: 'scenarios/empty-section',
        message: '`## Scenarios` section contains no scenarios.',
      });
    } else {
      for (const scenario of scenarios) {
        for (const err of lintScenario(scenario)) push(err);
      }
    }
  }

  const holdoutsSection = findSection(source, 'Holdout Scenarios');
  if (holdoutsSection) {
    const holdouts = parseScenarios(holdoutsSection, 'holdout');
    for (const scenario of holdouts) {
      for (const err of lintScenario(scenario)) push(err);
    }
  }

  return applyNoqa(errors, noqa);
}

interface NoqaState {
  /** Specific spec/* codes to suppress (per-code form). */
  codes: Set<string>;
  /** Blanket form (`<!-- NOQA -->` / `<!-- NOQA: -->`) — suppresses every `spec/*` warning. */
  blanket: boolean;
}

const NOQA_LINE_REGEX = /<!--[ \t]*NOQA(?::[ \t]*([^>]*?))?[ \t]*-->/gi;

function parseNoqaDirectives(source: string): NoqaState {
  const state: NoqaState = { codes: new Set(), blanket: false };
  for (const match of source.matchAll(NOQA_LINE_REGEX)) {
    const list = (match[1] ?? '').trim();
    if (list === '') {
      state.blanket = true;
      continue;
    }
    for (const raw of list.split(',')) {
      const code = raw.trim();
      if (code !== '') state.codes.add(code);
    }
  }
  return state;
}

function applyNoqa(errors: LintError[], noqa: NoqaState): LintError[] {
  if (!noqa.blanket && noqa.codes.size === 0) return errors;
  return errors.filter((err) => {
    // NOQA only ever suppresses warnings — errors always fire.
    if (err.severity !== 'warning') return true;
    if (noqa.codes.has(err.code)) return false;
    if (noqa.blanket && err.code.startsWith('spec/')) return false;
    return true;
  });
}

/**
 * Read a spec file from disk and lint it. The default `cwd` is the spec's
 * `<file>/../..` (i.e., the project root if the spec lives under `docs/specs/`).
 * Pass `opts.cwd` explicitly to override.
 */
export function lintSpecFile(filePath: string, opts: LintOptions = {}): LintError[] {
  const source = readFileSync(filePath, 'utf8');
  const cwd = opts.cwd ?? resolve(filePath, '..', '..', '..');
  return lintSpec(source, {
    ...opts,
    filename: opts.filename ?? filePath,
    cwd,
  });
}

function lintScenario(scenario: Scenario): Omit<LintError, 'file'>[] {
  const errors: Omit<LintError, 'file'>[] = [];
  const where = `Scenario ${scenario.id}`;
  if (scenario.given.trim() === '') {
    errors.push({
      line: scenario.line,
      severity: 'error',
      code: 'scenario/missing-given',
      message: `${where} is missing a Given clause.`,
    });
  }
  if (scenario.when.trim() === '') {
    errors.push({
      line: scenario.line,
      severity: 'error',
      code: 'scenario/missing-when',
      message: `${where} is missing a When clause.`,
    });
  }
  if (scenario.then.trim() === '') {
    errors.push({
      line: scenario.line,
      severity: 'error',
      code: 'scenario/missing-then',
      message: `${where} is missing a Then clause.`,
    });
  }
  // `test:` is required only for visible scenarios. Holdouts are checked at
  // end-of-task review and are not bound to a specific test path.
  if (scenario.kind === 'scenario') {
    const hasTest = scenario.satisfaction.some((s) => s.kind === 'test');
    if (!hasTest) {
      errors.push({
        line: scenario.line,
        severity: 'error',
        code: 'scenario/missing-test',
        message: `${where} has no \`- test:\` satisfaction line.`,
      });
    }
  }
  // v0.0.12 — surface non-ASCII quote chars in `test:` patterns. The harness
  // normalizes at run-time as a safety net, but flagging at scope-time lets
  // the author rewrite cleanly.
  for (const sat of scenario.satisfaction) {
    if (sat.kind !== 'test') continue;
    if (NON_ASCII_QUOTE_RE.test(sat.value)) {
      errors.push({
        line: sat.line,
        severity: 'warning',
        code: 'spec/test-name-quote-chars',
        message:
          'test name pattern uses non-ASCII quote characters; normalize to \' or " before run-time',
      });
    }
  }
  return errors;
}

const NON_ASCII_QUOTE_RE = /[‘’“”]/;

const DOD_BULLET_RE = /^\s*[-*]\s+(.*)$/;
const DOD_BACKTICK_SPAN_RE = /`[^`]+`/;
const DOD_GATE_KEYWORDS_RE = /\b(typecheck|tests?|lint|check|build|green|clean|passes?)\b/i;

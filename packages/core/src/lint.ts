import { YAMLParseError, parse as parseYaml } from 'yaml';
import { FrontmatterError, splitFrontmatter } from './frontmatter.js';
import { findSection, parseScenarios } from './scenarios.js';
import { type Scenario, SpecFrontmatterSchema } from './schema.js';

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
}

export function lintSpec(source: string, opts: LintOptions = {}): LintError[] {
  const errors: LintError[] = [];
  const filename = opts.filename;

  const push = (err: Omit<LintError, 'file'>) => {
    errors.push({ ...err, ...(filename !== undefined ? { file: filename } : {}) });
  };

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

  if (yamlValue !== null && yamlValue !== undefined) {
    const parsed = SpecFrontmatterSchema.safeParse(yamlValue);
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

  return errors;
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
  return errors;
}

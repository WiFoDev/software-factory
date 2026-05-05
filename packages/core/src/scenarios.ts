import type { Scenario, ScenarioSatisfaction, SpecScenarioKind } from './schema.js';

const SCENARIO_MARKER = /^\s*\*\*([SH]-\d+)\*\*\s*(?:—|--)?\s*(.*)$/;
const KEYWORD_LINE = /^(\s*)(Given|When|Then)\b\s*(.*)$/i;
const SATISFACTION_HEADER = /^\s*Satisfaction\s*:\s*$/i;
const SATISFACTION_ENTRY = /^\s*-\s*(test|judge)\s*:\s*(.+?)\s*$/i;
const SECTION_HEADING = /^##\s+(.+?)\s*$/;

export interface SectionExtract {
  /** Lines of the section body (excluding the heading line). */
  lines: string[];
  /** 1-based line number of the `##` heading in the source. */
  headingLine: number;
}

/**
 * Find a level-2 section by its heading text. Returns the lines after the heading
 * up to (but not including) the next `## ` heading or EOF, plus the heading's
 * absolute line number. Returns null if the heading is not present.
 */
export function findSection(source: string, heading: string): SectionExtract | null {
  const lines = source.split(/\r?\n/);
  const target = heading.trim().toLowerCase();
  let headingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const match = SECTION_HEADING.exec(line);
    if (match && match[1] !== undefined && match[1].trim().toLowerCase() === target) {
      headingIndex = i;
      break;
    }
  }
  if (headingIndex < 0) return null;
  const sectionLines: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (SECTION_HEADING.test(line)) break;
    sectionLines.push(line);
  }
  return { lines: sectionLines, headingLine: headingIndex + 1 };
}

interface ScenarioBlock {
  id: string;
  name: string;
  markerLine: number;
  bodyLines: { text: string; line: number }[];
}

function splitBlocks(section: SectionExtract): ScenarioBlock[] {
  const blocks: ScenarioBlock[] = [];
  let current: ScenarioBlock | null = null;
  section.lines.forEach((rawLine, idx) => {
    const line = rawLine;
    const absLine = section.headingLine + 1 + idx;
    const match = SCENARIO_MARKER.exec(line);
    if (match && match[1] !== undefined) {
      if (current) blocks.push(current);
      const name = (match[2] ?? '').trim();
      current = {
        id: match[1],
        name,
        markerLine: absLine,
        bodyLines: [],
      };
      return;
    }
    if (current) current.bodyLines.push({ text: line, line: absLine });
  });
  if (current) blocks.push(current);
  return blocks;
}

interface KeywordEntry {
  value: string;
  line: number;
}

interface ParsedBody {
  given: KeywordEntry | null;
  when: KeywordEntry | null;
  then: KeywordEntry | null;
  satisfaction: ScenarioSatisfaction[];
  satisfactionStartLine: number | null;
}

function parseBlockBody(block: ScenarioBlock): ParsedBody {
  const result: ParsedBody = {
    given: null,
    when: null,
    then: null,
    satisfaction: [],
    satisfactionStartLine: null,
  };

  type Section = 'none' | 'given' | 'when' | 'then' | 'satisfaction';
  let section: Section = 'none';
  let baseIndent = 0;
  let inCodeFence = false;

  const setKeyword = (key: 'given' | 'when' | 'then', entry: KeywordEntry) => {
    result[key] = entry;
  };

  const appendContinuation = (text: string) => {
    if (section === 'given' && result.given) {
      result.given = { value: `${result.given.value} ${text}`.trim(), line: result.given.line };
    } else if (section === 'when' && result.when) {
      result.when = { value: `${result.when.value} ${text}`.trim(), line: result.when.line };
    } else if (section === 'then' && result.then) {
      result.then = { value: `${result.then.value} ${text}`.trim(), line: result.then.line };
    }
  };

  for (const { text, line } of block.bodyLines) {
    // Worked-example fenced code blocks may contain their own Given/When/Then
    // and Satisfaction:/test: lines that must NOT be mistaken for the
    // scenario's actual content. Toggle on each ``` fence and skip everything
    // between.
    if (text.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    if (text.trim() === '') {
      // Blank line ends a continuation streak but doesn't end the block.
      continue;
    }

    const sat = SATISFACTION_HEADER.exec(text);
    if (sat) {
      section = 'satisfaction';
      result.satisfactionStartLine = line;
      continue;
    }

    if (section === 'satisfaction') {
      const entry = SATISFACTION_ENTRY.exec(text);
      if (entry && entry[1] !== undefined && entry[2] !== undefined) {
        const kind = entry[1].toLowerCase() as 'test' | 'judge';
        const value = entry[2].replace(/^"(.*)"$/, '$1');
        result.satisfaction.push({ kind, value, line });
      }
      continue;
    }

    const kw = KEYWORD_LINE.exec(text);
    if (kw && kw[2] !== undefined && kw[3] !== undefined) {
      const indent = kw[1] ?? '';
      baseIndent = indent.length;
      const keyword = kw[2].toLowerCase() as 'given' | 'when' | 'then';
      section = keyword;
      setKeyword(keyword, { value: kw[3].trim(), line });
      continue;
    }

    if (section === 'given' || section === 'when' || section === 'then') {
      const indentMatch = /^(\s*)/.exec(text);
      const indent = indentMatch && indentMatch[1] !== undefined ? indentMatch[1].length : 0;
      if (indent > baseIndent) {
        appendContinuation(text.trim());
      }
    }
  }

  return result;
}

export function parseScenarios(section: SectionExtract, kind: SpecScenarioKind): Scenario[] {
  const scenarios: Scenario[] = [];
  for (const block of splitBlocks(section)) {
    const body = parseBlockBody(block);
    scenarios.push({
      id: block.id,
      name: block.name,
      given: body.given?.value ?? '',
      when: body.when?.value ?? '',
      then: body.then?.value ?? '',
      satisfaction: body.satisfaction,
      line: block.markerLine,
      kind,
    });
  }
  return scenarios;
}

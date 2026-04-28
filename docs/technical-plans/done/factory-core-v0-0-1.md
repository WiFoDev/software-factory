# Technical Plan — `@wifo/factory-core` v0.0.1

## 1. Context

- `packages/core/` is scaffolded but empty: only `export {}` in `src/index.ts`.
- `package.json` declares `bin.factory` → `dist/cli.js`, depends on `zod@^3`, dev-deps `@types/bun`, runs tests with `bun test`. Build is `tsc` only.
- TS config: ESM (`module: ESNext`), `verbatimModuleSyntax`, strict + `noUncheckedIndexedAccess`. All type imports must use `import type`; every array index access needs a guard.
- Biome enforces single quotes, semicolons, trailing commas, no `any`, no non-null assertion.
- The spec format is canonically defined in `docs/SPEC_TEMPLATE.md`. The schema must mirror it: frontmatter (`id`, `classification`, `type`, `status`, `exemplars[]`) and body sections (`## Intent`, `## Scenarios`, optional `## Holdout Scenarios`, `## Constraints / Decisions`, optional `## Open Questions`, `## Subtasks`, `## Definition of Done`).
- v0.0.1 lints only what we can mechanically verify: frontmatter shape and scenario well-formedness. Sections like `## Intent` or `## Subtasks` are surfaced in the parsed entry but not validated semantically.

## 2. Architecture Decisions

### Library choices

| Concern | Choice | Rationale |
|---|---|---|
| YAML parsing | `yaml@^2` (eemeli/yaml) | Smaller and more focused than `gray-matter`. We write our own line-aware frontmatter splitter so we control error positions. |
| JSON Schema export | `zod-to-json-schema@^3` | Idiomatic. Generated at runtime so the JSON Schema is always in sync with the zod definition. |
| CLI args | `node:util` `parseArgs` | Zero deps. Subcommand dispatch (`factory spec lint`, `factory spec schema`) is handled manually on `argv[0]`/`argv[1]`; `parseArgs` consumes the remainder per subcommand. |
| File walking | `node:fs` `readdirSync({ recursive: true })` + extension filter | Native on Node 22; no glob dep needed. |
| Markdown parsing | None (line-based parser) | We only need section-aware splitting + Given/When/Then extraction. A full MD AST is overkill. |

### Module layout

```
src/
├── schema.ts          # zod SpecFrontmatterSchema + types
├── frontmatter.ts     # splitFrontmatter(text) → { yaml, body, bodyStartLine }
├── scenarios.ts       # parseScenarioBlock(section) → Scenario[]
├── parser.ts          # parseSpec(markdown) → Spec (composes the above)
├── lint.ts            # lintSpec(markdown, filename?) → LintError[]
├── json-schema.ts     # getFrontmatterJsonSchema()
├── cli.ts             # `factory spec lint` / `factory spec schema`
└── index.ts           # public API
```

Tests live next to source: `src/<name>.test.ts` (`bun test` picks them up).

### Public API (exports from `index.ts`)

```ts
export { SpecFrontmatterSchema, SpecScenarioSatisfactionSchema } from './schema';
export type { SpecFrontmatter, Spec, Scenario, ScenarioSatisfaction } from './schema';
export { parseSpec } from './parser';
export { lintSpec } from './lint';
export type { LintError, LintSeverity } from './lint';
export { getFrontmatterJsonSchema } from './json-schema';
```

### Data model

```ts
SpecFrontmatter = {
  id: string;
  classification: 'light' | 'deep';
  type: 'feat' | 'fix' | 'refactor' | 'chore' | 'perf';
  status: 'ready' | 'drafting' | 'blocked';
  exemplars: { path: string; why: string }[];   // default []
};

ScenarioSatisfaction = { kind: 'test' | 'judge'; value: string; line: number };

Scenario = {
  id: string;            // 'S-1', 'H-1' etc — preserved as-written
  name: string;
  given: string;
  when: string;
  then: string;
  satisfaction: ScenarioSatisfaction[];
  line: number;          // 1-based line where the scenario marker sits
  kind: 'scenario' | 'holdout';
};

Spec = {
  frontmatter: SpecFrontmatter;
  body: string;
  scenarios: Scenario[];
  holdouts: Scenario[];
  raw: { source: string; filename?: string };
};
```

### Error model

```ts
type LintSeverity = 'error' | 'warning';
type LintError = {
  file?: string;
  line?: number;          // 1-based
  severity: LintSeverity;
  code: string;           // 'frontmatter/missing-field', 'scenario/missing-test', …
  message: string;
};
```

`parseSpec` is permissive — it returns whatever it can extract and surfaces structural failures by throwing a typed `SpecParseError` only when the document is too malformed to read (e.g., no closing `---`). `lintSpec` calls `parseSpec`, catches, and converts everything to `LintError[]`. The parser stays usable by upstream tools (harness/runtime); the CLI gets a clean aggregation point.

### Frontmatter parsing strategy

Don't use `gray-matter` — it swallows YAML line numbers. Custom splitter walks lines:

- First non-blank line must be `---`.
- Collect lines until next `---`.
- Pass YAML to `yaml.parse(..., { prettyErrors: true })`. Map YAML `linePos` back into the document by adding `firstFenceLine + 1`.
- Body starts on the line after the closing fence; track `bodyStartLine` so all downstream line numbers are absolute.

### Scenario parsing strategy

1. Split body into sections on `^## ` headings.
2. For `## Scenarios` and `## Holdout Scenarios`, walk lines looking for `**S-…**` or `**H-…**` markers (regex `/^\*\*([SH]-\d+)\*\*\s*(?:—|--)\s*(.+)$/`).
3. For each scenario, expect `Given`, `When`, `Then` lines (case-insensitive, optional indent). Multi-line values: continuation is any indented line until the next keyword line.
4. `Satisfaction:` is optional but lint flags its absence. Inside it, lines `- test: ...` and `- judge: "..."` are collected.
5. Holdouts use the same parser, fed the holdouts section.

### Frontmatter strictness (resolved)

- zod `.strict()` on the frontmatter schema.
- Unknown top-level fields produce a `frontmatter/unknown-field` **warning** (not error) — domain packs will extend the format via a registration mechanism in a later layer; v0.0.1 is deliberately tight but doesn't break extension experiments.

### JSON Schema distribution (resolved)

- Runtime `getFrontmatterJsonSchema()` is the source of truth.
- Build step also emits `dist/spec.schema.json` for editor intellisense (VS Code YAML extension users reference it via `$schema`).
- Build script: a tiny post-`tsc` step (Bun script invoked from `package.json`'s `build`).

### CLI surface

```
factory spec lint <path>             # file or directory; recurses *.md; exits 1 on errors
factory spec schema [--out <file>]   # prints JSON Schema or writes to file
```

Directory mode: recurse via `readdirSync({ recursive: true })`, filter `.md` only.

Dispatch: `argv[0]` must be `spec`; `argv[1]` selects `lint` or `schema`; remaining argv is fed to `parseArgs` per subcommand. Anything else prints usage to stderr and exits 2.

Output for `lint`:

```
docs/TASKS.md:42  error  scenario/missing-test     Scenario S-2 has no `- test:` satisfaction line.
docs/TASKS.md:7   error  frontmatter/invalid-enum  classification must be one of: light, deep
2 errors
```

Exit 0 with `OK` to stdout when clean.

## 3. Risk Assessment

- **Blast radius**: zero — package is empty; nothing else in the repo imports it yet.
- **Schema drift between SPEC_TEMPLATE.md and zod**: medium risk over time. Mitigated by adding `docs/SPEC_TEMPLATE.md` itself as a fixture in tests — if the canonical template ever stops parsing cleanly, CI fails.
- **YAML library coupling**: `yaml@^2` returns plain JS objects → no leak into public types.
- **Line number accuracy**: failure mode is bad UX, not bad output. Covered by holdouts (CRLF, multi-line Given, indented satisfaction).
- **`zod-to-json-schema` output stability**: pinning a minor range plus a snapshot test of the generated schema catches accidental upgrades that change shape.

## 4. Task breakdown summary

See `docs/specs/done/factory-core-v0-0-1.md` for the canonical subtask list with dependencies and DoD.

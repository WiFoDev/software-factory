import { readFileSync } from 'node:fs';

// Embedded templates for `factory init`. Kept separate from init.ts so the
// raw strings are easy to review and unit-test against the slugify scaffold.

export const PACKAGE_JSON_TEMPLATE = {
  name: '__NAME_PLACEHOLDER__',
  version: '0.0.0',
  description: '',
  private: true,
  type: 'module',
  scripts: {
    typecheck: 'tsc --noEmit',
    test: 'bun test src',
    check: 'biome check',
    build: 'tsc -p tsconfig.build.json',
  },
  dependencies: {
    '@wifo/factory-context': '^0.0.9',
    '@wifo/factory-core': '^0.0.9',
    '@wifo/factory-runtime': '^0.0.9',
  },
  devDependencies: {
    '@biomejs/biome': '^2.4.4',
    '@types/bun': '^1.1.14',
    '@wifo/factory-spec-review': '^0.0.9',
    typescript: '^5.6.0',
  },
} as const;

// Self-contained tsconfig — does NOT extend `../../tsconfig.json` (the
// monorepo-relative path doesn't resolve outside this repo). Inlines the
// strict + ES2022 + verbatimModuleSyntax + noUncheckedIndexedAccess settings
// the examples rely on so a fresh repo gets the same compiler discipline.
export const TSCONFIG_TEMPLATE = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    lib: ['ES2022'],
    types: ['bun'],
    strict: true,
    noUncheckedIndexedAccess: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    isolatedModules: true,
    verbatimModuleSyntax: true,
  },
  include: ['src/**/*'],
  exclude: ['node_modules', '.factory'],
} as const;

// Verbatim copy of examples/slugify/.gitignore — kept byte-equivalent so the
// scaffold matches what people copy by hand today.
export const GITIGNORE_TEMPLATE = `node_modules
.factory
*.log
.DS_Store
.factory-spec-review-cache
`;

// Reads the bundled `/scope-project` slash-command markdown shipped in the
// npm tarball at `<package-root>/commands/scope-project.md`. Resolves relative
// to this module's location so it works in source-tree (src/init-templates.ts
// → ../commands/scope-project.md) and post-build (dist/init-templates.js →
// ../commands/scope-project.md) contexts identically. Internal-only — NOT
// exported from `core/src/index.ts`.
export function readScopeProjectCommandTemplate(): string {
  const url = new URL('../commands/scope-project.md', import.meta.url);
  return readFileSync(url, 'utf8');
}

// Canonical defaults documented for the v0.0.5 URL-shortener workflow. Users
// edit to taste; CLI flags always override. Internal-only — NOT exported from
// `core/src/index.ts`.
export const FACTORY_CONFIG_TEMPLATE = {
  runtime: {
    maxIterations: 5,
    maxTotalTokens: 1000000,
    maxPromptTokens: 100000,
    noJudge: false,
  },
} as const;

// Minimal biome.json shipped with the scaffold so `pnpm check` resolves a real
// config out of the box. Mirrors the monorepo's biome.json shape (linter +
// formatter both on; recommended ruleset; src/** scoped) without project-
// specific overrides. JSON-serialized with 2-space indent. Internal-only —
// NOT exported from `core/src/index.ts`.
export const BIOME_CONFIG_TEMPLATE = `${JSON.stringify(
  {
    $schema: 'https://biomejs.dev/schemas/2.4.4/schema.json',
    linter: { enabled: true, rules: { recommended: true } },
    formatter: { enabled: true, indentWidth: 2, lineWidth: 100 },
    files: { include: ['src/**/*.ts', 'src/**/*.tsx'] },
  },
  null,
  2,
)}\n`;

export const README_TEMPLATE = `# {{name}}

A software-factory project. Specs live in \`docs/specs/\`; the agent loop
runs against them via \`pnpm exec factory-runtime run docs/specs/<id>.md\`.

## Setup

\`\`\`sh
pnpm install
\`\`\`

Resolves the \`@wifo/factory-*\` deps from the public npm registry.

## The loop

\`\`\`sh
# 1. Scope a task — writes docs/specs/<id>.md
/scope-task "<your feature description>"

# 2. Lint the spec
pnpm exec factory spec lint docs/specs/

# 3. Review the spec (LLM judges, subscription auth via \`claude -p\`)
pnpm exec factory spec review docs/specs/<id>.md

# 4. Run the autonomous loop (default 5 iterations, 500k token cap)
pnpm exec factory-runtime run docs/specs/<id>.md --context-dir ./.factory

# 5. Inspect what came out
pnpm exec factory-context tree <runId> --dir ./.factory --direction down

# 6. Archive the shipped spec
/finish-task <id>
\`\`\`

## Multi-spec products

Real products are sequences of 4-6 specs in dependency order — \`/scope-project\` decomposes a product description into that DAG, and \`factory-runtime run-sequence\` walks it.

\`\`\`sh
# Decompose a product description into 4-6 ordered specs:
/scope-project A URL shortener with click tracking. JSON-over-HTTP, in-memory.

# Lint + review the first spec:
pnpm exec factory spec lint docs/specs/
pnpm exec factory spec review docs/specs/<first-id>.md

# Walk the dependency DAG:
pnpm exec factory-runtime run-sequence docs/specs/ --no-judge
\`\`\`

\`factory init\` writes \`.claude/commands/scope-project.md\` automatically — the slash command is available in any Claude Code session opened in this project, with no user-level install required.

For a single feature (one spec, not a product), use \`/scope-task\` — it lives in your user-level \`~/.claude/commands/\` and applies to every project.

## Layout

\`\`\`
{{name}}/
├── package.json
├── tsconfig.json
├── .gitignore
├── src/                     # write your implementation + tests here
└── docs/
    ├── specs/
    │   └── done/            # /finish-task moves shipped specs here
    └── technical-plans/
        └── done/
\`\`\`

## Tips

- \`.factory/\` holds run records. It's gitignored — diffable history lives in commits.
- \`--no-judge\` skips LLM-judged satisfactions (no \`ANTHROPIC_API_KEY\` needed).
- \`--no-implement\` drops to validate-only mode (no \`claude\` spawn).
`;

// Embedded templates for `factory init`. Kept separate from init.ts so the
// raw strings are easy to review and unit-test against the slugify scaffold.

export const PACKAGE_JSON_TEMPLATE = {
  name: '__NAME_PLACEHOLDER__',
  version: '0.0.0',
  description: '',
  private: true,
  type: 'module',
  scripts: {},
  dependencies: {
    '@wifo/factory-context': '^0.0.4',
    '@wifo/factory-core': '^0.0.4',
    '@wifo/factory-runtime': '^0.0.4',
  },
  devDependencies: {
    '@types/bun': '^1.1.14',
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
`;

export const README_TEMPLATE = `# {{name}}

A software-factory project. Specs live in \`docs/specs/\`; the agent loop
runs against them via \`pnpm exec factory-runtime run docs/specs/<id>.md\`.

## Setup

\`\`\`sh
pnpm install
\`\`\`

> **v0.0.4 caveat:** the \`@wifo/factory-*\` packages are not yet published to
> npm (deferred to v0.0.5). Until then, \`pnpm install\` against this scaffold
> requires that the workspace resolve them locally — typically by running
> inside the software-factory monorepo, or by linking the packages via
> pnpm overrides.

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

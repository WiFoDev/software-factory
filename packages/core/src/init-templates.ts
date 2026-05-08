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
    // `--no-errors-on-unmatched` lets `pnpm check` exit 0 on a freshly-
    // scaffolded tree (only .gitkeeps exist; no .ts files yet). Without it,
    // Biome 2.x errors with "No files were processed" — exactly the v0.0.12
    // BASELINE first-contact friction this v0.0.13 spec closes.
    check: 'biome check --no-errors-on-unmatched',
    build: 'tsc -p tsconfig.build.json',
  },
  dependencies: {
    '@wifo/factory-context': '^0.0.14',
    '@wifo/factory-core': '^0.0.14',
    '@wifo/factory-runtime': '^0.0.14',
  },
  devDependencies: {
    '@biomejs/biome': '^2.4.4',
    '@types/bun': '^1.1.14',
    '@wifo/factory-spec-review': '^0.0.14',
    typescript: '^5.6.0',
  },
} as const;

// Self-contained tsconfig — does NOT extend `../../tsconfig.json` (the
// monorepo-relative path doesn't resolve outside this repo). Inlines the
// strict + ES2022 + verbatimModuleSyntax + noUncheckedIndexedAccess settings
// the examples rely on so a fresh repo gets the same compiler discipline.
//
// v0.0.14 — pre-formatted string (not JSON.stringify'd) so short array values
// (`lib`, `types`, `include`, `exclude`) stay single-line. With BIOME_JSON_TEMPLATE's
// `files.includes: ["**"]`, biome scans tsconfig.json on `pnpm check`; multi-line
// 1-2-element arrays would self-flag biome's lineWidth=100 rule.
export const TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["bun"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", ".factory"]
}
`;

// v0.0.13 — `.factory/` itself is tracked (a `.gitkeep` is committed) so users
// see the dir exists from the start; only the per-record subdirs the runtime
// writes (`worktrees/`, `twin-recordings/`) are gitignored. Verbatim copy of
// examples/slugify/.gitignore — kept byte-equivalent so the scaffold matches
// what people copy by hand today.
export const GITIGNORE_TEMPLATE = `node_modules
.factory/worktrees/
.factory/twin-recordings/
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
//
// v0.0.13 — adds `dod.template`: literal-command DoD bullets derived from the
// scaffold's `scripts: { typecheck, test, check }`. `/scope-project` reads this
// at spec-author time and emits the same block into every generated spec's
// `## Definition of Done`, so the v0.0.12 `spec/dod-needs-explicit-command`
// lint stays green from the first author. `build` is intentionally excluded —
// build is a publish prereq, not a per-spec DoD gate. Order matches the
// PACKAGE_JSON_TEMPLATE.scripts insertion order.
export const FACTORY_CONFIG_TEMPLATE = {
  runtime: {
    maxIterations: 5,
    maxTotalTokens: 1000000,
    maxPromptTokens: 100000,
    noJudge: false,
  },
  dod: {
    template: [
      'typecheck clean (`pnpm typecheck`)',
      'tests green (`pnpm test`)',
      'biome clean (`pnpm check`)',
    ],
  },
} as const;

// Minimal biome.json shipped with the scaffold so `pnpm check` resolves a real
// config out of the box. Mirrors the monorepo's biome.json shape (linter +
// formatter both on; recommended ruleset) without project-specific overrides.
// Internal-only — NOT exported from `core/src/index.ts`.
//
// v0.0.14 — pre-formatted string (not JSON.stringify'd) so short array values
// stay single-line: `"includes": ["**"]` not the multi-line array JSON.stringify
// would emit. The v0.0.13 BASELINE caught `pnpm check` self-flagging biome.json's
// own multi-line `includes` array under biome's lineWidth=100 rule. The
// `["**"]` glob also widens the scan to all scaffold files (biome.json,
// tsconfig.json, package.json, factory.config.json, src/**) so the day-zero
// `pnpm check` actually validates the scaffold rather than no-op'ing.
//
// v0.0.13 — schema migrated from Biome 1.x's `files.include` key to Biome 2.x's
// `files.includes` key. The schema major MUST stay in lockstep with the
// `@biomejs/biome` major pinned in `PACKAGE_JSON_TEMPLATE.devDependencies`
// (currently `^2.4.4`). If a future scaffold change bumps Biome to 3.x, this
// template must update in the same commit; otherwise `pnpm check` errors on
// schema-key parse failures against a freshly-scaffolded tree.
export const BIOME_JSON_TEMPLATE = `{
  "$schema": "https://biomejs.dev/schemas/2.4.4/schema.json",
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "files": { "includes": ["**"] }
}
`;

// v0.0.14 — stub source + test shipped in `src/` so the day-zero DoD gates
// (`pnpm typecheck`, `pnpm test`) have real input to operate on. Without these,
// tsc would compile zero files (exit 0 trivially is fine, but `bun test src`
// errors `no tests found`). Both stubs are intentionally tiny — agents
// overwrite them on first feature scope without ceremony.
export const INDEX_TS_TEMPLATE = `export const VERSION = "0.0.0";\n`;

export const INDEX_TEST_TEMPLATE = `import { expect, test } from "bun:test";
import { VERSION } from "./index.js";

test("VERSION exists", () => expect(VERSION).toBe("0.0.0"));
`;

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

## Prerequisites: bun is required for \`pnpm test\` only

**bun is required for \`pnpm test\` only** — the workspace's test runner is \`bun test src\` per package. \`pnpm build\` and \`pnpm typecheck\` are Node-native (Node 22+); \`pnpm install\` for consumers of the published \`@wifo/factory-*\` packages does NOT require bun.
`;

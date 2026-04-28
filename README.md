# software-factory

A project-agnostic toolkit for building AI-driven software factories. Inspired by the StrongDM Factory model: spec-driven development where agents converge on correctness through a tight loop of intent → validation harness → feedback.

## Status

Pre-alpha. Layer 0 (structured specs) is the current scope. Nothing here is published or stable yet.

## Layers (planned)

| Layer | Package | Purpose |
|---|---|---|
| 0 | `@wifo/factory-core` | Spec format, schema, parser, lint CLI |
| 1 | `@wifo/factory-harness` | Scenario runner with test + LLM-as-judge satisfaction |
| 2 | `@wifo/factory-twin` | Digital twin contract (record / replay / synthesize) |
| 3 | `@wifo/factory-context` | Context store interface (filesystem-first) |
| 4 | `@wifo/factory-runtime` | Phase-graph agent runtime |
| 5 | `@wifo/factory-scheduler` | Shift-work scheduler (autonomous task queue) |

Domain packs (`@wifo/factory-pack-web`, `-pack-api`, etc.) extend the core with domain-specific schema fields, judges, and twin presets.

## Repo layout

```
software-factory/
├── packages/
│   ├── core/           # @wifo/factory-core
│   └── harness/        # @wifo/factory-harness (pre-alpha)
└── docs/
    ├── SPEC_TEMPLATE.md
    ├── example-spec.md
    ├── specs/
    │   ├── <id>.md           # active spec (one per file)
    │   └── done/
    │       └── <id>.md       # finished, moved here for history
    └── technical-plans/
        ├── <id>.md           # optional supporting plan for DEEP specs
        └── done/
            └── <id>.md
```

## Spec convention

One spec per file, named after the spec's `id` frontmatter (kebab-case). Specs live in `docs/specs/`; their optional technical plans live in the parallel `docs/technical-plans/` tree (kept separate so the spec linter never trips over prose). Active work lives at the top of each tree; finished work is moved to `done/`. Lint every active spec with `factory spec lint docs/specs/` (recursive).

## License

MIT — see [LICENSE](./LICENSE).

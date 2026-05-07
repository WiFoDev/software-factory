---
id: factory-core-v0-0-13-init-ergonomics
classification: light
type: feat
status: ready
exemplars:
  - path: packages/core/src/init-templates.ts
    why: "scaffold templates. v0.0.13 fixes 3 first-contact frictions surfaced in v0.0.12 BASELINE: (a) biome.json key migration (Biome 2.x uses 'includes' not 'include'); (b) .factory/ pre-creation via .gitkeep + .gitignore additions; (c) factory.config.json gains dod.template?: string[] for /scope-project to consume."
  - path: packages/core/src/init.ts
    why: "init driver — writes the templates. v0.0.13 ships .factory/.gitkeep alongside the existing scaffold + appends factory dirs to .gitignore."
  - path: packages/core/commands/scope-project.md
    why: "slash command source — v0.0.13 reads dod.template from factory.config.json and uses it for the spec's DoD section instead of the canonical default."
  - path: BACKLOG.md
    why: "v0.0.13 entries 'factory init ships a biome.json matching the pinned Biome major' (#1, friction #1), 'factory init pre-creates .factory/' (#3), 'auto-emit literal-command DoD template' (#2). All three close in this spec."
depends-on: []
---

# factory-core-v0-0-13-init-ergonomics — close 3 init-scaffold first-contact frictions

## Intent

Three init-scaffold polishes that share `packages/core/src/init-templates.ts`. All surfaced in the v0.0.12 BASELINE as friction the dogfooder had to hand-patch on every fresh `factory init`: (1) biome.json's `"include"` key is Biome 1.x; the scaffold pins Biome 2.4.x where it's `"includes"` — `pnpm check` errors until you patch the JSON; (2) `.factory/` doesn't exist at init time, so `tee .factory/run-sequence.log` fails until the runtime creates the dir on first run; (3) the `spec/dod-needs-explicit-command` lint shipped in v0.0.12 fires four times per cluster on the natural-language DoD lines spec authors write — `/scope-project` could emit the literal-command DoD block from the start.

This spec ships first in the v0.0.13 cluster. Every downstream spec inherits the cleaner scaffold.

## Scenarios

**S-1** — Scaffold's `biome.json` matches the pinned Biome major's schema
  Given `factory init --name my-app` is invoked in a fresh tmp dir
  When the scaffold writes `biome.json`
  Then the file uses the `"includes"` key (Biome 2.x), not `"include"` (Biome 1.x). The scaffold's `package.json` pins `@biomejs/biome ^2.4.4`; the `biome.json` schema matches that major. Running `pnpm check` against the freshly-scaffolded tree exits 0 (no schema parse error, no key-name mismatch).
  And given an `init-templates.test.ts` snapshot, the `BIOME_JSON_TEMPLATE` constant's keys are `["$schema", "files", "linter", ...]` with `files.includes` (and NOT `files.include`) for the file-glob inclusion.
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "BIOME_JSON_TEMPLATE uses the includes key matching the pinned Biome major"
    - test: packages/core/src/init.test.ts "factory init scaffold passes pnpm check on first run"

**S-2** — `.factory/` is pre-created with `.gitkeep` + `.gitignore` extends to factory subdirs
  Given `factory init --name my-app` in a fresh tmp dir (no pre-existing `.gitignore`)
  When the scaffold completes
  Then `.factory/.gitkeep` exists (empty file). `.gitignore` contains lines: `.factory/worktrees/`, `.factory/twin-recordings/`, `.factory-spec-review-cache` (existing v0.0.6 entry preserved). The `.factory/` directory itself is NOT in `.gitignore` (the dir is tracked because `.gitkeep` is committed); only the per-record subdirs are gitignored.
  And given the dir already had a pre-existing `.gitignore` with custom entries, the scaffold APPENDS the factory entries (does NOT overwrite the file). Lines are deduplicated — a re-run does not double-append. The pre-existing custom entries are preserved verbatim.
  Satisfaction:
    - test: packages/core/src/init.test.ts "factory init creates .factory/.gitkeep and extends .gitignore with factory subdir patterns"
    - test: packages/core/src/init.test.ts "factory init append to .gitignore is idempotent and preserves pre-existing entries"

**S-3** — `factory.config.json` gains `dod.template?: string[]` derived from package.json scripts
  Given `factory init --name my-app` writes `factory.config.json` in a fresh tmp dir
  When the file is read
  Then it includes a `dod.template` field whose value is `["typecheck clean (\`pnpm typecheck\`)", "tests green (\`pnpm test\`)", "biome clean (\`pnpm check\`)"]`. The order matches the canonical scaffold's `scripts: { typecheck, test, check, build }` ordering; the `build` script is intentionally excluded (build is not a DoD gate, it's a publish prereq).
  And given `/scope-project`'s slash-command source: it now contains explicit guidance "If `factory.config.json` has a `dod.template` field, use it as the DoD section's body for every generated spec; otherwise fall back to the canonical defaults."
  Satisfaction:
    - test: packages/core/src/init-templates.test.ts "FACTORY_CONFIG_TEMPLATE includes dod.template derived from package.json scripts"
    - test: packages/core/src/scope-project-source.test.ts "scope-project source documents dod.template precedence over canonical defaults"

## Constraints / Decisions

- **Biome major-version coupling (locked):** the `BIOME_JSON_TEMPLATE` schema must match the major version pinned in `PACKAGE_JSON_TEMPLATE.devDependencies['@biomejs/biome']`. Today: pin is `^2.4.4` → schema uses Biome 2.x keys. If a future scaffold change bumps Biome to 3.x, the template must update in lockstep. Add a regression-pin comment.
- **`.gitignore` extension is idempotent + preserving.** Lines added by `factory init` are: `.factory/worktrees/`, `.factory/twin-recordings/`, `.factory-spec-review-cache` (the last is pre-existing from v0.0.6). Re-runs MUST NOT duplicate lines. Pre-existing user-authored entries MUST be preserved verbatim.
- **`dod.template` shape (locked):** `string[]` of canonical DoD bullet bodies; each entry is the literal text that goes into a spec's `## Definition of Done` section as `- <entry>`. Default at scaffold time: 3 entries in the order typecheck → test → check. Spec authors can override by editing `factory.config.json`; `/scope-project` reads the field at spec-author time.
- **`/scope-project` precedence (locked):** if `factory.config.json` exists in `<cwd>` AND has `dod.template`, use it; if missing or empty, fall back to canonical defaults. Document this precedence in the slash-command source.
- **No public API surface change in `@wifo/factory-core`.** All changes are: (a) field-level on `FACTORY_CONFIG_TEMPLATE` (existing exported template), (b) field-level on `BIOME_JSON_TEMPLATE` (existing exported template), (c) internal logic in `init.ts` for `.gitkeep` + `.gitignore` extension. Public export count unchanged at 34.
- **DoD literal-command requirement** (per v0.0.12): every DoD bullet that maps to a runtime gate MUST embed the literal shell command in backticks. This spec's DoD does so itself — eat the dogfood.
- **Cross-cutting v0.0.13 cluster constraints (referenced by specs B, C, D, E, F):**
  - All packages bump 0.0.12 → 0.0.13 in lockstep at release time.
  - Cluster ships via `--include-drafting --skip-dod-phase --max-agent-timeout-ms 1800000` (DoD-judge dispatch needs ANTHROPIC_API_KEY which we don't have; pre-flight `factory spec lint` + `factory spec review` gates quality).
  - DoD-precision idiom (per v0.0.11 calibration): canonical phrasings + literal backtick commands pass review/dod-precision.
  - Cycle-break (spec E) ships before schema-emitter (spec F) so the build graph is clean when F lands.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.13 explicitly does NOT ship in this spec:** the runtime auto-quiet (spec B); finish-task batch mode (spec C); coverage-trip-detect (spec D); cycle-break (spec E); schema-emitter rewrite (spec F).

## Subtasks

- **T1** [feature] — Update `packages/core/src/init-templates.ts`'s `BIOME_JSON_TEMPLATE`: change `"include"` → `"includes"` to match Biome 2.x. Add inline comment pinning the schema to the `@biomejs/biome` major-version constant. ~10 LOC. **depends on nothing.**
- **T2** [feature] — Extend `packages/core/src/init-templates.ts`'s `FACTORY_CONFIG_TEMPLATE` with `dod.template` derived from the scaffold's `scripts: { typecheck, test, check }` (3 entries, literal backtick commands). ~15 LOC. **depends on nothing.**
- **T3** [feature] — Update `packages/core/src/init.ts` to: (a) write `.factory/.gitkeep` (empty file) on init; (b) append `.factory/worktrees/`, `.factory/twin-recordings/` to `.gitignore` (idempotent — skip if already present); (c) preserve pre-existing user-authored `.gitignore` entries. ~30 LOC. **depends on nothing.**
- **T4** [feature] — Update `packages/core/commands/scope-project.md` Step 2: add a paragraph documenting "If `factory.config.json` has `dod.template`, use it as the DoD section body; otherwise fall back to canonical defaults." ~15 LOC of prompt content. **depends on T2.**
- **T5** [test] — `packages/core/src/init-templates.test.ts` covers S-1 + S-3 (3 tests). `packages/core/src/init.test.ts` covers S-1 (scaffold passes `pnpm check`) + S-2 (gitkeep + gitignore idempotency, 2 tests). `packages/core/src/scope-project-source.test.ts` covers S-3 (dod.template precedence, 1 test). ~120 LOC. **depends on T1-T4.**
- **T6** [chore] — Update `packages/core/README.md`: brief note on v0.0.13 init-scaffold polishes (biome key migration, .factory pre-creation, dod.template). ~25 LOC. **depends on T5.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck`).
- tests green (`pnpm -C packages/core test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.13 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/core build`).
- `factory init --name <pkg>` against a fresh tmp dir produces a tree where `pnpm check` exits 0 on first run (no biome-key migration patch needed).
- `factory init` against an existing repo with a custom `.gitignore` preserves pre-existing entries + appends factory subdir patterns idempotently.
- Public API surface from `@wifo/factory-core/src/index.ts` strictly equal to v0.0.12's 34 names.
- v0.0.13 explicitly does NOT ship in this spec: runtime auto-quiet; finish-task batch; coverage-trip-detect; cycle-break; schema-emitter rewrite. Deferred per Constraints.

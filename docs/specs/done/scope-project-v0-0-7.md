---
id: scope-project-v0-0-7
classification: light
type: feat
status: ready
exemplars:
  - path: ~/.claude/commands/scope-task.md
    why: "Existing /scope-task slash command — same skeleton (Step 1 classify; Step 2A LIGHT; Step 2B DEEP), same output rules (one spec per file under docs/specs/<id>.md), same field rules (frontmatter + Scenarios + Constraints + Subtasks + DoD). /scope-project is the same shape one level up: instead of one spec from one task description, it emits N specs from one product description. Mirror the structure section-for-section so users who already know /scope-task can read /scope-project on sight."
  - path: docs/baselines/url-shortener-prompt.md
    why: "The canonical product fixture. Section 'What we're building' (4 numbered endpoints) is the exact shape /scope-project takes as input — a natural-language product description with explicit subfeatures. The four specs that fall out of this prompt (url-shortener-{core,redirect,tracking,stats}) are the canonical reference output: the spec set /scope-project should produce against this prompt. Use this as the fixture for S-3."
  - path: docs/specs/done/factory-runtime-v0-0-5.md
    why: "Reference shape for a generated LIGHT spec — frontmatter, intent, 3-4 scenarios with Given/When/Then + bare-path test: lines, Constraints / Decisions, Subtasks with explicit deps, DoD. /scope-project's output rules require the same skeleton plus one new field (depends-on, added by spec 2). Use as the visual template the slash command's instructions show users."
  - path: BACKLOG.md
    why: "Section 'Real-product workflow — close the project-scale gap' → '/scope-project slash command'. Source of truth for the Why and the constraints (per-feature sweet spot ~50-200 LOC; dependency boundaries match real package/module boundaries; stay within existing spec format)."
  - path: BASELINE.md
    why: "v0.0.6 entry, friction #1 'Manual decomposition + cross-spec API repetition.' Quantifies the friction this slash command removes: hand-paraphrasing spec 1's API in specs 2/3/4's Constraints blocks. /scope-project emits the four specs with a shared constraints block once."
---

# scope-project-v0-0-7 — `/scope-project` slash command

## Intent

Add a new `/scope-project` Claude Code slash command that takes a natural-language product description ("A URL shortener with a stats dashboard, JSON-over-HTTP, SQLite for storage, optional API-key auth") and writes 4-6 LIGHT-classification specs under `docs/specs/` in dependency order. The first generated spec ships `status: ready`; the rest ship `status: drafting` so the maintainer flips them one at a time as each prior spec converges. Each generated spec uses the SPEC_TEMPLATE skeleton AND populates the new `depends-on: [<id>, ...]` frontmatter field added by `factory-core-v0-0-7` (spec 2 of the v0.0.7 cluster).

The slash command is the centerpiece of v0.0.7's "real-product workflow" theme: it converts the maintainer's role from "decomposer + reviewer" to "reviewer only." Decomposition is mechanical and Claude is good at it; the value comes from staying in the review seat.

The slash-command source ships in this repo at `docs/commands/scope-project.md` (canonical reference, in-repo, reviewable + lintable + testable). Users install by copying or symlinking to `~/.claude/commands/scope-project.md`. README guidance + a one-line install snippet documented in `packages/core/README.md`.

## Scenarios

**S-1** — `/scope-project` source file exists at the canonical repo path with the required structure
  Given a fresh checkout of the software-factory repo
  When the file `docs/commands/scope-project.md` is read
  Then it exists; its content is plain markdown (no frontmatter); contains a top-line invocation `Scope the following product description: $ARGUMENTS`; contains a `## Step 1: Decompose` section that documents the decomposition rules (per-feature sweet spot ~50-200 LOC; dependency boundaries match real package/module boundaries); contains a `## Step 2: Generate specs` section that documents the per-spec skeleton + the `depends-on` frontmatter field; contains a `## Step 3: Self-check` section that documents the post-generation lint step (`factory spec lint docs/specs/`).
  Satisfaction:
    - test: packages/core/src/scope-project-source.test.ts "docs/commands/scope-project.md exists and contains the required structural sections"
    - judge: "the slash command's instructions read as a coherent recipe a model would actually follow — not a checklist of disconnected rules. A reader unfamiliar with the factory could decompose a product into specs by following it"

**S-2** — `/scope-project` output rules in the source file are unambiguous about status assignment + depends-on edges
  Given the slash command source file at `docs/commands/scope-project.md`
  When its content is parsed for the per-spec output rules
  Then the source explicitly states: (a) the FIRST generated spec is `status: ready`; (b) all subsequent specs are `status: drafting`; (c) `depends-on: []` is written even when empty; (d) every spec's id matches the kebab-case pattern `^[a-z][a-z0-9-]*$`; (e) every entry in any `depends-on:` list is the id of an earlier-in-the-set generated spec (no forward references; no external ids); (f) each generated spec is LIGHT-classification by default (DEEP allowed for specs the slash command itself flags as architectural).
  Satisfaction:
    - test: packages/core/src/scope-project-source.test.ts "source file documents status assignment + depends-on rules"
    - test: packages/core/src/scope-project-source.test.ts "source file enumerates the kebab-case id pattern"

**S-3** — Reference fixture demonstrates the canonical 4-spec URL-shortener output
  Given the canonical URL-shortener product description at `docs/baselines/url-shortener-prompt.md`
  When `/scope-project` is run against this prompt (manually, by a maintainer)
  Then the reference fixture set under `docs/baselines/scope-project-fixtures/url-shortener/` contains 4 spec files: `url-shortener-core.md`, `url-shortener-redirect.md`, `url-shortener-tracking.md`, `url-shortener-stats.md`. Each spec parses with `factory spec lint`'s parser without errors. The first spec (`url-shortener-core`) has `status: ready` and `depends-on: []`. The other three have `status: drafting` and `depends-on:` arrays naming earlier specs in the chain (e.g., `url-shortener-redirect.depends-on: [url-shortener-core]`; `url-shortener-tracking.depends-on: [url-shortener-redirect]`; `url-shortener-stats.depends-on: [url-shortener-tracking]`). The shape of the dependency chain is linear (no diamonds) for this canonical product. Each spec is LIGHT-classification.
  And given a fixture-shape test (no real `/scope-project` invocation), the test reads the 4 fixture files, parses each via `parseSpec`, and asserts the count (=4), the id ordering, the `status:` distribution (1 ready + 3 drafting), and the `depends-on:` edge set.
  Satisfaction:
    - test: packages/core/src/scope-project-fixture.test.ts "url-shortener fixture: 4 specs in linear dep order"
    - test: packages/core/src/scope-project-fixture.test.ts "url-shortener fixture: status assignment matches first-ready / rest-drafting rule"
    - test: packages/core/src/scope-project-fixture.test.ts "url-shortener fixture: depends-on edges form an acyclic chain ending at url-shortener-core"

**S-4** — README documents installation
  Given a fresh checkout of the software-factory repo
  When `packages/core/README.md` is read
  Then it contains a section (or subsection) named approximately `## /scope-project` (or under an existing `Slash commands` heading) that documents: (a) what the command does in one sentence; (b) the install snippet (`cp docs/commands/scope-project.md ~/.claude/commands/scope-project.md` or the equivalent symlink); (c) one-line example invocation; (d) a pointer to the URL-shortener fixture as a worked example. Top-level `README.md` v0.0.7 release notes mention `/scope-project` alongside `depends-on` and `run-sequence`.
  Satisfaction:
    - test: packages/core/src/scope-project-source.test.ts "packages/core/README.md documents /scope-project install + invocation"

## Constraints / Decisions

- **Source location:** `docs/commands/scope-project.md` in this repo (canonical, reviewable, testable). Users install by copying or symlinking to `~/.claude/commands/scope-project.md`. Rationale (locked): (a) v0.0.7 toolkit changes ship in this repo's commits — the slash-command source is part of that change-set, so it lives here for review; (b) tests can `readFileSync` against a known repo-relative path, which a user-dotfile location would not allow; (c) the existing `~/.claude/commands/scope-task.md` stays as-is (it predates this convention and isn't part of v0.0.7 scope) — `/scope-project` establishes the new pattern of "ship in repo, users copy."
- **No source duplicated to the user's `~/.claude/commands/`** as part of this spec. Installation is documented; not automated. A future v0.0.8+ candidate may add `factory init --install-commands` or similar.
- **Slash command output:** 4-6 LIGHT specs under `docs/specs/`. The 4-6 range is guidance, not enforcement — for very small products 3 may suffice, for richer products 6+ may be appropriate. The slash command's instructions document this as a target, not a hard cap.
- **Per-spec sweet spot constraint:** the slash command's instructions explicitly state "each generated spec must be small enough that `factory-runtime run` converges in 1-2 iterations under default budgets. Validated empirically: ~50-200 LOC including tests." Source: v0.0.5 + v0.0.6 BASELINE evidence (per-feature sweet spot is real).
- **Status assignment rule:** first spec `status: ready`; rest `status: drafting`. The maintainer flips drafting → ready manually after each prior spec converges. (v0.0.7's `run-sequence` will read `status: ready` and walk forward; mid-sequence specs at `drafting` are a no-op until flipped.)
- **`depends-on:` field:** every generated spec writes `depends-on: []` (literal empty array for the first spec; populated for later specs). Each entry must match the kebab-case id pattern `^[a-z][a-z0-9-]*$`; each entry must reference an earlier-generated spec id in the same set (no forward references; no external ids). The slash command's instructions enforce this in prose; spec 2 (`factory-core-v0-0-7`) enforces it via `factory spec lint`.
- **Decomposition guidance:** the slash command's instructions name the decomposition rules: (a) dependency boundaries match real package/module boundaries — "core helper" specs ship before "HTTP endpoint" specs ship before "frontend dashboard" specs; (b) shared constraints (data shape, error codes, public exports) are declared in the FIRST spec's Constraints / Decisions block; later specs reference (don't paraphrase) those decisions; (c) every spec has its own self-contained scenarios and DoD.
- **Per-spec tier:** LIGHT by default. The slash command's instructions allow DEEP when a spec is genuinely architectural (e.g., introduces new data models, spans backend + frontend + DB). DEEP specs additionally generate `docs/technical-plans/<id>.md`. Mirrors `/scope-task`'s tier-classification step.
- **Reference fixture:** `docs/baselines/scope-project-fixtures/url-shortener/` ships with 4 LIGHT spec files, each frontmatter-correct, each parseable by `parseSpec`. The fixture is NOT generated by an actual `/scope-project` invocation in CI — it's a hand-authored reference set captured from the canonical URL-shortener prompt. Tests assert structural properties of the fixture (count, ids, depends-on edges, status distribution), not byte-for-byte equality with a hypothetical /scope-project output.
- **No programmatic invocation in tests.** Tests do NOT spawn `claude -p` to drive `/scope-project` end-to-end. The cost + non-determinism would not pay off. End-to-end coverage lives in the v0.0.7 BASELINE run (URL-shortener manual smoke; documented in BASELINE.md after v0.0.7 ships).
- **README updates:** `packages/core/README.md` documents installation + invocation; top-level `README.md` v0.0.7 release notes mention `/scope-project` alongside `depends-on` + `run-sequence`.
- **Public API surface from `@wifo/factory-core/src/index.ts` is strictly equal to v0.0.6's surface count** (no new exports — slash command is a markdown asset, not a code path).
- **Coordinated package version bump:** `packages/core/package.json` bumps to `0.0.7`. Other packages bump in lockstep with the spec 2 + spec 3 work (no per-package drift in v0.0.7).
- **v0.0.7 explicitly does NOT ship:** automated install of the slash command into `~/.claude/commands/`; per-domain decomposition packs (web vs api vs ML); a `factory project scope` CLI subcommand (the slash command surface is enough for v0.0.7 — promote to a CLI only when the slash-command form has soaked).

## Subtasks

- **T1** [feature] — Author `docs/commands/scope-project.md` (canonical slash-command source). Sections: top-line invocation; `## Step 1: Decompose` (per-feature sweet spot, dependency boundaries, shared-constraints-in-first-spec rule); `## Step 2: Generate specs` (skeleton from `docs/SPEC_TEMPLATE.md` + the new `depends-on` field; status assignment rule; LIGHT-by-default with DEEP escape hatch); `## Step 3: Self-check` (`factory spec lint docs/specs/` + `factory spec review docs/specs/<first-id>.md` for the first spec). ~80-120 LOC of slash-command markdown. **depends on nothing.**
- **T2** [feature] — Author the URL-shortener reference fixture under `docs/baselines/scope-project-fixtures/url-shortener/`. Four LIGHT spec files (`url-shortener-{core,redirect,tracking,stats}.md`), each frontmatter-correct (id, classification: light, type: feat, first ready / rest drafting, depends-on linear chain), each with 2-3 scenarios + a Subtasks block + DoD. Frontmatter `depends-on:` fields use the v0.0.7 schema (which spec 2 introduces — fixture authoring assumes spec 2 has shipped first OR uses `depends-on: []` consistently and pre-includes the dep chain in the body for the linear case). Each fixture spec is small (~100 LOC) and not intended for `factory-runtime run` here — they are STRUCTURAL fixtures, not runnable specs. ~400 LOC across the four files. **depends on nothing (fixture is documentation; spec parsing tolerates unknown frontmatter fields as warnings).**
- **T3** [test] — `packages/core/src/scope-project-source.test.ts`: Bun tests asserting the source file at `docs/commands/scope-project.md` (resolved via `path.resolve(import.meta.dirname, '../../../docs/commands/scope-project.md')` or similar repo-root resolution) exists, parses as plain markdown, contains the required Step 1 / Step 2 / Step 3 headings, documents the status-assignment rule, documents the kebab-case id pattern, documents the `depends-on` field, AND that `packages/core/README.md` contains the `/scope-project` install + invocation section (S-4). ~80 LOC. **depends on T1.**
- **T4** [test] — `packages/core/src/scope-project-fixture.test.ts`: Bun tests reading the 4 fixture files, parsing each via `parseSpec` from `@wifo/factory-core`, asserting count (=4), id ordering, status distribution (1 ready + 3 drafting), and depends-on edge set (forms an acyclic linear chain ending at `url-shortener-core`). ~100 LOC. **depends on T2; soft-depends on spec 2's `depends-on` schema (fixtures need to parse cleanly under the v0.0.7 schema). If spec 2 hasn't shipped, the fixture's `depends-on:` lines surface as `frontmatter/unknown-field` warnings (per existing lint behavior), which the test tolerates.**
- **T5** [chore] — Update `packages/core/README.md` with a `/scope-project` subsection: (a) one-sentence what-it-does; (b) install snippet (`cp docs/commands/scope-project.md ~/.claude/commands/scope-project.md`); (c) one-line example; (d) pointer to the URL-shortener fixture. Update top-level `README.md` v0.0.7 release notes to mention `/scope-project` alongside `depends-on` + `run-sequence`. Bump `packages/core/package.json` to `0.0.7`. ~50 LOC. **depends on T1, T2, T3, T4.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.7 cluster (this spec + the v0.0.7 cluster's other two specs).
- `node packages/core/dist/cli.js spec lint docs/baselines/scope-project-fixtures/url-shortener/` exits 0 (the fixture set parses cleanly under the v0.0.7 schema).
- The 4 fixture specs each independently parse via `parseSpec` (not via the lint CLI) without throwing.
- Public API surface from `@wifo/factory-core/src/index.ts` is strictly equal to v0.0.6's surface (zero new exports).
- `packages/core/package.json` at `0.0.7` (in lockstep with the rest of the v0.0.7 cluster).
- README in `packages/core/` documents `/scope-project` install + invocation; top-level `README.md` v0.0.7 release notes mention `/scope-project`.
- v0.0.7 explicitly does NOT ship: automated install into `~/.claude/commands/`; domain-specific decomposition packs; a `factory project scope` CLI subcommand. Deferred per Constraints.

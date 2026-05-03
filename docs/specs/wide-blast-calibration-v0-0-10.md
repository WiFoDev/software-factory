---
id: wide-blast-calibration-v0-0-10
classification: light
type: chore
status: drafting
exemplars:
  - path: packages/core/src/lint.ts
    why: "wide-blast-radius scanner (lines ~145-163 since v0.0.9) — v0.0.10 raises the threshold from 8 to 12 + adds NOQA directive parsing. ~30 LOC change in the existing scanner."
  - path: BACKLOG.md
    why: "v0.0.10 entry 'Refine spec/wide-blast-radius heuristic — threshold of 8 fires on 18 historical specs.' Source of truth for the threshold raise + NOQA proposal."
  - path: BASELINE.md
    why: "v0.0.9 entry — calibration data: 18 historical specs trigger informational warnings at threshold 8. The v0.0.8 self-build's actual failure case was 12 files. 12 is the empirically-justified threshold."
depends-on:
  - dod-verifier-v0-0-10
  - reviewer-judges-v0-0-10
  - run-sequence-polish-v0-0-10
  - spec-watch-v0-0-10
---

# wide-blast-calibration-v0-0-10 — `spec/wide-blast-radius` threshold raise + NOQA directive + v0.0.10 chore

## Intent

Calibrate the v0.0.9 `spec/wide-blast-radius` lint warning that's firing on 18 historical specs as informational noise: raise the threshold from 8 to 12 (matches the v0.0.8 self-build's actual failure case) AND add a `<!-- NOQA: spec/wide-blast-radius -->` HTML-comment directive recognized anywhere in the spec body that suppresses the warning per-spec (mirrors common Python noqa convention). Catches intentionally-wide chore-coordinator specs without changing the global threshold.

This is the closing spec of the v0.0.10 cluster. Its chore subtask coordinates the lockstep version bump from `0.0.9` to `0.0.10` across all six `@wifo/factory-*` packages, scaffold dep refs from `^0.0.9` to `^0.0.10`, and CHANGELOG/ROADMAP/top-level README updates summarizing the cluster.

depends-on the four other v0.0.10 specs explicitly so this chore commits LAST in the topological order — the chore reconciles surface counts and version metadata only after all feature work has shipped.

## Scenarios

**S-1** — Threshold raised from 8 to 12; specs with 8-11 distinct paths no longer warn
  Given a spec whose `## Subtasks` section names exactly 11 distinct file paths
  When `lintSpec(source)` is invoked
  Then the returned errors include ZERO `spec/wide-blast-radius` warnings (raised threshold means 11 < 12 → no warning).
  And given a spec naming exactly 12 distinct file paths, the warning fires (threshold is `>= 12`, inclusive lower bound). Message format unchanged from v0.0.9 except the literal threshold number: `## Subtasks references 12 distinct file paths; specs touching >= 12 files commonly exceed the 600s implement-phase budget. Consider splitting or setting agent-timeout-ms in frontmatter.`
  And given a spec naming 18 distinct paths, the warning fires (mirroring the v0.0.7 chore commit's actual blast radius).
  Satisfaction:
    - test: packages/core/src/lint.test.ts "lintSpec wide-blast-radius threshold is 12 not 8"
    - test: packages/core/src/lint.test.ts "lintSpec emits warning at exactly 12 paths"

**S-2** — `<!-- NOQA: spec/wide-blast-radius -->` directive suppresses the warning per-spec
  Given a spec with 18 distinct paths in Subtasks AND `<!-- NOQA: spec/wide-blast-radius -->` placed anywhere in the spec body (e.g., on the line above `## Subtasks` or in the Constraints section)
  When `lintSpec(source)` is invoked
  Then the returned errors do NOT include `spec/wide-blast-radius` (the NOQA directive suppressed it).
  And given the same spec but with `<!-- NOQA: spec/different-code -->` (a different code), the wide-blast-radius warning DOES fire (NOQA is per-code, not blanket).
  And given the same spec with `<!-- NOQA: -->` (empty NOQA, blanket-form), all `spec/...` warnings are suppressed (treated as a global suppression for the spec).
  Satisfaction:
    - test: packages/core/src/lint.test.ts "NOQA directive suppresses wide-blast-radius warning"
    - test: packages/core/src/lint.test.ts "NOQA is per-code (different code does not suppress)"
    - test: packages/core/src/lint.test.ts "blank NOQA suppresses all spec warnings"

**S-3** — Coordinated v0.0.10 lockstep version bump across all six packages
  Given the post-implementation `packages/<name>/package.json` for every workspace package
  When their `version` fields are read
  Then every one is `"0.0.10"` (lockstep — context, core, harness, runtime, spec-review, twin all match). `init-templates.ts`'s `PACKAGE_JSON_TEMPLATE.dependencies` references `^0.0.10` for every `@wifo/factory-*` dep. `publish-meta.test.ts`'s version regex updated to `/^0\.0\.10$/`. `init.test.ts` and `init-templates.test.ts` version-string assertions updated to `^0.0.10`.
  Satisfaction:
    - test: packages/core/src/publish-meta.test.ts "every workspace package has v0.0.10 + publishConfig + npm metadata fields"
    - test: packages/core/src/init.test.ts "scaffold dependencies pin @wifo/factory-* at ^0.0.10"
    - test: packages/core/src/init-templates.test.ts "PACKAGE_JSON_TEMPLATE pins @wifo/factory-* deps at ^0.0.10"

## Constraints / Decisions

- **Threshold change (locked):** 8 → **12**. Sourced from v0.0.8 self-build evidence (the spec that actually timed out touched 12 files) + v0.0.9 BASELINE empirical data (18 historical specs at threshold 8 produced informational noise; raising to 12 exempts most while still catching the genuine wide-blast cases).
- **NOQA directive (locked syntax):**
  - Form 1 (specific code): `<!-- NOQA: spec/wide-blast-radius -->` — suppresses ONLY the named code.
  - Form 2 (blank, blanket-spec): `<!-- NOQA: -->` or `<!-- NOQA -->` — suppresses ALL `spec/*` warnings on this spec.
  - Form 3 (multi-code): `<!-- NOQA: spec/wide-blast-radius, spec/depends-on-missing -->` — comma-separated list. Each code suppressed.
  - Placement: anywhere in the spec body (NOT in frontmatter — frontmatter is `.strict()` and rejects unknown keys; an HTML comment in frontmatter would be a YAML parse error). The lint scanner walks the spec source line-by-line for any matching HTML comment.
- **NOQA scope:** per-spec (whole-document). NOT per-line, NOT per-section. Applies to every emission of the named code from `lintSpec` for this spec source.
- **NOQA does NOT suppress errors** (severity: 'error' codes always fire). Only warnings can be suppressed. v0.0.10's `wide-blast-radius` is a warning; `spec/invalid-depends-on` is an error and CANNOT be suppressed via NOQA.
- **Updated lint warning message** (literal number change from "8" to "12"): `## Subtasks references ${n} distinct file paths; specs touching >= 12 files commonly exceed the 600s implement-phase budget. Consider splitting or setting agent-timeout-ms in frontmatter.`
- **Coordinated package version bump (chore subtask, T4 below):**
  - `packages/{context,core,harness,runtime,spec-review,twin}/package.json` version: `0.0.9` → `0.0.10`.
  - `packages/core/src/init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies`: every `@wifo/factory-*` dep `^0.0.9` → `^0.0.10`.
  - `packages/core/src/init-templates.test.ts` version assertions: `^0.0.9` → `^0.0.10`.
  - `packages/core/src/init.test.ts` version assertions: `^0.0.9` → `^0.0.10`.
  - `packages/core/src/publish-meta.test.ts` version regex: `/^0\.0\.9$/` → `/^0\.0\.10$/`.
- **Existing v0.0.10 spec files in this cluster do NOT need NOQA directives** — the threshold raise to 12 should exempt them (most v0.0.10 specs have <12 paths). The chore-coordinator pattern that historically tripped the threshold (e.g., this very spec) needs explicit NOQA if it does. Self-check: this spec adds NOQA in its own Constraints if it triggers the warning post-threshold-raise.
- **CHANGELOG / ROADMAP / top-level README** updates summarize the v0.0.10 cluster (this spec + the four sibling specs).
- **Public API surface** from every `@wifo/factory-*` package strictly equal to v0.0.9's surface PLUS the deltas from the cluster's other specs:
  - `@wifo/factory-runtime`: 21 → 23 (from `dod-verifier-v0-0-10`).
  - `@wifo/factory-core`: 29 → 33 (29 → 31 from `dod-verifier`; 31 → 33 from `spec-watch`).
  - All others unchanged.
  This spec's CHANGELOG documents the surface counts.
- **`v0.0.10 explicitly does NOT ship in this spec:** retroactive NOQA additions to all 18 historical specs that currently warn at threshold 8 (the threshold raise alone exempts most of them; the rest can add NOQA on demand if they're re-reviewed); per-line NOQA scope; lint suppression for severity-`error` codes.

## Subtasks

- **T1** [feature] — Update `packages/core/src/lint.ts`: change the threshold constant from 8 to 12; update the warning message to use the new number; add NOQA scanner that walks the spec body for `<!-- NOQA[: <code-list>] -->` HTML-comment patterns and suppresses matching codes from the emitted error list. ~30 LOC. **depends on nothing.**
- **T2** [test] — `packages/core/src/lint.test.ts`: 5 tests covering S-1 + S-2 (threshold variations + NOQA forms). ~80 LOC. **depends on T1.**
- **T3** [chore] — Bump version field in all six `packages/<name>/package.json` files from `0.0.9` to `0.0.10`. Bump `init-templates.ts` `PACKAGE_JSON_TEMPLATE.dependencies` from `^0.0.9` to `^0.0.10` for all four `@wifo/factory-*` deps. ~10 LOC. **depends on nothing (parallel with T1).**
- **T4** [test] — Update `packages/core/src/publish-meta.test.ts` version regex (`^0\.0\.9$` → `^0\.0\.10$`); update `packages/core/src/init.test.ts` and `packages/core/src/init-templates.test.ts` version-string assertions (`^0.0.9` → `^0.0.10`). ~10 LOC. **depends on T3.**
- **T5** [chore] — Update `CHANGELOG.md` with v0.0.10 entry: list ALL FIVE specs' deliverables (DoD-verifier, 3 reviewer judges, run-sequence polish, spec-watch, wide-blast calibration); enumerate public API surface deltas (runtime 21 → 23; core 29 → 33; others unchanged); enumerate test surface growth; document the threshold raise + NOQA. Update `ROADMAP.md` (mark v0.0.10 shipped; promote v0.1.0+ candidates — worktree sandbox + holdout-aware convergence + CI publish). Update top-level `README.md` v0.0.10 banner with the trust-contract framing (DoD-verifier + reviewer judges = trust on both sides). ~150 LOC. **depends on T1, T3, T4.**
- **T6** [chore] — Update `packages/core/README.md` to mention the threshold raise + NOQA syntax in the existing `## factory spec lint` documentation block. ~10 LOC. **depends on T1.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.10 cluster (this spec + the cluster's other four specs). Warnings on existing shipped specs in `done/` are reduced (most no longer fire at threshold 12).
- `pnpm -C packages/core build` produces a working `dist/cli.js`.
- `pnpm pack --dry-run` against every `packages/<name>/` produces clean tarballs at version `0.0.10`.
- A fresh `factory init --name test-foo` (in a tmp dir) produces a project where: `.claude/commands/scope-project.md` exists (from v0.0.8); `package.json` deps are at `^0.0.10`; the scaffold scripts (typecheck/test/check/build from v0.0.9) work.
- All six `@wifo/factory-*` `package.json` files at `0.0.10`.
- `CHANGELOG.md`, `ROADMAP.md`, top-level `README.md`, `packages/core/README.md` reflect v0.0.10 ship state.
- Public API surface counts match the locked deltas: runtime 21 → 23; core 29 → 33; spec-review 10 (unchanged in count, +3 ReviewCode union members); context 18; harness ~16; twin ~7.
- v0.0.10 explicitly does NOT ship in this spec: retroactive NOQA additions; per-line NOQA scope; error-severity suppression. Deferred per Constraints.

---
id: factory-core-v0-0-12-dod-literal
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/core/src/lint.ts
    why: "lint codes registry. v0.0.12 adds `spec/dod-needs-explicit-command` (severity: warning) — fires when a DoD bullet looks like a runtime gate (typecheck/test/lint/check phrasing) but doesn't embed a backtick-wrapped shell command."
  - path: packages/runtime/src/phases/dod.ts
    why: "v0.0.10's dodPhase parses ## Definition of Done for shell-runnable bullets. Today maps prose like 'typecheck + test + check' to `pnpm typecheck && pnpm test && pnpm check` by guessing — fragile across heterogeneous host repos. v0.0.12 drops the guessing path; relies on explicit backtick-wrapped commands (already extracted)."
  - path: docs/SPEC_TEMPLATE.md
    why: "spec template canonical reference. v0.0.12 updates the DoD section guidance + examples to require backtick-wrapped commands per bullet."
  - path: BACKLOG.md
    why: "v0.0.12 entry 'Spec declares literal DoD shell commands (not framework-script names)' (CORE-836). Closes the 'coincidence with conventional names' fragile contract."
depends-on:
  - factory-runtime-v0-0-12-observability
---

# factory-core-v0-0-12-dod-literal — convert DoD trust contract from coincidence to contract

## Intent

v0.0.10's DoD-verifier shipped on the assumption that script names are stable across the factory's user base. The CORE-836 dogfood proved otherwise: the runtime maps DoD prose like "typecheck + test + check" to `pnpm typecheck && pnpm test && pnpm check` by guessing, which works only when the host repo happens to use those exact `package.json` script names. v0.0.12 closes the contract: spec authors embed literal shell commands in DoD bullets (backtick-wrapped); a new lint code `spec/dod-needs-explicit-command` (warning) catches the friction at scoping time; `dodPhase` drops the script-name-guessing path and relies on the existing backtick-extraction. The trust contract — "spec ships only when DoD passes" — is now portable across heterogeneous repos.

This spec depends on the observability spec landing first so DoD failures are visible (cause-of-iteration + per-phase progress lines).

## Scenarios

**S-1** — `spec/dod-needs-explicit-command` lint warning fires on script-name DoD bullets
  Given a spec whose `## Definition of Done` contains the bullet `- typecheck + lint + tests green` (no backtick command anywhere on the line)
  When `factory spec lint <path>` runs
  Then it emits a warning at the bullet's line: `<file>:<line>  warning  spec/dod-needs-explicit-command  DoD bullet looks like a runtime gate but doesn't embed a backtick-wrapped shell command. Add the literal command, e.g.: 'typecheck clean (`pnpm typecheck`)'`. Lint exit code 0 (warnings don't fail). The check uses a regex to identify DoD bullets where prose contains gate-shaped keywords (`typecheck`, `test`, `lint`, `check`, `build`) without any matching backtick code-span on the same line.
  And given the bullet IS `- typecheck clean (\`pnpm typecheck\`)`, no warning fires (literal command present).
  Satisfaction:
    - test: packages/core/src/lint.test.ts "spec/dod-needs-explicit-command fires on DoD bullet missing literal backtick command"
    - test: packages/core/src/lint.test.ts "spec/dod-needs-explicit-command does not fire when bullet contains backtick command"

**S-2** — `dodPhase` drops the script-name guessing path
  Given a spec's `## Definition of Done` contains the bullet `- tests green (\`pnpm test --filter @org/foo\`)` (a custom command not following the `pnpm test` convention)
  When `dodPhase` runs against this spec
  Then it extracts the backtick-wrapped command literally and shells out via Bash: `pnpm test --filter @org/foo`. The result is captured in `factory-dod-report.payload.gates[]`. NO part of the runtime's logic guesses what `pnpm test` should be — the literal backtick-extracted command is the source of truth.
  And given a DoD bullet that says ONLY `- typecheck + test green` (no backtick command, despite the new lint warning), `dodPhase` reports the gate as `status: 'skipped'` with reason `dod-gate-no-command-found`. Older specs without literal commands no longer mis-fire — they're explicitly skipped + reported.
  Satisfaction:
    - test: packages/runtime/src/phases/dod.test.ts "dodPhase shells out the literal backtick-extracted command verbatim"
    - test: packages/runtime/src/phases/dod.test.ts "dodPhase skips DoD bullets without backtick commands; gate.status === skipped"

**S-3** — `SPEC_TEMPLATE.md` requires backtick-wrapped commands in DoD bullets with worked examples
  Given the canonical SPEC_TEMPLATE.md
  When read at `docs/SPEC_TEMPLATE.md`
  Then the `## Definition of Done` section contains explicit guidance: "Each runtime-gate bullet MUST embed a backtick-wrapped shell command." Plus 3 worked examples covering the canonical idiom (`typecheck clean (\`pnpm typecheck\`)`, `tests green (\`pnpm test\`)`, `biome clean (\`pnpm check\`)`). The template's existing structure is preserved; only the DoD section's guidance + examples are updated.
  Satisfaction:
    - test: packages/core/src/spec-template.test.ts "SPEC_TEMPLATE.md DoD section requires backtick commands and shows 3 worked examples"

## Constraints / Decisions

- **Lint regex shape (locked):** match DoD bullets containing gate-shaped keywords (case-insensitive: `typecheck`, `test`, `lint`, `check`, `build`, `green`, `clean`, `pass`) without any matching `` ` `` code-span on the same line. False-positive rate: low — the keywords are distinctive enough; a DoD bullet that says "Public API surface unchanged" doesn't trip.
- **Severity: warning.** `spec/dod-needs-explicit-command` is `severity: warning` — does not fail `factory spec lint`'s exit code 0. Catches the friction at scoping time but doesn't block ship.
- **`dodPhase` no-command behavior (locked):** when a DoD bullet contains gate-shaped keywords AND no backtick command, the gate is reported as `status: 'skipped'` with `reason: 'dod-gate-no-command-found'`. The runtime does NOT fail the run on a skipped gate (it's not a `'fail'`); but neither does it claim the gate "passed" silently. v0.0.12 makes the gap explicit instead of papering over it.
- **`dod-precision` reviewer judge (v0.0.11) is unchanged.** It already calibrated to recognize "tests green" / "lint clean" as canonical idioms. v0.0.12's new lint code is complementary: the reviewer scores prose precision (is "tests green" precise enough to satisfy the reviewer?), the lint code scores command literalness (does the bullet have a runnable command?). Both fire as warnings; orthogonal checks.
- **No breaking change to existing specs in `done/`.** Existing specs that don't follow the new convention will warn under `spec/dod-needs-explicit-command` (not fail) and dodPhase will skip those gates instead of guessing. Maintainers can backfill commands in subsequent commits or leave older specs as-is.
- **Public API surface delta in `@wifo/factory-core`:** `LintCode` union gains `'spec/dod-needs-explicit-command'`. No new exports.
- **Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.11's 26 names.** Changes internal to `dod.ts`.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.12 explicitly does NOT ship in this spec:** `factory.config.json dod.commands` map (deferred — explicit literal in spec is canonical); cross-bullet command deduplication (e.g., when 3 bullets all reference `pnpm test`); auto-rewrite of older specs in `done/` (manual choice, not automated).

## Subtasks

- **T1** [feature] — Add `spec/dod-needs-explicit-command` lint code in `packages/core/src/lint.ts`: scan DoD bullets, flag gate-shaped lines without backtick commands. ~40 LOC. **depends on nothing.**
- **T2** [feature] — Update `packages/runtime/src/phases/dod.ts` to drop the script-name guessing path. Bullets with backtick commands → shell out the literal command. Bullets without → report gate as `status: 'skipped', reason: 'dod-gate-no-command-found'`. ~50 LOC. **depends on nothing.**
- **T3** [chore] — Update `docs/SPEC_TEMPLATE.md` `## Definition of Done` section: require backtick-wrapped commands; add 3 worked examples. ~25 LOC. **depends on T1, T2.**
- **T4** [test] — `packages/core/src/lint.test.ts` covers S-1 (2 tests). `packages/runtime/src/phases/dod.test.ts` covers S-2 (2 tests). `packages/core/src/spec-template.test.ts` covers S-3 (1 test pinning the worked examples). ~80 LOC. **depends on T1-T3.**
- **T5** [chore] — Update `packages/core/README.md` (lint code list gains `spec/dod-needs-explicit-command`) and `packages/runtime/README.md` (DoD literal-command requirement). ~25 LOC. **depends on T4.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/core typecheck` and `pnpm -C packages/runtime typecheck`).
- tests green (`pnpm -C packages/core test` and `pnpm -C packages/runtime test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.12 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0; the cluster's specs all use literal backtick commands in DoD — dogfooded).
- packages build (`pnpm -C packages/core build` and `pnpm -C packages/runtime build`).
- `SPEC_TEMPLATE.md` contains the 3 worked examples for canonical idioms.
- Public API surface delta: `@wifo/factory-core` `LintCode` union +1 (`spec/dod-needs-explicit-command`); `@wifo/factory-runtime` strictly equal to v0.0.11's 26 names.
- v0.0.12 explicitly does NOT ship in this spec: factory.config.json dod.commands map; cross-bullet dedup; auto-rewrite of older specs. Deferred per Constraints.

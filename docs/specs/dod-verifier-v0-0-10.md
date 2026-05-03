---
id: dod-verifier-v0-0-10
classification: deep
type: feat
status: ready
exemplars:
  - path: packages/runtime/src/phases/validate.ts
    why: "validatePhase pattern — exported factory function returning a Phase; iterates scenarios; persists factory-validate-report per iteration; returns aggregated PhaseResult. dodPhase mirrors this shape for DoD bullets."
  - path: packages/runtime/src/phases/implement.ts
    why: "v0.0.3's # Prior validate report cross-iteration prompt threading (lines ~370-440 of buildPrompt). v0.0.10 adds parallel # Prior DoD report section using the same byte-stable + 1KB-per-line + 50KB-section cap pattern."
  - path: packages/runtime/src/records.ts
    why: "FactoryValidateReportSchema is the template for the new FactoryDodReportSchema. Same shape: specId/iteration/durationMs/summary/status + per-bullet array. Registered via tryRegister at runtime startup."
  - path: packages/core/src/scenarios.ts
    why: "findSection + parseScenarios are the existing slicers. v0.0.10 adds parseDodBullets alongside them in packages/core/src/parser.ts; same helper-style export from @wifo/factory-core."
  - path: docs/technical-plans/dod-verifier-v0-0-10.md
    why: "Paired technical plan — context, architecture decisions, blast radius, public API surface deltas, and the locked decisions (shell allowlist, exactly-one-backtick rule, opt-out default, per-bullet 60s timeout). Spec body references decisions there rather than restating them."
depends-on: []
---

# dod-verifier-v0-0-10 — `dodPhase` runtime phase + `factory-dod-report` record + cross-iteration threading

## Intent

Close the long-deferred DoD-verifier trust gap (BACKLOG since v0.0.6 BASELINE) by adding a new `dodPhase` built-in that parses each spec's `## Definition of Done` block, executes shell-runnable bullets via Bash from the run's `cwd`, dispatches non-shell bullets to the existing harness judge runner, and persists results as a new `factory-dod-report` context record per iteration. Convergence requires DoD shell gates green AND existing test/judge satisfactions green. Closes the "runtime says converged → ship it" trust contract that's been broken since v0.0.1.

DEEP because: introduces a new built-in phase, a new context record type, a new parser (`parseDodBullets` in `@wifo/factory-core`), a convergence-semantics extension, AND a cross-iteration prompt-threading addition (`# Prior DoD report` section in `implementPhase`'s buildPrompt). Pairs with v0.0.9's scaffold-scripts work — without v0.0.9, this work was premature; with v0.0.9, the DoD bullets are now actually runnable in fresh `factory init` projects.

## Scenarios

**S-1** — `parseDodBullets` classifies bullets per the locked allowlist; `## Definition of Done` slicing reuses `findSection`
  Given a spec body with `## Definition of Done` containing four bullets:
    1. `` - `pnpm typecheck` clean. ``
    2. `` - `pnpm test` workspace-wide green. ``
    3. `- All scenarios pass.`
    4. `` - `pnpm typecheck` and `pnpm check` both pass. ``
  When `parseDodBullets(findSection(body, 'Definition of Done'))` is invoked
  Then it returns 4 bullets, classified as: `[shell, shell, judge, judge]`. The first two: `kind: 'shell'`, `command: 'pnpm typecheck'` and `command: 'pnpm test'` respectively (single-backtick token starting with allowlisted runner). The third: `kind: 'judge'`, `criterion: 'All scenarios pass.'` (no backticks → judge). The fourth: `kind: 'judge'` (multiple backticks → ambiguous → judge). Each bullet's `line` field points at the spec-body line number (1-indexed within the spec's source).
  And given a `## Definition of Done` containing only plain-prose bullets, `parseDodBullets` returns N bullets all classified `kind: 'judge'`.
  And given a spec WITHOUT a `## Definition of Done` section, `findSection` returns null; `parseDodBullets(null)` returns `[]`.
  Satisfaction:
    - test: packages/core/src/parser.test.ts "parseDodBullets classifies single-backtick allowlisted commands as shell"
    - test: packages/core/src/parser.test.ts "parseDodBullets classifies plain-prose bullets as judge"
    - test: packages/core/src/parser.test.ts "parseDodBullets classifies multi-backtick bullets as judge"
    - test: packages/core/src/parser.test.ts "parseDodBullets returns empty array when DoD section is absent"

**S-2** — `dodPhase` runs shell bullets via Bash; persists `factory-dod-report` with per-bullet status
  Given a tmp `cwd` containing a `package.json` with `scripts: { typecheck: 'tsc --noEmit', test: 'echo passed' }` and a `tsconfig.json` of the minimal scaffold shape; a parsed spec whose `## Definition of Done` has bullets `` `pnpm typecheck` `` + `` `pnpm test` `` + `- Public API surface unchanged.`
  When `dodPhase({ cwd })` is run via `runtime.run()` for a single iteration
  Then a `factory-dod-report` record is persisted with: `status: 'pass'` (all 3 bullets pass — shell run cleanly + judge returns pass via the test-fixture judge client); `bullets[0]: { kind: 'shell', command: 'pnpm typecheck', status: 'pass', exitCode: 0 }`; `bullets[1]: { kind: 'shell', command: 'pnpm test', status: 'pass', exitCode: 0 }`; `bullets[2]: { kind: 'judge', criterion: 'Public API surface unchanged.', status: 'pass' }`. Each shell bullet has a `command`, `exitCode`, optionally `stderrTail` (empty when pass).
  And given a `cwd` whose `package.json` lacks a `typecheck` script (so `pnpm typecheck` exits non-zero), the `factory-dod-report` reports `bullets[0].status: 'fail'`, `exitCode: 1`, `stderrTail` containing the npm/pnpm "missing script" message (truncated to 2 KB max). The phase returns `'fail'`.
  Satisfaction:
    - test: packages/runtime/src/phases/dod.test.ts "dodPhase runs shell bullets and persists factory-dod-report on pass"
    - test: packages/runtime/src/phases/dod.test.ts "dodPhase reports fail with exitCode + stderrTail when a shell bullet fails"
    - test: packages/runtime/src/phases/dod.test.ts "dodPhase dispatches non-shell bullets to the judge client"

**S-3** — Default graph integrates `dodPhase` after `validatePhase`; convergence requires both
  Given the runtime CLI invoked with `factory-runtime run <spec>` (no `--skip-dod-phase`, no `--no-implement`)
  When the default graph is constructed
  Then it has 3 phases (`implement`, `validate`, `dod`) with edges `[['implement', 'validate'], ['validate', 'dod']]`. Iteration converges when ALL three phases return `'pass'`. Iteration retries when validate-pass + dod-fail (the agent gets a `# Prior DoD report` section in iteration N+1's prompt) — same as today's validate-fail retries.
  And given `--skip-dod-phase` is set OR `factory.config.json runtime.skipDodPhase: true`, the graph drops `dodPhase`: `[implement, validate]` with edges `[['implement', 'validate']]`. Convergence semantics revert to v0.0.9's behavior. CLI flag wins over config.
  And given `--no-implement` AND `--skip-dod-phase`, the graph is `[validate]` (back-compat with v0.0.1).
  And given `--no-implement` only (without `--skip-dod-phase`), the graph is `[validate, dod]` — DoD is verified even when the implement phase is skipped (typical maintainer "I implemented by hand; verify the work" path).
  Satisfaction:
    - test: packages/runtime/src/cli.test.ts "default graph includes dodPhase after validatePhase"
    - test: packages/runtime/src/cli.test.ts "--skip-dod-phase removes dodPhase from the graph"
    - test: packages/runtime/src/cli.test.ts "factory.config.json runtime.skipDodPhase: true disables dodPhase by default"
    - test: packages/runtime/src/cli.test.ts "--no-implement keeps dodPhase by default"

**S-4** — `# Prior DoD report` section threads failed bullets into iteration N+1's implement prompt
  Given a 2-iteration run where iteration 1's validatePhase passes but dodPhase fails (1 shell bullet failure: `pnpm typecheck` non-zero exit with stderr "src/foo.ts:5: error TS2322: ...")
  When `implementPhase`'s `buildPrompt` is invoked for iteration 2 with `ctx.inputs` containing the prior iteration's terminal-phase outputs (which now include the dod-report)
  Then the produced prompt contains a `# Prior DoD report` section listing the failed bullets in the locked format `**<command>** — exit <code>: <stderrTail>`. The section appears AFTER `# Prior validate report` (or where that section would appear, in the byte-stable position). Per-line cap: 1 KB; section-total cap: 50 KB; truncation marker: `[runtime] truncated prior-DoD section`. The section is byte-identical when the same DoD failure repeats in iteration 2's input.
  And given iteration 1 also has a validate-fail, the prompt includes BOTH `# Prior validate report` AND `# Prior DoD report`, in that order.
  And given iteration 1 has dod-pass (no DoD failures), iteration 2's prompt has NO `# Prior DoD report` section.
  Satisfaction:
    - test: packages/runtime/src/phases/implement.test.ts "buildPrompt emits Prior DoD report section when prior dod-report is in inputs"
    - test: packages/runtime/src/phases/implement.test.ts "Prior DoD report section is byte-stable across iterations with the same failure"
    - test: packages/runtime/src/phases/implement.test.ts "buildPrompt does not emit Prior DoD report when no dod-report in inputs"

## Holdout Scenarios

**H-1** — Shell allowlist rejects unsafe commands; `kind: 'judge'` is the safe default
  Given a DoD bullet `` - `rm -rf /` `` (or any command whose first word isn't in the locked allowlist `[pnpm, bun, npm, node, tsc, git, npx, bash, sh, make, pwd, ls]` and doesn't start with `./` or `../`)
  When `parseDodBullets` classifies it
  Then `kind: 'judge'` (NOT shell). The conservative allowlist prevents accidental shell injection from prose mishaps. The judge runner sees the criterion text but does not execute it.

**H-2** — Per-bullet timeout (default 60_000 ms) catches hung commands without freezing the run
  Given a DoD bullet `` `bash -c "sleep 90"` `` (90s sleep, exceeds the 60s default)
  When `dodPhase` runs the bullet with `timeoutMs: 60000`
  Then the bullet reports `status: 'error'`, `exitCode: null`, `stderrTail` containing `dod-timeout (after 60000ms)`. The phase returns `'error'`. Total dodPhase wall-clock is bounded.

**H-3** — `factory-context tree --direction down <runId>` walks `factory-dod-report` as a run descendant
  Given a converged 1-iteration run with dodPhase enabled
  When `factory-context tree <runId> --direction down` is invoked against the persisted records
  Then the tree shows: `factory-run` at the top → `factory-phase` (3 entries: implement, validate, dod) → per-phase outputs (`factory-implement-report`, `factory-validate-report`, `factory-dod-report`). The `factory-dod-report` is reachable via the `factory-phase` for `phaseName: 'dod'`. `tree` rendering is unchanged — the new record type slots in via the existing generic walk.

## Constraints / Decisions

- **Architecture decisions live in `docs/technical-plans/dod-verifier-v0-0-10.md`** — paired technical-plan covers context, blast radius, default-graph wiring, prompt-threading, public API surface deltas. The spec body references that document rather than restating it.
- **Shell allowlist (locked):** `[pnpm, bun, npm, node, tsc, git, npx, bash, sh, make, pwd, ls]` plus relative-path scripts (`./...`, `../...`). Bullets whose backtick-wrapped command begins with any other word are classified `'judge'`. Conservative — prevents accidental shell injection from prose; new runners can be added in point releases.
- **Exactly-one-backtick rule:** a bullet qualifies as `shell` ONLY when its body contains exactly one backtick-wrapped token. Bullets with multiple backticks → `'judge'` (ambiguous criteria). Bullets with no backticks → `'judge'` (plain prose).
- **Per-bullet shell timeout default: 60_000 ms.** Knob: `DodPhaseOptions.timeoutMs?: number`. Distinct from `RunOptions.maxAgentTimeoutMs` (which is for agent subprocesses). DoD timeout is for Bash subprocesses.
- **`stderrTail` cap: 2 KB per bullet.** Truncation marker: `[runtime] truncated stderr`.
- **Default graph (v0.0.10) is `[implement, validate, dod]` with edges `[['implement', 'validate'], ['validate', 'dod']]`.** `--skip-dod-phase` opts out (drops dod). `--no-implement` opts out of implement (keeps validate + dod). Combinations enumerated in S-3.
- **`RunOptions.skipDodPhase?: boolean`** — field-level addition. Programmatic callers building their own graph aren't affected.
- **`factory.config.json runtime.skipDodPhase?: boolean`** — extends the existing partial schema. Precedence: CLI flag > config > built-in default `false`.
- **`# Prior DoD report` section format (locked):**
  ```
  # Prior DoD report

  **`pnpm typecheck`** — exit 1: src/foo.ts:5: error TS2322: ...
  **`pnpm test`** — exit 1: 2 tests failing
  ```
  One bullet per line. Per-line cap 1 KB; section-total cap 50 KB; truncation marker `[runtime] truncated prior-DoD section`. Byte-stable across iterations of the same failure (cache-friendly).
- **Section position in `buildPrompt`:** AFTER the existing `# Prior validate report` section position; BEFORE `# Working directory`.
- **New context record `factory-dod-report`** — schema in `docs/technical-plans/dod-verifier-v0-0-10.md`. Registered via `tryRegister` at runtime startup. Persisted by `dodPhase` as its phase output (consumed via `ctx.inputs` in subsequent iterations).
- **No new `RuntimeErrorCode`.** dodPhase failures land as `'fail'` status (iteration retries) or `'error'` status (mirrors `runtime/agent-failed`-shape with stderr label `runtime/dod-bullet-error: ...` — string label, NOT a new enum value).
- **Public API surface deltas (locked):**
  - `@wifo/factory-runtime/src/index.ts`: 21 → **23** names. New exports: `dodPhase` (function) + `DodPhaseOptions` (type).
  - `@wifo/factory-core/src/index.ts`: 29 → **31** names. New exports: `parseDodBullets` (function) + `DodBullet` (type).
  - `RunOptions.skipDodPhase?: boolean` — field-level on already-exported type.
  - `RuntimeErrorCode`: unchanged (still 14 values from v0.0.9).
- **Coordinated package version bump deferred to spec 5** (`wide-blast-calibration-v0-0-10`'s chore subtask).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.10 explicitly does NOT ship in this spec:** parallel DoD bullet execution (sequential by design); DoD bullet caching (re-runs every iteration); per-bullet retry-on-fail (single attempt per iteration); user-extensible runner allowlist via config (locked at the canonical set); DoD bullets in `## Holdout Scenarios` style (DoD is documentation-only; holdouts apply to scenarios).

## Subtasks

- **T1** [feature] — `packages/core/src/parser.ts`: add `parseDodBullets(section)` + `DodBullet` type. Allowlist-based classification per Constraints. Re-export from `packages/core/src/index.ts`. ~80 LOC. **depends on nothing.**
- **T2** [feature] — `packages/runtime/src/records.ts`: add `FactoryDodReportSchema` + `FactoryDodReportPayload` type. ~30 LOC. **depends on nothing.**
- **T3** [feature] — `packages/runtime/src/phases/dod.ts` (NEW FILE): implement `dodPhase(opts)` returning a `Phase`. Slices DoD via `findSection`; calls `parseDodBullets`; dispatches shell vs judge per bullet; persists `factory-dod-report`; returns aggregated PhaseResult. ~200 LOC. **depends on T1, T2.**
- **T4** [feature] — `packages/runtime/src/runtime.ts`: extend `tryRegister` calls to include `FactoryDodReportSchema`. ~5 LOC. **depends on T2.**
- **T5** [feature] — `packages/runtime/src/phases/implement.ts`: extend `buildPrompt` to emit `# Prior DoD report` section when `ctx.inputs` includes a `factory-dod-report` with status `'fail'`. Reuse v0.0.3's per-line + section-total cap pattern; new `[runtime] truncated prior-DoD section` marker. ~50 LOC. **depends on T2.**
- **T6** [feature] — `packages/runtime/src/cli.ts`: add `--skip-dod-phase` flag; extend `FactoryConfigRuntimeSchema` with `skipDodPhase?: boolean`; update default-graph composition per S-3. ~40 LOC. **depends on T3.**
- **T7** [feature] — `packages/runtime/src/index.ts`: re-export `dodPhase` + `DodPhaseOptions`. Surface count goes 21 → 23. ~3 LOC. **depends on T3.**
- **T8** [test] — `packages/core/src/parser.test.ts`: 4 tests covering S-1. `packages/runtime/src/phases/dod.test.ts` (NEW): 5 tests covering S-2 + H-1 + H-2 (parser allowlist; per-bullet timeout). `packages/runtime/src/cli.test.ts`: 4 tests covering S-3 (graph composition variants). `packages/runtime/src/phases/implement.test.ts`: 3 tests covering S-4 (Prior DoD report section). `packages/runtime/src/runtime.test.ts`: 1 test covering H-3 (factory-dod-report walks via tree). ~400 LOC across all test files. **depends on T1..T7.**
- **T9** [chore] — Update `packages/runtime/README.md`: document `dodPhase`, the default-graph change, the `--skip-dod-phase` flag, the `# Prior DoD report` section, the shell allowlist + exactly-one-backtick rule. ~80 LOC. **depends on T1..T7.**

## Definition of Done

- All scenarios (S-1..S-4) AND holdouts (H-1..H-3) pass.
- `pnpm -C packages/core typecheck` and `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/core test`, `pnpm -C packages/runtime test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.10 cluster.
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`; `factory-runtime run --skip-dod-phase` is wired.
- **Deterministic CI smoke**: a Bun test creates a tmp project with a minimal `package.json` (typecheck + test scripts), a 2-bullet `## Definition of Done` (one shell + one judge); `runtime.run()` against the spec converges in 1 iteration with all 3 phases pass.
- Public API surface from `@wifo/factory-runtime/src/index.ts` is **23 names** (was 21; +2: `dodPhase` + `DodPhaseOptions`).
- Public API surface from `@wifo/factory-core/src/index.ts` is **31 names** (was 29; +2: `parseDodBullets` + `DodBullet`).
- All other `@wifo/factory-*` package surfaces strictly equal to v0.0.9.
- `RuntimeErrorCode` enum has 14 values (unchanged).
- README in `packages/runtime/` documents `dodPhase` + the default-graph change + the `--skip-dod-phase` flag.
- v0.0.10 explicitly does NOT ship in this spec: parallel DoD execution; per-bullet caching; DoD-bullet retry-on-fail; user-extensible runner allowlist. Deferred per Constraints.

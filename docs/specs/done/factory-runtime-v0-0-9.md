---
id: factory-runtime-v0-0-9
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/runtime/src/sequence.ts
    why: "loadSpecs (lines ~78-100) — currently reads every *.md regardless of frontmatter.status. v0.0.9 adds a status filter: skip status='drafting' specs unless includeDrafting is set. ~15 LOC change."
  - path: packages/runtime/src/cli.ts
    why: "runRunSequence (the v0.0.7 helper) — v0.0.9 adds --include-drafting flag with the existing parseArgs pattern. factory.config.json's runtime.* schema also extends with includeDrafting (CLI flag > config > built-in default false)."
  - path: packages/runtime/src/runtime.ts
    why: "run() resolves maxAgentTimeoutMs from options.maxAgentTimeoutMs ?? DEFAULT_MAX_AGENT_TIMEOUT_MS today (line ~101). v0.0.9 inserts a per-spec layer: spec.frontmatter['agent-timeout-ms'] (when defined) > options.maxAgentTimeoutMs > DEFAULT_MAX_AGENT_TIMEOUT_MS."
  - path: docs/specs/done/factory-core-v0-0-5-1.md
    why: "Reference shape for adding a factory.config.json key (CLI flag > config > built-in default precedence). v0.0.5.1 added maxIterations/maxTotalTokens/etc.; v0.0.9 adds includeDrafting + consumes the new agent-timeout-ms field from spec frontmatter."
depends-on:
  - factory-core-v0-0-9
---

# factory-runtime-v0-0-9 — `run-sequence` skips drafting + per-spec `agent-timeout-ms` consumption

## Intent

Two field-level runtime extensions that close the v0.0.7 + v0.0.8 sequence-runner gaps. First: `factory-runtime run-sequence` skips `status: drafting` specs by default — the v0.0.7 spec documented this behavior but the implementation never enforced it; the v0.0.8 self-build and v0.0.8 BASELINE both flagged it. New `--include-drafting` flag preserves the legacy walk-everything mode for cluster-atomic shipping. Second: `run()` consumes `spec.frontmatter['agent-timeout-ms']` (added in `factory-core-v0-0-9`) when resolving `PhaseContext.maxAgentTimeoutMs` — wide-blast-radius specs declare their own budget without bumping the global default.

Public API surface unchanged: zero new exports. Field-level addition to `runRunSequence`'s flag set + `factory.config.json` schema extension + a one-line precedence change in `run()`.

## Scenarios

**S-1** — `run-sequence` skips drafting specs by default; `--include-drafting` runs everything
  Given a tmp `<dir>` containing 3 spec files: `a.md` (status: ready), `b.md` (status: drafting, depends-on=[a]), `c.md` (status: drafting, depends-on=[b])
  When `factory-runtime run-sequence <dir> --no-implement --context-dir <ctx>` is invoked (no `--include-drafting`)
  Then exit code 0; `SequenceReport.specs` contains only `a` (status: converged); the topological order returned by `runSequence` reflects only the included specs (i.e., `topoOrder = ['a']`); no `factory-run` records persisted for `b` or `c`. The CLI stdout includes a single line per skipped spec: `factory-runtime: skipping <id> (status: drafting)`.
  And given `factory-runtime run-sequence <dir> --no-implement --include-drafting --context-dir <ctx>`, all 3 specs run; topological order is `['a', 'b', 'c']`.
  And given the same dir but ALL specs at `status: drafting`, the default invocation produces exit 1 with stderr `runtime/sequence-empty: no specs with status: ready found in <dir> (use --include-drafting to walk all specs regardless of status)`. **NEW `runtime/sequence-empty` RuntimeErrorCode.**
  Satisfaction:
    - test: packages/runtime/src/sequence.test.ts "run-sequence default skips status: drafting; runs only ready"
    - test: packages/runtime/src/sequence.test.ts "run-sequence --include-drafting walks every spec regardless of status"
    - test: packages/runtime/src/sequence.test.ts "run-sequence with no ready specs exits with runtime/sequence-empty"
    - test: packages/runtime/src/cli.test.ts "run-sequence skipping logs one line per skipped spec to stdout"

**S-2** — `factory.config.json` `runtime.includeDrafting` toggles default; CLI flag overrides
  Given a tmp cwd containing `factory.config.json` with `{ "runtime": { "includeDrafting": true } }` and a `<dir>` of 3 specs (1 ready + 2 drafting)
  When `factory-runtime run-sequence <dir> --no-implement --context-dir <ctx>` is invoked (no CLI flag)
  Then all 3 specs run (config opts in to walk-everything); `SequenceReport.specs` has 3 entries.
  And given the same setup but the CLI explicitly passes `--include-drafting=false` (or, since boolean flags don't have a false form, the absence of the flag with config opting in still respects config), the config value applies. The CLI flag, when present, ALWAYS wins (via the existing CLI flag > config file > built-in default precedence from v0.0.5.1).
  And given a cwd WITHOUT `factory.config.json`, only the `ready` spec runs (built-in default `false`).
  Satisfaction:
    - test: packages/runtime/src/cli.test.ts "factory.config.json runtime.includeDrafting=true makes run-sequence walk drafting specs"
    - test: packages/runtime/src/cli.test.ts "absent factory.config.json leaves run-sequence default (drafting skipped)"

**S-3** — `run()` resolves `maxAgentTimeoutMs` from spec.frontmatter['agent-timeout-ms'] when defined
  Given a spec with `agent-timeout-ms: 1200000` in frontmatter and `RunOptions` without an explicit `maxAgentTimeoutMs`
  When `run()` is invoked
  Then `PhaseContext.maxAgentTimeoutMs` equals `1200000` (per-spec override, overriding the built-in 600_000 default).
  And given a spec with `agent-timeout-ms: 1200000` AND `RunOptions.maxAgentTimeoutMs: 1800000`, `PhaseContext.maxAgentTimeoutMs` equals `1800000` (RunOptions wins — the maintainer's explicit override beats the spec's declaration; this matches the existing CLI flag > config > built-in precedence pattern).
  And given a spec WITHOUT the field and `RunOptions.maxAgentTimeoutMs: undefined`, `PhaseContext.maxAgentTimeoutMs` equals `600_000` (built-in default unchanged).
  And given a spec WITHOUT the field and `RunOptions.maxAgentTimeoutMs: 900_000`, `PhaseContext.maxAgentTimeoutMs` equals `900_000` (RunOptions applies; existing v0.0.6 behavior unchanged).
  Satisfaction:
    - test: packages/runtime/src/runtime.test.ts "run() resolves maxAgentTimeoutMs from spec.frontmatter['agent-timeout-ms'] when set"
    - test: packages/runtime/src/runtime.test.ts "run() lets RunOptions.maxAgentTimeoutMs override spec.frontmatter['agent-timeout-ms']"
    - test: packages/runtime/src/runtime.test.ts "run() falls back to 600_000 when neither spec frontmatter nor RunOptions sets it"

## Constraints / Decisions

- **Default behavior change (locked):** `run-sequence` skips `status: drafting` specs unless `--include-drafting` (or `factory.config.json runtime.includeDrafting: true`) is set. The v0.0.7 spec for `run-sequence` already documented this; v0.0.9 enforces it. Backward-compat preserved via the flag.
- **`runtime/sequence-empty` (NEW RuntimeErrorCode):** added to the existing union (10 → 13 in v0.0.7 → **14** in v0.0.9). Fired when default invocation finds zero `status: ready` specs. Exit code 1 (sequence-no-converge family — the user has work to do, not a runtime error).
  Wait — exit 1 is reserved for `'partial'` / `'no-converge'`; `'error'` is exit 3. `runtime/sequence-empty` is fired BEFORE any spec runs, when the input directory has no work for the sequence-runner to do. It's an empty-DAG signal, not a runtime error. **Decision: exit 1, with stderr label** (mirrors `runtime/invalid-twin-mode` which also writes to stderr without throwing). The error code namespace stays for symmetry; the name is `'runtime/sequence-empty'`.
- **CLI flag (locked):** `--include-drafting`. Boolean (no value). Mirrors the existing `--continue-on-fail` flag's shape.
- **`factory.config.json` extension:** `runtime.includeDrafting?: boolean` (default `false`). Read by the existing v0.0.5.1 `readFactoryConfig` helper (already partial-schema, so the new key slots in cleanly).
- **Per-spec `agent-timeout-ms` consumption (locked precedence):** `RunOptions.maxAgentTimeoutMs` ?? `spec.frontmatter['agent-timeout-ms']` ?? `DEFAULT_MAX_AGENT_TIMEOUT_MS`. RunOptions wins (CLI/explicit programmatic override beats the spec's declaration). The spec's declaration beats the built-in default. Locked because: the maintainer's CLI flag is intentional; the spec's field is the spec author's intent; the built-in is the floor.
  - **Note on directionality:** existing v0.0.6 behavior was `options.maxAgentTimeoutMs ?? DEFAULT`. v0.0.9 inserts the spec layer between options and DEFAULT. Backward-compat: specs without the field behave identically to v0.0.8.
- **`run-sequence`'s pre-spec timeout resolution:** when `runSequence` calls `run()` per spec, it does NOT pre-merge the spec's frontmatter timeout into the per-spec options. `run()` itself reads `spec.frontmatter['agent-timeout-ms']` and resolves the precedence locally. This keeps `runSequence` orthogonal to spec-level fields (it only sees runtime-level options).
- **Stdout format for skipped specs (locked):** `factory-runtime: skipping <id> (status: drafting)`. One line per skipped spec, written to stdout BEFORE the sequence's converged/partial summary line. Order: skipped lines in topological order, then summary.
- **`SequenceReport.specs`** does NOT include skipped (drafting) specs as entries when `includeDrafting=false`. The skipped specs are noted via the stdout log only. Programmatic callers reading `SequenceReport.specs.length` see only the specs that were actually walked.
- **Tests use bare paths in `test:` lines (no backticks).**
- **Public API surface** from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.8's 21 names. No new exports. `RuntimeErrorCode` enum gains `'runtime/sequence-empty'` (field-level on already-exported type — 13 → 14 values).
- **Coordinated package version bump deferred to spec 4** (`factory-spec-review-v0-0-9`'s chore subtask).
- **v0.0.9 explicitly does NOT ship in this spec:** auto-flipping of `status: drafting` → `ready` after a converging spec (still maintainer-driven); per-spec timeout overrides via `factory.config.json` (only via spec frontmatter); custom skipping rules beyond `status: drafting`.

## Subtasks

- **T1** [feature] — Update `packages/runtime/src/sequence.ts`'s `loadSpecs` to filter on `frontmatter.status` when `options.includeDrafting !== true`. Pass the includeDrafting flag through `RunSequenceOptions`. ~15 LOC. **depends on nothing.**
- **T2** [feature] — Update `runSequence`: when filtered specs is empty, throw `RuntimeError({ code: 'runtime/sequence-empty', message: ... })`. Add the new error code to `errors.ts`. ~10 LOC. **depends on T1.**
- **T3** [feature] — Update `packages/runtime/src/cli.ts`'s `runRunSequence` to add `--include-drafting` flag (boolean parseArgs entry); extend `FactoryConfigRuntimeSchema` with `includeDrafting?: boolean`; thread through to `runSequence` options with the standard CLI > config > default precedence. ~20 LOC. **depends on T2.**
- **T4** [feature] — Update `packages/runtime/src/runtime.ts`'s `run()`: insert the per-spec layer between `options.maxAgentTimeoutMs` and `DEFAULT_MAX_AGENT_TIMEOUT_MS`. Read `args.spec.frontmatter['agent-timeout-ms']` (assumes the field exists per `factory-core-v0-0-9`'s schema extension). ~5 LOC. **depends on factory-core-v0-0-9 having shipped.**
- **T5** [test] — `packages/runtime/src/sequence.test.ts`: 3 tests covering S-1. `packages/runtime/src/cli.test.ts`: 2 tests covering S-2. `packages/runtime/src/runtime.test.ts`: 3 tests covering S-3. ~150 LOC. **depends on T1, T2, T3, T4.**
- **T6** [chore] — Update `packages/runtime/README.md`: document the new `--include-drafting` flag, the default behavior change, and the spec frontmatter precedence for agent-timeout-ms. ~25 LOC. **depends on T1..T5.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.9 cluster.
- `pnpm -C packages/runtime build` produces a working `dist/cli.js`; `factory-runtime run-sequence` accepts the new `--include-drafting` flag without parse errors.
- Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.8's 21 names.
- `RuntimeErrorCode` enum has 14 values (was 13; +1 new code: `runtime/sequence-empty`).
- README in `packages/runtime/` documents the new flag + default behavior change + spec-level timeout override.
- v0.0.9 explicitly does NOT ship in this spec: auto-flip drafting → ready; config-file timeout overrides; non-status-based skipping. Deferred per Constraints.

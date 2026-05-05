---
id: factory-runtime-v0-0-12-observability
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/runtime/src/runtime.ts
    why: "central runtime loop. Today silent between phases; v0.0.12 emits one stderr line per phase boundary AND one cause-of-iteration line at iter N+1 start (built from prior iter's factory-validate-report + factory-dod-report payloads). New cross-iteration comparison detects monotonic DoD-pass + identical-validate-fail tooling-mismatch loops."
  - path: packages/runtime/src/cli.ts
    why: "CLI flag surface. v0.0.12 adds `--quiet` (suppress stderr progress) and `--quiet` parsing. Also adds factory.config.json key `runtime.quiet`."
  - path: docs/specs/done/dynamic-dag-walk-v0-0-11.md
    why: "v0.0.11's promotion log lines (`factory-runtime: <id> converged → promoting <dep-id>`) are stdout. v0.0.12's per-phase + per-iteration progress lines are stderr — separate channel so scripts that parse stdout aren't disturbed."
  - path: BACKLOG.md
    why: "v0.0.12 entries 'run-sequence surfaces cause-of-iteration on streamed output' (short-url BASELINE highest-impact friction), 'Live progress on stderr (one line per phase)' (CORE-836), 'Detect monotonic DoD-pass + same validate-fails tooling-mismatch loop' (CORE-836). All three close in this spec."
depends-on:
  - factory-harness-v0-0-12
---

# factory-runtime-v0-0-12-observability — surface why a spec re-iterated and what each phase is doing

## Intent

Three observability fixes that share the runtime's per-phase / per-iteration boundary. Today the runtime is silent on stderr until convergence — minutes-long silences on wide-blast specs erode trust, and reconstructing "why did iter 1 fail?" requires hand-walking implement-report payloads. v0.0.12 surfaces three signals: (1) one-line cause-of-iteration summary on stderr at iter N+1 start (data already on disk via v0.0.3's cross-iter prompt threading), (2) one stderr line per phase boundary (start + end with timing/tokens/files-changed), and (3) a warning when the runtime detects monotonic DoD-pass + identical-validate-fail across iterations (suspected tooling mismatch — surface, don't auto-resolve). Closes the short-url BASELINE's highest-impact friction.

## Scenarios

**S-1** — Cause-of-iteration line emitted on iter N+1 start
  Given a spec runs for 2 iterations: iter 1 implement passes; iter 1 validate fails on scenario `S-2`; iter 1 dod passes; iter 2 implement starts
  When `factory-runtime run` invokes the runtime (no `--quiet` flag)
  Then between iter 1's terminal phase report and iter 2's first phase, stderr contains exactly one line of the form `[runtime] iter 2 implement (start) — retrying: 1 failed scenario (S-2); 0 failed dod gates`. The summary is built by reading prior iter's `factory-validate-report.failedScenarios` and `factory-dod-report.failedGates` from the context store. If both are empty (e.g., iter 1's own implement-phase failed and validate didn't run), the line reads `[runtime] iter 2 implement (start) — retrying: prior implement phase failed (see factory-implement-report <id>)`.
  Satisfaction:
    - test: packages/runtime/src/runtime.test.ts "iter N+1 start emits cause-of-iteration line built from prior validate + dod reports"
    - test: packages/runtime/src/runtime.test.ts "cause-of-iteration falls back to implement-failed message when validate did not run in prior iter"

**S-2** — Live progress: one stderr line per phase boundary
  Given a spec running with default settings (no `--quiet`)
  When `factory-runtime run` walks `implement → validate → dod` in iter 1
  Then stderr contains six lines (one start + one end per phase): `[runtime] iter 1 implement (start) — spec=<id> phase=implement runId=<short>` followed at phase completion by `[runtime] iter 1 implement (84s, 32 charged tokens, 7 files changed)`. Same shape for `validate` and `dod` (their end-line lists scenario-pass-count or dod-gate-pass-count instead of files-changed). When `--quiet` is passed (or `factory.config.json runtime.quiet: true`), NO progress lines are emitted; the runtime's existing stdout (sequence-summary line at end) is unchanged.
  Satisfaction:
    - test: packages/runtime/src/runtime.test.ts "phase boundaries emit start + end stderr lines with timing and counts"
    - test: packages/runtime/src/cli.test.ts "--quiet suppresses progress; existing stdout unchanged"
    - test: packages/runtime/src/cli.test.ts "factory.config.json runtime.quiet: true matches --quiet flag behavior"

**S-3** — Monotonic DoD-pass + identical-validate-fail warning
  Given iter N-1 has `factory-dod-report.status === 'pass'` AND `factory-validate-report.failedScenarios = ['S-2', 'S-5']`, AND iter N has `factory-dod-report.status === 'pass'` AND `factory-validate-report.failedScenarios = ['S-2', 'S-5']` (identical set)
  When iter N+1 is about to start
  Then stderr contains one warning line: `[runtime] WARNING: DoD passing + validate fails identical across iter N-1/N — likely tooling mismatch; consider --prefer-dod or inspect per-scenario harness invocation. Failed scenarios: S-2, S-5`. The runtime continues to iter N+1 (no behavior change — surface only). The warning fires at most once per run; subsequent iterations don't re-fire.
  And given the failed-scenario set CHANGES between iter N-1 and iter N (genuine progress), no warning fires.
  Satisfaction:
    - test: packages/runtime/src/runtime.test.ts "monotonic DoD-pass + identical validate-fail emits warning once at iter N+1 start"
    - test: packages/runtime/src/runtime.test.ts "no warning when failed-scenario set differs between iterations"

## Constraints / Decisions

- **Stderr is the channel for progress.** Stdout reserved for: (a) v0.0.11's `factory-runtime: <id> converged → promoting <dep-id>` lines, (b) the converged final-summary line, (c) explicit user-facing CLI output. All v0.0.12 progress lines emit on stderr so script consumers parsing stdout are undisturbed.
- **Cause-of-iteration line format (locked):** `[runtime] iter <N> implement (start) — retrying: <K> failed scenario(s) (<id>, <id>); <M> failed dod gate(s) (<command>, <command>)`. Comma-separated id/command lists; truncate after 5 with `, ...`.
- **Per-phase end-line format (locked):** `[runtime] iter <N> <phase> (<elapsed>s, <charged> charged tokens<, <K> files changed | , <K>/<N> scenarios pass | , <K>/<N> dod gates pass>)`. Phase-specific suffix; consistent overall shape.
- **`--quiet` semantics (locked):** suppresses ALL `[runtime]` stderr progress lines AND the cause-of-iteration line AND the tooling-mismatch warning. Does NOT suppress hard-fail stderr (RuntimeError surfaces; agent stderr captures).
- **`factory.config.json runtime.quiet?: boolean`** (default false). CLI flag > config > built-in default — matches the existing `runtime.includeDrafting` precedence.
- **Warning is fire-once per run.** Once emitted, an internal flag prevents re-firing in subsequent iterations of the same run. (If the loop persists 5 iterations, the human only sees the warning once — at the iter-3 boundary where the data first allows the diagnosis.)
- **Cross-iter data source:** runtime reads `factory-validate-report` + `factory-dod-report` records via `contextStore.list({ type, parents: [runId] })` filtered by iteration index. Read-only; no schema changes; data is already persisted.
- **Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.11's 26 names.** All changes are internal to `runtime.ts` + a `quiet?: boolean` field added to `RunOptions` (existing exported type — field-level addition).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.12 explicitly does NOT ship in this spec:** auto-short-circuit on monotonic DoD-pass loops (option (b) in BACKLOG — needs more evidence about determinism); JSON-line streaming progress format (option (c) in BACKLOG — could ship in v0.0.13 if tooling consumers ask for it); per-phase telemetry in stdout (kept on stderr per channel-discipline).

## Subtasks

- **T1** [feature] — Extend `packages/runtime/src/runtime.ts` to emit per-phase start + end stderr lines via `process.stderr.write` (or an existing logger). Phase names: `implement`, `validate`, `dod`. Counts pulled from each phase's terminal record. ~50 LOC. **depends on nothing.**
- **T2** [feature] — Add cause-of-iteration line at iter N+1 start: read prior iter's terminal records, build the summary string, emit on stderr. Helper `buildCauseOfIteration(priorReports): string`. ~40 LOC. **depends on T1.**
- **T3** [feature] — Add monotonic-DoD-pass detection + warning emission. Helper `detectToolingMismatchLoop(iterReports): { mismatchDetected: boolean, failedScenarios: string[] }`. Fire-once flag. ~35 LOC. **depends on T2.**
- **T4** [feature] — Add `RunOptions.quiet?: boolean` (existing type, field-level addition). CLI flag `--quiet` (boolean) parsed in `cli.ts`; `factory.config.json runtime.quiet` consumed via existing config loader (CLI > config > default). ~20 LOC. **depends on T1, T2, T3.**
- **T5** [test] — `packages/runtime/src/runtime.test.ts`: 5 tests covering S-1, S-2, S-3 (cause line, phase progress, warning, quiet flag suppression, no-warning-on-progress). `cli.test.ts`: 2 tests for `--quiet` flag + config key. ~120 LOC. **depends on T1-T4.**
- **T6** [chore] — Update `packages/runtime/README.md`: add a "Live progress (v0.0.12+)" subsection documenting stderr format + `--quiet`. ~25 LOC. **depends on T5.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/runtime typecheck`).
- tests green (`pnpm -C packages/runtime test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.12 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/runtime build`).
- A test verifies that `--quiet` suppresses ALL stderr progress lines including the tooling-mismatch warning.
- Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.11's 26 names.
- README in `packages/runtime/` documents v0.0.12 progress + `--quiet`.
- v0.0.12 explicitly does NOT ship in this spec: auto-short-circuit on monotonic loops; JSON-line streaming format; stdout-channel progress. Deferred per Constraints.

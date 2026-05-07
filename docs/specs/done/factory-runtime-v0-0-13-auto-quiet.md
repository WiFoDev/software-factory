---
id: factory-runtime-v0-0-13-auto-quiet
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/runtime/src/cli.ts
    why: "v0.0.12 shipped --quiet to suppress per-phase + cause-of-iteration progress lines. v0.0.13 makes --quiet the DEFAULT when stderr is not a TTY (i.e., the run is being captured via tee/redirection) — the v0.0.12 BASELINE dogfooder flagged stderr-pollution of captured logs as honorable mention #2."
  - path: BACKLOG.md
    why: "v0.0.13 entry 'Default --quiet for non-TTY stdout (or stderr-progress channel discipline)' (CORE-836 + v0.0.12 BASELINE)."
depends-on:
  - factory-core-v0-0-13-init-ergonomics
---

# factory-runtime-v0-0-13-auto-quiet — default `--quiet` for non-TTY stderr

## Intent

v0.0.12 shipped live progress on stderr (`[runtime] iter <N> <phase> ...` lines) default-on. The v0.0.12 BASELINE found this pollutes captured logs — `tee .factory/run-sequence.log`, `2>&1 > log.txt`, and CI-job log captures all swallow the progress lines as noise. v0.0.13 auto-detects `process.stderr.isTTY` at runtime startup: when stderr is not a TTY (script-piped, redirected, captured), the resolved quiet flag defaults to true. CLI flag `--quiet` always quiets; new CLI flag `--no-quiet` (or `--progress`) opts back into progress for non-TTY contexts that want it (e.g., a CI job that wants step-by-step in its captured log). `factory.config.json runtime.quiet` precedence: CLI flag > config > auto-detect > built-in default false.

## Scenarios

**S-1** — Auto-quiet fires when stderr is not a TTY
  Given a `factory-runtime run` invocation where `process.stderr.isTTY` is false (simulated in tests via stubbing or by piping the output)
  When the runtime starts a phase
  Then NO `[runtime] iter <N> <phase> ...` progress lines are written to stderr. The runtime's existing stdout (sequence summary, dynamic-DAG promotion logs) is unchanged. The cause-of-iteration line at iter N+1 start is also suppressed (it's part of the progress family).
  And given `process.stderr.isTTY` is true (real terminal), the v0.0.12 progress + cause-line behavior is preserved (default-on).
  Satisfaction:
    - test: packages/runtime/src/cli.test.ts "non-TTY stderr triggers auto-quiet by default"
    - test: packages/runtime/src/cli.test.ts "TTY stderr preserves v0.0.12 progress + cause-line default"

**S-2** — `--no-quiet` (or `--progress`) opts back into progress for non-TTY
  Given a non-TTY stderr (auto-quiet would fire) AND `factory-runtime run --no-quiet <spec>` is invoked
  When the runtime runs
  Then progress lines ARE emitted on stderr (the same lines the v0.0.12 default produced). `--progress` is accepted as a synonym for `--no-quiet`. Both flags override the auto-detect.
  And given `--quiet` is also passed (`--quiet --no-quiet`), the LATER flag wins (this is parseArgs's standard behavior; document it).
  Satisfaction:
    - test: packages/runtime/src/cli.test.ts "--no-quiet overrides auto-detect on non-TTY stderr"
    - test: packages/runtime/src/cli.test.ts "--progress is accepted as --no-quiet alias"

**S-3** — Precedence: CLI flag > factory.config.json > auto-detect > built-in default
  Given `factory.config.json` has `runtime.quiet: false` AND `process.stderr.isTTY` is false
  When `factory-runtime run` is invoked WITHOUT a CLI quiet flag
  Then the resolved quiet is `false` (config wins over auto-detect). Progress lines emit normally.
  And given the same setup but `--quiet` is passed on the CLI, the resolved quiet is `true` (CLI wins over config).
  And given no config + no CLI flag + non-TTY stderr, auto-detect kicks in → quiet=true.
  Satisfaction:
    - test: packages/runtime/src/cli.test.ts "factory.config.json runtime.quiet overrides auto-detect"
    - test: packages/runtime/src/cli.test.ts "--quiet CLI flag wins over config"

## Constraints / Decisions

- **Auto-quiet trigger (locked):** `process.stderr.isTTY === false`. Note: NOT `process.stdout.isTTY` — progress goes to stderr; check the relevant stream. Most CI environments (GitHub Actions, GitLab CI) report stderr.isTTY=false, so progress auto-suppresses there by default.
- **Precedence chain (locked):** CLI `--quiet`/`--no-quiet`/`--progress` flag > `factory.config.json runtime.quiet` > auto-detect (`process.stderr.isTTY`) > built-in default false. Documented in cli.ts comment block + README.
- **CLI flags:** `--quiet` (boolean, force-quiet), `--no-quiet` (boolean, force-not-quiet), `--progress` (alias for `--no-quiet`). Mutual exclusion: if both `--quiet` AND `--no-quiet` appear, the later one wins (parseArgs default).
- **`factory.config.json runtime.quiet` semantics extended:** previously a boolean; now `true | false | undefined`. `undefined` means "fall through to auto-detect"; that's the default for v0.0.13's `factory init`-scaffolded `factory.config.json` (the field is omitted, allowing auto-detect to kick in).
- **No public API surface change.** Changes are internal to `cli.ts` (auto-detect logic + flag-parser additions) and field-level on the existing `RunOptions.quiet?: boolean` (field stays the same shape; just resolution-rule changes). Public API exports unchanged at 26.
- **Auto-detect MUST be testable** — extract the precedence resolution to a pure helper `resolveQuiet({ cliFlag, configValue, isTTY }): boolean` so tests don't have to stub `process.stderr.isTTY`.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.13 explicitly does NOT ship in this spec:** JSON-line streaming progress format (deferred); separate `--progress=fd:N` channel (deferred); per-phase opt-in (e.g., suppress implement progress only) — out of scope.

## Subtasks

- **T1** [feature] — Add pure helper `resolveQuiet({ cliFlag, configValue, isTTY }): boolean` in `packages/runtime/src/cli.ts` (or a new `quiet-resolution.ts`). Implements the precedence chain. ~25 LOC. **depends on nothing.**
- **T2** [feature] — Wire `resolveQuiet` into the CLI flag parsing for `factory-runtime run` and `factory-runtime run-sequence`. Add `--no-quiet` (and `--progress` alias) to the parseArgs config. Read `process.stderr.isTTY` at startup. ~20 LOC. **depends on T1.**
- **T3** [test] — `packages/runtime/src/cli.test.ts` covers S-1 + S-2 + S-3 (6 tests via `resolveQuiet` direct calls — deterministic, no need to stub stderr.isTTY). ~80 LOC. **depends on T1, T2.**
- **T4** [chore] — Update `packages/runtime/README.md`: extend the v0.0.12 `--quiet` subsection with the v0.0.13 auto-detect + precedence chain. ~20 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/runtime typecheck`).
- tests green (`pnpm -C packages/runtime test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.13 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/runtime build`).
- A test verifies the resolveQuiet precedence chain for all 8 input combinations (CLI yes/no/unset × config yes/no/unset × TTY true/false → expected boolean).
- Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.12's 26 names.
- README in `packages/runtime/` documents v0.0.13 auto-quiet + precedence chain.
- v0.0.13 explicitly does NOT ship in this spec: JSON-line streaming format; per-channel progress fd; per-phase opt-in. Deferred per Constraints.

---
id: factory-runtime-v0-0-5-2
classification: light
type: feat
status: ready
exemplars:
  - path: packages/runtime/src/phases/implement.ts
    why: "the file with the hardcoded 600_000ms timeout in spawnAgent. v0.0.5.2 makes it configurable via a new RunOptions field threaded through from the runtime."
  - path: packages/runtime/src/cli.ts
    why: "mirror the --max-prompt-tokens validation pattern (positive integer, exit 2 with stderr label `runtime/invalid-max-agent-timeout-ms` on bad value, NOT a RuntimeErrorCode value). v0.0.3 set the precedent for --max-total-tokens; v0.0.5.2 follows it exactly."
  - path: docs/specs/done/factory-runtime-v0-0-3.md
    why: "v0.0.3 spec — exemplar for adding a new RunOptions field + matching CLI flag with the locked validation pattern (string label, NOT a RuntimeErrorCode value)."
  - path: BACKLOG.md
    why: "the entry 'factory-runtime: per-phase agent timeout configurable via --max-agent-timeout-ms' under 'Moneyball lessons from v0.0.5 self-build'. Documents that factory-publish-v0-0-5 hit the hardcoded 600s cap on iteration 2 because it touched 14 files."
---

# factory-runtime-v0-0-5-2 — Configurable per-phase agent timeout (`--max-agent-timeout-ms`)

## Intent

`implementPhase`'s spawned `claude -p` subprocess has a hardcoded 600_000ms (10-minute) wall-clock timeout. Wide-blast-radius specs hit it: v0.0.5's `factory-publish-v0-0-5` (touching 14 files) timed out on iteration 2 with the agent making real progress. The proper fix is a configurable knob — keep the default tight as a guardrail against hung agents, but let big specs raise the ceiling explicitly.

Add `RunOptions.maxAgentTimeoutMs?: number` (default 600_000) and CLI flag `--max-agent-timeout-ms <n>` with positive-integer validation. Mirrors the v0.0.3 `--max-total-tokens` design exactly (field-level addition; string-label CLI validation with NO new RuntimeErrorCode; existing `runtime/agent-failed` error code covers the timeout case with the message updated to use the resolved value).

## Scenarios

**S-1** — Default 600_000ms is unchanged when no flag/option provided
  Given a fresh factory-runtime invocation with no `--max-agent-timeout-ms` flag and no programmatic `maxAgentTimeoutMs` option
  When `implementPhase` runs and the spawned agent hangs (use the existing fake-claude `hang` mode)
  Then the spawn rejects with `runtime/agent-failed: agent-timeout (after 600000ms): ...` — byte-equal to v0.0.5 behavior. Regression gate.
  Satisfaction:
    - test: src/phases/implement.test.ts "default agent timeout remains 600000ms when no override is provided"

**S-2** — `--max-agent-timeout-ms 30000` is honored end-to-end
  Given a fresh `dist/cli.js` and a tmp context-dir, the fake-claude `hang` mode, and the CLI invocation `factory-runtime run <spec> --no-judge --max-agent-timeout-ms 30000 --claude-bin <fake> --context-dir <tmp>`
  When the run executes
  Then the spawn rejects within ~30s (not the default 600s) with `runtime/agent-failed: agent-timeout (after 30000ms): ...`. Wall-clock asserted as `< 35_000ms` for the timeout path. The CLI exit code is `3` (matches v0.0.5 agent-failed exit-code mapping). The persisted `factory-phase` for the implement iteration has `status: 'error'`, `failureDetail` starting `runtime/agent-failed: agent-timeout (after 30000ms):`.
  Satisfaction:
    - test: src/cli.test.ts "--max-agent-timeout-ms 30000 honored end-to-end via fake-claude hang fixture"

**S-3** — `--max-agent-timeout-ms` invalid → exit 2 with stderr label
  Given the built `dist/cli.js`
  When `factory-runtime run <spec> --max-agent-timeout-ms 0` is invoked (or `abc`, or `-5`)
  Then exit code `2`; stderr contains `runtime/invalid-max-agent-timeout-ms: --max-agent-timeout-ms must be a positive integer (got '0')` (or `'abc'` / `'-5'`). The stderr label is a string format only — NOT a `RuntimeErrorCode` value (mirrors the `--max-prompt-tokens` and `--max-total-tokens` precedents).
  Satisfaction:
    - test: src/cli.test.ts "--max-agent-timeout-ms 0 / abc / -5 → exit 2 with stderr label runtime/invalid-max-agent-timeout-ms"

## Constraints / Decisions

- New field `RunOptions.maxAgentTimeoutMs?: number` in `packages/runtime/src/types.ts`. Field-level addition to an already-exported type. Default resolved as `options.maxAgentTimeoutMs ?? 600_000` in `runtime.ts`; threaded to `implementPhase` via the existing options-flow path.
- New CLI flag `--max-agent-timeout-ms <n>` in `packages/runtime/src/cli.ts`. Validation pattern mirrors `--max-prompt-tokens`: parse with `Number.parseInt`, check `Number.isFinite(n) && n > 0 && String(n) === raw.trim()`. On bad value: exit 2 with stderr line `runtime/invalid-max-agent-timeout-ms: --max-agent-timeout-ms must be a positive integer (got '<raw>')`. The label is a STRING format, NOT a `RuntimeErrorCode` value (locked: zero new RuntimeErrorCode members in v0.0.5.2).
- Update USAGE string to document the new flag with `(default: 600000)`.
- The existing `runtime/agent-failed` error code covers timeout. The `agent-timeout (after Nms)` message uses the resolved value (so a 30000ms run reports `after 30000ms`, not `after 600000ms`).
- Public API surface unchanged — field-level addition. `@wifo/factory-runtime/src/index.ts` exports stay at 19 names.
- `RuntimeErrorCode` union unchanged (still 10 members from v0.0.3). The CLI validation label is a string format, mirroring the v0.0.3 `--max-total-tokens` decision.
- `packages/runtime/package.json` bumps to `0.0.5.1` if the filesChanged spec ships first, else to `0.0.5.2`. Both can coexist in the same `0.0.5.1` if shipped bundled (factory-runtime-v0-0-5-1 and -5-2 both bump to the same version when bundled).

## Subtasks

- **T1** [feature] — Add `maxAgentTimeoutMs` to `RunOptions` in `packages/runtime/src/types.ts`. Resolve in `packages/runtime/src/runtime.ts` and thread to `implementPhase`. Update `spawnAgent` in `packages/runtime/src/phases/implement.ts` to use the resolved value (replace the hardcoded `600_000` constant in the `setTimeout` call and the `agent-timeout (after Nms)` message). ~40 LOC. **depends on nothing.**
- **T2** [feature] — Add `--max-agent-timeout-ms <n>` flag in `packages/runtime/src/cli.ts` with positive-integer validation mirroring `--max-prompt-tokens`. Update USAGE string. ~30 LOC. **depends on T1.**
- **T3** [test] — Add 3 tests covering S-1, S-2, S-3 in the appropriate test files (implement.test.ts for S-1; cli.test.ts for S-2 and S-3). Use the existing fake-claude `hang` mode. ~80 LOC. **depends on T1, T2.**
- **T4** [chore] — Bump `packages/runtime/package.json` to `0.0.5.1` (if bundled with factory-runtime-v0-0-5-1) or `0.0.5.2`. Update `packages/runtime/README.md` v0.0.5.x release notes. ~10 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/runtime typecheck` clean.
- `pnpm -C packages/runtime test` green; `pnpm test` workspace-wide green.
- `pnpm check` clean.
- Public API surface from `@wifo/factory-runtime/src/index.ts` is **strictly equal** to v0.0.5's 19 names.
- `RuntimeErrorCode` union is **strictly equal** to v0.0.3's 10 members (no new code in v0.0.5.2).
- The fake-claude hang fixture reliably triggers the timeout at the resolved value across multiple runs.

---
id: factory-runtime-v0-0-14-claude-no-hooks
classification: light
type: feat
status: drafting
exemplars:
  - path: packages/runtime/src/phases/implement.ts
    why: "implementPhase spawns `claude -p` with locked args. v0.0.14 investigates whether claude v2.x has a flag to suppress session-start hooks (which inject Vercel/Next.js skill auto-suggestions into the agent's prompt — false positives in factory-shaped projects)."
  - path: BACKLOG.md
    why: "v0.0.14 entry 'Skill-injection noise reaches subprocess agents'. The v0.0.13 BASELINE caught the implement-phase agent explicitly noting it ignored the noise. Even ignored, it eats prompt budget."
depends-on:
  - factory-harness-v0-0-14-apostrophe-fix
---

# factory-runtime-v0-0-14-claude-no-hooks — silence skill-injection noise in subprocess agents

## Intent

When `implementPhase` spawns `claude -p`, the spawned Claude inherits the user's session-start hooks — including Vercel/Next.js/AI-SDK skill auto-suggestions. The v0.0.13 BASELINE caught the implement-phase agent's result field: *"I noticed and ignored several Vercel/Next.js/bootstrap skill auto-suggestions from session-start hooks — they were false positives (this is a Bun-only project with no Vercel or Next.js)."* Even ignored, the noise eats the implement-phase's prompt budget every iteration.

v0.0.14 investigates the claude CLI surface for a way to suppress hooks. If a flag exists (e.g., `--no-hooks`, `--minimal`, `--isolated`), apply it to `implementPhase`'s spawn args. If no flag exists, try `HOME=$(mktemp -d)` to isolate the spawn from user-level `.claude/` (verify subscription auth still works). If neither path works without breaking auth, document the limitation and defer to upstream claude.

This spec is intentionally exploratory — the actual fix depends on what claude exposes. Investigation is part of the work.

## Scenarios

**S-1** — Investigation: claude CLI flag survey
  Given the locally-installed `claude` CLI (v2.x)
  When the implementer runs `claude --help` (and `claude -p --help` if separate)
  Then a textual document is captured (in the spec's investigation log or README) listing the flags claude supports for hook suppression. The investigation MUST identify ONE of:
  - (a) A flag that disables session-start hooks (e.g., `--no-hooks`, `--no-session-start-hooks`, `--minimal`);
  - (b) A flag combination + env var that achieves the same effect (e.g., `CLAUDE_NO_HOOKS=1 claude -p`);
  - (c) No clean way exists in the current claude version.
  Satisfaction:
    - test: packages/runtime/src/phases/implement.test.ts "implementPhase's claude spawn args include the resolved no-hooks flag if available"

**S-2** — If a flag/env exists: apply it to `implementPhase`'s spawn
  Given the investigation from S-1 identified a working flag (e.g., `--no-hooks`)
  When `implementPhase` spawns `claude -p ...`
  Then the spawn args include the flag (e.g., `claude -p --no-hooks ...`). The fake-claude test fixture in `packages/runtime/test-fixtures/fake-claude.ts` verifies the flag appears in argv. The agent's prompt no longer carries session-start hook noise (verified by checking the prompt's final byte length — should be smaller).
  Satisfaction:
    - test: packages/runtime/src/phases/implement.test.ts "fake-claude receives the no-hooks flag in argv"

**S-3** — If no flag exists: HOME-isolation fallback OR documented limitation
  Given the investigation from S-1 found NO flag (option c)
  When `implementPhase` spawns `claude -p ...`
  Then either:
  - (path a — HOME isolation): the spawn uses `env: { ...process.env, HOME: <tmpdir> }` to isolate from user-level hooks; subscription auth state is preserved by either copying relevant files into the tmpdir OR by setting `HOME` only after auth state is read at spawn parent. Verify subscription auth still works via fake-claude or empirical test.
  - (path b — documented limitation): `packages/runtime/README.md` gains a "Subscription-auth + skill-injection" subsection explaining the trade-off; v0.0.15 candidate for upstream-claude flag dependence.
  The implementer picks (a) if HOME-isolation works without breaking auth; otherwise (b).
  Satisfaction:
    - test: packages/runtime/src/phases/implement.test.ts "implementPhase HOME-isolation preserves subscription auth (or — if path b — README documents the limitation)"

## Constraints / Decisions

- **Investigation precedes implementation.** This spec is small in LOC if a flag exists (~10 LOC); larger if HOME-isolation is needed (~40 LOC) or pure-docs if no fix works. The implementer MUST capture the investigation result (which path: a/b/c) in the implement-report's payload.result before writing the test or code.
- **Subscription auth preservation (locked):** the fix MUST NOT break Claude Pro/Max subscription auth. If HOME-isolation breaks auth (auth state lives in HOME), abandon path (a) and go to (b).
- **Path (c) — documented limitation — is acceptable.** If the implementer determines neither path works in the current claude version, the spec ships pure-docs + a v0.0.15 candidate noting upstream dependence. This is NOT a failure — surfacing the limitation IS the win.
- **Fake-claude test fixture extensibility (locked):** if path (a), `packages/runtime/test-fixtures/fake-claude.ts` learns to emit a marker in its output when called with the no-hooks flag (e.g., `console.log('[fake-claude] no-hooks=true')`). The test reads the marker.
- **No public API surface change.** All changes are internal to `implementPhase`'s spawn logic + tests + README.
- **References v0.0.14 cross-cutting Constraints from `factory-harness-v0-0-14-apostrophe-fix`** for cluster ordering and ship flags.
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.14 explicitly does NOT ship in this spec:** custom hook authoring (out of scope); a runtime-level skill-injection filter (would parse claude's stdout — too fragile); Anthropic SDK direct calls bypassing CLI (out of scope; subscription auth is the locked path).

## Subtasks

- **T1** [chore] — Run `claude --help` (and equivalent for `-p`); capture flag list in the implement-report's payload.result. Determine path (a/b/c). ~5 LOC if path (a); investigation note if (b)/(c). **depends on nothing.**
- **T2** [feature/fix] — IF path (a): update `packages/runtime/src/phases/implement.ts`'s `claude -p` spawn args to include the no-hooks flag. ~5 LOC. IF path (b): add HOME-isolation env override to the spawn; verify auth via fake-claude test. ~25 LOC. IF path (c): no code change. **depends on T1.**
- **T3** [test] — Update `packages/runtime/test-fixtures/fake-claude.ts` to emit a marker when called with the resolved flag (path a). `packages/runtime/src/phases/implement.test.ts`: 1-2 tests verifying the flag/env propagates AND auth preservation. IF path (c): 1 test pinning the README documents the limitation. ~40 LOC. **depends on T2.**
- **T4** [chore] — Update `packages/runtime/README.md`: brief subsection "Skill-injection noise (v0.0.14)" documenting the resolved approach (a/b/c). ~25 LOC. **depends on T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- typecheck clean (`pnpm -C packages/runtime typecheck`).
- tests green (`pnpm -C packages/runtime test`; `pnpm test` workspace-wide green).
- biome clean (`pnpm check`).
- lint clean against the v0.0.14 cluster (`node packages/core/dist/cli.js spec lint docs/specs/` exits 0).
- packages build (`pnpm -C packages/runtime build`).
- The investigation result (path a/b/c) is captured in the implement-report's payload.result.
- A test verifies the resolved flag/env propagates to the spawned claude process (or — if path c — that the README documents the limitation).
- Subscription auth is verified to still work via the fake-claude test (or — if path c — manually noted in the README).
- Public API surface from `@wifo/factory-runtime/src/index.ts` strictly equal to v0.0.13's 26 names.
- README in `packages/runtime/` documents the v0.0.14 hook-suppression approach.
- v0.0.14 explicitly does NOT ship in this spec: custom hook authoring; runtime skill-filter; SDK direct calls. Deferred per Constraints.

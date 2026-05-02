---
id: factory-harness-v0-0-5-1
classification: light
type: fix
status: ready
exemplars:
  - path: packages/harness/src/parse-test-line.ts
    why: "the `parseTestLine` function. v0.0.5.1 adds a `stripBackticks` helper paired with the existing `stripQuotes` and applies it to both the file token and the pattern."
  - path: packages/harness/src/parse-test-line.test.ts
    why: "existing test patterns for parseTestLine. v0.0.5.1 adds 3-4 unit tests for the backtick-stripping cases."
  - path: BACKLOG.md
    why: "the entry 'Harness: strip surrounding backticks from test: paths' under 'Moneyball lessons from v0.0.5 self-build' has the full motivation and the recurring-pitfall context."
---

# factory-harness-v0-0-5-1 — Strip surrounding backticks from `test:` paths

## Intent

`parseTestLine` currently returns the file/pattern tokens as-is, including any wrapping markdown backticks. Spec authors naturally write ``- test: `src/foo.test.ts` "happy path"`` (markdown code-formatting); the harness then invokes `bun test \`src/foo.test.ts\` -t "happy path"` and `bun test` searches for a file matching the literal token *with* the backticks — which never matches. Every scenario fails as `runner/no-test-files-matched` even when the implementation is correct. Caught twice now: once in `examples/parse-size`'s v1 spec, once in v0.0.5's `factory-runtime-v0-0-5.md` (the moneyball self-build).

Fix: strip a leading + trailing backtick from the file token and the pattern token in `parseTestLine`, paired with the existing `stripQuotes` step. ~5 LOC change. Unblocks the recurring spec-authoring pitfall at the source; the SPEC_TEMPLATE backtick-guidance BACKLOG entry becomes redundant once shipped.

## Scenarios

**S-1** — Bare paths pass through unchanged
  Given the satisfaction value `src/foo.test.ts "happy path"`
  When `parseTestLine` is called
  Then the result is `{ file: 'src/foo.test.ts', pattern: 'happy path' }` — bytes-identical to v0.0.5 behavior
  Satisfaction:
    - test: src/parse-test-line.test.ts "bare path passes through unchanged"

**S-2** — Backtick-wrapped path strips to bare
  Given the satisfaction value `` `src/foo.test.ts` "happy path" ``
  When `parseTestLine` is called
  Then the result is `{ file: 'src/foo.test.ts', pattern: 'happy path' }` — backticks around the file token are stripped before `looksLikeFile` evaluates the token
  Satisfaction:
    - test: src/parse-test-line.test.ts "backtick-wrapped path strips to bare"

**S-3** — Backtick-wrapped pattern strips to bare
  Given the satisfaction value `` src/foo.test.ts `happy path` ``
  When `parseTestLine` is called
  Then the result is `{ file: 'src/foo.test.ts', pattern: 'happy path' }` — backticks around the pattern token are stripped after `stripQuotes`
  Satisfaction:
    - test: src/parse-test-line.test.ts "backtick-wrapped pattern strips to bare"

**S-4** — Backticks mid-string are NOT stripped (only leading + trailing)
  Given the satisfaction value `` `src/foo.test.ts` "match `inner` token" ``
  When `parseTestLine` is called
  Then the result is `{ file: 'src/foo.test.ts', pattern: 'match \`inner\` token' }` — only the OUTER backticks on each token are stripped; mid-string backticks survive (they're meaningful regex chars or just literal characters bun-test passes through)
  Satisfaction:
    - test: src/parse-test-line.test.ts "mid-string backticks survive"

## Constraints / Decisions

- New internal helper `stripBackticks(text: string): string` in `parse-test-line.ts`, mirrors `stripQuotes` shape: trims, checks length ≥ 2, checks first + last char === '\`', slices. Internal-only — NOT exported from `src/index.ts`.
- Apply `stripBackticks` to the file token (BEFORE `looksLikeFile` evaluates whether it's a file path) and to the pattern (AFTER `stripQuotes` runs — so `` "..." `` and `` `...` `` both work, and `` "`...`" `` becomes the unquoted pattern).
- Strip only leading + trailing — mid-string backticks pass through (S-4). Same convention as `stripQuotes`.
- Public API surface unchanged — internal helper, no new export. `@wifo/factory-harness` exports stay at 16 names.
- Once shipped, the BACKLOG entry "SPEC_TEMPLATE: tell users to write `test: src/foo.test.ts \"...\"`" becomes redundant. Mark it superseded in the BACKLOG cleanup follow-up.

## Subtasks

- **T1** [fix] — Add `stripBackticks` helper in `packages/harness/src/parse-test-line.ts`. Apply to the file token before `looksLikeFile` (lines 47-49 + 55) and to the pattern after the existing `stripQuotes` calls (lines 56-57 + 61). ~10 LOC. **depends on nothing.**
- **T2** [test] — Add 4 unit tests in `packages/harness/src/parse-test-line.test.ts` covering S-1..S-4. ~30 LOC. **depends on T1.**
- **T3** [chore] — Bump `packages/harness/package.json` to `0.0.5.1`. **depends on T2.**

## Definition of Done

- All scenarios (S-1..S-4) pass.
- `pnpm -C packages/harness typecheck` clean.
- `pnpm -C packages/harness test` green; `pnpm test` workspace-wide green.
- `pnpm check` clean.
- Public API surface from `@wifo/factory-harness/src/index.ts` is **strictly equal** to v0.0.5's 16 names.
- `packages/harness/package.json` is at `0.0.5.1`.

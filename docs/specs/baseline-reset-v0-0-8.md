---
id: baseline-reset-v0-0-8
classification: light
type: chore
status: ready
exemplars:
  - path: docs/baselines/url-shortener-prompt.md
    why: "The current canonical prompt — byte-stable since v0.0.5 but stale after v0.0.7. v0.0.8's reset archives this verbatim under a versioned filename + writes a fresh canonical that uses /scope-project + run-sequence as the entry point. The new prompt's intent (build a URL shortener with stats) is preserved; only the workflow framing changes."
  - path: BASELINE.md
    why: "Methodology section (lines 12-19) prescribes the baseline-reset trigger: 'if the prompt needs an edit because the factory's API changed, that's a baseline reset; archive the old prompt as <product>-prompt-vX.Y.Z.md.' v0.0.7's BASELINE entry (already shipped) flagged the trigger fired. v0.0.8 executes the prescribed reset."
  - path: docs/baselines/scope-project-fixtures/url-shortener/url-shortener-core.md
    why: "Reference for the four-spec decomposition the new prompt is expected to produce when the agent runs /scope-project against the URL-shortener description. The fixture set demonstrates the canonical output shape; the new baseline prompt should produce a comparable set."
depends-on: []
---

# baseline-reset-v0-0-8 — archive v0.0.5–v0.0.7 prompt + write v0.0.8+ canonical

## Intent

Execute the baseline reset prescribed by BASELINE.md's methodology and triggered by v0.0.7's BASELINE entry. Archive the current `docs/baselines/url-shortener-prompt.md` (which explicitly tells the agent v0.0.7's deliverables don't exist yet) under a versioned filename, then write a fresh canonical whose entry point is `/scope-project` + `factory-runtime run-sequence`. The new prompt measures the v0.0.7+ flow honestly. BASELINE.md's methodology section is updated to record this as the first baseline-reset event.

The product under test is unchanged (URL shortener with click tracking and JSON stats endpoint) — only the workflow framing changes. Methodology invariant preserved: byte-stable canonical from v0.0.8 onward until the next API-change-driven reset.

## Scenarios

**S-1** — The pre-v0.0.8 prompt is archived under a versioned filename
  Given the current `docs/baselines/url-shortener-prompt.md`
  When the v0.0.8 reset is applied
  Then `docs/baselines/url-shortener-prompt-v0.0.5-v0.0.7.md` exists with byte-identical content to the pre-reset prompt; the file's first line is `# URL shortener — canonical baseline prompt (v0.0.5–v0.0.7 era; archived 2026-05-03)` (one-line archive marker prepended; original content follows verbatim below); `git log --follow` resolves the file's history back through every prior commit on the original path.
  Satisfaction:
    - test: packages/core/src/baseline-reset.test.ts "archived prompt exists at versioned path with byte-identical body"
    - test: packages/core/src/baseline-reset.test.ts "archived prompt's first line is the dated archive marker"

**S-2** — The new canonical prompt opens with /scope-project and never mentions the old manual-decomposition workflow
  Given the new `docs/baselines/url-shortener-prompt.md`
  When its content is read
  Then it contains the literal string `/scope-project A URL shortener with click tracking and JSON stats. JSON-over-HTTP, in-memory, no auth.` as the agent's entry-point invocation; it contains the literal `factory-runtime run-sequence docs/specs/` as the convergence step; it does NOT contain any of: `is a v0.0.6 deliverable`, `it doesn't ship until later`, `decomposition is the maintainer's job`, the hardcoded four-spec list (`url-shortener-core`, `url-shortener-redirect`, `url-shortener-tracking`, `url-shortener-stats` mentioned together as a prescribed decomposition); no v0.0.5.x backtick-stripping warning (v0.0.6 fixed that and v0.0.8's prompt should not relitigate); the prompt's product description (URL shortener with click tracking + JSON stats; in-memory; no auth) is preserved verbatim from the archived version's "What we're building" section.
  Satisfaction:
    - test: packages/core/src/baseline-reset.test.ts "new prompt contains /scope-project entry point + run-sequence convergence step"
    - test: packages/core/src/baseline-reset.test.ts "new prompt does not contain v0.0.7-future-tense biases"
    - test: packages/core/src/baseline-reset.test.ts "new prompt preserves the product description from the archived version"

**S-3** — BASELINE.md methodology section records the reset
  Given the updated `BASELINE.md`
  When its methodology section is read
  Then a new subsection (or paragraph appended to the existing methodology) names the v0.0.8 reset event: the date (2026-05-03), the trigger (v0.0.7 shipped /scope-project + depends-on + run-sequence; the pre-v0.0.7 prompt told the agent those tools don't exist), the archived path (`docs/baselines/url-shortener-prompt-v0.0.5-v0.0.7.md`), and the new canonical's entry point (/scope-project). The methodology section also documents the meta-rule: "every baseline reset MUST archive the prior prompt under `<product>-prompt-vX.Y.Z-vX.Y.Z+N.md` and link from this section." This is a forward-compat invariant for future resets.
  Satisfaction:
    - test: packages/core/src/baseline-reset.test.ts "BASELINE.md methodology section names the v0.0.8 reset event + archived path"

## Constraints / Decisions

- **Archive filename pattern (locked):** `docs/baselines/<product>-prompt-vX.Y.Z-vA.B.C.md` where the version range describes the era the archived prompt was canonical for. v0.0.8's archive is `url-shortener-prompt-v0.0.5-v0.0.7.md` (canonical from v0.0.5 ship through v0.0.7 ship). Future resets follow the same pattern.
- **Archive content rule:** byte-identical to the pre-reset prompt EXCEPT for a one-line dated marker prepended at the top (`# URL shortener — canonical baseline prompt (v0.0.5–v0.0.7 era; archived 2026-05-03)`). The marker is MANDATORY so a reader landing on the archived file knows it's not the live canonical.
- **New canonical content rules:**
  - **Setup section:** unchanged from the archived version (still `mkdir ~/dev/url-shortener-vX.Y.Z` + `git init` + open Claude Code).
  - **Product description:** unchanged from the archived version's "What we're building" section. Same four endpoints, same HTTP+Bun constraints. The factory measures progress against the SAME product; only the workflow changes.
  - **Workflow section** (replaces the archived version's "Why we're decomposing manually" + "The four specs" + "Per-spec workflow" + "Setup before spec 1"): one short section that instructs the agent to invoke `/scope-project A URL shortener with click tracking and JSON stats. JSON-over-HTTP, in-memory, no auth.` immediately after `factory init` finishes. The agent is told to review the generated specs (one ready, rest drafting) before invoking `factory-runtime run-sequence docs/specs/ --no-judge --max-iterations 5 --max-total-tokens 1000000 --context-dir ./.factory`. The maintainer flips drafting → ready as each spec converges (or, when status-aware iteration ships, the runtime drives that).
  - **Rules section** (preserved from archived version): bullet list of "use Bun for tests", "native Bun.serve", "bare paths in test: lines", "smallest version", "no bundling specs", "friction IS the artifact." The backtick-warning bullet is REMOVED (obsolete since v0.0.6).
  - **JOURNAL.md template** (preserved): same shape as before — the maintainer/agent still capture per-spec wall-clock, tokens, friction, and a final state section.
- **Methodology update in BASELINE.md:** add a new subsection `### Baseline reset events` (or extend the existing methodology paragraph) listing the v0.0.8 reset with date + trigger + archived path + new entry point. Document the forward-compat invariant for future resets.
- **No code changes outside `packages/core/src/baseline-reset.test.ts`** — this spec is purely docs + a structural test that pins the archive + new-prompt invariants. The test lives under `packages/core/src/` because that's where the existing `scope-project-source.test.ts` and `scope-project-fixture.test.ts` already live (structural tests against in-repo doc artifacts).
- **`git mv` is the rename operation** (not delete + add) so `git log --follow` traces history.
- **Public API surface unchanged across every package** (this spec is docs-only).
- **Coordinated package version bump deferred to spec 3** (`factory-core-v0-0-8-1`'s chore subtask). This spec doesn't bump versions; it ships the doc reset only.
- **v0.0.8 explicitly does NOT ship in this spec:** automated regeneration of fixtures from a real `/scope-project` invocation; a CLI subcommand for triggering future resets; multiple canonical products at once (URL shortener stays the only canonical for now). Each is a separate v0.0.9+ candidate.

## Subtasks

- **T1** [chore] — `git mv docs/baselines/url-shortener-prompt.md docs/baselines/url-shortener-prompt-v0.0.5-v0.0.7.md`. Edit the renamed file to prepend the one-line dated archive marker. ~5 LOC of edits. **depends on nothing.**
- **T2** [chore] — Author the new `docs/baselines/url-shortener-prompt.md` from scratch following the content rules in Constraints. Setup + product description preserved verbatim from archived version; workflow section rewritten to use `/scope-project` + `run-sequence`; rules section preserved minus the backtick bullet; JOURNAL.md template preserved. ~80-120 LOC of prompt markdown. **depends on T1.**
- **T3** [chore] — Update `BASELINE.md` methodology section: add `### Baseline reset events` subsection with the v0.0.8 entry; document the forward-compat invariant for future resets. ~25 LOC. **depends on nothing (parallel with T1, T2).**
- **T4** [test] — `packages/core/src/baseline-reset.test.ts`: tests covering S-1, S-2, S-3 using `readFileSync` against repo-root paths (mirrors `scope-project-source.test.ts`'s pattern). ~80 LOC. **depends on T1, T2, T3.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.8 cluster (this spec + the cluster's other two specs).
- `git log --follow docs/baselines/url-shortener-prompt-v0.0.5-v0.0.7.md` shows the file's history traces back through every prior commit on the original path (verifies `git mv` was used, not delete + add).
- The new `docs/baselines/url-shortener-prompt.md` does not contain ANY of the strings flagged in S-2's "does NOT contain" list.
- `BASELINE.md` methodology section names the v0.0.8 reset event by date, archived path, and new entry point.
- Public API surface from every `@wifo/factory-*` package strictly equal to v0.0.7's surface (this spec ships zero code changes outside the new test file).
- v0.0.8 explicitly does NOT ship in this spec: automated fixture regeneration; reset CLI; multiple canonical products. Deferred per Constraints.

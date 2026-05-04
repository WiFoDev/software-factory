# Backlog

Cross-package candidates for **v0.0.4+**. Not bugs; not blocking the next release. Each entry explains *what* and *why*, plus enough context that a future spec writer can scope it without re-deriving the motivation. The roadmap commits to *direction*; this file is the candidate pile.

Items shipped in v0.0.2 / v0.0.3 (agent-driven `implementPhase`, twin wired into runtime, cross-iteration record threading, whole-run cost cap, default `--max-iterations 5`) have been pruned out — see `git log` and `ROADMAP.md` for that history.

---

## Spec reviewer (`factory spec review <path>`)

**What:** A second-pass linter that judges *spec quality*, not just *spec format*. Codifies the review angles a human reviewer applies to a freshly-generated `/scope-task` output. Output mirrors `factory spec lint`'s shape (`file:line  severity  code  message`) so it slots into the same workflow. Each "review angle" is a judge prompt that runs against the spec via `@wifo/factory-harness`'s existing LLM-as-judge machinery — same primitive that scores `judge:` lines on scenarios, applied to specs themselves.

**Why:** Spec quality determines code quality. The factory's central thesis is *spec-driven correctness*; if the spec is ambiguous, internally inconsistent, or has parity gaps in its scenarios, the agent's implementation degrades to match. Today this catch happens manually (a human reviewer reads the spec, flags issues, suggests fixes). Automating it closes the spec-side feedback loop in the same way `factory-runtime` closes the code-side loop. The reviewer is the spec-side analog of the harness.

**Codified review angles** (each becomes one judge prompt in the rule set):

| Code | What it checks |
|---|---|
| `review/format-strictness` | (already covered by `factory spec lint`) — keep separate from review for fast-fail |
| `review/internal-consistency` | Constraints reference deps that aren't declared; scenarios reference test files outside `cwd`; DoD includes checks that don't match the constraints |
| `review/judge-parity` | Same category of scenario should have the same satisfaction kinds. If two scenarios both test error UX but only one has a `judge:` line, flag asymmetry |
| `review/holdout-distinctness` | Holdouts probe genuinely distinct failure categories from visible scenarios. Flag holdouts that overlap with visible scenarios (overfit risk) or probe completely unrelated concerns (irrelevant) |
| `review/dod-precision` | "X matches Y" / "X validates Y" without explicit operator (equal vs subset vs superset). `review/judge-parity`'s sibling for the DoD section |
| `review/api-surface-drift` | Public API list (in §2 of technical-plan) vs constraints in spec — names enumerated in one but not the other |
| `review/feasibility` | Given the constraints, is the implementation actually possible in the stated LOC estimate? Subtask sizes look realistic? |
| `review/cross-doc-consistency` | Spec and its technical-plan don't disagree about: error codes, public surface, default values, deferral list |
| `review/scope-creep` | Subtasks that obviously belong in a future version. "Defer" sections that are missing |

Each judge prompt produces a finding with severity (`error`, `warning`, `info`), a `code` from the table above, a one-line message, and an optional line reference. Aggregated like `lint`'s output.

**Where it lives:**
- New package `@wifo/factory-spec-review` (or a `review/` submodule of `@wifo/factory-core` — separate package is cleaner since it pulls in `@wifo/factory-harness` for the judge runner)
- Rules live in versioned YAML/markdown so adding a new judge is a config change, not a code change
- CLI: `factory spec review <path>` — file or directory; recurses; same exit codes as `lint` (0 ok, 1 findings)

**Costs to be honest about:**
- Each judge is an LLM call. A spec with 9 review codes = 9 calls per `review` invocation. Latency in seconds, tokens in low-thousands.
- Subscription-paid via `claude -p` (same path as `implementPhase`) — no API key needed.
- Caching: identical spec content + identical rule set → identical findings. Content-addressable on the spec hash + rule-set hash means re-running review on an unchanged spec is free (read from cache).

**Workflow placement:**

```
/scope-task              writes spec
factory spec lint        ← format check (fast, free, deterministic)
factory spec review      ← quality check (slower, costs tokens, LLM-judged)
human review (optional)  ← still recommended for big specs; the reviewer cuts ~80% of "obvious" findings
factory-runtime run      ← implementation
```

The reviewer is most valuable for DEEP specs where the human reviewer would otherwise spend 10-30 minutes; it brings that down to seconds and surfaces every angle consistently. For LIGHT specs, lint alone is usually enough.

**Touches:** new package `packages/spec-review/`, `~/.claude/commands/scope-task.md` (add `factory spec review` to the self-check step alongside `factory spec lint`), `ROADMAP.md` (add v0.0.4 entry).

**Phasing suggestion:** ship the reviewer in v0.0.4 with 3-5 of the strongest judges (`internal-consistency`, `judge-parity`, `dod-precision`); add the rest in subsequent point releases as real review passes surface gaps. Each new judge ships with a "this real spec would have caught X" justification.

---

## Starter template + `factory init`

**What:** Two related deliverables that close the "5 minutes from `mkdir` to first agent iteration" gap.

1. **`factory init` command** in `@wifo/factory-core`: drops a minimal `docs/specs/done/`, `docs/technical-plans/done/`, `factory.config.json`, and `.gitignore` entries into the cwd. One-shot bootstrap for any TypeScript repo.
2. **A reference template repo** (`software-factory-starter` or similar) — a minimal but real factory-ready project: `package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml`, an example spec, a working `bun test` setup, and a README walking the loop. `git clone` → `pnpm install` → first feature spec → done.

**Why:** Today, "use the factory in a new repo" requires copying configs from `examples/slugify`, manually creating `docs/specs/` directories, and setting up workspace deps (or, post-publish, npm deps). Worth ~20-30 minutes of yak shaving per new project. With both pieces, that drops to under 5 minutes for a fresh repo.

**Touches:** new subcommand in `packages/core/src/cli.ts` (`factory init [--template <name>]`), new repo for the starter template, README in factory's main repo pointing at it.

**Phasing suggestion:** ship `factory init` in v0.0.4 (small, internal); ship the starter template repo separately whenever it's ready (it's a doc artifact, not a code release).

---

## `factory-context`: descendants traversal

**What:** Walk *down* the DAG from a record, not just up. Today `factory-context tree <id>` walks ancestors (parents), so `tree <runId>` shows only the run itself because the run is a root with no parents. To see "everything that came out of this run", a user has to `list` and visually correlate, or pick a leaf and tree up to the run.

**Why:** The most natural question after `factory-runtime run` is "what was produced under this run?" — descendants, not ancestors. The current UX requires the user to flip the question backwards.

**Shape options:**
- `factory-context tree <id> --direction up|down` (default `up` for backward compat) — extends the existing command
- `factory-context descendants <id>` — separate verb; clearer but doubles the surface
- Both — `tree` becomes the umbrella, `descendants` is its sibling

Mild lean toward `--direction` flag: zero new commands, one well-scoped flag, and the existing `tree` semantics stay the default. `descendants` as a discoverable alias is fine if it's a free addition.

**Implementation note:** Descendants traversal can't use the same single-pass walk as ancestors. Records know their parents but not their children — finding descendants requires scanning the whole `<dir>` and filtering for records whose `parents[]` includes the target. O(n) per call, fine for typical context-store sizes.

**Touches:** `packages/context/src/tree.ts` (new `buildDescendantTree` or generalize `buildTree`), `packages/context/src/cli.ts` (flag parsing + dispatch), `packages/context/README.md` (document direction).

---

## PostToolUse hook for spec lint

**What:** A Claude Code hook that runs `factory spec lint <path>` (and eventually `factory spec review <path>`) automatically every time the agent writes or modifies a `docs/specs/*.md` file. Surfaces the result inline so the agent sees it before reporting completion — belt-and-suspenders on the self-check step that's already in `/scope-task`.

**Why:** The self-check in `/scope-task` is mandatory in the prompt but enforced only by the agent following its own instructions. A hook is harness-enforced — the agent literally cannot skip the lint, because the hook fires on every Write. Closes the "agent forgot to run the linter" failure mode.

**Touches:** `~/.claude/settings.json` (hook config under `hooks.PostToolUse`), maybe a small `factory spec watch` helper in `@wifo/factory-core` for projects that want filesystem-event-based linting independent of Claude Code.

**Phasing suggestion:** trivial to ship — one hook config in `dotfiles`. Should land in the same window as the spec reviewer so it can hook both `lint` and `review`.

---


## Shipped in v0.0.6 (kept here briefly for history)

Five entries that were live candidates as of v0.0.5 shipped together as the v0.0.6 cluster (commit `5e2d6fa`):

- ✅ **Harness: strip surrounding backticks from `test:` paths** — `parseTestLine` strips a leading + trailing backtick from both the file token and the pattern. ~5 LOC fix in `parse-test-line.ts` + 4 unit tests.
- ✅ **`SPEC_TEMPLATE.md`: backtick guidance** — superseded by the harness fix above. The template no longer needs to warn against backticks; the harness tolerates them.
- ✅ **`factory-runtime`: per-phase agent timeout configurable via `--max-agent-timeout-ms`** — `RunOptions.maxAgentTimeoutMs?: number` (default 600_000) + new CLI flag with the locked validation pattern. Mirrors v0.0.3's `--max-total-tokens`.
- ✅ **`factory init` — first-contact gaps** — `@wifo/factory-spec-review` now in scaffold devDeps; `.factory-spec-review-cache` in scaffold gitignore; new `factory.config.json` with documented defaults; runtime CLI reads it (CLI flag > config > built-in default).
- ✅ **`factory-implement-report.filesChanged` audit reliability** — pre/post working-tree snapshot replaces the buggy `git diff` capture. False negative on new-file-only runs + false positive on pre-dirty files both fixed.

---

## Lessons from the v0.0.6 URL-shortener baseline run

Two friction points surfaced in the v0.0.6 baseline (see `BASELINE.md` v0.0.6 entry's "Surprises") that weren't on the v0.0.5-locked prediction list. Both came from a real run; both are concrete.

### `factory init` — ship typescript in scaffold devDependencies

**What:** `factory init` produces a scaffold whose `tsconfig.json` references TypeScript options but the scaffold doesn't add `typescript` to `devDependencies`. A user running `pnpm exec tsc --noEmit` (the canonical typecheck) gets `tsc: command not found` until they add typescript themselves. The v0.0.6 BASELINE-running agent caught this on spec 1 and fixed it post-hoc.

**Why:** Same theme as the v0.0.5.x init-ergonomics fix — first-contact UX. The scaffold's `tsconfig.json` is meaningless without a tsc binary in `node_modules/.bin`. Either remove the tsconfig (silly) or include the typescript dep (right). The second is one line in `PACKAGE_JSON_TEMPLATE.devDependencies`.

**The fix:** Add `'typescript': '^5.6.0'` to `PACKAGE_JSON_TEMPLATE.devDependencies` in `packages/core/src/init-templates.ts`. Match the version range used by the workspace root `package.json` (currently `^5.6.0`). Update the existing `init.test.ts` test that asserts the devDeps shape.

**Touches:** `packages/core/src/init-templates.ts` (~1 LOC), `packages/core/src/init.test.ts` (~3 LOC), maybe `packages/core/src/init-templates.test.ts` if it asserts the full devDeps list.

**Phasing suggestion:** v0.0.6.x point release, OR roll into v0.0.7's `/scope-project` work since both touch `factory init`'s output. Tiny lift either way.

### DoD-verifier runtime phase — `factory-runtime run` should actually run the DoD

**What:** A spec's `## Definition of Done` section lists shell-runnable gates ("typecheck clean", "biome clean", "pnpm test workspace-wide green"). Today these are documentation only — the runtime returns "converged" purely on test-pass + agent-success, never executing the DoD gates. Result: a spec can ship with broken types, lint failures, or workspace-wide test breakage and the runtime won't notice. The v0.0.6 BASELINE run surfaced this when `--no-judge` skipped the harness's judge phase, which apparently is the only thing that runs DoD checks today (and it doesn't even do it well).

**Why:** Audit-trust gap, not just UX. The factory's central trust mechanism is "the runtime says converged → ship it." If converge doesn't include DoD verification, the trust contract is broken. The v0.0.5 `filesChanged` audit fix was about per-file truth; this is about whole-spec truth.

**The shape (sketchy — needs scoping):**

- New built-in phase `dodPhase` (or extend `validatePhase`) that parses the spec's `## Definition of Done` section, detects shell-runnable lines (lines starting with backtick code spans containing commands like `` `pnpm test` ``, `` `pnpm typecheck` ``, etc.), and runs each as a Bash step.
- Convergence requires all DoD lines green AND all test/judge satisfactions green.
- Non-shell DoD lines ("Public API surface unchanged") are LLM-judged via the existing harness judge runner (subscription-paid).

**Why it's gated on more evidence:** The DoD-as-text design is intentional today — DoDs include human-readable assertions alongside shell-runnable ones. Mechanically running the shell ones is easy; the design question is "what about the human-readable ones?" Two real product runs (v0.0.5 + v0.0.6 URL-shorteners) surfaced this; one more run on a different shape (cron-scheduler, csv-pipeline) would calibrate whether DoD-verifier should ship as a unified phase or whether shell + judge should split into two passes.

**Touches:** `packages/runtime/src/phases/` — new file `dod.ts` or extension of `validate.ts`. `packages/core/src/parser.ts` — add a `parseDoD(source)` helper that extracts shell-runnable lines from the DoD section (similar to how `parseScenarios` extracts Given/When/Then). `packages/runtime/src/runtime.ts` — wire dodPhase into the default graph. Tests + README. Probably ~300 LOC including tests; non-trivial.

**Phasing suggestion:** v0.0.8+ (post real-product workflow). The v0.0.7 work (`/scope-project`, `depends-on`, sequence-runner) is more user-visible and has more evidence behind it. DoD-verifier is the right v0.0.8 candidate once the v0.0.7 ships and surfaces whatever DoD-related friction it surfaces.

---

## `run-sequence` skips already-converged specs *(NEW, surfaced by v0.0.9 BASELINE — friction #2)*

**What:** v0.0.9's status-aware `run-sequence` skips `status: drafting` specs by default. But a spec that ALREADY converged (shipped) stays at `status: ready` — there's no "shipped" status, and the maintainer's natural workflow is to flip drafting → ready as each prior spec converges, leaving every shipped spec at `ready`. Each subsequent `run-sequence` invocation walks the full ready set, spawning a no-op implement phase per shipped spec. Cost grows N² across multi-pass workflows. The v0.0.9 BASELINE measured this empirically: 4 specs shipped one-at-a-time produced 1+2+3+4 = 10 implement spawns instead of 4 (6 wasted no-op re-runs).

**Why:** This is the next layer of friction beyond v0.0.9's status-awareness. The runtime ALREADY persists `factory-run` records for every converged spec; the sequence-runner could query these to detect "spec X has a converged factory-run rooted at the current factory-sequence's specsDir hash" and skip re-execution. The data is on disk; the wiring isn't.

**Shape options:**
- (a) `runSequence` queries `contextStore` before running each spec: walk `factory-run` records, find one whose `specId === spec.id` AND parent chain matches the current `factorySequenceId`'s `specsDir`. If found AND status was `'converged'`, skip (treat as already-shipped). One-line log: `factory-runtime: <id> already converged in run <runId> — skipping`.
- (b) Add an explicit `status: 'shipped'` enum value to `SpecStatus` schema. Maintainer (or `factory finish-task` slash command) flips `ready → shipped` post-convergence. `run-sequence` skips both `drafting` and `shipped`.
- (c) `factory-runtime` writes a `.factory-shipped/<spec-id>.lock` file post-convergence; `run-sequence` skips specs with a matching lock file.

Lean: (a). Reuses existing provenance data — no schema or filesystem additions. The maintainer's spec stays at `ready` (semantically: "it's ready to ship if needed"); the runtime makes the decision based on whether shipping already happened. Pure data-driven dedup.

**Touches:** `packages/runtime/src/sequence.ts` (insert a `factory-run` lookup before each spec's `run()` call), tests, README. ~50 LOC. No new error codes; no new schema. Could pair with friction #1 below as a single v0.0.10 spec ("`run-sequence` workflow polish").

**Phasing suggestion:** v0.0.10 lead candidate. Highest-leverage of the v0.0.9 BASELINE findings (closes the N² regression).

---

## `run-sequence` resolves `depends-on` against `<dir>/done/` *(NEW, surfaced by v0.0.9 BASELINE — friction #1)*

**What:** When the maintainer ships a spec and `git mv`s it to `docs/specs/done/`, the next `run-sequence` invocation against `docs/specs/` fails with `runtime/sequence-dep-not-found` for any later spec that declares the moved spec in its `depends-on`. The runtime's locked decision (per v0.0.7's spec) is "`run-sequence` does NOT recurse into `<dir>/done/` for execution." That's correct for execution (we don't want to re-run shipped specs), but applies overly strictly to dep-resolution: `done/` specs should be available as DEP CONTEXT even if they're not run.

**Why:** Two existing locked decisions collide: (a) shipped specs move to `done/` per the per-spec lifecycle convention (v0.0.4); (b) `run-sequence` only reads `<dir>/*.md` for execution AND dep validation (v0.0.7). The maintainer's natural workflow (ship → move to done → ship next) breaks under this collision. The v0.0.9 BASELINE agent hit this directly.

**Shape options:**
- (a) `runSequence`'s dep-resolution walks `<dir>/done/` IN ADDITION TO `<dir>` when validating that each `depends-on` entry points at a known spec. Specs in `done/` are valid dep targets (treated as "already-converged" — paired with the friction-#2 fix above). Specs in `done/` are NOT walked into the topological execution order; they're context-only.
- (b) Defer the per-spec move-to-done in the canonical prompt — move all specs to `done/` AFTER the cluster ships, not per-spec. Workaround at the docs layer; doesn't fix the underlying constraint.
- (c) Drop the `done/` convention entirely; specs stay at `<dir>/<id>.md` forever, with status flips encoding lifecycle. Bigger change; tied to friction #2's "shipped" status discussion.

Lean: (a) + the canonical-prompt edit (b). (a) is the right runtime fix. (b) is a small docs polish that prevents the workflow break in the meantime — edit the v0.0.8-reset prompt to say "move all shipped specs to `done/` AFTER the cluster ships" instead of per-spec. Both small.

**Touches:** `packages/runtime/src/sequence.ts` (`buildDag` consults `<dir>/done/` for dep-id existence), `packages/runtime/src/runtime.ts` (no change), tests. ~30 LOC. Plus a 2-line edit to `docs/baselines/url-shortener-prompt.md` (defer move-to-done) — but this is a baseline-prompt edit, NOT a baseline reset (the prompt's intent is preserved; only an over-prescribed step is removed).

**Phasing suggestion:** v0.0.10 alongside friction #2 above. Pair as a single "`run-sequence` workflow polish" spec.

---

## Harmonize `--context-dir` flag across `factory-context` + `factory-runtime` *(NEW, surfaced by v0.0.9 BASELINE — friction #3)*

**What:** `factory-runtime run` and `factory-runtime run-sequence` use `--context-dir <path>`. `factory-context tree` uses `--dir <path>`. Same concept, different flag names. The maintainer (or agent) reaching for both CLIs has to remember which is which.

**Why:** Pre-existing technical debt — the two CLIs were authored in different versions and shipped without flag-name coordination. The v0.0.9 BASELINE agent reached for `factory-context list` more often than prior runs (because the multi-pass workflow produced more records to inspect) and the friction surfaced.

**Shape options:**
- (a) Add `--context-dir` as a synonym for `--dir` on `factory-context` (both work; `--dir` deprecated with a one-liner stderr warning). Three-version deprecation arc: v0.0.10 adds synonym, v0.0.11 emits deprecation warning, v0.1.0 removes `--dir`.
- (b) Force-rename to `--context-dir` immediately. Breaking change for any tooling that parses `factory-context tree --dir`. Low risk (small user base) but breaks the deprecation discipline.
- (c) Add `--dir` as a synonym for `--context-dir` on `factory-runtime`. Keeps `factory-context`'s historical name as canonical; reverses the migration direction. Less consistent with the existing `--context-dir` name in `factory.config.json`.

Lean: (a). `--context-dir` is the more descriptive name; `factory.config.json`'s key is `runtime.contextDir`-shaped (when it lands). The deprecation arc protects existing scripts.

**Touches:** `packages/context/src/cli.ts` (add `--context-dir` synonym), tests, README. ~15 LOC. Trivial.

**Phasing suggestion:** v0.0.10 — small enough to bundle with the workflow-polish work above.

---

## Refine `spec/wide-blast-radius` heuristic — threshold of 8 fires on 18 historical specs *(NEW, surfaced by v0.0.9 ship)*

**What:** v0.0.9 added the `spec/wide-blast-radius` lint warning at >= 8 distinct file paths in `## Subtasks`. Running it against the v0.0.9 cluster + every shipped spec under `docs/specs/done/` produces **18 warnings on existing specs** — including small ones like `factory-core-v0-0-5-1` (9 paths) and `factory-runtime-v0-0-5-2` (8 paths) that converged in single-iteration runs without budget pressure. The heuristic catches the v0.0.8 self-build's failure mode (12-file spec) but also normal-shape specs that ship cleanly.

**Why:** The threshold + path-detection regex were locked at design time on n=1 evidence (one v0.0.8 self-build timeout). Empirically, ≥ 8 distinct paths is the modal shape for shipped specs, not the failure-mode shape. The lint as-shipped emits noise; future scoping runs will see the warning fire on every spec the agent writes, and the maintainer/agent will start ignoring it. Better to refine before that habit forms.

**Shape options:**
- (a) Raise threshold to 12 (matches the v0.0.8 self-build failure case more tightly; the v0.0.6 BASELINE noted ~50-200 LOC sweet spot, which empirically translates to <12 file paths).
- (b) Refine the path-detection regex to count only paths that look like NEW files (e.g., paths inside subtasks with `[NEW FILE]` or `[feature]` markers vs `[chore]` / version-bump references). Distinguishes "creates 12 new files" (high blast radius) from "edits version field in 12 package.json files" (mechanical, low risk).
- (c) Per-subtask path counting — the regex counts paths PER SUBTASK; warning fires when any single subtask references >= 4 distinct paths. Catches "fat subtask" specifically.
- (d) Add a `# NOQA: spec/wide-blast-radius` directive recognized by the lint (e.g., as an HTML comment in the spec body) so authors can opt out per-spec when the count is intentional and budget is appropriate.

Lean: (a) + (d) together. Raising the threshold to 12 catches the actual failure-mode shape; the noqa directive lets chore-coordinator specs explicitly opt out. (b) and (c) are more sophisticated but harder to calibrate without more baseline runs.

**Touches:** `packages/core/src/lint.ts` (threshold constant change + optional noqa parser), tests in `lint.test.ts` (rewrite the threshold tests), updates to existing v0.0.5+ specs in `done/` to add `# NOQA` if the warning shouldn't fire on them. ~50 LOC.

**Phasing suggestion:** v0.0.10 lead candidate. Pairs with whatever v0.0.10 ships (probably a small cluster — DoD-verifier work has been deferred long enough; or worktree sandbox).

---

## Scaffold ships `scripts: { typecheck, test, check }` matching its DoD claims *(NEW, surfaced by v0.0.8 BASELINE)*

**What:** `factory init` produces a scaffold whose `package.json` has `scripts: {}` (empty), but every spec template's default DoD says "typecheck + lint + tests green" and the `internal-consistency` reviewer judge flags the gap as a finding. Only `bun test src` works in a fresh scaffold; `pnpm typecheck`, `pnpm lint`/`pnpm check`, and `pnpm test` are all aspirational until the maintainer adds them by hand.

**Why:** This is a more concrete, more actionable shape of the v0.0.6 BASELINE's "DoD-verifier" finding. The v0.0.6 angle was "the runtime doesn't enforce DoD"; the v0.0.8 BASELINE angle is "the scaffold doesn't even ship the commands the DoD claims will run." Closing the second is much cheaper than closing the first, and unlocks a clean "DoD says X, X exists, runtime can verify X" chain.

**Shape options:**
- (a) Scaffold ships `scripts: { typecheck: 'tsc --noEmit', test: 'bun test src', check: 'biome check', build: 'tsc -p tsconfig.build.json' }` matching this monorepo's conventions. Pair with the existing scaffold devDeps (typescript already lands in v0.0.6.x).
- (b) Scaffold ships `scripts: { typecheck, test }` only (more minimal); biome/build are user-driven.
- (c) Spec template's default DoD shrinks to only what the scaffold ships. Documents the floor honestly.

Lean: (a). The convention is well-established in this monorepo and the published packages are the reference; copy them. Adds zero ambiguity for users.

**Touches:** `packages/core/src/init-templates.ts` (`PACKAGE_JSON_TEMPLATE.scripts` field), tests in `init-templates.test.ts` + `init.test.ts`, scaffold README's flow snippets reference the new scripts. Small — ~30 LOC.

**Phasing suggestion:** v0.0.9 lead candidate alongside the per-spec timeout override + run-sequence drafting filter. Three small fixes that together close every concrete friction the v0.0.8 BASELINE surfaced.

---

## `internal-consistency` judge gains `depends-on`-awareness *(NEW, surfaced by v0.0.8 BASELINE)*

**What:** When `/scope-project` writes a multi-spec product, its decomposition discipline says "shared decisions live in the FIRST spec's `## Constraints / Decisions` block; later specs reference them." But the `internal-consistency` reviewer judge (which scores each spec in isolation) flags those shared constraints as unreferenced — because it doesn't follow `depends-on` edges to see how downstream specs use them. Result: the v0.0.8 BASELINE's first spec (`url-store`) collected a `review/internal-consistency` warning on the "Project-wide JSON conventions" block, even though the pattern worked end-to-end.

**Why:** The judge fires at the very moment the maintainer is supposed to trust the scoper. It's a substance-light warning (won't block the run-sequence), but it injects a stop-and-think where the workflow promised seamlessness. Worse, the warning could push future maintainers to either (a) duplicate shared constraints across every spec (defeats the whole point of `depends-on`-aware decomposition), or (b) move shared decisions out of the spec format into a separate `docs/conventions.md` (changes the workflow). Neither resolution is desirable; the right fix is in the judge.

**Shape options:**
- (a) When scoring spec N with non-empty `depends-on`, the judge reads each transitive dep's body via the same machinery v0.0.7's `cross-doc-consistency` already uses. Constraints declared in any dep are treated as "available context" — references to them in scenarios don't have to be local.
- (b) Add a recognized section header `## Project-wide constraints` (parallel to the existing `## Constraints / Decisions`) that the judge knows is informational + downstream-shared. Stricter signal but adds a new section to the spec format.
- (c) Add a frontmatter flag `shared-constraints: true` on the first spec of a product to opt that spec's Constraints block into the "downstream-shared" interpretation.

Lean: (a). It reuses existing machinery (the dep-loading CLI path from v0.0.7's `cross-doc-consistency` work) and doesn't add new spec format. The judge becomes "internal-consistency-with-dep-context."

**Touches:** `packages/spec-review/src/judges/internal-consistency.ts` (extend `applies()` and `buildPrompt()` to consume `JudgePromptCtx.deps` — already plumbed through in v0.0.7), `packages/spec-review/src/review.ts` (no changes — deps are already threaded), tests. ~40 LOC.

**Phasing suggestion:** v0.0.9 alongside the other v0.0.8 BASELINE follow-ups. Small fix; closes the only "trust pause" the new flow currently introduces.

---

## Per-spec agent-timeout override + file-blast-radius guidance *(NEW, surfaced by v0.0.8 self-build)*

**What:** When `factory-runtime run-sequence` ran the v0.0.8 cluster against itself, spec 3 (`factory-core-v0-0-8-1`) hit `runtime/agent-failed: agent-timeout (after 600000ms)` during implement phase iteration 1. The agent's work landed (all 544 workspace tests pass post-timeout; biome + spec lint clean), but validate phase never ran — the runtime classified the spec as `'error'` because the implement phase didn't return cleanly within budget.

The blast radius was 12 files: 6 `package.json` version bumps + 4 doc updates (CHANGELOG / ROADMAP / top-level README / packages/core/README.md) + 2 test files (init.test.ts version assertions + publish-meta.test.ts version regex). Per-file LOC was small; the cumulative time-per-edit + repeated typecheck/test runs across 12 files exhausted the 600s default.

**Why:** The v0.0.6 BASELINE evidence said "per-feature sweet spot is 50-200 LOC." That was correct as far as it went, but blast-radius (file count) is a separate axis the runtime doesn't currently surface. A spec at 250 LOC across 4 files is fine; a spec at 250 LOC across 12 files isn't.

**Shape options:**
- (a) Raise default `--max-agent-timeout-ms` to 1_200_000 (20 min). Trivial. Side effect: hides the constraint instead of surfacing it.
- (b) Per-spec `agent-timeout-ms` field on `SpecFrontmatter` so wide-blast-radius specs declare their own budget. Field-level addition; zero new exports.
- (c) `factory spec lint`-time warning when a spec's Subtasks block names ≥ 8 distinct file paths. Catches the bomb at scoping time, not run time.
- (d) Resume-from-partial-work: if the implement phase times out mid-edit, the runtime persists the agent's progress and re-runs the next iteration with `# Prior partial work` section in the prompt. Speculative; biggest UX win.

Lean: ship (b) + (c) together in v0.0.9. (a) is too crude. (d) is v0.1.0+ territory.

**Touches:** `packages/core/src/schema.ts` (add optional `agent-timeout-ms` field), `packages/core/src/lint.ts` (file-blast-radius warning), `packages/runtime/src/runtime.ts` (consume `spec.frontmatter['agent-timeout-ms']` when resolving `maxAgentTimeoutMs`), tests + READMEs.

**Phasing suggestion:** v0.0.9 lead candidate. Pairs with the discoverability work that v0.0.8 already shipped — together they make the per-spec authoring loop predictable end-to-end.

---

## `factory-runtime run-sequence` should skip `status: drafting` specs by default *(NEW, surfaced by v0.0.8 self-build)*

**What:** `runSequence`'s `loadSpecs()` reads every `*.md` file under `<dir>` regardless of `frontmatter.status`. The v0.0.7 spec (factory-runtime-v0-0-7) documented "specs at status: drafting are a no-op until flipped" but never enforced it. v0.0.8's self-build ran all three specs (1 ready + 2 drafting) because of this gap — accidentally fine for that run, but the documented behavior is wrong.

**Why:** Status-aware iteration is the prescribed maintainer workflow: ship one spec, review, flip the next from drafting → ready, ship that, repeat. Without enforcement, run-sequence runs everything and the maintainer can't stage review checkpoints across the DAG.

**Shape options:**
- (a) Default behavior change: skip `status: drafting` specs; emit a log line noting the skip. Add `--include-drafting` flag for runs that intentionally walk everything.
- (b) Skip drafting specs AND warn at lint time when a `depends-on` declares a spec that's still drafting (catch staleness before run).
- Both options preserve backward-compat for the v0.0.8 self-build pattern via `--include-drafting`.

**Touches:** `packages/runtime/src/sequence.ts` (filter in loadSpecs unless flag set), `packages/runtime/src/cli.ts` (new `--include-drafting` flag), tests, README. Trivial — ~30 LOC.

**Phasing suggestion:** v0.0.9 alongside the timeout-override work above. Both close gaps the v0.0.8 self-build surfaced.

---

## `factory init`: drop `/scope-project` into scaffolded `.claude/commands/`

**What:** Have `factory init` write `.claude/commands/scope-project.md` (and any other in-repo slash commands) into the scaffolded project, copying from the published `@wifo/factory-core/dist/commands/` (or similar). Today the user must `cp docs/commands/scope-project.md ~/.claude/commands/` manually after `factory init`; this fix makes `/scope-project` discoverable in any fresh project zero-config.

**Why:** Surfaced when scoping v0.0.7 — the slash command source ships in this repo at `docs/commands/scope-project.md`, but Claude Code only auto-discovers from `~/.claude/commands/` (user-level) or `.claude/commands/` (project-level). A new project created via `factory init` doesn't get either, so `/scope-project` silently doesn't exist until the maintainer manually installs. First-contact UX gap, same shape as v0.0.5.x's "missing devDeps in scaffold" friction.

**Shape options:**
- (a) `factory init` copies `scope-project.md` (and future slash commands) into `<cwd>/.claude/commands/`. Project-level scope; recipient project gets the command in this repo only.
- (b) `factory init` ALSO offers `--install-commands user` to drop into `~/.claude/commands/` (user-level, applies to every project). Opt-in flag.
- (c) Both (a) and (b). Project-level by default; opt-in user-level.

**Where the source lives at install time:** `@wifo/factory-core` would need to ship the slash-command markdown file in its `files` glob. Today only `dist/` ships; the canonical `docs/commands/scope-project.md` lives in the monorepo root, NOT in `packages/core/`. Either: (i) move it under `packages/core/commands/scope-project.md` (or `packages/core/src/commands/`); or (ii) keep the canonical at repo-root and copy into `packages/core/commands/` on `pnpm release`. Option (i) is cleaner — single source of truth in the package that ships it.

**Touches:** `packages/core/commands/scope-project.md` (move from `docs/commands/`), `packages/core/package.json` (add to `files` glob), `packages/core/src/init.ts` + `init-templates.ts` (planFiles for `.claude/commands/scope-project.md`), tests, README updates. Optional: a `factory commands install` subcommand for retrofitting existing projects.

**Phasing suggestion:** v0.0.8 candidate. Pairs naturally with the PostToolUse hook recipe (also deferred to v0.0.8) — both are "make Claude Code aware of factory tooling" workflow polish.

---

## Shipped in v0.0.10 (kept here briefly for history)

The "trust contract + spec-quality teeth + workflow polish" cluster shipped in v0.0.10. Five specs (1 DEEP centerpiece + 4 LIGHT) scoped via `/scope-project` (third clean dogfood) + run via `factory-runtime run-sequence` with `--include-drafting --max-agent-timeout-ms 1800000` (30min budget for the DEEP DoD-verifier + chore-coordinator):

- ✅ **DoD-verifier runtime phase** — `dodPhase` parses `## Definition of Done` for shell-runnable bullets (allowlist: pnpm/bun/npm/node/tsc/git/npx/bash/sh/make/pwd/ls + `./` paths), runs each via Bash, dispatches non-shell to harness judge runner. New `factory-dod-report` record. Convergence requires DoD shell gates green AND test/judge satisfactions green. Closes the trust contract gap from v0.0.6 BASELINE.
- ✅ **Three deferred reviewer judges** — `review/api-surface-drift`, `review/feasibility`, `review/scope-creep`. Round out v0.0.4's 9-judge plan; v0.0.10 closes 3 of the original 4 deferred (only `review/format-strictness` already lives in `lint`). ReviewCode union 8 → 11.
- ✅ **`run-sequence` workflow polish** — already-converged dedup (closes the v0.0.9 BASELINE N² re-run pattern), `<dir>/done/` consulted for depends-on resolution, `factory-context --context-dir` synonym for `--dir` with deprecation arc.
- ✅ **`factory spec watch` + PostToolUse hook recipe** — long-running CLI companion + harness-enforced lint+review path documented.
- ✅ **`spec/wide-blast-radius` calibration** — threshold 8 → 12; NOQA HTML-comment directive (per-spec, multi-code, blanket forms).

**v0.0.10 dogfood summary:** 5/5 first-try converges in 81 min wall-clock (biggest cluster yet). Workspace tests 581 → 640 (+59). Lint warnings on historical specs dropped 18 → 4 post-calibration. The factory's trust contract closed on both sides (runtime-side via DoD-verifier; spec-side via 3 new reviewer judges) in the same release. The v0.0.10 BASELINE re-run is the next maintainer-driven step.

---

## Shipped in v0.0.9 (kept here briefly for history)

The "close v0.0.8 BASELINE friction list" cluster shipped in v0.0.9 (commit `ded0863`). Four LIGHT specs, scoped via `/scope-project` (second clean dogfood) + run via `factory-runtime run-sequence` with `--max-agent-timeout-ms 1200000` (20min escape hatch — the v0.0.9 per-spec field lands in this very cluster):

- ✅ **`agent-timeout-ms` frontmatter field + `spec/wide-blast-radius` lint** — wide-blast specs declare their own budget; lint catches scope-creep at scoping time. Threshold of 8 fires too aggressively on historical specs → v0.0.10 calibration entry above.
- ✅ **Scaffold `scripts: { typecheck, test, check, build }` + `biome.json` + biome devDep** — fresh `factory init` projects' DoD claims are now runnable.
- ✅ **`run-sequence` skips `status: drafting` by default + `--include-drafting` flag** — closes the gap documented in v0.0.7 spec but never enforced. Two prior baselines (self-build + URL-shortener) flagged it.
- ✅ **`internal-consistency` judge gains `depends-on`-awareness** — closes the false-positive on shared constraints in multi-spec products. Reuses v0.0.7's existing dep-loading machinery.

**v0.0.9 dogfood summary:** scope-project produced 4 specs cleanly; run-sequence converged 4/4 in one invocation (32 min wall-clock). No agent timeout (the explicit 20min CLI flag worked). Test surface: 544 → 581. Public API surface unchanged across all six packages. The v0.0.9 BASELINE re-run (against the URL-shortener canonical) is the next maintainer-driven step.

---

## Shipped in v0.0.8 (kept here briefly for history)

The discoverability + baseline reset cluster shipped in v0.0.8 (commit `c061321`). Three LIGHT specs scoped via `/scope-project` (the first dogfood of v0.0.7's slash command against the factory itself):

- ✅ **Baseline prompt reset** — archived `url-shortener-prompt.md` as `url-shortener-prompt-v0.0.5-v0.0.7.md`; new canonical opens with `/scope-project` + `run-sequence`. `BASELINE.md` methodology section gains a "Baseline reset events" subsection.
- ✅ **`factory init` bundles `/scope-project`** — canonical source moves to `packages/core/commands/`; ships in npm tarball; scaffold writes `.claude/commands/scope-project.md` zero-config.
- ✅ **Scaffold README documents `/scope-project` + `run-sequence`** — `## Multi-spec products` section in `init-templates.ts`'s `README_TEMPLATE`. The scaffold is now the documentation.

**Dogfood findings → v0.0.9 BACKLOG entries above:** spec 3 hit the 600s implement-phase timeout despite landing all the work (validate phase never ran; the runtime classified it `'error'` even though tests passed). Surfaces two follow-up entries — per-spec timeout override + status-drafting filter for run-sequence.

---

## Shipped in v0.0.7 (kept here briefly for history)

The "real-product workflow" cluster shipped in v0.0.7 (commits `4d48d81` factory-core, `a7c6b44` factory-runtime, `ae93b45` scope-project). Three primitives that together collapse the multi-spec-product friction quantified in the v0.0.6 BASELINE (32 manual interventions per 4-spec product → ~8):

- ✅ **`/scope-project` slash command** — canonical source at `docs/commands/scope-project.md` (in-repo); install via `cp` to `~/.claude/commands/`. Worked example: `docs/baselines/scope-project-fixtures/url-shortener/`.
- ✅ **`depends-on` frontmatter field** — optional `string[]` on `SpecFrontmatter`. Two new lint codes (`spec/invalid-depends-on`, `spec/depends-on-missing`); two new public exports (`KEBAB_ID_REGEX`, `lintSpecFile`). `cross-doc-consistency` reviewer reads declared deps from disk via the CLI; missing → `review/dep-not-found` warning.
- ✅ **`factory-runtime run-sequence <dir>/`** — Kahn's algorithm with alphabetic tie-break; new `factory-sequence` context record at the root; `RunArgs.runParents?: string[]`; `--max-sequence-tokens` (PRE-RUN check); `--continue-on-fail` skips transitive dependents only. Three new RuntimeErrorCode values; two new public exports (`runSequence`, `SequenceReport`).

---

## `factory-runtime`: `explorePhase` + `planPhase`

**What:** Two new built-in phases that run before `implement`: `explore` (read the codebase, summarize what exists) and `plan` (propose a concrete change set). The agent gets focused context for `implement` rather than synthesizing it from scratch every iteration.

**Why:** Speculative — deferred from v0.0.3 per the roadmap's "scope discipline" rule. If gh-stars or similar demos converge in 1-2 iterations without staged thinking, this stays in the backlog. If they thrash, the bottleneck is plan-making, not implementation, and these phases earn their slot.

**Touches:** new `packages/runtime/src/phases/explore.ts` / `plan.ts`, runtime support for the wider graph, README updates.

---

## Domain packs

**What:** Per-domain extensions to the factory's spec format and judge set. A pack contributes:
- Additional zod schema fields for spec frontmatter (e.g., `phi_risk: 'none' | 'low' | 'high'` for healthcare)
- Domain-specific judge prompts (e.g., `review/hipaa-leak` checks log statements for PHI)
- Twin presets for known external dependencies (e.g., a Healthie API recording set for the healthcare pack)
- Optional phase-graph hooks (e.g., a "PHI scrub" phase that runs before validate)

Candidate packs:
- `@wifo/factory-pack-web` — frontend conventions (a11y judges, perf budgets, SEO hints)
- `@wifo/factory-pack-api` — backend conventions (idempotency checks, blast-radius judges, db-migration gates)
- `@wifo/factory-pack-healthcare` — PHI guards, HIPAA gates, EHR twin presets (likely **private** — ships internally to OLH only)

**Why:** The factory core stays domain-agnostic; packs add the domain knowledge each project needs. Without packs, every project re-invents its own judges and twins. With packs, OLH gets healthcare guarantees out of the box and a side project gets web/perf/a11y guarantees out of the box.

**Touches:** new packages, `packages/core` extensibility (allow registered schema extensions; allow third-party judges to register against the reviewer's rule set).

---

## Scheduler (Layer 5)

**What:** Autonomous task queue. Pulls `status: ready` specs from `docs/specs/` (or a queue manifest), runs `factory-runtime` against each, posts findings somewhere (Linear, GitHub Issues, Slack, file). The "fire and forget" interface for the factory.

**Why:** The roadmap's eventual end state. Once v0.0.3's autonomous loop is solid and v0.0.4's reviewer is solid, the next leverage is "specs run themselves overnight." Removes humans from triggering the loop, only from reviewing the diff.

**Touches:** new package `packages/scheduler/`, integration adapters per output channel, persistence for the queue.

---

## Streaming cost monitoring

**What:** Today's cost cap is post-hoc — the agent has already spent the tokens by the time the JSON envelope is parsed. Streaming would intercept token usage during the Claude session and abort early on budget exceedance.

**Why:** Hard-stop on overrun is honest; mid-stream abort is cheaper. Worth pursuing once cost-cap-exceeded events become common enough that the prevented waste justifies the implementation complexity.

**Touches:** subprocess wrapper in `packages/runtime/src/phases/implement.ts` — needs streaming JSON parsing + a budget watchdog. Non-trivial. Probably v0.0.5+.

---

## Multi-agent coordination

**What:** Multiple agents running in parallel within a single phase, or different agents per phase (e.g., a "planner" agent that's better at architecture + a "coder" agent that's better at implementation). Coordinated via the context store as the shared memory substrate.

**Why:** Diminishing returns on single-agent quality. Multi-agent might unlock task shapes single-agent struggles with. Speculative — only worth pursuing once single-agent's ceiling is clearly hit.

**Touches:** new phase types, runtime parallelism, prompt-engineering for inter-agent coordination. Out of scope until single-agent v0.0.3 ships and we have data on its limits.

---

## Shipped (kept here briefly for history)

- ✅ **`factory-runtime`: agent-driven `implement` phase** — landed in v0.0.2. `validatePhase` + `implementPhase` ship; `explorePhase`/`planPhase` deferred (see above).
- ✅ **`factory-twin`: wire into runtime** — landed in v0.0.2. The runtime sets `WIFO_TWIN_MODE` + `WIFO_TWIN_RECORDINGS_DIR` on the spawned agent subprocess; user code calls `wrapFetch` against them in test setup. Auto-injection of `wrapFetch` is intentionally not done — keeps the runtime mechanism minimal.
- ✅ **`factory-runtime`: cross-iteration record threading** — landed in v0.0.3. Iter N+1's `implementPhase` prompt gets a `# Prior validate report` section listing only iter N's failed scenarios; `factory-implement-report.parents` extends to `[runId, priorValidateReportId]`; `factory-validate-report.parents` extends to `[runId, sameIterImplementReportId]`. Implemented via a single `PhaseContext.inputs: readonly ContextRecord[]` addition (deliberately distinct from `factory-phase.parents`).
- ✅ **`factory-runtime`: closed iteration loop** — landed in v0.0.3. `--max-iterations` default flipped 1 → 5; `[implement → validate]` runs unattended until convergence or budget.
- ✅ **`factory-runtime`: whole-run cost cap** — landed in v0.0.3. `RunOptions.maxTotalTokens?: number` (default 500_000) sums `tokens.input + tokens.output` across every implement; overrun aborts with `RuntimeError({ code: 'runtime/total-cost-cap-exceeded' })`. CLI flag `--max-total-tokens <n>`. Coexists with v0.0.2's per-phase `--max-prompt-tokens` cap.
- ✅ **gh-stars v2 demo** — landed in v0.0.3. Pagination + ETag/conditional caching + retry-with-backoff on 5xx. The closed-loop walkthrough; designed to require iteration 2+.

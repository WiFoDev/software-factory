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


## "Sketch" tier under LIGHT for ≤30-line specs *(NEW, surfaced by v0.0.11 OLH dogfood — CORE-836 retro, future-work)*

**What:** Today's spec template tiers are LIGHT (~50-200 LOC, 5-8 scenarios) and DEEP (200+ LOC, 8+ scenarios + holdouts). For very small fixes/refactors (60-line implementation work, single concern), even LIGHT feels like ceremony — the spec ends up larger than the diff. The CORE-836 dogfooder noted this directly: "my 130-line spec was overhead vs. just writing the code." A SKETCH tier (intent + 2 scenarios + DoD, max 30 lines, no holdouts) would right-size the workflow for fix/refactor work.

**Why:** The factory's compounding leverage assumes the spec is cheaper than the code it produces. For 60-line refactors, that ratio inverts unless the spec scales down. The factory loses "fix-shaped" use cases entirely without a smaller tier — maintainers default to writing the fix by hand, the loop never runs, and the audit/provenance trail for that work disappears.

**Shape options:**
- (a) **Add a `tier: sketch` enum value to `SpecFrontmatter`.** Lint enforces ≤2 scenarios + ≤30 lines + DoD section + no holdouts. Reviewer judges that don't apply to sketches (`review/holdout-distinctness`, `review/judge-parity`) skip on `tier: sketch`. Scoper produces sketch-sized specs when prompt mentions "fix" / "refactor" / clear small-scope phrasing.
- (b) **Keep the tier dimension binary; add a `--sketch` flag to `factory spec lint` that disables the tier-specific judges and relaxes the LIGHT-floor requirements.** Lighter touch; opts out at lint time.
- (c) **Add a `/scope-fix` slash command (parallel to `/scope-task` / `/scope-project`)** that produces sketch-sized output by construction. Workflow-side fix; doesn't change the spec format.

Lean: (a) + (c). The tier value is the cleanest schema-side fix; the slash command is the matching scoping-side entrypoint. Pairs naturally.

**Touches:** `packages/core/src/schema.ts` (add `'sketch'` to `tier` enum), `packages/core/src/lint.ts` (sketch-tier validation), `packages/spec-review/src/judges/*` (skip rules where appropriate), `SPEC_TEMPLATE_SKETCH.md` (new template — minimal), `~/.claude/commands/scope-fix.md` (new slash command), tests, README. ~150 LOC.

**Phasing suggestion:** v0.0.13+ candidate (post-v0.0.12 stabilization). Tier-shift, not a friction fix. Worth holding until v0.0.12's brownfield-adopter work lands so we have data on what fix-sized specs actually look like in real OLH adoption.

---

## Provenance retention / pruning *(NEW, surfaced by v0.0.11 OLH dogfood — CORE-836 retro, future-work)*

**What:** Each `factory-runtime run` invocation produces ~14 records / ~80 KB in `.factory/` for a 3-iteration run. For a 6-spec product across many runs, that grows quickly — measured in MB after a few weeks of regular use. No pruning today; everything stays forever.

**Why:** The provenance DAG is one of the factory's strongest features (`factory-context tree --direction down` saves real debugging time, per the CORE-836 retro), but unbounded growth is a known scaling issue. Better to design the pruning model deliberately than to ship a `rm -rf .factory/` workaround when the disk fills.

**Shape options:**
- (a) **`factory-context prune --keep-last <N>`** subcommand: keep records from the last N runs per spec, drop older ones. Default N=5. Manual / scriptable.
- (b) **Default gzip on persisted records** at write time — content-addressable, transparent decompress on read. Buys ~3-5× compression for typical record shape. Doesn't bound storage; just reduces it.
- (c) **`factory.config.json` retention policy**: `provenance.retainRunsPerSpec: 5` + `provenance.retainAtomicRuns: 3` — runtime auto-prunes on each `run`. Hands-off after config.
- (d) **All three.** Manual prune + gzip + auto-retention.

Lean: (a) + (b) for v0.0.13+. Manual prune as the explicit knob; gzip as the transparent storage win. (c) is overkill until storage actually pinches.

**Touches:** `packages/context/src/cli.ts` (new `prune` subcommand), `packages/context/src/store.ts` (gzip on write, decompress on read), tests, README. ~150 LOC.

**Phasing suggestion:** v0.0.13+. Not a current pain point at OLH dogfood scale (80 KB is cheap); ship before the first user reports a "factory dir is GBs" issue. Consider tracking `.factory/` size as a v0.0.12 telemetry signal so we know when to prioritize.

---

## `run-sequence` walks the DAG dynamically (auto-promote dependents on convergence) *(NEW, surfaced by v0.0.10 BASELINE — friction #1, lead candidate for v0.0.11)*

**What:** When a spec converges within a `run-sequence` invocation, the runtime should detect any direct dependent whose deps are now ALL converged AND in-memory promote it from `status: drafting` → `status: ready` AND continue walking — all in the same invocation. The maintainer should not need to flip statuses by hand or re-invoke `run-sequence` per spec. The v0.0.10 BASELINE measured the gap empirically: 4 specs in a linear chain required 4 separate `run-sequence` invocations + 3 manual `drafting → ready` flips between them.

**Why:** This is the next layer of friction beyond v0.0.9's status-aware filter and v0.0.10's already-converged dedup. The runtime ALREADY has every signal it needs:
- The DAG (parsed from `depends-on`).
- Convergence status per spec (from each `run()` call's `RunReport.status`).
- The mapping from spec → "depends on me" (inverse of `depends-on`).

What's missing is the wire-up: after each spec's `run()` returns `'converged'`, walk `inverseDepends[convergedSpec]` and check whether each dependent's deps are now all converged; if yes, in-memory promote to ready and add to the topological execution queue.

**Shape options:**
- (a) **Default behavior change.** `runSequence` walks the DAG dynamically — `status: drafting` becomes "blocked on a dep that hasn't converged yet" semantically rather than "skipped indefinitely." On convergence, the runtime walks `inverseDepends` and re-runs the loop with the newly-promoted set. `--include-drafting` still forces full-walk-from-start. CLI behavior change but back-compat: existing `--include-drafting` users see no diff; new behavior is what users actually want when they run `run-sequence`.
- (b) **`--auto-promote` flag, opt-in.** Same logic as (a), but gated behind a flag. Smaller blast radius; explicit. Maintainer runs `run-sequence --auto-promote docs/specs/` for the dynamic walk.
- (c) **Edit the file on convergence.** When spec X converges, the runtime `git`-edits `docs/specs/<dependent>.md`'s frontmatter from `drafting` → `ready`. More invasive (touches user files), but explicit + recoverable.

Lean: (a). The status field's documented semantic was always "ready when its prior dep ships"; v0.0.7 documented it; v0.0.9 enforced "skip drafting"; v0.0.10 already-converged dedup. (a) closes the gap by making the runtime walk the DAG, which is what the maintainer expected `run-sequence` to do all along. Back-compat preserved via `--include-drafting`.

**Touches:** `packages/runtime/src/sequence.ts` (extend `runSequence`'s execution loop with an inverse-deps map + post-convergence promotion + re-walk), `packages/runtime/src/cli.ts` (no flag changes if (a); add `--auto-promote` if (b)), tests, README. ~120-180 LOC including tests.

**Phasing suggestion:** v0.0.11 lead candidate. **This is the v0.0.10 BASELINE's headline finding** — closes the 4×-invocations pattern, brings maintainer-intervention count from 7 to ~1-2.

---

## `tokens.total` ambiguity — split into `tokens.charged` (budget-relevant) vs `tokens.totalInclCache` *(NEW, surfaced by v0.0.10 BASELINE — friction #2)*

**What:** The Anthropic SDK's `usage.total_tokens` includes cache reads + cache creates + input + output. The runtime's `--max-total-tokens` budget enforcement uses `input + output` only (cache is free per Anthropic's pricing). Reports surface the SDK's `total` value as `tokens.total` — making runs LOOK like they blew a 1M-token budget when they didn't. Same field, two meanings; confusing.

**Why:** The v0.0.10 BASELINE agent flagged this directly: *"reads as 'blew the 1M budget' when it didn't."* The schema field name is misleading. Telemetry/UX issue, not a correctness bug — the budget enforcement is correct; the reporting is misleading.

**Shape options:**
- (a) **Rename `tokens.total` → `tokens.totalInclCache` + ADD `tokens.charged: input + output`.** Budget enforcement uses `tokens.charged` (which it already does, unchanged). Reports / UI show `tokens.charged` prominently. Field-level addition + rename. Schema migration concern: existing context-store records have `tokens.total`; need a migration shim or version bump.
- (b) **Drop SDK's `total` from the persisted record entirely.** Compute `tokens.charged` ourselves; report only that. Simpler; loses cache visibility (which is interesting for cache-hit-rate analysis).
- (c) **Keep `tokens.total` as-is but add `tokens.charged`.** Two fields side by side. Surface `charged` prominently in CLI output; `total` becomes "cache-aware total." Smallest blast radius.

Lean: (c). Add `tokens.charged: input + output`. Update `RunReport` to surface `charged` as the budget-relevant number. Rename CLI output references from "tokens used" (currently shows `total`) to "tokens charged: <charged> / <budget>". Schema gets one new optional field; back-compat preserved.

**Touches:** `packages/runtime/src/records.ts` (add `tokens.charged?: number` to `FactoryImplementReportSchema`), `packages/runtime/src/phases/implement.ts` (compute `charged` from input + output), `packages/runtime/src/cli.ts` (output formatting), `packages/runtime/src/runtime.ts` (`RunReport.totalTokens` already excludes cache — verify + document; consider renaming to `chargedTokens` for symmetry; back-compat via deprecated alias). Tests + README. ~50 LOC.

**Phasing suggestion:** v0.0.11 alongside the dynamic-DAG-walk fix. Telemetry cleanup; small.

---

## `review/dod-precision` calibration — recognize "green / clean" as canonical idioms *(NEW, surfaced by v0.0.10 BASELINE — friction #3)*

**What:** The v0.0.4 `dod-precision` reviewer judge fires on DoD bullets like "all tests pass green" or "lint clean" — flagging them as imprecise ("what does 'green' mean?"). But these are idiomatic shorthand widely understood. The canonical baseline prompt itself uses these exact phrases. The judge is producing false positives on the very phrasing the toolchain promotes.

**Why:** Stylistic nit masquerading as a correctness check. Surfaced repeatedly across baselines; v0.0.10 BASELINE finally documented it explicitly. The judge's CRITERION text is too aggressive — needs to allow conventional idioms when paired with a recognizable command name.

**Shape options:**
- (a) **Tighten the CRITERION text** to recognize "tests pass green" / "tests green" / "lint clean" / "typecheck clean" / "biome clean" / "<command> clean" / "<command> green" as canonical idioms. Embed examples in the prompt: "These bullets ARE precise enough; do not flag them: ...". Judge prompt edit only; ~10 LOC plus the prompt text.
- (b) **Add a dictionary of recognized idioms** to the judge's logic — pre-filter bullets that match before sending to the LLM. Faster (no LLM call) + deterministic. ~30 LOC.
- (c) **Demote `review/dod-precision`** from the default-enabled set; make it opt-in via `--judges`. Sidesteps the calibration question; harshest fix.

Lean: (a). The CRITERION text already does the work for other judges; calibrating it for canonical idioms is exactly the spec-quality knob that v0.0.4 designed for. Doesn't add code; just polishes prompt.

**Touches:** `packages/spec-review/src/judges/dod-precision.ts` (extend CRITERION with positive examples). `ruleSetHash` flips on the prompt change → cache invalidates correctly on next run. Tests. ~30 LOC including a regression test pinning that "tests pass green" + "lint clean" don't fire findings.

**Phasing suggestion:** v0.0.11 alongside the other two BASELINE findings. Trivial; small win.

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


## Validator strips apostrophes from `bun test -t <pattern>` — phantom no-converge *(NEW, surfaced by v0.0.13 BASELINE — friction #1, MUST-FIX, regression of v0.0.12)*

**What:** v0.0.12's `factory-harness-v0-0-12` spec shipped `normalizeTestNamePattern` to strip curly quotes / apostrophes / backticks from BOTH the spec's `test:` line pattern AND the harvested test name — so a spec that wrote `"v0.0.10's hash"` would still match an `it()` named `"v0.0.10s hash"` (auto-stylized by the agent). The implementation strips apostrophes from BOTH sides… BEFORE passing the pattern to `bun test -t <regex>`. Result: spec-side pattern `"...slug's log"` becomes `"...slugs log"`, but the actual test in the file STILL has the apostrophe (the agent wrote it correctly per the spec) — bun's regex matches zero tests, runtime reports validate-fail, the loop iterates re-implementing already-correct code.

The v0.0.13 BASELINE caught this: 4 wasted iterations on `click-tracking` (~248s + 11k tokens burned) on a phantom failure. Implement passed every iter; DoD passed every iter; only validate failed because the regex matcher can never find an apostrophe-bearing test name.

**Why:** This is a correctness regression of v0.0.12 + the deepest soundness bug the runtime has hit since the trust contract shipped. The implement-validate loop's invariant is "if validate fails, the implementation is wrong" — when the validator's test discovery is lossy on a character class, that invariant breaks and the loop becomes an unbounded token-burn. Closing this is more important than closing whatever else v0.0.14 ships.

**Shape options:**
- (a) **Don't strip apostrophes from the SPEC-SIDE pattern; only normalize the harvested test-name from `bun test --json`.** The original v0.0.12 BACKLOG motivation was "agent stylizes apostrophes out of `it()` names" — which means the IMPLEMENTATION drifts; the SPEC stays canonical. Normalize the agent's output, not the source-of-truth pattern. ~10 LOC change in `parse-test-line.ts` (drop apostrophes from `normalizeTestNamePattern`'s strip set; keep curly-quote → ASCII conversion).
- (b) **Escape apostrophes for the regex** — bun's `-t` is regex; an apostrophe is literal but if any other character class is involved, escape via `escapeRegex`. (Already escaped — but `normalizeTestNamePattern` runs AFTER `escapeRegex` on output and BEFORE on input — re-order so escape runs last.)
- (c) **Match by exact string instead of regex** — bun supports `--test-name-pattern <regex>` only; no exact-string flag. Would need to escape ALL regex specials in the pattern, making it functionally an exact-match. Heavier; (a) is simpler.
- (d) **Detect "regex matched 0 tests + bun test exited 0" as a tooling mismatch** (similar shape to v0.0.13's coverage-trip detection). Surface a clear diagnostic instead of looping.

Lean: (a) for the must-fix; (d) as a complementary safety net so the next pattern-quirk we forget doesn't re-burn iterations silently. Drop apostrophe stripping entirely from `normalizeTestNamePattern` — the friction the v0.0.12 spec described (agent stylizes test names) actually doesn't manifest in modern Claude (it preserves apostrophes). The fix was solving a non-problem and creating a real one.

**Touches:** `packages/harness/src/parse-test-line.ts` (drop apostrophe from strip set in `normalizeTestNamePattern`), `packages/harness/src/parse-test-line.test.ts` (regression-pin: `"slug's log"` matches `"slug's log"`), `packages/harness/src/runners/test.ts` (verify the helper's invocation is post-escape), tests, README. ~30 LOC. Plus optional (d): `packages/harness/src/runners/test.ts` parse stdout for "regex matched 0 tests" + nonzero exit + harvested-test-name list nonempty → surface `harness/test-name-regex-no-match` as a distinct status. ~40 LOC.

**Phasing suggestion:** v0.0.14 lead candidate. The "smoking gun" of the v0.0.13 BASELINE — closes a real soundness bug AND restores trust that validate's signal is meaningful.

---

## `workspace:*` shipped to npm — `npx @wifo/factory-core init` fails for fresh users *(NEW, surfaced by v0.0.13 BASELINE — friction #2, MUST-FIX)*

**What:** v0.0.13's published manifests for `factory-spec-review`, `factory-runtime`, `factory-harness`, `factory-twin`, and `factory-core` declare their internal `@wifo/factory-*` deps as `workspace:*`. The publish pipeline didn't rewrite these to real semver. Result: `npx @wifo/factory-core@0.0.13 init` fails immediately with `EUNSUPPORTEDPROTOCOL — Unsupported URL Type "workspace:":` because npm can't resolve `workspace:*` outside a pnpm workspace. `pnpm dlx` works (pnpm understands the protocol); `npx` doesn't.

The BASELINE dogfooder workaround: add `pnpm.overrides` pinning every `@wifo/factory-*` to `0.0.13` in their generated `package.json` — making the scaffold "dirty" (uncommitted edits) the moment it's created. Every greenfield user pays this tax.

**Why:** Root cause: v0.0.13.x's CI publish step switched from `pnpm publish` (which auto-rewrites `workspace:*` to `^<currentVersion>` at publish time) to `npm publish` (which doesn't). The switch was needed because `pnpm publish`'s OIDC handshake didn't propagate properly to bun's bundled npm — but in fixing that, we broke the rewrite. The two concerns weren't separable in a single change.

**Shape options:**
- (a) **Pre-publish step: run `pnpm pack --pack-destination /tmp/factory-tarballs` per package, then `npm publish /tmp/factory-tarballs/<name>-<version>.tgz`.** `pnpm pack` does the rewrite; `npm publish <tarball>` consumes the rewritten manifest. ~10 LOC in publish.yml. Cleanest split — pnpm rewrites, npm uploads.
- (b) **Restore `pnpm publish` and find a different OIDC fix.** Revert the v0.0.13.x switch to npm; debug pnpm's OIDC propagation. Higher risk — pnpm 10.x's bundled npm might have OIDC support now (npm 11.5+ shipped recently).
- (c) **Manual rewrite via jq before `npm publish`:** scan each `package.json`, replace `workspace:*` with `^<version>`, commit to disk before `npm publish` runs. ~20 LOC of jq + bash. Works but reinvents what pnpm already does.

Lean: (a). `pnpm pack` is purpose-built for this; npm publish on the resulting tarball is purpose-built for the OIDC handshake. The two tools each do what they're best at.

**Touches:** `.github/workflows/publish.yml` (per-package: `pnpm pack` to tmpdir, then `npx -y npm@latest publish <tmpdir>/<tarball>.tgz --access public --provenance`), `packages/core/src/ci-publish.test.ts` (update buildIdx/publishIdx matchers if needed), tests, README. ~30 LOC.

**Phasing suggestion:** v0.0.14 lead candidate. Every fresh user hits this on first-contact — easily the highest-volume friction in the v0.0.13 ship.

---

## `factory spec review` broken on published packages — `createRequire` hits CJS resolution against ESM-only exports map *(NEW, surfaced by v0.0.13 BASELINE — friction #3, MUST-FIX)*

**What:** v0.0.13 kept the v0.0.12 `createRequire(import.meta.url)` workaround in `packages/core/src/cli.ts` to defer spec-review type resolution past the build cycle. `createRequire` does CJS-style resolution. `factory-spec-review`'s `package.json` declares `exports['./cli']` with only `import` + `types` conditions (no `require`). On the published packages: `createRequire('@wifo/factory-spec-review/cli')` cannot satisfy the resolution because the exports map blocks CJS. The error path catches this, prints nothing, and exits 0. **The reviewer cannot review on the published package.**

In the workspace: workspace symlinks bypass the exports-map enforcement — that's why local development works and CI tests pass. Only the npm-published artifact is broken.

**Why:** v0.0.13's "cycle-break" spec moved spec-review to peerDependencies (peer deps don't escape pnpm's cycle detector). The createRequire workaround stayed because pnpm's build still needed it. We didn't realize createRequire and the exports map are incompatible at runtime — the published artifact silently fails the documented happy path (`npx @wifo/factory-core spec review <path>`).

**Shape options:**
- (a) **Add `require` condition to `factory-spec-review`'s `exports['./cli']`.** Make the package CJS-and-ESM-friendly. ~5 LOC of JSON. But: spec-review's source is ESM-only; CJS consumers would need a separate compile target. Not really viable.
- (b) **Replace `createRequire` with `await import()`** in `core/cli.ts`. ESM dynamic import respects exports map. Reintroduces the build-time cycle for tsc — but the v0.0.13 per-package build sequence in publish.yml already handles cycles. Requires tsc to either skip type-checking the dynamic import (via type-only declaration trick) OR accept the cycle.
- (c) **Ship a `factory-cli` umbrella package** (option b deferred from v0.0.13 BACKLOG): thin package depending on both core + spec-review, providing the unified `factory` bin. core stops shipping a CLI; everything routes through factory-cli. Bigger blast radius (every adopter's `bin: factory` reference moves) but architecturally clean — eliminates the cycle entirely.
- (d) **Spawn the reviewer as a subprocess via the `factory-spec-review` bin** instead of importing it. core's CLI dispatcher does `child_process.spawn('factory-spec-review', rest)` rather than reaching inside the spec-review package. Crosses a process boundary — slightly heavier but eliminates the type-resolution problem entirely.

Lean: (d) for v0.0.14 (smallest, ships fast, isolates the import problem behind a process boundary; reviewer's bin already exists). (c) is the right v1.0.0 architecture but deferrable.

**Touches:** `packages/core/src/cli.ts` (replace createRequire block with `child_process.spawn` of the factory-spec-review bin), `packages/core/package.json` (no change — peerDeps declaration stays, runtime resolves spec-review's bin from PATH via npm's bin-linking), `packages/core/src/cli.test.ts` (update v0.0.13 cycle-break tests — the createRequire pin reverts), tests, README. ~40 LOC.

**Phasing suggestion:** v0.0.14 lead candidate. Closes the most-hidden of the three must-fix bugs — silent exit 0 means nobody notices until they realize spec review never produced output.

---

## `factory finish-task --all-converged` ships specs that `run-sequence` called `no-converge` *(NEW, surfaced by v0.0.13 BASELINE — friction #4)*

**What:** Run-1 of the v0.0.13 BASELINE explicitly reported `click-tracking: no-converge` (validate phase failed 5 times due to friction #1). Run-2's `factory finish-task --all-converged --since <run-1-id>` then **shipped click-tracking to `done/` despite the prior no-converge**. The dogfooder had to manually `mv` it back. Two parts of the toolchain disagree on what "converged" means: run-sequence's `SequenceReport.specs[].status === 'converged'` vs finish-task's predicate (likely just "a `factory-run` record exists with `implement: pass`").

**Why:** The v0.0.12 finish-task spec defined "converged" as "the spec's most-recent factory-run reached `'converged'` status" but the implementation may have only checked for record existence + implement-phase success. The v0.0.12 dedup-status correctness fix (in `factory-runtime-v0-0-12-correctness`) closed a similar bug for run-sequence's already-converged dedup; finish-task wasn't audited for the same shape.

**Shape options:**
- (a) **`finish-task --all-converged` walks `factory-phase` records (same logic as v0.0.12's run-sequence dedup) and verifies all iterations' terminal phase is `'pass'`** before adding the spec to the move-list. Reuses the same helper. ~30 LOC.
- (b) **`finish-task` reads the run's `RunReport.status` field directly** if persisted (v0.0.12 might persist this; otherwise reconstruct from phases per (a)).
- (c) **Add a confirmation prompt** when finish-task moves a spec whose RunReport.status was anything but 'converged'. Worse — doesn't auto-progress.

Lean: (a). Reuse the v0.0.12 helper; one source of truth for "did this spec converge?".

**Touches:** `packages/core/src/finish-task.ts` (call into the existing aggregator), `packages/core/src/finish-task.test.ts` (regression-pin: a spec with no-converge factory-run is NOT moved by `--all-converged`), tests, README. ~50 LOC.

**Phasing suggestion:** v0.0.14. Pairs with friction #1 (the apostrophe bug exposed this) — both are "iteration trust gone wrong" bugs.

---

## `--context-dir` default differs across `factory-runtime` / `factory finish-task` / `factory-context` *(NEW, surfaced by v0.0.13 BASELINE — friction #5)*

**What:** Three CLIs that consume the same context store have three different defaults: `factory-runtime` defaults to `./.factory`, `factory finish-task` defaults to `./context`, `factory-context` historically defaulted to `./context` and gained `--context-dir` as a synonym for `--dir` in v0.0.10. Forgetting the flag silently looks for records in the wrong directory and reports `no factory-sequence found` — the records exist, the lookup just doesn't see them.

**Why:** Each CLI's default landed in a different release without cross-CLI coordination. v0.0.13's `factory finish-task` is the most recent addition and inherited the wrong default — should have matched runtime's `./.factory` (the directory `factory init` actually creates). Trivial fix; high frustration cost when forgotten.

**Shape options:**
- (a) **Universal default: `./.factory`** — the directory `factory init` actually creates. Update `finish-task` (default was `./context`); update `factory-context` (default was `./context`). Document the breaking change in CHANGELOG; preserve old default behind `--legacy-context-dir-default` for one release if needed.
- (b) **Auto-detect from `factory.config.json`** in cwd. If the config has `runtime.contextDir`, use it; otherwise fall back to `./.factory`. ~30 LOC.
- (c) **Both** — auto-detect from config, fall back to `./.factory`.

Lean: (c). The factory.config.json field already exists (v0.0.6+); the CLIs just need to read it. ~50 LOC across 3 CLIs.

**Touches:** `packages/core/src/finish-task.ts`, `packages/core/src/cli.ts` (finish-task default), `packages/context/src/cli.ts` (default change), all three packages' test suites + READMEs. ~60 LOC.

**Phasing suggestion:** v0.0.14. Small lift; high-frequency annoyance.

---

## Scaffold's `biome.json` fails its own `pnpm check` until `--write` runs *(NEW, surfaced by v0.0.13 BASELINE — friction #6)*

**What:** v0.0.13's `factory-core-v0-0-13-init-ergonomics` spec migrated `biome.json` from Biome 1.x's `"include"` to 2.x's `"includes"`. The schema-key migration is correct. But the template's actual format — multi-line `"includes": [\n  "**"\n]` array — fails biome's own lineWidth=100 single-vs-multi-line rule on a fresh `pnpm check`. `pnpm check --write` heals it (collapses to single-line). The scaffold can't pass its own DoD on day zero.

**Why:** Biome's formatter rule for short arrays prefers single-line. The template was written multi-line for human readability; biome's auto-format disagrees. Either format the template through biome at write time, OR write it in the format biome expects.

**Shape options:**
- (a) **Single-line the template:** `"includes": ["**"]` (biome's preferred format). Trivial. ~3 LOC.
- (b) **Run `biome format --write` on the template at init time** — `factory init` formats the just-written biome.json through the locally-installed biome. Heavier; assumes biome is already installed at init time (pnpm install runs after init).
- (c) **Run a self-test in `factory init.test.ts`**: scaffold a tmp tree, run `pnpm check`, assert exit 0. Catches this class of bug going forward without changing the template format.

Lean: (a) + (c). Single-line the template (matches biome's preference) AND add a regression-pin that scaffold passes `pnpm check` on day zero (this is the v0.0.13 init-ergonomics spec's stated DoD — the test was missing).

**Touches:** `packages/core/src/init-templates.ts` (single-line BIOME_JSON_TEMPLATE arrays), `packages/core/src/init.test.ts` (new test: scaffold + `pnpm check` exit 0), tests, README. ~30 LOC.

**Phasing suggestion:** v0.0.14. Closes the regression-pin gap that v0.0.13's spec promised but didn't actually verify.

---

## Day-0 DoD gates fail on freshly-scaffolded tree *(NEW, surfaced by v0.0.13 BASELINE — friction #7)*

**What:** `factory init`'s scaffolded `src/` contains only `.gitkeep` (v0.0.13). Running the scaffold's documented DoD gates immediately:
- `pnpm typecheck` — empty src/, no .ts files: tsc errors out with "no inputs."
- `pnpm test` — `bun test src` finds zero `.test.ts` files; bun returns nonzero ("no tests found").
- `pnpm check` — fails per friction #6 above.

Reasonable for a blank project, but the `dod.template` v0.0.13 ships claims these gates work. A new user runs `factory init`, runs `pnpm <gate>`, sees three failures, loses trust in the toolchain.

**Why:** v0.0.13 shipped `.gitkeep` to ensure `.factory/` directory exists, but didn't add a stub `src/index.ts` + `src/index.test.ts` so the gates the DoD template claims pass actually do pass. Friction #6 is the same shape — scaffold doesn't pass its own DoD claims.

**Shape options:**
- (a) **Scaffold ships `src/index.ts` (`export const VERSION = '0.0.0';`) + `src/index.test.ts` (`test('VERSION exists', () => expect(VERSION).toBe('0.0.0'))`).** Day-0 typecheck + test pass. The agent overwrites them when scoping the first feature.
- (b) **Scaffold ships a `// TODO: implement` placeholder** that satisfies tsc but leaves test empty (skipped via `test.skip`). Less "real" but doesn't ship dead code.
- (c) **`factory init` doesn't write `src/`** — let the maintainer create it. DoD template adjusts to acknowledge "tests pass when src/ is non-empty."

Lean: (a). The stub is small (~10 LOC), real, and overwritten on first feature scope. Day-0 DoD passes cleanly.

**Touches:** `packages/core/src/init-templates.ts` (new INDEX_TS_TEMPLATE + INDEX_TEST_TEMPLATE; init writes them alongside `.gitkeep`), `packages/core/src/init.test.ts` (regression-pin: day-0 `pnpm typecheck && pnpm test && pnpm check` all exit 0), tests, README. ~50 LOC.

**Phasing suggestion:** v0.0.14. Pairs with friction #6 — both "scaffold passes its own DoD" promises that v0.0.13 made and didn't deliver.

---

## YAML colon-in-string parse trap on frontmatter *(NEW, surfaced by v0.0.13 BASELINE — friction #8)*

**What:** A spec frontmatter value containing an unquoted colon — e.g., `why: \`clicks: Map<string, Click[]>\`` (using backtick quoting) — gets parsed by YAML as a nested mapping (the inner `: ` is read as a key/value separator). Lint catches it at scoping time as a parse error, but the message is YAML-jargon-y and the spec author has to debug "what's wrong with this colon?". Small friction, high re-discovery rate.

**Why:** YAML's bare-string vs quoted-string parsing rules are notoriously confusing. The fix is structural — auto-quote any frontmatter value that contains a colon during `/scope-project`'s authoring step, OR upgrade lint to detect the pattern and emit a friendlier message.

**Shape options:**
- (a) **Lint upgrade: detect colons in unquoted frontmatter values and emit `spec/yaml-colon-needs-quoting`** with a fix-suggestion message ("wrap the value in single or double quotes"). Severity warning. ~30 LOC.
- (b) **`/scope-project` auto-quotes values containing colons.** The slash-command source's authoring rules add: "if a frontmatter value contains `:`, wrap in single quotes." Prevents the bomb at scoping time.
- (c) **Both.** Lint catches at scoping time; slash command writes correctly by default.

Lean: (c). Both are small; combined they close the issue from author-side AND tool-side.

**Touches:** `packages/core/src/lint.ts` (new lint code), `packages/core/commands/scope-project.md` (frontmatter-quoting rule), `packages/core/src/lint.test.ts`, `packages/core/src/scope-project-source.test.ts`, tests, READMEs. ~70 LOC.

**Phasing suggestion:** v0.0.14. Smaller; pairs with friction #6 + #7 in the "scaffold ergonomics" cluster.

---

## Skill-injection noise reaches subprocess agents *(NEW, surfaced by v0.0.13 BASELINE — friction #9)*

**What:** When the runtime spawns `claude -p` for the implement phase, the spawned Claude's session-start hooks inject Vercel/Next.js/AI-SDK skill-best-practice context into its prompt. The implement agent in the v0.0.13 BASELINE explicitly noted in its result field: *"I noticed and ignored several Vercel/Next.js/bootstrap skill auto-suggestions from session-start hooks — they were false positives (this is a Bun-only project with no Vercel or Next.js)."* The noise is constant per-subprocess; even when ignored, the implement agent's prompt budget gets eaten by hook context.

**Why:** Session-start hooks fire on every `claude -p` invocation. The runtime's `claude -p` invocations are headless + scoped to a specific spec — they don't benefit from session-start chrome (most session-start hooks are user-environment-aware, not spec-scoped). The runtime should suppress them.

**Shape options:**
- (a) **Pass `--no-session-start-hooks` (or equivalent) to `claude -p` in `implementPhase`.** Check what claude CLI supports; v2.x has a `--no-hooks` option. ~5 LOC if the flag exists.
- (b) **Spawn `claude -p` with a clean env (`HOME=/tmp/factory-claude-home`)** so user-level hooks don't fire. Heavier; might disable subscription auth too.
- (c) **Filter agent stdout/stderr to drop hook output** — too late; the hooks already fired and consumed prompt budget.
- (d) **Document the limitation in factory-runtime/README.md** — punt the fix to upstream claude. Don't ship a workaround.

Lean: (a) if claude supports `--no-hooks`; otherwise (d). Investigate first. The fix is tiny if the flag exists.

**Touches:** `packages/runtime/src/phases/implement.ts` (add the flag to the `claude -p` arg list), tests, README. ~10 LOC if (a); 0 LOC + docs if (d).

**Phasing suggestion:** v0.0.14. Smallest of the 9 entries; ships with the cluster if the flag exists, otherwise documents.

---

## Shipped in v0.0.13 (kept here briefly for history)

The "init-script ergonomics + brownfield-adopter polish + architectural cycle-break" cluster shipped in v0.0.13. Six specs scoped via `/scope-project` (sixth dogfood) + run via `factory-runtime run-sequence` with `--include-drafting --skip-dod-phase --max-agent-timeout-ms 1800000`. **First cluster to converge 6/6 first-iter in one invocation with zero recovery.**

- ✅ **`factory init` first-contact polish** — biome.json `"include"` → `"includes"` (Biome 2.x); `.factory/.gitkeep` + `.gitignore` extension idempotent; `factory.config.json dod.template` derived from package.json scripts and consumed by `/scope-project` as canonical DoD body. Closes 3 v0.0.12 BASELINE frictions.
- ✅ **Auto-quiet for non-TTY stderr** — `[runtime]` progress lines auto-suppress when `process.stderr.isTTY` is false. New `--no-quiet` / `--progress` opts back in. Precedence chain: CLI flag > config > auto-detect > built-in default.
- ✅ **`factory finish-task --all-converged`** — batch ship-cycle move-to-done. Walks the most recent (or `--since`-named) factory-sequence; moves each converged spec to `done/`; emits `factory-spec-shipped` records. Mutually exclusive with positional `<spec-id>`.
- ✅ **Per-scenario coverage-trip detection (option b)** — runner parses `0 fail` + `coverage threshold ... not met` + nonzero exit → classifies as `pass` with `harness/coverage-threshold-tripped:` detail prefix. Real failures still classify `fail`. Closes the CORE-836 friction v0.0.12 shipped a half-fix for.
- ✅ **Cycle-break: `@wifo/factory-spec-review` moves to `peerDependencies` of `factory-core`** — pnpm 8+ / npm 7+ auto-install; v0.0.12's `createRequire` workaround reverts to a static import; publish.yml reverts to `pnpm -r build` (single line). Build-graph cycle disappears.
- ✅ **Bun-as-test-only — schema emitter is Node-native** — `scripts/emit-json-schema.ts` rewritten to `node:fs` + standard ESM. Build script switches `bun run` → `tsx`. `pnpm build` is Node-only; bun required only for `pnpm test`.

**v0.0.13 dogfood summary:** 6/6 first-iter convergence in 71m wall-clock, 169k charged tokens. Cleanest dogfood evidence to date — runtime + judge + sequence-runner triad is stable. 8 BACKLOG candidates closed: 5 init-script (v0.0.12 BASELINE) + 1 carve-out (CORE-836 / v0.0.12 ship) + 2 architectural (v0.0.12 tag-fire). Workspace tests grew ~750 → ~770+. Public API surface unchanged across all 6 packages. The v0.0.13 BASELINE re-run is the next maintainer-driven step.

---

## Shipped in v0.0.12 (kept here briefly for history)

The "validate-phase reliability + brownfield-adopter onramp + observability + DoD trust" cluster shipped in v0.0.12. Six specs scoped via `/scope-project` (fifth dogfood) + run via `factory-runtime run-sequence` with `--include-drafting --skip-dod-phase --max-agent-timeout-ms 1800000` (30min budget; DoD-phase skipped because v0.0.10's judge dispatcher requires `ANTHROPIC_API_KEY` — pre-flight `factory spec lint` + `factory spec review` gated quality):

- ✅ **Harness quote normalization + lint warning** — `parseTestLine` strips/replaces curly quotes; `spec/test-name-quote-chars` lint catches scoping-time. Per-scenario coverage carve-out **descoped to v0.0.13** (bun 1.3.x rejects `--coverage=false`; option (b) re-opens — see entry above).
- ✅ **Live progress on stderr + cause-of-iteration + tooling-mismatch detection** — `[runtime] iter <N> <phase>` lines per phase boundary; cause-line at iter N+1 start; warning on monotonic DoD-pass + identical validate-fail. New `--quiet` flag + `factory.config.json runtime.quiet`.
- ✅ **Dedup correctness + filesChanged debug telemetry + agent stderr-tail capture** — `convergedBySpecId` aggregates `factory-phase` records to verify actual convergence (closes v0.0.11 ship bug); `filesChangedDebug?: { preSnapshot, postSnapshot }` for diagnosing the v0.0.11 BASELINE undercount; `failureDetail.stderrTail?: string` (10 KB) on agent-exit-nonzero.
- ✅ **Literal DoD shell commands** — new `spec/dod-needs-explicit-command` lint warning. `dodPhase` drops script-name-guessing; bullets without backtick commands → `status: 'skipped', reason: 'dod-gate-no-command-found'`. SPEC_TEMPLATE.md updated with worked examples.
- ✅ **`factory init --adopt` + `factory finish-task` + `factory-spec-review` hard dep** — `init --adopt` for brownfield onramp; `factory finish-task <id>` CLI subcommand + library helper (+1 public surface: `finishTask`, 33 → 34); `@wifo/factory-spec-review` moves to `dependencies` of `@wifo/factory-core`. Runtime emits `converged → ship via 'factory finish-task <id>'` hint on convergence.
- ✅ **Smoke-boot scenarios in `/scope-project`** — slash command source enumerates HTTP entrypoint trigger keywords (`createServer`, `listen(<port>)`, `app.listen`, `http.createServer`, `Bun.serve`, `serve(`); appends a smoke-boot scenario that boots `bun src/main.ts` + probes + kills. Closes the v0.0.11 short-url BASELINE "library shipped, server doesn't boot" gap.

**v0.0.12 dogfood summary:** 4 run-sequence invocations to ship cleanly (recovery from one bad spec assumption — bun's `--coverage=false` doesn't exist; one transient stale-dist after my source-revert; one `agent-exit-nonzero` after work landed — same shape as v0.0.11 worktree-sandbox spec). Total wall-clock ~140 minutes across all attempts; ~275k charged tokens. Public API surface: factory-core 33 → 34 (+`finishTask`); factory-runtime 26 → 26 (field-level `RunOptions.quiet?` addition). Workspace tests grew ~700 → ~750+. The v0.0.12 BASELINE re-run is the next maintainer-driven step.

---

## Shipped in v0.0.11 (kept here briefly for history)

The "trust → isolation + trust-layer calibration" cluster shipped in v0.0.11 (commit `<TBD>`). Six specs (5 LIGHT + 1 DEEP) scoped via `/scope-project` (fourth dogfood) + run via `factory-runtime run-sequence` with `--include-drafting --max-agent-timeout-ms 2400000` (40min budget — first production test of v0.0.9's per-spec frontmatter timeout override field, declared on worktree-sandbox-v0-0-11):

- ✅ **CI publish workflow** — `.github/workflows/publish.yml` + RELEASING.md.
- ✅ **`dod-precision` calibration** — recognizes `<command> green` / `<command> clean` as canonical idioms.
- ✅ **`run-sequence` walks the DAG dynamically** — auto-promotes drafting dependents on convergence. Closes v0.0.10 BASELINE friction #1.
- ✅ **Holdout-aware convergence** — `--check-holdouts` flag; both visible AND holdouts must pass; failed-holdout IDs surfaced in iter N+1's prompt (criteria stay hidden).
- ✅ **`tokens.charged` field split** — budget-relevant total separate from cache-aware total.
- ✅ **Worktree sandbox** — `factory-runtime run --worktree` materializes `<projectRoot>/.factory/worktrees/<runId>/` on a throwaway branch; phases run inside; main tree never touched. New `factory-worktree` context record. New `factory-runtime worktree { list | clean }` subcommand. **First DEEP spec to declare `agent-timeout-ms: 2400000` in frontmatter — the v0.0.9 per-spec timeout override survived its first production test.**

**v0.0.11 dogfood summary:** Required 2 run-sequence invocations to ship cleanly (the first stopped on a 1-character apostrophe mismatch in dod-precision's test name; one-char fix unstuck it). Total wall-clock ~95 minutes across both attempts. The retry's `factory-runtime: <id> already converged in run <runId> — skipping` log line FIRED for ci-publish (correctly) AND for dod-precision (incorrectly — exposed v0.0.10's dedup bug above). Public API surface: factory-runtime 23 → 26 (+3 worktree exports). Workspace tests grew from ~640 to ~700+. THREE concrete v0.0.12 candidates surfaced from this ship cycle (entries above).

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

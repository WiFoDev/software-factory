# Baseline runs

Longitudinal evidence that the factory is actually getting better, version by version. Each entry is a run of a **canonical product** through the factory at one minor version; diffing entries shows exactly how much friction each release removed.

> **What this file is.** A tracker. Each run produces a `JOURNAL.md` in its own throwaway repo (`~/dev/url-shortener-vX.Y.Z/`). This file collects the headline measurements from those journals into one place so the comparison stays organized.
>
> **What this file is not.** A roadmap (that's `ROADMAP.md`). A candidate pile (that's `BACKLOG.md`). A diff log (that's `CHANGELOG.md`). This file answers ONE question: *between v0.X.Y and v0.X.Y+1, did the factory actually get better at building real things?*

---

## Methodology

1. **Canonical products are byte-stable test fixtures.** Each canonical product has a fixed prompt under `docs/baselines/<product>-prompt.md`. The prompt does not change between versions — only the factory does. If the prompt needs an edit because the factory's API changed, that's a baseline reset; archive the old prompt as `<product>-prompt-vX.Y.Z.md` and start fresh.
2. **Runs happen in fresh directories outside the monorepo.** `~/dev/<product>-vX.Y.Z/`. This makes `pnpm install` resolve against public npm — the published packages are part of what's being measured, not a local workspace shortcut.
3. **Subscription auth only.** The factory's economic thesis is Pro/Max, not per-token. Baseline runs validate that thesis — token spend appears in usage but doesn't bill.
4. **Friction is the primary artifact.** Every awkward moment ("this would have been easier if X existed") gets logged to the run's `JOURNAL.md`. After the run, the top friction points get extracted here. Each friction point should map to a `BACKLOG.md` entry; if it doesn't, that's a gap.
5. **Predictions are part of the entry.** Before each run, write down what you expect to be friction. Score predicted-vs-actual after. Misses are signal — they expose blind spots about where the friction actually lives.
6. **One run per minor version.** Run on v0.0.5. Run again on v0.0.6 (using the same prompt). Diff the journals.

### What goes into a per-version entry

| Field | Captured how |
|---|---|
| Date of run | Wall-clock |
| Factory version | The npm tag at run time (e.g., `v0.0.5` = each `@wifo/factory-*` published at `0.0.5`) |
| Wall-clock total | Sum across all spec runs in the product |
| Token total | Sum of `tokens.input + tokens.output` across every `factory-implement-report` produced |
| Iterations per spec | From the `RunReport.iterationCount` of each spec's run |
| Top friction points | 3-5 ranked, mapped to BACKLOG entries |
| Predictions vs actuals | Did the predicted friction land? What surprised? |

### Baseline reset events

A baseline reset is what happens when the factory's API changes enough that the canonical prompt no longer measures the current toolchain honestly — the prompt instructs the agent against using tools that now exist, or relies on workflow steps the runtime now collapses. When this trigger fires, the existing prompt is archived under a versioned filename and a fresh canonical is written.

**Forward-compat invariant for every reset:** the prior prompt MUST be archived under `docs/baselines/<product>-prompt-vX.Y.Z-vA.B.C.md` (where the version range names the era the archived prompt was canonical for) and the reset MUST be linked from this section. The archived file is byte-identical to the pre-reset prompt EXCEPT for a one-line dated marker prepended at the top so a reader landing on the archived file knows it is not the live canonical. The rename uses `git mv` (not delete + add) so `git log --follow` traces the file's history through every prior commit on the original path. Every reset event entry below names the date, the trigger, the archived path, and the new canonical's entry point.

#### v0.0.8 reset — 2026-05-03

- **Date:** 2026-05-03.
- **Trigger:** v0.0.7 shipped `/scope-project` + `depends-on:` frontmatter + `factory-runtime run-sequence`. The pre-v0.0.7 prompt explicitly told the agent those tools didn't exist yet ("`/scope-project` is a v0.0.6 deliverable — it doesn't ship until later", hardcoded four-spec decomposition body, per-spec workflow listing manual lint/review/run/move-to-done steps). The v0.0.7 BASELINE entry confirmed the agent dutifully followed those instructions and produced a friction list mirroring what the prompt told it to expect — the new tools were live on npm but invisible because the prompt instructed against using them.
- **Archived path:** [`docs/baselines/url-shortener-prompt-v0.0.5-v0.0.7.md`](./docs/baselines/url-shortener-prompt-v0.0.5-v0.0.7.md). The archived file's first line is a dated marker (`# URL shortener — canonical baseline prompt (v0.0.5–v0.0.7 era; archived 2026-05-03)`); the rest is byte-identical to the prompt that was canonical from v0.0.5 ship through v0.0.7 ship.
- **New canonical entry point:** `/scope-project A URL shortener with click tracking and JSON stats. JSON-over-HTTP, in-memory, no auth.` followed by `pnpm exec factory-runtime run-sequence docs/specs/`. The product under test is unchanged (URL shortener with click tracking and JSON stats endpoint; in-memory; no auth) — only the workflow framing changes.
- **Methodology invariant preserved:** the new canonical is byte-stable from v0.0.8 onward until the next API-change-driven reset.

---

## Canonical products

### URL shortener

A small JSON-over-HTTP URL shortener with click tracking. In-memory storage, native `Bun.serve`, no auth/db/frontend.

- **Goal:** test the per-feature → product-scale gap. The product is a sequence of 4 specs in dependency order; the factory at v0.0.5 forces manual decomposition + manual sequencing.
- **Scope (4 specs):** `url-shortener-core` → `url-shortener-redirect` → `url-shortener-tracking` → `url-shortener-stats`.
- **Prompt:** [`docs/baselines/url-shortener-prompt.md`](./docs/baselines/url-shortener-prompt.md).

#### Run history

##### v0.0.5 — shipped 2026-05-01

The first baseline. The maintainer manually decomposed into 4 specs and ran them in sequence. `/scope-project` did not yet exist; `depends-on` was not yet a frontmatter field; `factory-runtime run-sequence` did not yet exist.

**Predictions (locked in before the run):**

1. **The decomposition step itself.** Picking the 4 spec boundaries was easy in the conversation that produced this prompt; for a different product it wouldn't be. `/scope-project` directly addresses this.
2. **Cross-spec dependency invisibility.** Spec 3 (tracking) needs to know what spec 2 (redirect) actually exported. Today: agent reads the existing code. With `depends-on`: the reviewer's `cross-doc-consistency` judge would catch dependency drift before the run.
3. **Context-dir reuse oddness.** With `--context-dir ./.factory` shared across all 4 runs, `tree --direction down <runId>` walks ONE run; the four runs are siblings under no common parent. Sequence-runner would create a parent record so all four runs hang under one product.
4. **Status flipping tax.** Manually flipping `status: drafting` → `status: ready` between specs is small but real friction.
5. **Possibly the harness backtick gotcha.** The prompt warns about it explicitly, but if Claude slips, a spec will appear to "fail" until spotted.

**Actuals:**

| Spec | Iterations | Wall-clock (run only) | Notes |
|---|---|---|---|
| url-shortener-core | 1 | — | clean converge |
| url-shortener-redirect | 1 | — | clean converge |
| url-shortener-tracking | 1 | — | clean converge |
| url-shortener-stats | 1 | — | clean converge |
| **Total (all 4 runs)** | **4** | **7m 3s (423 s)** | every spec converged first try |

| Metric | Value |
|---|---|
| Total iterations | 4 (1 per spec) |
| Wall-clock total | 7m 3s |
| Tokens (raw input + output) | 22,703 |
| Tokens (cache-aware total) | 2,920,000 |
| **Implied prompt-cache hit rate** | **~99%** — the v0.0.5 `IMPLEMENTATION_GUIDELINES` byte-stability investment is doing real work |
| Tests | 14/14 passing |
| End-to-end live `curl` | verified |
| Commits produced | 7 (4 spec ships + scaffold + JOURNAL.md + final) |

**Top friction points (ranked, post-run):**

1. **Manual decomposition + no inter-spec dependency graph.** What `/scope-project` + `depends-on` + sequence-runner will collapse into one command. **Validated** — this was prediction #1+#2, and it was the dominant friction. v0.0.6's centerpiece is correctly aimed.
2. **`factory init` is incomplete on first contact.** Three sub-issues: (a) `@wifo/factory-spec-review` is not in the scaffold's deps even though it's invoked by `factory spec review` via dynamic import; (b) `.factory-spec-review-cache` is missing from the scaffold gitignore; (c) no `factory.config.json` defaults file for canonical run flags (`--max-iterations 5`, `--max-total-tokens 1000000`, `--no-judge`). **NEW signal — not in the prediction list.**
3. **`filesChanged` in implement-reports is unreliable both ways.** False negative for runs that only create new files (spec 2 reported empty `filesChanged` despite creating the HTTP server module). False positive when there are pre-run uncommitted changes (spec 1's `filesChanged` was contaminated by the JOURNAL.md edit that hadn't been committed yet). The audit field cannot be trusted as "what did the agent touch" today. **NEW signal — not in the prediction list.**

**Mapped BACKLOG entries:**
- Friction #1 → "Real-product workflow — close the project-scale gap" (existing v0.0.6 cluster: `/scope-project`, `depends-on`, sequence-runner)
- Friction #2 → NEW entry: `factory init` ergonomics — first-contact gaps (added below)
- Friction #3 → NEW entry: `factory-implement-report.filesChanged` is unreliable (added below)

**Predicted-vs-actual scoring:**

| Prediction | Outcome | Notes |
|---|---|---|
| #1 Decomposition | ✅ Landed | Exactly the dominant friction, as expected |
| #2 Cross-spec dep invisibility | ✅ Landed (collapsed into #1) | The two are facets of the same pain |
| #3 Context-dir reuse oddness | ❓ Did not surface | Probably absorbed because every spec converged in 1 iteration — there was no need to walk the multi-run DAG. Will likely show on a less-clean product |
| #4 Status flipping tax | ❓ Did not surface | Same reason — small enough to absorb when the workflow is moving fast |
| #5 Harness backtick gotcha | ❌ Did not land | The explicit warning in the prompt prevented it. Confirms the workaround works; the harness fix is still worth shipping (so the warning becomes unnecessary) |

**Surprises (the high-value entries — these expose where the friction actually lives):**

- **Cache hit rate is the real v0.0.5 win.** 22,703 raw tokens / 2.92M cache-aware = ~99% cache reuse. The `IMPLEMENTATION_GUIDELINES` byte-stability invariant pays off MORE than the iteration-count theory predicted. Re-running the same spec is essentially free; iterating mid-spec is essentially free; the prompt-prefix design is a quiet but huge unlock.
- **`factory init`'s first-contact UX matters more than I weighted it.** Two of the three sub-issues in friction #2 (missing spec-review dep + missing cache gitignore) are 1-line fixes that make the difference between "the toolchain works on a fresh repo" and "the maintainer has to add things by hand." Worth a v0.0.5.x point release.
- **`filesChanged` audit reliability is a trust issue, not a UX issue.** This affects the provenance contract — `factory-context tree` and `get` are supposed to tell you *exactly* what the agent touched. Right now they don't. This was fully invisible until a real product run with a non-trivial git state.

**Would you want to use the factory for the next product?**

Yes — the per-feature sweet spot is real and the prompt cache makes it cheap. The friction is concrete and addressable: friction #1 is what v0.0.6 already targets; #2 and #3 land in BACKLOG below as v0.0.5.x candidates. **Net signal: the v0.0.6 roadmap is correctly aimed; nothing about this run suggests a re-theme.**

##### v0.0.6 — shipped 2026-05-02

The v0.0.5.x cluster. Shipped four BACKLOG-tracked v0.0.5 follow-ups (harness backtick stripping, `factory init` first-contact UX, `filesChanged` audit reliability, configurable per-phase agent timeout). Did NOT add `/scope-project` (that theme moved to v0.0.7).

**Actuals:**

| Spec | Iterations | Wall-clock | Tests cumulative | Notes |
|---|---|---|---|---|
| url-shortener-core | 1 | 63s | 4/4 | clean converge |
| url-shortener-redirect | 1 | 64s | 8/8 | clean converge |
| url-shortener-tracking | 1 | 88s | 12/12 | clean converge |
| url-shortener-stats | 1 | 51s | 16/16 | clean converge |
| **Total (all 4 runs)** | **4** | **4m 26s (266 s)** | **16 pass, 0 fail** | every spec converged first try |

| Metric | v0.0.5 | v0.0.6 | Delta |
|---|---|---|---|
| Wall-clock | 7m 3s (423s) | 4m 26s (266s) | **−37%** |
| Tokens (cache-aware) | 2,920,000 | 2,202,884 | **−25%** |
| Tests shipped | 14 | 16 | +2 (more tests per spec) |
| Iterations / 4 specs | 4 (1 each) | 4 (1 each) | unchanged — per-feature sweet spot holds |
| Commits | 7 | 6 | −1 |

**Predicted-vs-actual scoring:**

| Prediction | Outcome | Notes |
|---|---|---|
| Friction #2 from v0.0.5 (init UX) → gone | ✅ Confirmed | Agent did NOT mention init friction. The scaffold now ships with spec-review in deps, cache-gitignored, factory.config.json present. |
| Friction #3 from v0.0.5 (filesChanged unreliable) → gone | ✅ Confirmed | Agent did NOT mention filesChanged friction. New-file-only specs (redirect, tracking, stats) all populated correctly. |
| Backtick gotcha → gone | ✅ Confirmed | Agent had no test-path issues; harness tolerated both forms. |
| Friction #1 from v0.0.5 (manual decomposition) → still bites | ✅ Confirmed | Agent ranked it #1 again, with new precision: "I hand-paraphrased spec 1's API in specs 2/3/4's Constraints blocks. /scope-project + depends-on: frontmatter would emit the four specs with a shared constraints block once." |
| Friction #3+#4 from v0.0.5 (context-dir reuse, status flipping) → survive | ✅ Confirmed | Folded into the agent's new friction #2 below. |
| Token totals — similar to v0.0.5 (~99% cache hit) | ❌ Better than predicted | 25% reduction in cache-aware tokens AND 37% wall-clock reduction. The v0.0.6 fixes (especially smoother init + no harness re-runs from backtick failures) are net token-positive. |

**Top 3 friction points (ranked, post-run, per agent's JOURNAL):**

1. **Manual decomposition + cross-spec API repetition.** The v0.0.7 keystone gap. The agent quantified: hand-paraphrased spec 1's API in specs 2/3/4's Constraints blocks. `/scope-project` + `depends-on:` frontmatter would emit the four specs with a shared constraints block once. **Maps to v0.0.7's `/scope-project` + `depends-on` cluster.**
2. **No sequence-runner — 8 maintainer steps × 4 specs = 32 manual interventions.** Quantified evidence the v0.0.7+ entry required. Agent compute was ~4½ minutes; maintainer orchestration time was multiples of that. `factory-runtime sequence ./docs/specs/*.md` collapses 32 → ~8. **Maps directly to BACKLOG's spec-sequence runner — promote to v0.0.7 (was v0.0.8) based on this evidence.**
3. **DoD-vs-runtime gap.** `factory-runtime run --no-judge` skipped the DoD shell gates (typecheck went unchecked). The agent had to add typescript himself post-spec-1 because `factory init` doesn't ship it. **NEW signal — two new BACKLOG entries below: (a) ship typescript in `factory init` devDeps; (b) DoD-verifier runtime phase.**

**Mapped BACKLOG entries:**
- Friction #1 → "Real-product workflow — close the project-scale gap" (existing v0.0.7 cluster)
- Friction #2 → "factory-runtime: spec-sequence runner" (existing entry, **promoted from v0.0.8 to v0.0.7** based on quantified evidence)
- Friction #3 → 2 NEW entries (factory init typescript + DoD-verifier runtime phase) — added to BACKLOG below

**Surprises:**

- **Wall-clock was 37% faster, not "similar."** The v0.0.6 fixes paid off MORE than predicted — likely because (a) no harness re-runs from backtick mis-parses and (b) factory.config.json removed flag-typing time across 4 runs. The IMPLEMENTATION_GUIDELINES cache hit rate (~99%) holds, but cumulative orchestration time per spec dropped meaningfully.
- **`--no-judge` silently skips DoD gates.** The user (and I) assumed `--no-judge` only skipped LLM-judged satisfactions. It actually means "don't run the harness's judge phase at all" — and DoD bullets like "typecheck clean" never get verified. The runtime returns "converged" because tests pass, but a spec could ship with broken types and the runtime wouldn't notice. Audit-trust gap, not just UX.
- **Agent ate one bug for breakfast** — typescript wasn't in the scaffold's devDeps, so spec 1's typecheck would have failed if anyone ran it. Agent added typescript himself (going slightly out of spec scope but correctly so). The factory init scaffold should ship with typescript so this never bites.

**Would you want to use the factory for the next product?**

Per the agent: *"Yes — I'd use the factory again. Convergence quality is excellent (4/4 first-try, every constraint honored). The pain is entirely on the maintainer side — I would not drive a 10-spec project by hand on v0.0.6's surface."* **Net signal: v0.0.6 was leverage; the maintainer-side pain is exactly the v0.0.7 target. Sequence-runner promoted to v0.0.7 alongside /scope-project per the quantified "32 interventions" evidence.**

##### v0.0.7 — shipped 2026-05-03 (FLAGGED: outdated prompt; baseline reset proposed for v0.0.8)

The v0.0.7 cluster shipped (`/scope-project` + `depends-on` + `factory-runtime run-sequence`). All six packages on npm at 0.0.7. Run executed in `~/dev/url-shortener-v0.0.7/` against the public registry.

**Actuals:**

| Spec | Iterations | Wall-clock | Notes |
|---|---|---|---|
| url-shortener-core | 1 | — | clean converge |
| url-shortener-redirect | 1 | — | clean converge |
| url-shortener-tracking | 1 | — | clean converge |
| url-shortener-stats | 1 | — | clean converge |
| **Total (all 4 runs)** | **4** | **5m 9s (309s)** | every spec converged first try |

| Metric | v0.0.6 | v0.0.7 | Delta |
|---|---|---|---|
| Wall-clock | 4m 26s (266s) | 5m 9s (309s) | **+16% (likely noise)** |
| Tokens (raw input + output) | — | 17,009 | — |
| Tokens (cache-aware) | 2,202,884 | 2,343,546 | **+6%** (~94% cache reads, comparable) |
| Tests shipped | 16 | 19 | +3 (more coverage on stats spec) |
| Iterations / 4 specs | 4 (1 each) | 4 (1 each) | unchanged |
| Commits | 6 | 6 | unchanged |

**Top 3 friction points (per agent's JOURNAL):**

1. **No run-sequence walking docs/specs/ with depends-on enforcement** — agent manually lint/review/run/move-to-done × 4.
2. **No `/scope-project` to decompose** — decomposition discipline left to the agent.
3. **Spec-quality review fires after authoring** — DoD-precision warnings predictable enough that `/scope-task` could prevent them by templating runnable bullets.

**End-to-end smoke:** `curl POST /shorten` → `GET /:slug` → `GET /stats/:slug` returned `{"clicks":3,...}` with the correct ISO timestamp. Verdict: viable today.

**Why the friction list is identical to v0.0.6 — root cause:**

This is **not roadmap drift**. The canonical prompt (`docs/baselines/url-shortener-prompt.md`, byte-stable since v0.0.5) explicitly tells the agent v0.0.7's three deliverables don't exist yet:

- Line 38-41: "**`/scope-project` is a v0.0.6 deliverable — it doesn't ship until later**. Until then, decomposition is the maintainer's job."
- Line 43-50: hardcodes the four-spec decomposition INTO the prompt body, eliminating any reason for the agent to invoke `/scope-project`.
- Line 56: "**`/scope-task` the feature.**" — instructs the agent to use the per-spec command, not the product-level one.
- Line 113-114: warns about backtick-stripping that v0.0.6 fixed.
- Line 127-128: pre-frames the friction list as "things `/scope-project` or sequence-runner would have eliminated."

The agent dutifully followed these instructions and produced a friction list that mirrors what the prompt told it to expect. v0.0.7's tools were live on npm but invisible because the prompt instructed against using them.

**Methodology trigger fired:** per BASELINE.md, "if the prompt needs an edit because the factory's API changed, that's a baseline reset." v0.0.7 is exactly that condition. **Proposed for v0.0.8: archive the current prompt as `url-shortener-prompt-v0.0.5-v0.0.7.md` and write a fresh canonical that uses `/scope-project` + `run-sequence` as the entry point.** The next minor's BASELINE will measure the v0.0.7+ flow honestly.

**Secondary contributing factor:** even with a corrected prompt, `factory init`'s scaffold doesn't include `.claude/commands/scope-project.md` — a fresh-repo agent has no signal that the slash command exists. Captured in BACKLOG as the v0.0.8 lead candidate ("`factory init`: drop `/scope-project` into scaffolded `.claude/commands/`"). Pairs with the prompt reset.

**Predicted-vs-actual scoring (predictions made before run, locked in v0.0.6's BASELINE entry):**

| Prediction | Outcome | Notes |
|---|---|---|
| Friction #1 (manual decomp) → largely disappears | ❌ Did not land | Stale prompt told agent to decompose manually anyway. |
| Friction #4 (status flipping) → shrinks | ❌ Did not land | Agent followed prompt's per-spec workflow; status flipping was prescribed. |
| Sequence-runner gap → survives until v0.0.8 | ❌ Wrong direction | Sequence-runner shipped in v0.0.7 (promoted from v0.0.8). It exists; prompt didn't surface it. |

All three predictions wrong, all in the same direction: **the prompt prevented the new tools from being exercised**. The miss exposes a methodology blind spot — "shipped to npm" ≠ "discoverable to a baseline-prompt-following agent."

**Surprises:**

- **The byte-stable prompt is actively misleading after a major API change.** The methodology section anticipated this case and prescribed "baseline reset"; this run is the first time the trigger has fired in practice. The reset is the correct response, not a methodology failure.
- **Scaffold discoverability matters as much as the prompt.** Even with a corrected prompt, a fresh-repo agent needs `.claude/commands/scope-project.md` to be auto-installed by `factory init` for `/scope-project` to be reachable. Two-pronged v0.0.8 work: prompt reset + scaffold drop.
- **Cache-aware token totals stayed flat (~99% cache hit).** The implementation guidelines prefix from v0.0.5 still earns its keep. Whatever v0.0.8 changes, that invariant should not break.

**Mapped BACKLOG entries:**
- Friction #1 + #2 → root cause is stale prompt + scaffold gap. Both addressed in v0.0.8: (a) baseline reset (NEW methodology task, see "v0.0.8 reset plan" below); (b) scaffold-drop BACKLOG entry already added.
- Friction #3 (DoD-precision predictability) → minor; possible `/scope-task` template tightening in a future point release.

**Would you want to use the factory for the next product?** Per the agent: "yes, viable today; the three missing pieces above would make it the obvious default." Verdict honest under the constraint that the prompt told the agent those pieces were missing.

##### v0.0.8 reset plan (the meta-deliverable)

Two-pronged:

1. **Baseline reset.** Archive the current `url-shortener-prompt.md` as `url-shortener-prompt-v0.0.5-v0.0.7.md` (the era when manual decomposition was canonical). Write a fresh `url-shortener-prompt.md` whose entry point is `/scope-project A URL shortener with click tracking and JSON stats. JSON-over-HTTP, in-memory, no auth.` followed by `factory-runtime run-sequence docs/specs/`. The new prompt measures the v0.0.7+ flow.
2. **`factory init` scaffold drop.** New v0.0.8 BACKLOG entry — `factory init` writes `.claude/commands/scope-project.md` so any fresh project gets the slash command zero-config. Without this, the new prompt fails on a fresh-repo agent (slash command not discoverable).

Both ship before any v0.0.8 BASELINE re-run. The v0.0.8 BASELINE entry below depends on both landing first.

##### v0.0.8 — pending

After (1) baseline reset and (2) `factory init` scaffold drop ship. New canonical prompt opens with `/scope-project`; agent decomposes via the slash command; `factory-runtime run-sequence docs/specs/` walks the four shipped specs in topological order. Predicted improvements: friction #1 (manual decomposition) genuinely disappears for the first time; friction #2 (sequence orchestration, 32 manual interventions on v0.0.6) collapses to ~1 invocation; the v0.0.7 friction list stops repeating. Wall-clock + token totals expected flat (the bottleneck is agent compute, not orchestration). Maintainer interventions expected: ≤4 (one per spec review, vs 32 on v0.0.6).

##### v0.1.0 — pending

After scheduler (Layer 5) ships. The maintainer prompt should reduce to "scope this product, ship it overnight" with no hand-driving. If we're not there by v0.1.0, the scheduler isn't done.

---

## Adding a new canonical product

When the URL shortener has been measured across 2-3 versions and the factory is converging on it cleanly, add a **second canonical product**. Candidates that probe different surfaces:

- **`cron-scheduler`** — a small CLI that takes cron expressions + commands and runs them. Different shape from URL shortener: no HTTP, but stateful + time-sensitive. Tests the runtime's wall-clock handling.
- **`csv-pipeline`** — read CSV, transform, write CSV. ETL shape; tests the agent's handling of streaming I/O.
- **`feature-flag-evaluator`** — given a JSON ruleset, evaluate whether a flag is on for a context. Tests deeply-nested data shape handling and edge cases.

Each new canonical gets its own prompt under `docs/baselines/<product>-prompt.md` and its own section in this file. Same per-version entry shape.

The point is variety: URL shortener tests HTTP + sequencing; the others test different shapes. If the factory ships a friction-less URL shortener but stumbles on `csv-pipeline`, that's signal about which domain pack matters next.

---

## When this file says we've drifted

- **No new entries between minor versions.** Each minor version should add a row to at least one canonical product's run history. If a release ships without a baseline run, the release shipped without evidence — back-fill or note explicitly why we skipped.
- **Friction points stop mapping to BACKLOG entries.** If the run surfaces a real pain point and it doesn't land in BACKLOG, the BACKLOG isn't tracking reality.
- **Predictions get wildly wrong.** If predicted friction lists keep being mostly empty (real friction lives elsewhere), we're scoping releases against the wrong constraints. Re-anchor on the URL-shortener test case in `ROADMAP.md`'s end-state section.

This file is the third anchor (alongside `ROADMAP.md` and `BACKLOG.md`). All three should agree about where the factory is going. When they disagree, this one is the empirical ground truth — the others adjust.

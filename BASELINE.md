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

##### v0.0.8 — shipped 2026-05-03 (FIRST run where the friction list actually shrunk)

The discoverability + baseline reset cluster shipped (`/scope-project` auto-installed by `factory init`, scaffold README documents the multi-spec flow, baseline prompt reset). Run executed against the new canonical prompt in `~/dev/url-shortener-v0.0.8/`.

**Predictions (locked before the run):**

1. Friction #1 (manual decomposition) genuinely disappears for the first time — `/scope-project` is auto-installed and the new prompt opens with it.
2. Friction #2 (sequence orchestration, 32 manual interventions on v0.0.6) collapses to ~4-8 (one `/scope-project` + one `run-sequence` + per-spec review checkpoints).
3. Wall-clock + cache-aware tokens stay flat — agent compute didn't change, only orchestration did.
4. Possible NEW friction: agent timeout on a wide-blast-radius spec (the v0.0.8 self-build hit this on a 12-file spec).
5. Friction #3 (DoD-precision predictability) may persist — v0.0.8 didn't address it.

**Actuals:**

| Spec | Iterations | Notes |
|---|---|---|
| url-store | 1 | clean converge (the `ready` root) |
| click-store | 1 | clean converge |
| shorten-endpoint | 1 | clean converge |
| redirect-endpoint | 1 | clean converge — diamond join, NO timeout |
| stats-endpoint | 1 | clean converge |
| **Total (all 5 specs)** | **5** | **6m 26s (385.8 s)** | every spec converged first try |

| Metric | v0.0.5 | v0.0.6 | v0.0.7 | v0.0.8 | Per-spec (v0.0.8) |
|---|---|---|---|---|---|
| Specs shipped | 4 (linear) | 4 (linear) | 4 (linear) | **5 (diamond)** | — |
| Wall-clock | 7m 3s | 4m 26s | 5m 9s | 6m 26s | **77 s/spec** |
| Wall-clock per spec | 106 s | 67 s | 77 s | **77 s** | identical to v0.0.7 |
| Raw tokens | 22,703 | — | 17,009 | 20,900 | ~4,200/spec |
| Tests shipped | 14 | 16 | 19 | 16 | — |
| Commits | 7 | 6 | 6 | **4** | — |
| Maintainer interventions | ~32 | 32 | 32 (prompt-biased) | **~3-8** | **≥4× collapse** |

**End-to-end smoke:** all 7 `curl` calls in the cookbook behave per spec. Live HTTP + click tracking + JSON stats verified.

**Top 3 friction points (per agent's JOURNAL):**

1. **`run-sequence` is not status-aware.** It walked all 5 specs even though only `url-store` was `status: ready`. The "I'll flip drafting → ready as each spec converges" workflow documented in the new canonical prompt is fictional in v0.0.8 — once you invoke `run-sequence`, the runtime walks the full DAG to convergence with no maintainer checkpoint between specs. The prompt itself acknowledged this as a TODO. **Maps directly to existing v0.0.9 BACKLOG entry** ("`factory-runtime run-sequence` should skip `status: drafting` specs by default") — surfaced again, twice now (v0.0.8 self-build + v0.0.8 BASELINE).
2. **Scaffold ships `scripts: {}` but every spec DoD says "typecheck + lint + tests green."** `factory init` and `/scope-project`'s default DoD disagree about what "green" means. Only `bun test` works in a fresh scaffold; `pnpm typecheck` and `pnpm lint` are aspirational. The reviewer's `internal-consistency` judge caught this. **NEW v0.0.9 BACKLOG entry needed:** scaffold should ship `scripts: { typecheck, test, check }` matching the monorepo conventions, OR the spec template's default DoD should not promise gates that don't exist in fresh scaffolds.
3. **`/scope-project` and the spec-reviewer disagree about shared constraints.** `/scope-project` says "cross-spec decisions live in spec #1's Constraints"; the `internal-consistency` judge flags those as unreferenced because it doesn't follow `depends-on` edges to see downstream references. The pattern worked end-to-end (the warning was substance-light), but it forced a stop-and-think at the very moment the maintainer was supposed to trust the scoper. **NEW v0.0.9 BACKLOG entry needed:** the reviewer's `internal-consistency` judge needs `depends-on`-awareness — when scoring spec N, treat constraints declared in any spec in `depends-on*` chain as already-covered (or referenced via known patterns).

**Predicted-vs-actual scoring:**

| Prediction | Outcome | Notes |
|---|---|---|
| #1 Manual decomposition disappears | ✅ **LANDED** | `/scope-project` invoked once; 5 specs out; zero hand-decomposition. **First time the friction list has actually shrunk version-over-version.** |
| #2 32 → ~4-8 interventions | ✅ **LANDED** | 4 commits total (vs 6 in v0.0.6). Estimated ~3-8 maintainer touches (one `/scope-project` + one review pass + one `run-sequence` + per-spec eyeballing). **≥4× collapse.** |
| #3 Wall-clock + tokens flat per spec | ✅ **LANDED EXACTLY** | 77 s/spec wall-clock, identical to v0.0.7. ~4,200 raw tokens/spec. The bottleneck genuinely is agent compute; orchestration collapse doesn't move that needle (correctly predicted). |
| #4 Wide-blast-radius timeout | ❌ **Did NOT land** | None of the 5 specs hit the 600s timeout. `/scope-project`'s implicit decomposition discipline (5 narrow specs vs 1 wide one) prevented it. The v0.0.8 self-build's timeout finding is real but only fires when a spec is hand-authored to span 10+ files (the version-bump-coordination spec, e.g.) — not when `/scope-project` produced it. |
| #5 DoD-precision persists | ✅ **LANDED in NEW shape** | Surfaced concretely as "scaffold scripts are empty; DoD claims are aspirational." More actionable than v0.0.7's vague "review fires after authoring" — this is a specific scaffold gap that pairs with the v0.0.6 BASELINE's DoD-verifier finding. |

**Surprises:**

- **`/scope-project` produced a strictly better decomposition than the hand-authored prompt ever did.** v0.0.5–v0.0.7 always produced a 4-spec linear chain (`core → redirect → tracking → stats`). `/scope-project` produced a 5-spec diamond: two pure stores at the base (`url-store` + `click-store` separated by SRP), three HTTP endpoints stacked (`shorten-endpoint`, `redirect-endpoint` joining both stores, `stats-endpoint`). The agent's decomposition is cleaner architecture — separation of concerns, deeper depends-on graph, smaller per-spec blast radius. **This is the kind of unlock that justifies `/scope-project`'s existence.**
- **The runtime's friction list FINALLY shrunk.** Every prior baseline produced essentially the same friction list (manual decomp + sequence orchestration + DoD gap). v0.0.8 is the first where the headline frictions are GONE. New frictions surfaced (status-aware `run-sequence`, scaffold scripts, reviewer-vs-scoper tension) — but they're at a higher level of abstraction than the prior list, which is the right kind of progress.
- **Per-spec agent compute is invariant.** 77 s/spec across v0.0.7 and v0.0.8 — exact match despite different specs. The implementation guidelines prefix from v0.0.5 + the prompt-cache invariant continues to hold. v0.0.9+ work that touches the agent prompt should preserve this baseline carefully.
- **Two of the three new frictions had already been predicted as v0.0.9 BACKLOG entries** (status-aware run-sequence + scaffold scripts gap). Independent confirmation = strong signal. The third (reviewer-vs-scoper tension) is genuinely new and worth its own BACKLOG entry.

**Mapped BACKLOG entries:**
- Friction #1 (status-aware run-sequence) → existing v0.0.9 entry "Per-spec agent-timeout override + run-sequence skips drafting" (two-finding cluster). Now confirmed twice; promote priority.
- Friction #2 (scaffold scripts vs DoD) → NEW v0.0.9 entry needed: scaffold ships `scripts: { typecheck, test, check }`. Pairs with the long-deferred DoD-verifier work.
- Friction #3 (reviewer-vs-scoper shared-constraints tension) → NEW v0.0.9 entry needed: `internal-consistency` judge gains `depends-on`-awareness.

**Would you want to use the factory for the next product?** Per the agent: 5 specs converged, 16 tests pass, all 7 curl calls behave per spec. Yes — and for the first time, the friction is at a higher level than "manual decomposition." Net signal: **v0.0.8 is the first release where the factory genuinely got better at building real things, measured empirically.**

##### v0.0.9 — shipped 2026-05-03 (status-aware sequence-runner exposed deeper workflow friction)

The "close v0.0.8 BASELINE friction list" cluster shipped (per-spec `agent-timeout-ms` + `spec/wide-blast-radius` lint + status-aware `run-sequence` + scaffold scripts + `internal-consistency` dep-awareness). Run executed in `~/dev/url-shortener-v0.0.9/` against the published 0.0.9 packages.

**Predictions (locked before the run):**

1. `run-sequence` respects `status: drafting`.
2. Reviewer false-positive on shared constraints disappears.
3. Scaffold's DoD claims are runnable (`pnpm typecheck`, `pnpm check`).
4. Wall-clock + tokens flat per spec (~77s, ~4.2k tokens).
5. NEW friction may surface: `spec/wide-blast-radius` warning fires.
6. Maintainer interventions ≤ 3-4.

**Actuals:**

| Spec | Iterations on first appearance | Notes |
|---|---|---|
| (4 specs from `/scope-project` decomposition) | 1 each | every spec converged first try |
| **Total productive iterations** | **4** | one per spec, no retries |
| **Total implement-report records** | **10** | 4 productive + **6 no-op re-runs of already-shipped specs** |
| **Total wall-clock** | **611s (~10m 11s)** | inflated by re-runs |
| **Total tokens** | **30,904 raw** | +48% vs v0.0.8 (5,150 → 7,725 per total spawn = ~3k/spawn — re-runs are cheap individually but cumulative) |
| **Tests** | **15 pass** | (v0.0.8 was 16) |
| **Commits** | **7** | scaffold + journal + scope + 4 spec ships |

| Metric | v0.0.5 | v0.0.6 | v0.0.7 | v0.0.8 | v0.0.9 |
|---|---|---|---|---|---|
| Specs shipped | 4 | 4 | 4 | 5 | 4 |
| Wall-clock | 7m 3s | 4m 26s | 5m 9s | 6m 26s | **10m 11s** ↑ |
| Wall-clock per PRODUCTIVE spec | 106s | 67s | 77s | 77s | **~61s** ✓ |
| Wall-clock per IMPLEMENT spawn | — | — | — | — | **~61s** ✓ |
| Raw tokens | 22,703 | — | 17,009 | 20,900 | 30,904 |
| Tokens per implement spawn | — | — | — | ~5,200 | ~3,090 |

**The wall-clock regression is entirely from no-op re-runs of already-shipped specs**, not from per-spec compute slowing down. Per-implement-spawn cost is FASTER than v0.0.8 (~61s vs ~77s); the 6 extra spawns are pure overhead.

**Top 3 friction points (per agent's JOURNAL):**

1. **Moving specs to `docs/specs/done/` breaks `depends-on` resolution.** The runtime doesn't walk into `done/` when validating depends-on edges (per v0.0.7's locked behavior — "run-sequence does NOT recurse into `<dir>/done/`"). The maintainer's natural workflow (ship spec → `git mv` to done → ship next) hits `runtime/sequence-dep-not-found` because the dep is no longer in `docs/specs/`. Two existing locked decisions collide: (a) shipped specs move to `done/` per the per-spec lifecycle convention; (b) `run-sequence` only reads `<dir>/*.md`. **NEW v0.0.10 BACKLOG entry needed.**
2. **`run-sequence` re-runs every already-shipped spec on each invocation.** Status-aware filtering (v0.0.9) skips drafting specs, but a spec that ALREADY shipped stays at `status: ready` — there's no "shipped" status. Each subsequent `run-sequence` invocation walks the full ready set, spawning a no-op implement phase per shipped spec. Cost grows N² across a multi-pass workflow (4 specs shipped one-at-a-time → 1+2+3+4 = 10 implement spawns). The agent observed: "every walk re-runs every shipped spec." **NEW v0.0.10 BACKLOG entry needed.**
3. **CLI fragmentation between `factory-context` and `factory-runtime`.** Different flag names for the same concept (e.g., `--dir` vs `--context-dir`); can't pass shared values via a single flag. The agent had to reason about TWO toolchains' UX surfaces when walking the run's provenance. Pre-existing technical debt; surfaced because the agent reached for `factory-context` more in v0.0.9's workflow than prior runs. **NEW v0.0.10 BACKLOG entry needed.**

**Predicted-vs-actual scoring:**

| Prediction | Outcome | Notes |
|---|---|---|
| #1 status: drafting filter works | ✅ Landed BUT exposed deeper friction | The drafting filter does what was specified. The friction shifted to "shipped-but-still-ready specs re-run." Status-aware sequence-runner is half the fix; "shipped-aware" is the missing other half. |
| #2 internal-consistency false positive disappears | ❓ Not validated by this run | The agent didn't re-run `factory spec review` on the multi-spec product mid-flow per JOURNAL. Inconclusive at BASELINE level; the unit test in `internal-consistency.test.ts` confirms the fix at code level. |
| #3 scaffold scripts runnable | ✅ Landed | Typecheck green; agent didn't flag any DoD-vs-scaffold mismatch. The reviewer's `dod-precision` judge no longer fires the false-aspirational warning. |
| #4 wall-clock + tokens flat per spec | ✅ **At per-implement-spawn level** | Per-implement-spawn cost dropped from ~77s/spawn (v0.0.8) to ~61s/spawn (v0.0.9). The TOTAL inflation is from spawn-count growth (10 vs 5), NOT per-spawn slowdown. v0.0.5's prompt-cache invariant continues to hold at the spawn level. |
| #5 spec/wide-blast-radius may fire | ❓ Not validated | Not mentioned in the agent's report. Either `/scope-project`'s decomposition stayed under the threshold (the URL-shortener decomposition typically produces 4-7 path-references per spec) or the agent didn't surface the warning. Inconclusive. |
| #6 maintainer interventions ≤ 3-4 | ❌ Higher than predicted | 7 commits + multiple run-sequence invocations + the move-to-done friction. The "ship one at a time" workflow + the re-run + the dep-resolution break inflated the count. **The PROMPT'S workflow may be over-prescribing per-spec ceremony given v0.0.9's primitives.** |

**Surprises:**

- **Status-awareness wasn't enough — "shipped-awareness" is the next layer.** v0.0.9 added "skip drafting specs"; the friction the BASELINE surfaced is "skip already-converged specs." The runtime persists `factory-run` records for every converged spec; the sequence-runner could query these to detect "spec X already has a converged factory-run rooted at the current factory-sequence's specsDir hash" and skip re-running. The data is there; the wiring isn't.
- **The new prompt's per-spec move-to-done step is workflow friction, not factory friction.** The prompt (post-v0.0.8 reset) still includes "move shipped spec to `docs/specs/done/` with `git mv` before moving on" — leftover from the v0.0.5–v0.0.7 manual-decomposition era. With `run-sequence` driving the cluster, per-spec move-to-done is a pessimization (it BREAKS depends-on resolution mid-flow). The prompt should be edited (small, not a full reset): defer the move-to-done step to AFTER the entire cluster ships.
- **Per-implement-spawn cost dropped 20%.** From ~77s in v0.0.7/v0.0.8 to ~61s in v0.0.9. Possibly noise; possibly the prompt-cache prefix invariant compounding with the smaller dep-context loaded by the dep-aware judges. Worth confirming on v0.0.10's run.

**Mapped BACKLOG entries:**
- Friction #1 (move-to-done breaks depends-on) → NEW v0.0.10 entry: either (a) `run-sequence` walks `<dir>/done/` for depends-on resolution (not execution); or (b) defer move-to-done to cluster-end in the canonical prompt + remove the per-spec move-to-done step from the workflow guidance.
- Friction #2 (re-run cost N²) → NEW v0.0.10 entry: `run-sequence` queries `factory-run` records to detect already-converged specs; skips with a one-line log; new `factory-runtime/already-converged` status (or extend `'skipped'` with a new `blockedBy: 'already-converged'` shape).
- Friction #3 (CLI fragmentation) → NEW v0.0.10 entry: harmonize `--context-dir` flag name across all CLIs; deprecation period for `--dir` on `factory-context`.

**Would you want to use the factory for the next product?** Per the agent: "yes — after fixes 1 and 2 above." Verdict: the workflow IS smoother than v0.0.8 (drafting filter works; reviewer false-positive gone) but the next layer of friction is now visible. v0.0.10 should close it; v0.0.10's BASELINE will tell us whether the curve is still trending right.

##### v0.0.10 — shipped 2026-05-03 (trust contract held; friction is polish not foundational)

The "trust contract + spec-quality teeth + workflow polish" cluster shipped (`dodPhase` runtime phase, 3 new reviewer judges, run-sequence already-converged dedup + done/ dep resolution, `factory spec watch` + PostToolUse hook recipe, `spec/wide-blast-radius` calibration to 12 + NOQA directive). Run executed in `~/dev/url-shortener-v0.0.10/` against the published 0.0.10 packages.

**Predictions (locked before the run):**

1. DoD-verifier fires on every iteration.
2. First baseline where some specs may require iter 2+ (DoD failures).
3. Per-iteration wall-clock +10-30 seconds from Bash subprocess overhead.
4. 3 new reviewer judges may surface findings on canonical specs.
5. Already-converged dedup eliminates v0.0.9 BASELINE's N² re-run pattern.
6. `<dir>/done/` dep resolution works.
7. Token totals may drop or rise (hard to predict).

**Actuals:**

| Spec | Iterations | Wall-clock | Tokens (input+output) |
|---|---|---|---|
| core-utilities | 1 | 81.1s | 4,504 |
| shorten-endpoint | 1 | 105.4s | 5,863 |
| redirect-and-tracking | 1 | 70.8s | 3,976 |
| stats-endpoint | 1 | 54.8s | 3,079 |
| **Total (4 specs)** | **4** | **5m 12s (312s)** | **17,422** |

| Metric | v0.0.5 | v0.0.6 | v0.0.7 | v0.0.8 | v0.0.9 | v0.0.10 |
|---|---|---|---|---|---|---|
| Specs shipped | 4 (linear) | 4 (linear) | 4 (linear) | 5 (diamond) | 4 (diamond) | **4 (linear)** |
| Wall-clock | 7m 3s | 4m 26s | 5m 9s | 6m 26s | 6m 26s | **5m 12s** |
| Wall-clock per spec | 106 s | 67 s | 77 s | 77 s | 77 s | **78 s** ✓ |
| Raw tokens | 22,703 | — | 17,009 | 20,900 | 17,009 | **17,422** |
| Tokens per spec | — | — | ~4,250 | ~4,180 | ~4,180 | **~4,355** ✓ |
| Tests | 14 | 16 | 19 | 16 | 16 | **16** |
| Iterations / spec | 1 each | 1 each | 1 each | 1 each | 1 each | **1 each** ✓ |
| Maintainer interventions | ~32 | 32 | 32 | ~3-8 | ~3-8 | **7** (4 invocations + 3 status flips) |

**End-to-end smoke:** all `curl` calls in the cookbook behave per spec.

**Top 3 friction points (per agent's JOURNAL):**

1. **`run-sequence` doesn't walk the DAG dynamically.** It skips `status: drafting` specs instead of promoting direct dependents on convergence. 4 specs = 4 manual invocations + 3 manual `drafting → ready` status flips. The maintainer is the DAG walker. v0.0.9 added status-awareness; v0.0.10 added already-converged dedup; v0.0.11 needs **dynamic dependent promotion** — when spec X converges, run-sequence in-memory promotes any direct dependent whose deps are all converged AND continues walking, all in one invocation. **NEW v0.0.11 BACKLOG entry needed (lead candidate).**
2. **`tokens.total` includes cache reads but budgets exclude them — same field, two meanings.** The Anthropic SDK's `tokens.total` includes cache reads + cache creates + input + output. The runtime's `--max-total-tokens` budget enforcement uses `input + output` only (cache is free, by Anthropic's pricing). Reports surface `tokens.total` which makes runs LOOK like they blew a 1M budget when they didn't. **NEW v0.0.11 BACKLOG entry needed:** rename or split — add a `tokens.charged: input + output` field; rename `tokens.total` to `tokens.totalInclCache` for clarity OR drop the SDK's `total` and compute the budget-relevant value ourselves.
3. **`review/dod-precision` judge fires on color-word DoD bullets ("green", "clean").** The canonical prompt itself uses "tests pass green / lint clean" — idiomatic shorthand. The judge flags these as imprecise ("what does 'green' mean?"). Stylistic nit masquerading as correctness check. **NEW v0.0.11 BACKLOG entry needed:** tighten the `dod-precision` CRITERION to recognize "green / clean" as canonical idioms when paired with a command name (`tests pass green`, `lint clean`). ~20 LOC + judge prompt edit.

**Predicted-vs-actual scoring:**

| Prediction | Outcome | Notes |
|---|---|---|
| #1 DoD-verifier fires every iteration | ✅ Landed | Shell gates ran each iter; no spec needed iter 2 because the agent wrote code that passed typecheck/test/check first-try. |
| #2 First baseline with iter 2+ | ❌ Did NOT land | **5 consecutive baselines now with 1-iter convergence per spec.** The DoD-verifier did its job by NOT firing failures — the agent's code was already correct. The streak holds. |
| #3 Per-iteration wall-clock +10-30s | ❌ Did NOT land | Per-spec wall-clock essentially flat at 78s (vs 77s in v0.0.7-9). DoD shell gates are fast (~3-5s for typecheck + test + check on a small project); LLM calls dominate. |
| #4 3 new reviewer judges may surface findings | ⚠️ Partially landed | `review/dod-precision` fired on color-word bullets (false positive — captured as friction #3). `api-surface-drift` and `feasibility` didn't fire on canonical specs. `scope-creep` not exercised. Net: the new judges are too loose (dod-precision) or didn't get exercised (api-surface, feasibility, scope-creep). |
| #5 Already-converged dedup kills N² re-runs | ✅ Landed | The maintainer made 4 invocations (one per spec), but each invocation ran exactly ONE spec — the newly-promoted one. Zero wasted re-runs. **The friction shifted UP one layer to "why am I making 4 invocations instead of 1?" — the dynamic-DAG-walk gap.** |
| #6 Move-to-done resolution works | ❓ Not exercised | Agent didn't move specs to `done/` mid-cluster (kept all 4 in `docs/specs/`). The fix shipped; no failure mode encountered. |
| #7 Token totals may drop or rise | ✅ Dropped | 17,422 raw vs v0.0.9's 20,900 → -17% (mostly from 4 specs vs 5). Per-spec flat at ~4,355 — invariant holds. |

**Surprises (the high-value entries):**

- **Per-spec compute invariant has held across 5 baselines.** v0.0.7 / v0.0.8 / v0.0.9 / v0.0.10 all clock 77-78s/spec wall-clock + ~4,200-4,400 tokens. The v0.0.5 prompt-cache + implementation-guidelines prefix continues to earn its keep across every release that's touched the agent prompt. **Anything that breaks this baseline should be flagged as a regression in code review.**
- **DoD-verifier added ZERO per-spec cost.** Predicted +10-30s per iteration; actual flat. Bash subprocess overhead for `pnpm typecheck && pnpm test && pnpm check` on a small project is 3-5s — orders of magnitude less than the LLM call cost.
- **The friction shifted from "runtime does too much" to "runtime doesn't do enough yet."** v0.0.9 friction was "run-sequence ignores status; runs converged specs wastefully." v0.0.10 fixed both. v0.0.10 friction is "the maintainer is still the DAG walker; runtime should walk dependents automatically." Each release surfaces friction one abstraction layer higher than the prior release. **That's the curve trending right.**
- **3 of the 5 status-flips would have been zero invocations** if `run-sequence` had walked the DAG dynamically. 4 invocations → 1 invocation. That's the v0.0.11 prize.
- **Verdict crossed a threshold.** The agent wrote: *"would use the factory for the next product. ... Remaining friction is runtime/judge polish, not the scoping or implementing loop itself."* This is the first BASELINE where the friction is universally polish-tier, not foundational-tier. The factory is mature enough to be RECOMMENDED for the next product without major caveats.

**Mapped BACKLOG entries:**
- Friction #1 (dynamic DAG walk) → NEW v0.0.11 entry — this is the lead candidate; closes the 4×-invocations pattern.
- Friction #2 (tokens.total semantics) → NEW v0.0.11 entry — telemetry/UX cleanup.
- Friction #3 (dod-precision color-word false positive) → NEW v0.0.11 entry — judge calibration.

**Would you want to use the factory for the next product?** Per the agent: *"yes — would use the factory for the next product. First-iteration convergence on every spec with locked shared decisions surviving four independent implementer invocations is a real win — `/scope-project` did its job."* Net signal: **v0.0.10 is the first release where the factory is recommended without caveats** — first-iter convergence on every spec, DoD gates working as designed, /scope-project's decomposition surviving multi-spec consistency, friction shifted to polish tier.

##### v0.0.11 — shipped 2026-05-04 (worktree-sandbox + dynamic DAG walk landed; first 1-invocation 4-spec ship)

The "trust → isolation + trust-layer calibration" cluster shipped (worktree sandbox, holdout-aware convergence, dod-precision calibration, charged-token budget surfacing, **dynamic DAG walk** for run-sequence, CI publish hardening). Run executed in `~/dev/url-shortener-v0.0.11/` against the published 0.0.11 packages.

**Predictions (locked before the run):**

1. Dynamic DAG walk collapses 4 invocations → 1.
2. Charged-token surfacing makes the budget number meaningful again.
3. dod-precision calibration eliminates the "green/clean" false-positives.
4. First baseline where some spec needs iter 2+ (the streak ends eventually).

**Actuals:**

| Spec | Iterations | Wall-clock | Tokens (charged) |
|---|---|---|---|
| core-store-and-slug | **2** | 173.1s | 8,521 |
| shorten-endpoint | 1 | 87.6s | 4,741 |
| redirect-with-click-tracking | 1 | 68.9s | 4,387 |
| stats-endpoint | 1 | 60.9s | 3,489 |
| **Total (4 specs)** | **5** | **6m 32s (392.4s)** | **21,138** |

| Metric | v0.0.7 | v0.0.8 | v0.0.9 | v0.0.10 | v0.0.11 |
|---|---|---|---|---|---|
| Specs shipped | 4 (linear) | 5 (diamond) | 4 (diamond) | 4 (linear) | **4 (linear)** |
| Wall-clock | 5m 9s | 6m 26s | 6m 26s | 5m 12s | **6m 32s** |
| Wall-clock per spec | 77 s | 77 s | 77 s | 78 s | **98 s** |
| Charged tokens | 17,009 | 20,900 | 17,009 | 17,422 | **21,138** |
| Tokens per spec | ~4,250 | ~4,180 | ~4,180 | ~4,355 | **~5,285** |
| Iterations / spec | 1 each | 1 each | 1 each | 1 each | **1 each (3) + 2 (1)** |
| Maintainer interventions | 32 | ~3-8 | ~3-8 | 7 | **1 invocation** ✓ |

**End-to-end smoke:** all `curl` calls in the cookbook behave per spec.

**Top 3 friction points (per agent's JOURNAL — ranked by annoyance):**

1. **`run-sequence` is silent about *why* a spec re-iterated.** `core-store-and-slug` needed iter 2; the only way to find out what failed in iter 1 was to read both implement-report payloads (~10KB each) and diff them against the working tree. ~5 min of manual archaeology to answer a one-line question. **NEW v0.0.12 BACKLOG entry — highest impact.**
2. **The runtime ships product code without the production entrypoint.** `shorten-endpoint`'s Constraints specified `index.ts` (or `src/main.ts`) calls `createServer({ port: 3000 })`, but no spec emitted a `test:` line forcing its existence — implement shipped library-only code and `bun src/main.ts` 404'd. Dogfooder hand-wrote 4 lines to make the curl cookbook runnable. **NEW v0.0.12 BACKLOG entry.**
3. **`factory-implement-report.filesChanged` reports 0 despite obvious edits.** Two of four iterations reported `filesChanged: 0` despite both `src/server.ts` and `src/store.ts` getting patched (verified by `git log --stat`). Different shape from v0.0.6's new-file false-negative — this fails on edits to *existing* files. **NEW v0.0.12 BACKLOG entry — correctness bug.**

**Predicted-vs-actual scoring:**

| Prediction | Outcome | Notes |
|---|---|---|
| #1 Dynamic DAG walk → 1 invocation | ✅ Landed | 4 specs shipped in one `run-sequence` invocation; auto-promotion of `drafting → ready` worked invisibly. |
| #2 Charged-token surfacing meaningful | ✅ Landed | `tokens.charged` is now the budget-relevant number; `tokens.total` (cache-aware) preserved as deprecated alias. |
| #3 dod-precision calibration eliminates green/clean false positives | ✅ Landed | Reviewer no longer fires on canonical idioms paired with a command. |
| #4 First baseline with iter 2+ | ✅ Landed | `core-store-and-slug` needed iter 2 — first time across 6 baselines. **The streak ended at 5.** |

**Surprises (the high-value entries):**

- **The 6-baseline streak of 1-iter-per-spec convergence broke.** `core-store-and-slug` hit iter 2. Apparent because the friction immediately shifted from "did it converge?" to "*why* did it re-iterate?" — exactly the friction-shifts-up pattern v0.0.10 anticipated. Friction #1 above is the direct consequence.
- **Per-spec wall-clock crept up from 78s → 98s.** Mostly from the iter-2 spec dragging the average; the 3 single-iter specs averaged 72s, in line with the v0.0.7-v0.0.10 invariant.
- **`/scope-project` + dynamic DAG walk together earned the v0.0.11 lineage.** The agent's verdict — *"yes — would use the factory for the next product. /scope-project + run-sequence removed the two most-tedious chores; 4 specs shipped in ~6.5min with one human-readable command"* — confirms the v0.0.10 maturity-threshold holds AND the workflow tightened further: 7 maintainer interventions → 1.
- **The `filesChanged` correctness bug is a real regression** of trust on a v0.0.6-fixed area. Different shape from the v0.0.6 fix (which addressed new-file-only runs); this one fails on edits to *existing* files. Telemetry-first response (capture pre/post snapshots in factory-implement-report) shipped in v0.0.12.

**Mapped BACKLOG entries:**
- Friction #1 (cause-of-iteration) → NEW v0.0.12 entry — closed via `factory-runtime-v0-0-12-observability`.
- Friction #2 (production entrypoint missing) → NEW v0.0.12 entry — closed via `scope-project-v0-0-12-smoke-boot`.
- Friction #3 (filesChanged undercount) → NEW v0.0.12 entry — telemetry capture closed via `factory-runtime-v0-0-12-correctness`; algorithm replacement deferred to v0.0.13 once captured snapshots reveal the root cause.

**Would you want to use the factory for the next product?** Per the agent: *"Yes. /scope-project + run-sequence removed the two most-tedious chores (decomposition copy-paste and per-spec status flipping); 4 specs shipped in ~6.5min with one human-readable command. The friction items are real but small — none broke the workflow, they just left small gaps I filled by hand."* Net signal: **v0.0.11 is the first release that ships an entire 4-spec product in one CLI invocation.** The friction has shifted entirely to observability + edge cases.

##### v0.0.12 — shipped 2026-05-06 (4/4 specs first-iter; init-script + observability friction shapes for v0.0.13)

The "validate-phase reliability + brownfield onramp + observability + DoD trust" cluster shipped (harness quote normalization + `spec/test-name-quote-chars` lint, runtime live progress + cause-of-iteration + monotonic-DoD-pass detection + `--quiet`, runtime dedup status verify + filesChanged debug telemetry + agent stderrTail capture, literal DoD shell commands + `spec/dod-needs-explicit-command` lint, `factory init --adopt` + `factory finish-task` + `factory-spec-review` hard dep, smoke-boot scenarios in `/scope-project`). Run executed in `~/dev/url-shortener-v0.0.12/` against the published 0.0.12 packages.

**Predictions (locked before the run):**

1. The 1-iter convergence streak resumes (v0.0.11's iter-2 was caused by validate-phase friction the v0.0.12 cluster addressed at the source).
2. The new live progress + cause-of-iteration line shows up in the captured log.
3. `factory finish-task` works end-to-end for the move-to-done step.
4. The `spec/dod-needs-explicit-command` lint catches DoD bullets the agent might author imprecisely.

**Actuals:**

| Spec | Iterations | Wall-clock | Tokens (charged) |
|---|---|---|---|
| shorten-endpoint | 1 | 168s | 8,594 |
| redirect-endpoint | 1 | 70s | 3,368 |
| click-tracking | 1 | 145s | 8,388 |
| stats-endpoint | 1 | 74s | 4,378 |
| **Total (4 specs)** | **4** | **7m 35s (455.4s)** | **24,728** |

| Metric | v0.0.7 | v0.0.8 | v0.0.9 | v0.0.10 | v0.0.11 | v0.0.12 |
|---|---|---|---|---|---|---|
| Specs shipped | 4 | 5 | 4 | 4 | 4 | **4 (linear)** |
| Wall-clock | 5m 9s | 6m 26s | 6m 26s | 5m 12s | 6m 32s | **7m 35s** |
| Wall-clock per spec | 77 s | 77 s | 77 s | 78 s | 98 s | **114 s** |
| Charged tokens | 17,009 | 20,900 | 17,009 | 17,422 | 21,138 | **24,728** |
| Tokens per spec | ~4,250 | ~4,180 | ~4,180 | ~4,355 | ~5,285 | **~6,182** |
| Iterations / spec | 1 each | 1 each | 1 each | 1 each | 1 each (3) + 2 (1) | **1 each** ✓ |
| Maintainer interventions | 32 | ~3-8 | ~3-8 | 7 | 1 invocation | **1 invocation** ✓ |

**End-to-end smoke:** all `curl` calls in the cookbook behave per spec.

**Top 3 friction points (per agent's JOURNAL):**

1. **`factory init` ships a `biome.json` incompatible with the bundled Biome version.** Scaffold writes `"include"` (Biome 1.x); `package.json` pins `^2.4.4` which resolves to 2.4.14, where the key is `"includes"`. Every greenfield run has to hand-patch this to make `pnpm check` green and satisfy the DoD lint gate. **NEW v0.0.13 BACKLOG entry — highest impact (every adopter pays the tax).**
2. **`spec/dod-needs-explicit-command` warns on natural-language DoD lines.** "typecheck + lint + tests green" is what every author writes; the linter wants `(\`pnpm typecheck\`)`, `(\`pnpm check\`)`, `(\`bun test src\`)`. Both `factory init` and `/scope-project` know which scripts exist in `package.json` — they could emit the project-default DoD block automatically. Fresh users re-discover the same warning four times per cluster. **NEW v0.0.13 BACKLOG entry — ergonomics fix to the v0.0.12 lint we just shipped.**
3. **`.factory/` is not pre-created by `factory init`.** Runtime creates it on first use, but anything that writes there before runtime starts (e.g., `tee .factory/run-sequence.log`) fails at startup. **NEW v0.0.13 BACKLOG entry — `~10 LOC fix.**

**Honorable mentions** (per agent): `factory finish-task --all-converged` for batch ship-cycle move-to-done; default `--quiet` for non-TTY stdout (the per-iteration `[runtime]` lines pollute captured logs). Both → NEW v0.0.13 BACKLOG entries.

**Predicted-vs-actual scoring:**

| Prediction | Outcome | Notes |
|---|---|---|
| #1 1-iter convergence streak resumes | ✅ Landed | 4/4 first-iter convergence — the streak resets at v0.0.12. The v0.0.11 iter-2 was caused by missing run-sequence observability + a transient stale-dist; both addressed. |
| #2 Live progress in captured log | ✅ Landed (with friction) | The `[runtime]` lines show up in the captured log AND pollute it (friction honorable mention #2). The default needs an auto-quiet for non-TTY. |
| #3 `factory finish-task` works end-to-end | ✅ Landed | Per-spec move worked; batch mode wanted (honorable mention #1). |
| #4 dod-needs-explicit-command catches imprecise DoD | ⚠️ Partially landed | Catches them, but as friction #2 above — the lint fires too readily on natural-language DoD lines without offering an alternative. |

**Surprises (the high-value entries):**

- **First baseline where ALL friction is `factory init`-shaped.** The 3 ranked friction items + 2 honorable mentions are all init-script / CLI-default ergonomics. Zero runtime/judge friction. The factory's runtime + judge layers have stabilized; iteration is now on the bootstrap surface.
- **Per-spec wall-clock crept again to 114s.** This is the second consecutive baseline where the per-spec invariant (~77-78s through v0.0.10) is no longer holding. Possibly attributable to: (a) the live-progress instrumentation adding minor overhead, (b) larger spec bodies due to the literal-DoD-command requirement, or (c) prompt-cache invalidation from v0.0.12's prompt edits. Worth investigating before the trend solidifies — flag for v0.0.13 surveillance.
- **The `dod-needs-explicit-command` lint we just shipped became its own friction point on the very next baseline.** Classic case of "shipped the catch, didn't ship the fix." The ergonomics complement (auto-emit a default DoD block from `factory.config.json` script names) is the natural v0.0.13 follow-up.
- **Verdict held — agent recommended unconditionally.** Per the agent: *"Yes — status-aware run-sequence plus the shared-Constraints discipline of /scope-project turned a 4-feature backend into one approve-and-watch command, and the few friction points (biome scaffold mismatch, DoD-line linter, missing .factory/) are all init-script-shaped fixes that should be easy wins for v0.0.13."* This is the second consecutive baseline (v0.0.11, v0.0.12) where the verdict is "yes, would use again, friction is small."

**Mapped BACKLOG entries:**
- Friction #1 (biome.json scaffold mismatch) → NEW v0.0.13 entry — highest leverage.
- Friction #2 (dod-needs-explicit-command ergonomics) → NEW v0.0.13 entry — auto-emit DoD template from `package.json` scripts.
- Friction #3 (`.factory/` not pre-created) → NEW v0.0.13 entry — small init-template addition.
- Honorable mention #1 (`factory finish-task --all-converged`) → NEW v0.0.13 entry — batch CLI ergonomics.
- Honorable mention #2 (default `--quiet` for non-TTY) → NEW v0.0.13 entry — progress-output discipline.

**Would you want to use the factory for the next product?** Per the agent: *"Yes — status-aware run-sequence plus the shared-Constraints discipline of /scope-project turned a 4-feature backend into one approve-and-watch command."* Net signal: **v0.0.12's friction is purely init-script-shaped polish; the runtime+judge+sequence-runner triad is mature.**

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

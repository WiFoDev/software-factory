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

##### v0.0.6 — pending (shipped 2026-05-02, BASELINE not yet re-run)

The v0.0.5.x cluster. Did NOT add `/scope-project` (the originally-planned v0.0.6 theme moved to v0.0.7). Instead shipped the four BACKLOG-tracked v0.0.5 follow-ups: harness backtick stripping, `factory init` first-contact UX, `filesChanged` audit reliability, configurable per-phase agent timeout.

**Predicted improvements when re-running the URL-shortener prompt against v0.0.6:**

- **Friction #2 from v0.0.5 entry (`factory init` first-contact gaps) → should disappear.** The fresh `factory init` now ships with `@wifo/factory-spec-review` already in deps, `.factory-spec-review-cache` gitignored, and `factory.config.json` writing canonical defaults so the user types fewer flags.
- **Friction #3 from v0.0.5 entry (`filesChanged` unreliable) → should disappear.** New-file-only runs now report new files; pre-dirty paths are filtered out.
- **The harness backtick-quoted-path bug → should disappear.** Spec authors can write either form; the harness handles both.
- **Predictions #3 + #4 from v0.0.5 (context-dir reuse oddness, status flipping) → still survive.** Those need v0.0.7's `/scope-project` + sequence-runner.

The v0.0.6 baseline will run when convenient — no specific date. If the v0.0.5.x cluster genuinely removed friction, friction #2 + #3 should be absent from the v0.0.6 row.

##### v0.0.7 — pending

After `/scope-project` + `depends-on` ship. Same prompt, fresh `~/dev/url-shortener-v0.0.7/`. Predicted improvements: friction #1 from v0.0.5 (manual decomposition + dependency invisibility) should largely disappear. Friction #4 (status flipping) should also shrink if `/scope-project` writes the first spec as `ready` and stages the rest. Sequence-runner gap (originally prediction #3) survives until v0.0.8.

##### v0.0.8 — pending

After spec-sequence runner ships. The context-dir reuse oddness becomes invisible — one CLI invocation walks all 4 specs and produces one DAG. Per-spec status flipping also goes away if the sequence-runner ships with status-aware iteration.

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

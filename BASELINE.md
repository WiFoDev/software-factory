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

##### v0.0.5 — pending

The first baseline. The maintainer manually decomposes into 4 specs and runs them in sequence. `/scope-project` does not yet exist; `depends-on` is not yet a frontmatter field; `factory-runtime run-sequence` does not yet exist.

**Predictions (locked in before the run):**

1. **The decomposition step itself.** Picking the 4 spec boundaries was easy in the conversation that produced this prompt; for a different product it wouldn't be. `/scope-project` directly addresses this.
2. **Cross-spec dependency invisibility.** Spec 3 (tracking) needs to know what spec 2 (redirect) actually exported. Today: agent reads the existing code. With `depends-on`: the reviewer's `cross-doc-consistency` judge would catch dependency drift before the run.
3. **Context-dir reuse oddness.** With `--context-dir ./.factory` shared across all 4 runs, `tree --direction down <runId>` walks ONE run; the four runs are siblings under no common parent. Sequence-runner would create a parent record so all four runs hang under one product.
4. **Status flipping tax.** Manually flipping `status: drafting` → `status: ready` between specs is small but real friction.
5. **Possibly the harness backtick gotcha.** The prompt warns about it explicitly, but if Claude slips, a spec will appear to "fail" until spotted.

**Actuals (filled in after the run):**

| Spec | Iterations | Wall-clock | Tokens (in+out) | Notes |
|---|---|---|---|---|
| url-shortener-core | _ | _ | _ | _ |
| url-shortener-redirect | _ | _ | _ | _ |
| url-shortener-tracking | _ | _ | _ | _ |
| url-shortener-stats | _ | _ | _ | _ |
| **Total** | _ | _ | _ | — |

**Top friction points (ranked, post-run):**

1. _(fill in)_
2. _(fill in)_
3. _(fill in)_

**Mapped BACKLOG entries:** _(which BACKLOG items would have removed each friction point above? cross-reference by name)_

**Surprises (not in the prediction list):** _(fill in — these are the highest-value entries; they expose blind spots about where the friction actually lives)_

**Final answer to "would you want to use the factory for the next product?"** _(fill in — one sentence)_

##### v0.0.6 — pending

After `/scope-project` + `depends-on` ship. Same prompt, fresh `~/dev/url-shortener-v0.0.6/`. Predicted improvements: predictions #1, #2, #4 from the v0.0.5 entry should largely disappear or shrink. Predictions #3 and #5 should survive (they're v0.0.7 territory). New predictions land here when v0.0.6 is closer.

##### v0.0.7 — pending

After spec-sequence runner ships. Predicted improvements: prediction #3 (context-dir reuse oddness) becomes invisible — one CLI invocation walks all 4 specs and produces one DAG. Per-spec status flipping (#4) also goes away if the sequence-runner ships with status-aware iteration.

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

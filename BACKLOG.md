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

## Real-product workflow — close the project-scale gap

The factory's sweet spot today (verified by slugify, gh-stars-{v1,v2}, parse-size, and the v0.0.5 self-build moneyball) is **one feature per spec**. The natural next step is a real product — "build a URL shortener with stats dashboard." That's not one spec, it's a sequence of 4-6 specs in dependency order: `core` → `redirect` → `tracking` → `stats` → `dashboard`.

Today the maintainer drives the sequence by hand (write 4 specs, ship one at a time, manually thread "spec 2 depends on spec 1's exports"). It works for 1-2 specs, gets friction-y at 4+. Three primitives close the gap, ordered cheapest-first:

### `/scope-project` slash command

**What:** A new `~/.claude/commands/scope-project.md` slash command that takes a natural-language project description ("A URL shortener with a stats dashboard, JSON-over-HTTP, SQLite for storage") and writes N specs in dependency order under `docs/specs/`. The first spec is `status: ready`; the rest are `status: drafting` until the first ships and the maintainer flips the next one. Mirrors `/scope-task`'s skeleton + DEEP/LIGHT classification but operates a level up.

**Why:** The single biggest UX win for "open Claude Code, build a real product." Without it, the maintainer is the decomposition step — they read the product description and write 4-6 spec files manually. With it, that's one slash command. The factory's value comes from the maintainer staying in the **review** seat (catching bad specs, tweaking each before running); decomposition is mechanical and Claude is good at it.

**The shape of a `/scope-project` invocation:**

```
/scope-project A URL shortener with a stats dashboard. JSON-over-HTTP, SQLite storage.
  Optional auth via API key.
```

Output: 4-6 spec files under `docs/specs/`, plus a printed "ship order" with explicit dependency markers. Each spec uses the standard skeleton; the only addition is a `depends-on: [<id>, ...]` frontmatter field (see next entry).

**Constraints worth pinning when scoping the slash command:**

- Each generated spec must be small enough that `factory-runtime run` converges in 1-2 iterations under default budgets (the moneyball lesson — broad specs hit the agent timeout).
- The decomposition picks dependency boundaries that match real package/module boundaries. "Core helper" specs ship before "HTTP endpoint" specs ship before "frontend dashboard" specs.
- Stay within the existing spec format — no new top-level sections beyond the skeleton. `depends-on` is the only new frontmatter field.

**Where it lives:** `~/.claude/commands/scope-project.md` (the user's dotfiles, parallel to `scope-task.md`). NOT in this repo — it's a Claude Code user-level command. Documenting the command in `packages/core/README.md` is fine.

**Touches:** `~/.claude/commands/scope-project.md` (new ~30 LOC of slash-command markdown), `packages/core/src/schema.ts` (add `depends-on` frontmatter field — see below), `packages/core/README.md` (document the workflow). Optionally `examples/url-shortener/` as a worked example, parallel to `examples/parse-size`.

**Phasing suggestion:** v0.0.6 centerpiece. Highest UX leverage of any candidate currently in the BACKLOG. Pairs with the `depends-on` field below.

### `depends-on` frontmatter field

**What:** Optional spec-level metadata: `depends-on: [<spec-id>, ...]` in the YAML frontmatter. Declares that this spec assumes the named prior specs have shipped (their tests pass + their public exports exist). `factory spec lint` validates each id format; `factory-runtime run` doesn't enforce ordering by default in v0.0.6 (manual sequencing stays the workflow); the `factory spec review` reviewer's `cross-doc-consistency` judge is taught to read the dependency target's spec when scoring.

**Why:** Without this, the dependency relationship is implicit (the agent reads existing code and infers what's available). That works but loses cheap signal — the spec doesn't tell `factory spec review` "this should reference `shortenUrl` from `url-shortener-core`," so the reviewer can't catch dependency drift. With the field declared, the reviewer can validate that the spec's scenarios actually use the dependency's exports correctly.

**Why it's separate from `/scope-project`:** Two reasons. (a) It's useful even when the maintainer writes specs by hand for a multi-spec product. (b) It's the prerequisite for `factory-runtime`'s sequence-runner (next entry) — without explicit dependency declarations, the runner has nothing to walk.

**Touches:** `packages/core/src/schema.ts` (Zod schema extension on `SpecFrontmatter`), `packages/core/src/lint.ts` (validate id format), `packages/spec-review/src/judges/cross-doc-consistency.ts` (read declared deps and score against their content), tests. Public surface gains zero new exports — field-level addition to an already-exported schema.

**Phasing suggestion:** v0.0.6 alongside `/scope-project`. The slash command and the frontmatter field are the two halves of the same UX.

### `factory-runtime`: spec-sequence runner (`run-sequence`)

**What:** A new CLI subcommand `factory-runtime run-sequence <dir>/` (or `factory-runtime run --sequence`) that reads every spec under the given directory, builds the dependency DAG from `depends-on` fields, and runs each spec via `factory-runtime run` in topological order. Stops on the first non-converging spec (default), or continues with `--continue-on-fail`. Threads each run's `runId` into the next as a parent edge so `factory-context tree` walks the multi-spec ancestry.

**Why:** Closes the manual handoff between specs. Today: maintainer runs spec-1, eyeballs result, runs spec-2, etc. With sequence-runner: one command, one provenance trail across the whole product. **End-state UX moves significantly closer.**

**Why it's gated on evidence:** Premature now. The maintainer has shipped one product-class workflow (the v0.0.5 self-build, which was 3 specs in sequence — manageable by hand). They need to ship 1-2 more multi-spec products manually before the friction is calibrated enough to design the right interface. **Trigger when the manual sequence-driving has become annoying enough to be specific about.**

**Constraints worth thinking about when it's time to scope:**

- Failure handling: a non-converging mid-sequence spec is the interesting case. Skip the dependents? Continue and let them fail naturally? Configurable?
- Cost capping: per-spec cap and whole-sequence cap, both configurable (mirrors v0.0.3's per-phase + whole-run cap pattern).
- `factory-context tree --direction down <sequence-id>` should walk the whole product's DAG — every spec's run + every iteration's reports under one root.

**Touches:** `packages/runtime/src/cli.ts` (new subcommand), `packages/runtime/src/runtime.ts` (sequence orchestration), `packages/runtime/src/types.ts` (sequence-level options + RunReport extensions), tests. Probably ~400 LOC including tests. Public surface: 1-2 new exports (a `runSequence` function + a `SequenceReport` type), parallel to v0.0.3's `RunOptions`/`RunReport`.

**Phasing suggestion:** v0.0.7 — gated on **evidence from real multi-spec products**. If the URL-shortener and 1-2 other products ship cleanly via manual sequencing, the value-add is small. If those products surface real friction (specs running out of order, parent-edge gaps in provenance, cost-cap blow-ups across specs), the runner earns its slot.

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

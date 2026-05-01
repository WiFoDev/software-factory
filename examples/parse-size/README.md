# example-parse-size — the v0.0.4 walkthrough

A small `parseSize(text)` helper that parses human-readable size strings (`"1.5 KB"`, `"3.5 GiB"`, `"1024"`) into bytes — used as the vehicle for demonstrating **all three v0.0.4 deliverables** end-to-end:

1. **`factory init`** — bootstrap a fresh project (this directory's shape).
2. **`factory spec review`** — LLM-judged spec quality. We ship two specs in this example:
   - `docs/specs/parse-size-v1.md` — a deliberately-defective draft. The reviewer catches multiple quality issues.
   - `docs/specs/parse-size-v2.md` — the post-review version, paired with a technical-plan to exercise the `cross-doc-consistency` judge.
3. **`factory-context tree --direction down`** — finally answers "what came out of this run?" by walking descendants instead of ancestors.

Compared to the prior examples:

- [`examples/slugify`](../slugify) walks the **v0.0.1 manual loop** (validate-only, no agent).
- [`examples/gh-stars`](../gh-stars) walks **v0.0.2 single-shot** and **v0.0.3 unattended-loop** with an agent.
- This example walks **v0.0.4: spec quality + bootstrap + descendant traversal** without needing the agent at all (the implementation is tiny and pre-written).

## Setup (one-time)

From the monorepo root:

```sh
pnpm install
```

That links the factory CLIs (`factory`, `factory-runtime`, `factory-context`) into this example's `node_modules/.bin`.

All commands below run from `examples/parse-size/`.

---

## Step 1 — `factory init` (how this directory was bootstrapped)

This directory's shape — `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, `src/`, `docs/specs/done/`, `docs/technical-plans/done/` — is **exactly what `factory init` produces** in an empty cwd. To replicate it from scratch:

```sh
mkdir my-thing && cd my-thing
pnpm exec factory init --name my-thing
ls -R
# → package.json, tsconfig.json, .gitignore, README.md, src/.gitkeep,
#   docs/specs/done/.gitkeep, docs/technical-plans/done/.gitkeep
```

Idempotent + safe: if any target file or directory already exists, `factory init` exits `2` with a list of conflicts and writes nothing (no `--force` flag in v0.0.4).

```sh
pnpm exec factory init
# → "init/path-exists: refusing to write — these targets already exist:"
# →   package.json, tsconfig.json, ...
# → exit 2
```

---

## Step 2 — `factory spec review` against the defective v1 spec

The `docs/specs/parse-size-v1.md` spec lints clean (`factory spec lint` finds no format issues) but has multiple **quality** defects — the kind a tired developer would write without noticing. The reviewer catches them.

### 2a. Lint passes, but quality issues remain

```sh
pnpm exec factory spec lint docs/specs/parse-size-v1.md
# → OK
```

### 2b. Run the reviewer (real claude, subscription auth)

```sh
pnpm exec factory spec review docs/specs/parse-size-v1.md
```

Expected findings (one per judge):

| Code | What it catches in v1 |
|---|---|
| `review/internal-consistency` | The constraints declare *"Uses zod for input validation"* but no subtask, scenario, or DoD entry references zod — and the function description suggests no validation library is needed. |
| `review/judge-parity` | S-4 and S-5 are both error-UX scenarios. S-4 has a `judge:` line scrutinizing the error message; S-5 doesn't. Asymmetric satisfaction. |
| `review/dod-precision` | DoD reads *"the parser matches the expected format"* and *"output validates against the schema"*. Neither uses an explicit operator (equal? subset? superset?). |
| `review/holdout-distinctness` | H-1 paraphrases S-1 (overlap → overfit risk). H-2 talks about leap-year date arithmetic (irrelevant to a size parser). |
| `review/cross-doc-consistency` | Auto-resolves the paired `docs/technical-plans/parse-size-v1.md` if present (none here, so this judge skips with `applies() === false` — included for completeness). |

Output mirrors `factory spec lint`'s shape — different namespace (`review/...`), same line template + summary:

```text
docs/specs/parse-size-v1.md:18  warning  review/judge-parity           ...
docs/specs/parse-size-v1.md:42  warning  review/dod-precision          ...
0 errors, 4 warnings
```

> **All judges default to `severity: 'warning'`** — exit code is `0` even with findings. Promotion to `'error'` happens per-judge after calibration in v0.0.4.x point releases. See [`packages/spec-review/README.md`](../../packages/spec-review/README.md).

### 2c. Don't have a `claude` subscription on PATH? Use the deterministic fixture

You can prove the wiring without any real claude calls. The `@wifo/factory-spec-review` package ships a `fake-claude-judge.ts` test fixture:

```sh
FAKE_JUDGE_MODE=clean-json pnpm exec factory spec review \
  docs/specs/parse-size-v1.md \
  --claude-bin ../../packages/spec-review/test-fixtures/fake-claude-judge.ts \
  --no-cache
# → emits canned `pass: false` findings for every applicable judge.
# → verifies pipeline + finding format + exit code without burning subscription tokens.
```

---

## Step 3 — Fix the spec → review v2 → clean

`docs/specs/parse-size-v2.md` applies the review feedback. Diff highlights:

- Concrete operators in the DoD (`is strictly equal to <N>`, exact byte-count assertions).
- Both error-UX scenarios get `judge:` lines (parity restored).
- `Uses zod` constraint removed — replaced with `No external deps. No dependencies declared in package.json beyond what's already present.` (consistency).
- H-1 and H-2 replaced with genuinely distinct probes: **negative-input throws** (sign sanity) and **SI-vs-IEC discrimination** (the unit-collision risk).
- DoD adds boundary checks (`parseSize("0") === 0`, explicit SI vs IEC byte counts).

The paired technical-plan at `docs/technical-plans/parse-size-v2.md` agrees with the spec on every load-bearing detail (default SI base 1000, IEC base 1024, negative throws, integer return) — so `cross-doc-consistency` produces no findings.

```sh
pnpm exec factory spec review docs/specs/parse-size-v2.md
# → docs/specs/parse-size-v2.md: OK
```

Try the same with the deterministic fixture in `pass` mode:

```sh
FAKE_JUDGE_MODE=pass pnpm exec factory spec review \
  docs/specs/parse-size-v2.md \
  --claude-bin ../../packages/spec-review/test-fixtures/fake-claude-judge.ts \
  --no-cache
# → docs/specs/parse-size-v2.md: OK
```

### Cache invariants

Re-run the reviewer against an unchanged spec with an unchanged rule set: **zero `claude` spawns**. Editing the spec OR a judge prompt invalidates the key automatically (the rule-set hash covers each judge's prompt content).

```sh
pnpm exec factory spec review docs/specs/parse-size-v2.md
# first call: cold cache, runs claude

pnpm exec factory spec review docs/specs/parse-size-v2.md
# second call: warm cache hit, byte-identical output, zero spawns
```

`--no-cache` skips both lookup and write.

---

## Step 4 — Run the spec → produce a context-store DAG

The implementation is pre-written at `src/parse-size.ts` and the tests pass:

```sh
bun test src
# → 12 pass, 0 fail (S-1..S-6 + H-1, H-2 + boundary checks)
```

Run the v0.0.1 validate-only graph (no agent needed; the implementation already satisfies every scenario):

```sh
pnpm exec factory-runtime run docs/specs/parse-size-v2.md \
  --no-judge --no-implement --context-dir ./.factory
# → factory-runtime: converged in 1 iteration(s) (run=<runId>, ...)
# → exit code 0
```

Capture the `<runId>` from the output. The context store now has records on disk:

```sh
pnpm exec factory-context list --dir ./.factory
# → <runId>             factory-run                2026-...
# → <phaseId>           factory-phase              2026-...
# → <validateId>        factory-validate-report    2026-...
```

---

## Step 5 — Walk descendants with `tree --direction down` (the v0.0.4 win)

Before v0.0.4, `factory-context tree <runId>` showed only the run itself — the run is a root, so the **ancestor** walk has nothing to follow. The natural question after a run ("what came out of this?") was unanswerable without `list` + manual correlation.

```sh
pnpm exec factory-context tree <runId> --dir ./.factory
# v0.0.3 default = ancestors. Run has no parents → output shows only the runId.

pnpm exec factory-context tree <runId> --dir ./.factory --direction up
# explicit version of the same — backward-compatible.
```

Now flip the direction:

```sh
pnpm exec factory-context tree <runId> --dir ./.factory --direction down
# → <runId> [type=factory-run] 2026-...
#   ├── <phaseId> [type=factory-phase] 2026-...
#   │   └── <validateId> [type=factory-validate-report] 2026-...
#   └── <validateId> [type=factory-validate-report] 2026-...
```

The descendant tree shows **everything produced under this run** — phase records and reports, with the multi-parent edges of the DAG visible (the validate-report reachable via two paths).

You can also walk **up** from any leaf to the run (the v0.0.3 behavior, still works):

```sh
pnpm exec factory-context tree <validateId> --dir ./.factory
# → <validateId> [type=factory-validate-report] 2026-...
#   ├── <runId> [type=factory-run] 2026-...
#   └── <phaseId> [type=factory-phase] 2026-...
#       └── <runId> [type=factory-run] 2026-...
```

---

## Step 6 — Archive the spec

```sh
/finish-task parse-size-v2
```

Sweeps `docs/specs/parse-size-v2.md` and `docs/technical-plans/parse-size-v2.md` into the parallel `done/` subdirs.

---

## What this example demonstrates

| v0.0.4 surface | Where in this walkthrough |
|---|---|
| `factory init` | Step 1 — this directory's layout IS the init output |
| `factory spec review` (defective spec) | Step 2 — v1 catches 4 categories of quality defects |
| `factory spec review` (clean spec) | Step 3 — v2 + paired technical-plan, zero findings |
| `claudeCliJudgeClient` (subscription auth) | Step 2b — runs against real `claude -p` |
| Deterministic fixture override | Step 2c — `fake-claude-judge.ts` for CI / no-claude environments |
| Reviewer cache (content-addressable) | Step 3 — second invocation is free |
| `factory-runtime run` | Step 4 — produces a context-store DAG |
| `factory-context tree --direction down` | Step 5 — answers "what came out?" |
| `factory-context tree --direction up` | Step 5 — backward-compatible ancestor walk |

## Tips

- `.factory/` and `.factory-spec-review-cache/` are gitignored — diffable history lives in commits, not in run artifacts.
- `--no-judge` skips LLM-judged satisfactions on the harness side (no `ANTHROPIC_API_KEY` needed).
- `--no-implement` drops to validate-only mode (no `claude` spawn for the runtime — the spec-review still uses `claude` for its judges, separately).
- The deterministic-fixture path (Step 2c) is the right CI gate. The real-claude path is the manual release-gate smoke.
- If you want to start fresh: `rm -rf .factory .factory-spec-review-cache` and re-run.

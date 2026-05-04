# @wifo/factory-spec-review

> The LLM-judged spec quality reviewer. 8 `claude -p`-backed judges score specs for quality issues lint can't catch.

`@wifo/factory-spec-review` is the spec-side analog of the harness. Harness runs `judge:` lines against scenarios at runtime; the reviewer runs structured prompts against the spec itself **before** any agent token is spent. Output mirrors `factory spec lint`'s shape (`file:line  severity  code  message`), in the `review/...` namespace. Cache-backed by content-addressable spec hash + judge rule-set hash, so re-runs on unchanged specs cost zero `claude` spawns.

> **For AI agents:** start at **[`AGENTS.md`](../../AGENTS.md)** (top-level). This README is detailed reference.

## Install

```sh
pnpm add -D @wifo/factory-spec-review @wifo/factory-core
```

Pre-installed via `factory init`. Invoked via `factory spec review` (dispatched from `@wifo/factory-core`).

## When to reach for it

- **Score spec quality before running.** `factory spec review docs/specs/<id>.md` — runs all 8 enabled judges. Subscription-paid via `claude -p`.
- **Score a directory.** `factory spec review docs/specs/` — recurses; one finding stream per file.
- **Restrict to specific judges.** `--judges <a,b,c>` runs only those (e.g., quick `--judges dod-precision` for a fast DoD sanity check).
- **Programmatically review.** Import `runReview({ spec, judgeClient, ... })` to get a typed `ReviewFinding[]` array.
- **Build a custom judge.** Implement the `JudgeDef` interface, register it via your own `loadJudgeRegistry` wrapper, run it via `runReview`. The default-enabled list is configurable.

## What's inside

### CLI

```
factory spec review <path> [flags]                # dispatched from factory-core
```

| Flag | Default | Notes |
|---|---|---|
| `--cache-dir <path>` | `.factory-spec-review-cache` | Per-spec-bytes cache. Re-runs on unchanged specs are free. |
| `--no-cache` | off | Disable cache (always run every judge). |
| `--judges <a,b,c>` | all 8 | Comma-separated subset (e.g. `internal-consistency,dod-precision`). |
| `--claude-bin <path>` | `claude` on PATH | Override (test injection). |
| `--technical-plan <path>` | auto-resolved | Override path to paired technical-plan. |
| `--timeout-ms <n>` | 60000 | Per-judge timeout. |

Auto-resolution of paired technical-plan: `docs/specs/<id>.md` ↔ `docs/technical-plans/<id>.md` (and `done/` subdirs).

Auto-loading of `depends-on` deps (v0.0.7+): when reviewing a spec with non-empty `depends-on`, the CLI walks `<projectRoot>/docs/specs/<dep-id>.md` and `<projectRoot>/docs/specs/done/<dep-id>.md` to load each dep's body, then threads it through to the judges that consume `JudgePromptCtx.deps` (currently `cross-doc-consistency` and `internal-consistency`).

Exit codes: `0` (clean or warnings only), `1` (errors found).

### Public API (10 exports)

```ts
import { runReview, formatFindings, loadJudgeRegistry, claudeCliJudgeClient }
  from '@wifo/factory-spec-review';

import type {
  RunReviewOptions, ReviewFinding, ReviewCode, ReviewSeverity,
  JudgeDef, ClaudeCliJudgeClientOptions,
} from '@wifo/factory-spec-review';
```

### The 8 judges (v0.0.10)

All ship at `severity: 'warning'` by default — even findings don't escalate exit codes. Promotion to `'error'` happens per-judge in point releases, post-calibration.

| Code | Catches | Notes |
|---|---|---|
| `review/internal-consistency` | Constraints reference deps not declared; scenarios reference test files outside `cwd`. | v0.0.4. Dep-aware since v0.0.9 (loads `depends-on` deps' Constraints). |
| `review/judge-parity` | Asymmetric satisfaction kinds across same-category scenarios. | v0.0.4. |
| `review/dod-precision` | Vague DoD checks ("X validates Y" without operator). | v0.0.4. |
| `review/holdout-distinctness` | Holdouts that overlap with visible scenarios (overfit risk). | v0.0.4. |
| `review/cross-doc-consistency` | Spec ↔ technical-plan disagreement on names, defaults, deferral list. | v0.0.4. Dep-aware since v0.0.7. |
| `review/api-surface-drift` | Public API names in spec Constraints don't appear in tech-plan §4 (or vice versa). | v0.0.10. Applies only when paired technical-plan is present. |
| `review/feasibility` | Subtask LOC estimates that don't match file-path counts. | v0.0.10. Applies when Subtasks contain LOC numbers. |
| `review/scope-creep` | Subtasks naming future-version work; missing anti-goals in DEEP specs. | v0.0.10. Always applies. |

Plus three meta-codes:

- `review/judge-failed` — judge subprocess errored (severity: error). Pipeline continues with other judges.
- `review/section-missing` — judge skipped because target section absent (severity: info).
- `review/dep-not-found` — declared `depends-on` dep file missing during CLI dep-load (severity: warning).

### Concepts

**Cache.** `cacheKey = sha256(specBytes : ruleSetHash : sortedJudges)`. `ruleSetHash` covers each judge's static prompt content — editing a judge's CRITERION text invalidates correctly. The cache stores BOTH success and failure findings; if a judge errors due to flaky network, you must `--no-cache` after fixing.

**`JudgeDef` shape.** Each judge is `{ code, defaultSeverity, applies(spec, ctx), buildPrompt(spec, sliced, ctx) }`. `applies()` decides whether the judge runs at all (gates on `hasTechnicalPlan`, `hasDod`, `depsCount`); `buildPrompt()` produces a `{ criterion, artifact }` pair fed to the LLM via `JudgeClient.judge`.

**Subscription auth path.** The default `claudeCliJudgeClient` spawns `claude -p --allowedTools '[]' --output-format json` per judge. Strict-JSON-in-text parsing with regex-extract fallback for prefixed prose. **No `ANTHROPIC_API_KEY` required** — auth comes from the `claude` CLI's active subscription session.

**Dep-aware judges.** `cross-doc-consistency` (v0.0.7+) and `internal-consistency` (v0.0.9+) both consume `JudgePromptCtx.deps` — when scoring spec N with non-empty `depends-on`, they get each dep's body as available context. Closes the false-positive on `/scope-project`'s shared-constraints-in-first-spec pattern.

## Worked example

```sh
# Lint first (fast, free); review only on lint-clean specs
pnpm exec factory spec lint docs/specs/foo.md && \
  pnpm exec factory spec review docs/specs/foo.md

# Subset run for a quick sanity check
pnpm exec factory spec review docs/specs/foo.md \
  --judges internal-consistency,dod-precision

# Re-run with cache disabled (e.g., after editing a judge's CRITERION)
pnpm exec factory spec review docs/specs/foo.md --no-cache
```

Programmatic:

```ts
import { runReview, claudeCliJudgeClient } from '@wifo/factory-spec-review';
import { parseSpec } from '@wifo/factory-core';

const spec = parseSpec(await Bun.file('docs/specs/foo.md').text());
const judgeClient = claudeCliJudgeClient();

const findings = await runReview({
  specPath: 'docs/specs/foo.md',
  spec,
  judgeClient,
  cacheDir: './.factory-spec-review-cache',
});

for (const f of findings) {
  console.log(`${f.file}:${f.line ?? '?'}  ${f.severity}  ${f.code}  ${f.message}`);
}
```

## See also

- **[`AGENTS.md`](../../AGENTS.md)** — single doc for AI agents using the toolchain.
- **[`packages/core/README.md`](../core/README.md)** — `factory spec review` is dispatched from here. `factory spec lint` is the format-floor first stop.
- **[`packages/harness/README.md`](../harness/README.md)** — the `JudgeClient` interface used here is also used by the runtime's `validatePhase`.
- **[`CHANGELOG.md`](../../CHANGELOG.md)** — every release's deltas.

## Status

Pre-alpha. The reviewer's exit-1 condition is dormant — all 8 judges ship at `severity: 'warning'`. APIs may break in point releases until v0.1.0.

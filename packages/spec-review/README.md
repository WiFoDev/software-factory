# @wifo/factory-spec-review

LLM-judged spec quality reviewer for the software-factory loop. Runs five `claude -p`-backed judges against `docs/specs/<id>.md` files and emits findings in the same `${file}:${line}  ${sev}  ${code}  ${message}` format as `factory spec lint` — different namespace (`review/...` vs `spec/...`), same ergonomics.

The reviewer is the **spec-side** analog of the harness: harness scores `judge:` lines on scenarios; reviewer scores the spec itself.

## Why

`factory spec lint` is fast, free, and deterministic — but only checks **format**. A spec can lint clean and still ship with vague DoD checks, asymmetric satisfactions, or holdouts that paraphrase visible scenarios. Today, that catch happens manually (a human reads the spec, flags issues). The reviewer automates it.

## Install

```sh
pnpm add -D @wifo/factory-spec-review @wifo/factory-core
```

## Usage

```sh
factory spec review docs/specs/<id>.md
factory spec review docs/specs/                     # recursive
```

Auto-resolves the paired technical-plan from `docs/specs/<id>.md` ↔ `docs/technical-plans/<id>.md` (and the `done/` subdirs). Override with `--technical-plan <path>`.

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--cache-dir <path>` | `.factory-spec-review-cache` | Where cached findings live. |
| `--no-cache` | (off) | Disable lookup AND write. |
| `--judges <a,b,c>` | all 5 enabled | Comma-separated subset. Codes can be bare (`dod-precision`) or fully namespaced (`review/dod-precision`). |
| `--claude-bin <path>` | `claude` (PATH) | Test injection for fake-claude fixtures. |
| `--technical-plan <path>` | auto-resolved | Override paired-plan resolution. |
| `--timeout-ms <n>` | `60000` | Per-judge wall-clock timeout. |

### Exit codes

Mirror `factory spec lint`:
- `0` — clean OR only `info`/`warning` findings
- `1` — at least one `error`-severity finding (or path-not-found)
- `2` — bad CLI args (unknown judge code, missing path, invalid timeout)
- `3` — `claude -p` couldn't spawn (analogous to `runtime/agent-failed`)

## The five v0.0.4 judges

All ship at `severity: 'warning'` by default. The reviewer's exit-1 condition is therefore **dormant by default** — promote a judge to `error` once you've calibrated it on real specs.

| Code | Reads | What it catches |
|---|---|---|
| `review/internal-consistency` | full body | Constraints reference deps that aren't declared; scenarios reference test files outside `cwd`; DoD checks don't match constraints |
| `review/judge-parity` | scenarios + holdouts | Same category of scenario should have the same satisfaction kinds. If two error-UX scenarios but only one has a `judge:` line — flag it |
| `review/dod-precision` | DoD section (sliced) | "X matches Y" / "X validates Y" without explicit operator (equal vs subset vs superset). |
| `review/holdout-distinctness` | scenarios + holdouts | Holdouts overlap with visible scenarios (overfit) OR probe completely unrelated concerns (irrelevant) |
| `review/cross-doc-consistency` | spec + paired tech-plan | Spec and technical-plan disagree on error codes, public surface, default values, deferral list |

Plus two non-judge codes the runner emits:

- `review/judge-failed` (severity `error`) — JudgeClient threw; pipeline continues
- `review/section-missing` (severity `info`) — slicer didn't find a required `## ` section; that judge is skipped

## Calibration: warning → error

1. Run the reviewer against representative specs in your repo with `--judges <code>` (single judge at a time).
2. Eyeball the findings. False positives → tune the judge's prompt in `src/judges/<code>.ts` and bump the rule-set hash automatically (the cache invalidates on any prompt edit).
3. Once the false-positive rate is acceptable, change `defaultSeverity: 'warning'` to `'error'` in the judge file and ship a point release. CI now fails on that judge's findings.

## Cache

Content-addressable. Cache key = `sha256(specBytes : ruleSetHash : sortedJudges)`. Hit → identical findings, **zero `claude` spawns**. Re-running the reviewer on an unchanged spec with an unchanged rule set is free.

The `ruleSetHash` covers each judge's prompt content — editing a judge prompt without bumping a version still invalidates the cache automatically.

```
.factory-spec-review-cache/
├── 3a8f4e9b...d2c1056.json    # ReviewFinding[] for one (spec, ruleSet, judges) tuple
└── ...
```

`--no-cache` skips both lookup and write.

## How it talks to `claude`

The reviewer ships a `claudeCliJudgeClient` adapter that implements `@wifo/factory-harness`'s `JudgeClient` interface by spawning `claude -p --output-format json --allowedTools '[]' < prompt`. **Subscription auth** (no `ANTHROPIC_API_KEY`). Mirrors `packages/runtime/src/phases/implement.ts`'s subprocess pattern.

`--allowedTools '[]'` blocks all tool calls, so the judge's `record_judgment` tool path (used by the SDK-based default in harness) isn't available. Instead, the prompt instructs the model to emit strict JSON in the response text:

```
Respond with a single JSON object on one line, with no surrounding prose:
{"pass": <boolean>, "score": <number 0-1>, "reasoning": "<one or two sentences>"}
```

Parser: `JSON.parse` first; on failure, regex-extract the first `{...}` substring containing `"pass"`. Both fail → `judge/malformed-response` → `review/judge-failed` finding (severity `error`). Documented tradeoff: tool-forced JSON is more reliable, but doesn't fit the subscription-auth path.

## Release-gate manual smoke

CI tests use a mocked `JudgeClient` (see `src/review.test.ts`) — burns zero tokens, verifies the **pipeline**, not prompt quality.

Before tagging a release, run each fixture against real claude to verify prompt quality:

```sh
for f in test-fixtures/*.md test-fixtures/*/*.md; do
  pnpm exec factory spec review "$f" --no-cache
done
```

- `good-spec.md` should produce zero findings (negative control).
- `inconsistent-deps.md` should produce a `review/internal-consistency` finding.
- `dod-vague.md` should produce a `review/dod-precision` finding.
- `holdout-overlapping.md` should produce a `review/holdout-distinctness` finding.
- `parity-asymmetric.md` should produce a `review/judge-parity` finding.
- `cross-doc-mismatched/spec.md` (with paired plan) should produce `review/cross-doc-consistency`.

If `good-spec.md` produces noisy findings → tighten the prompts before release.

## Public API surface

`@wifo/factory-spec-review` exports exactly **10 names** (4 functions + 6 types):

```ts
runReview, formatFindings, loadJudgeRegistry, claudeCliJudgeClient,
ReviewFinding, ReviewCode, ReviewSeverity, RunReviewOptions, JudgeDef,
ClaudeCliJudgeClientOptions
```

Locked at v0.0.4. Future judges land via `JUDGE_REGISTRY` config (`src/judges/index.ts`); future fixes ship as field-level changes on existing types. Surface-lock test in `src/index.test.ts`.

## Deferred to v0.0.4.x

- `review/api-surface-drift` — public-API enumeration in spec vs technical-plan
- `review/feasibility` — LOC estimates vs constraints
- `review/scope-creep` — subtasks that obviously belong in a future version

Each ships with a "this real spec would have caught X" justification.

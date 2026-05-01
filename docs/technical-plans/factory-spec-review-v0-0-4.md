# Technical Plan — `@wifo/factory-spec-review` v0.0.4

## 1. Context

- v0.0.3 closed the *agent* gap: `factory-runtime run <spec>` drives `[implement → validate]` to convergence with no human between iterations. Spec quality is now the ceiling on agent output. v0.0.4's reviewer closes the *spec-side* feedback loop: a second-pass linter that judges spec **quality**, not just spec **format**. Mirrors `factory spec lint`'s output ergonomics so it slots into the same workflow.
- `factory spec lint` exists today at `packages/core/src/lint.ts` and emits findings as `${file}:${line}  ${sev}  ${code.padEnd(28)}  ${message}\n` to stderr (one line per finding) + a `${errors} error(s), ${warnings} warning(s)\n` summary; clean → stdout `OK\n`, exit 0; any `error`-severity finding → exit 1; bad CLI args → exit 2. The reviewer reproduces this contract bit-for-bit so users learn one ergonomics surface and can chain the two checkers (`factory spec lint $f && factory spec review $f`).
- `@wifo/factory-harness` already has the LLM-as-judge primitive used to score `judge:` lines on scenarios — `JudgeClient.judge({ scenario, artifact, criterion }) → Judgment`. Default impl `anthropicJudgeClient` (in `packages/harness/src/runners/judge.ts`) uses the **Anthropic SDK** directly, requiring `ANTHROPIC_API_KEY` (per-token billing). The factory's central economic thesis is *Pro/Max subscription, not API tokens*. The v0.0.4 reviewer **must** run on subscription auth — so we ship a new `claudeCliJudgeClient` adapter that implements the same `JudgeClient` interface by spawning `claude -p` (mirrors `packages/runtime/src/phases/implement.ts`'s subprocess pattern). Zero changes to `@wifo/factory-harness`.
- The reviewer ships **5 judges** in v0.0.4 (per the BACKLOG's "3-5 strongest first" guidance, taking the upper bound): `internal-consistency`, `judge-parity`, `dod-precision`, `holdout-distinctness`, `cross-doc-consistency`. The other four candidates from BACKLOG (`api-surface-drift`, `feasibility`, `scope-creep`, plus `format-strictness` which is already covered by `factory spec lint`) are deferred to v0.0.4.x point releases — each ships with a "this real spec would have caught X" justification.
- The Spec parser (`packages/core/src/parser.ts` + `schema.ts`) only structures `Scenarios` and `Holdout Scenarios`. **Intent**, **Constraints / Decisions**, **Subtasks**, **Definition of Done** are unparsed prose in `spec.body`. Reviewer judges that need those sections regex-slice them via a new `slice-sections.ts` module (gracefully degrades to "section not found → judge skipped with `info` finding" rather than crashing).
- Caching is content-addressable: `sha256(specBytes + ':' + ruleSetHash) → findings JSON`. Re-running review on an unchanged spec with an unchanged rule set is free — zero `claude` spawns, byte-identical output. Default cache dir `.factory-spec-review-cache/` in cwd; override `--cache-dir <path>`; disable `--no-cache`. Lives outside the `factory-context` DAG store (no parent edges to thread; pollution-free).
- Reviewer's CLI lives in the new `@wifo/factory-spec-review` package; `@wifo/factory-core`'s CLI dispatch (`packages/core/src/cli.ts:33-52`) gains a two-line branch (`if (command === 'review') return runReview(rest, io);`) that calls into it. Same dispatch shape as `spec lint` and `spec schema`.
- Locked exemplars:
  - `packages/core/src/lint.ts` + `lint.test.ts` — output shape, exit-code contract, severity rules (mirror exactly).
  - `packages/core/src/cli.ts` — manual subcommand dispatch + `parseArgs(strict: true)` + injectable `CliIo`. Reviewer's CLI mirrors.
  - `packages/core/src/parser.ts` + `schema.ts` — parsed `Spec` shape (`{ frontmatter, body, scenarios, holdouts, raw }`) consumed by every judge.
  - `packages/harness/src/runners/judge.ts` — `JudgeClient` interface + `Judgment` shape + `RECORD_JUDGMENT_TOOL`. `claudeCliJudgeClient` implements the same interface.
  - `packages/runtime/src/phases/implement.ts` — `claude -p` subprocess pattern (locked args: `-p`, `--output-format json`, `--allowedTools`; OAuth/keychain-based auth; JSON envelope parsing). `claudeCliJudgeClient` reuses this shape with `--allowedTools '[]'` (judges read the spec, never write).
  - `packages/runtime/test-fixtures/fake-claude.ts` — for testing `claudeCliJudgeClient` deterministically. Reviewer test fixtures get a similar `fake-claude-judge.ts` that emits canned `Judgment` JSON.
- Conventions unchanged from v0.0.3: strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere, factory-function pattern for clients, manual subcommand dispatch, injectable CLI I/O, Bun tests.
- Out of scope for v0.0.4 (deferred): the other four review angles, PostToolUse hook for spec lint/review (lives in `~/.claude/settings.json`, not in this repo), worktree sandbox, holdout-aware automated convergence, scheduler, streaming cost monitoring, `explorePhase`/`planPhase` separation, domain packs.

## 2. Architecture Decisions

### Module layout (new package)

```
packages/spec-review/
├── src/
│   ├── index.ts                       # public surface — 10 names locked
│   ├── review.ts                      # runReview(spec, judges, client, cache) → ReviewFinding[]
│   ├── findings.ts                    # ReviewFinding type + formatFindings (mirrors lint output)
│   ├── slice-sections.ts              # regex-extract Intent / Constraints / Subtasks / DoD from body
│   ├── judges/
│   │   ├── index.ts                   # JUDGE_REGISTRY: Record<ReviewCode, JudgeDef>; ruleSetHash()
│   │   ├── internal-consistency.ts
│   │   ├── judge-parity.ts
│   │   ├── dod-precision.ts
│   │   ├── holdout-distinctness.ts
│   │   └── cross-doc-consistency.ts
│   ├── claude-cli-judge-client.ts     # JudgeClient impl spawning `claude -p`
│   ├── cache.ts                       # specHash + ruleSetHash → findings JSON, file-per-hash
│   └── cli.ts                         # `factory spec review` (called from core's dispatch)
├── test-fixtures/
│   ├── good-spec.md                   # zero findings expected
│   ├── inconsistent-deps.md           # internal-consistency catches it
│   ├── parity-asymmetric.md           # judge-parity catches it
│   ├── dod-vague.md                   # dod-precision catches it
│   ├── holdout-overlapping.md         # holdout-distinctness catches it
│   ├── cross-doc-mismatched/          # spec + technical-plan disagree
│   │   ├── spec.md
│   │   └── technical-plan.md
│   └── fake-claude-judge.ts           # canned-judgment subprocess (mirrors fake-claude.ts)
├── package.json, tsconfig.json, README.md
└── tsconfig.build.json
```

### Public API surface (10 names, locked at v0.0.4)

```ts
// Functions (4)
export function runReview(opts: RunReviewOptions): Promise<ReviewFinding[]>;
export function formatFindings(findings: ReviewFinding[], opts?: { file?: string }): string;
export function loadJudgeRegistry(): Record<ReviewCode, JudgeDef>;
export function claudeCliJudgeClient(opts: ClaudeCliJudgeClientOptions): JudgeClient;

// Types (6)
export type ReviewFinding;
export type ReviewCode;
export type ReviewSeverity;          // 'error' | 'warning' | 'info'
export type RunReviewOptions;
export type JudgeDef;
export type ClaudeCliJudgeClientOptions;
```

`runReview` is the entry point. CLI is a thin wrapper that calls it. Future judges land via `JUDGE_REGISTRY` config — no new exports.

### `ReviewFinding` shape (strict mirror of `LintError` semantics)

```ts
type ReviewSeverity = 'error' | 'warning' | 'info';
type ReviewCode =
  | 'review/internal-consistency'
  | 'review/judge-parity'
  | 'review/dod-precision'
  | 'review/holdout-distinctness'
  | 'review/cross-doc-consistency'
  | 'review/judge-failed'              // fallback when a JudgeClient call errors
  | 'review/section-missing';          // fallback when slice-sections finds no target section

interface ReviewFinding {
  file?: string;
  line?: number;                       // section heading line where extractable; otherwise undefined
  severity: ReviewSeverity;
  code: ReviewCode;
  message: string;
}
```

`formatFindings(findings, { file })` produces the same `${file}:${line}  ${sev}  ${code.padEnd(28)}  ${message}\n` lines `lintSpec` produces; the shared format makes piping the two checkers' outputs together produce a uniform report.

### `RunReviewOptions`

```ts
interface RunReviewOptions {
  specPath: string;                    // path to the spec .md file
  spec: Spec;                          // already-parsed (caller did parseSpec)
  judgeClient: JudgeClient;            // injected — claudeCliJudgeClient by default in CLI
  judges?: ReviewCode[];               // defaults to all 5 enabled-by-default codes
  cacheDir?: string;                   // undefined → no cache; CLI defaults to '.factory-spec-review-cache'
  technicalPlanPath?: string;          // for cross-doc-consistency; CLI auto-resolves
  log?: (line: string) => void;
}
```

### Judge registry + `JudgeDef`

```ts
interface JudgeDef {
  code: ReviewCode;
  defaultSeverity: ReviewSeverity;     // 'warning' for v0.0.4 — see Risk §3
  applies(spec: Spec, ctx: { hasTechnicalPlan: boolean }): boolean;
  buildPrompt(spec: Spec, sliced: SlicedSections, ctx: { technicalPlan?: string }): {
    criterion: string;
    artifact: string;                  // payload the judge reads
    line?: number;                     // line for the finding (when extractable)
  };
}

const JUDGE_REGISTRY: Record<ReviewCode, JudgeDef> = {
  'review/internal-consistency': INTERNAL_CONSISTENCY_JUDGE,
  'review/judge-parity': JUDGE_PARITY_JUDGE,
  'review/dod-precision': DOD_PRECISION_JUDGE,
  'review/holdout-distinctness': HOLDOUT_DISTINCTNESS_JUDGE,
  'review/cross-doc-consistency': CROSS_DOC_CONSISTENCY_JUDGE,
};
```

`ruleSetHash()` returns `sha256(JSON.stringify(serializeRegistry()))` where `serializeRegistry` flattens every judge's code + defaultSeverity + the static text portion of `buildPrompt` (the fixed instruction prefix). Editing a judge's prompt invalidates the cache automatically — pinned by H-1.

### `runReview` pipeline

1. **Parse** — caller has done it; `runReview` receives a parsed `Spec`.
2. **Cache lookup** — `cacheKey = sha256(specBytes + ':' + ruleSetHash() + ':' + judgesEnabled.sort().join(','))`. If `<cacheDir>/<cacheKey>.json` exists and parses to a valid `ReviewFinding[]`, return it.
3. **Slice sections** — `slice-sections.ts` walks `spec.body` looking for `## ` headings matching the canonical names (`Intent`, `Constraints / Decisions`, `Subtasks`, `Definition of Done`). Returns `{ intent, constraints, subtasks, dod, headingLines }`. Missing sections → `undefined`.
4. **Run each enabled judge in parallel** — for judge in `judges`:
   - `if (!judge.applies(spec, ctx)) continue;`
   - if the judge depends on a section that's `undefined` → emit `review/section-missing` finding (severity `info`) and skip.
   - else → call `judgeClient.judge({ scenario: pseudoScenario(judge), artifact, criterion })`.
   - On `Judgment` returned: if `pass === false`, push a `ReviewFinding { code: judge.code, severity: judge.defaultSeverity, message: judgment.reasoning, file: specPath, line: prompt.line }`.
   - On client throw: push `review/judge-failed` finding (severity `error`) with the error message; continue. The reviewer never crashes.
5. **Cache write** — write the finalized findings to `<cacheDir>/<cacheKey>.json` (atomic via tmp-file + rename, mirrors `factory-context`'s pattern).
6. **Return** the `ReviewFinding[]`. The CLI sorts (by line then code), formats, prints, and computes exit code.

Pseudo-scenario synthesis (zero harness changes):

```ts
function pseudoScenario(judge: JudgeDef): ScenarioContext {
  return {
    id: judge.code,                                 // 'review/internal-consistency'
    name: judge.code.replace('review/', ''),
    given: 'A factory spec is being reviewed for quality.',
    when: `The reviewer evaluates the spec for ${judge.code.replace('review/', '')}.`,
    then: judge.criterion,                          // judge-specific one-liner
  };
}
```

### `claudeCliJudgeClient`

Implements the `JudgeClient` interface from `@wifo/factory-harness`. Spawns `claude -p` with locked args mirroring `implementPhase`:

```ts
const args = [
  '-p',
  '--output-format', 'json',
  '--allowedTools', '[]',                           // judges read; never write
  promptText,                                       // includes criterion + artifact
];
```

Auth via OAuth/keychain (subscription) — same path as `implementPhase`. No `ANTHROPIC_API_KEY` required.

**Judgment extraction strategy.** The harness's SDK-based `anthropicJudgeClient` forces a `record_judgment` tool call (via `tool_choice`) and reads `{ pass, score, reasoning }` from the structured tool input. `claude -p` can emit tool-use entries in its envelope, but the shape is not guaranteed stable across `claude` versions, and `--allowedTools '[]'` blocks all tool calls. **So the reviewer can't use the tool-call path.** Instead:

- Prompt instructs the model to return strict JSON in the response text:
  ```
  Respond with a single JSON object on one line, with no surrounding prose:
  {"pass": <boolean>, "score": <number 0-1>, "reasoning": "<one or two sentences>"}
  ```
- Parser:
  1. Read `result` field from the `claude -p` JSON envelope.
  2. Trim, attempt `JSON.parse(result)` directly.
  3. If parse fails, regex-extract the first `{...}` substring and retry.
  4. If still fails → throw a typed error → `runReview` catches and emits `review/judge-failed`.

Tradeoff documented: the SDK path can use forced tool calls (no parsing risk); the CLI path needs strict-JSON-in-text + a tolerant parser. Acceptable for a release blocker on subscription auth. Pinned by H-2.

### Cache layer

```
.factory-spec-review-cache/
├── <cacheKey>.json                    # ReviewFinding[] for one (spec, ruleSet, judges) tuple
└── <cacheKey>.json
```

- Atomic writes (tmp file + rename).
- Cache key: `sha256(specBytes + ':' + ruleSetHash + ':' + sortedJudges)`. Any change to spec content, judge prompt, judge severity, or enabled-set invalidates.
- Read returns `null` on parse failure or shape mismatch (cache entry treated as absent → judges re-run).
- `--no-cache` skips lookup AND skips write.
- Cache directory is created on first write (no init step).

### CLI surface

In `@wifo/factory-spec-review/cli.ts`:

```
factory spec review <path> [flags]

Path: a .md file or a directory (recurses *.md non-recursive into subdirs:
      mirrors `factory spec lint` exactly — single level recursion is fine).
Flags:
  --cache-dir <path>      Cache directory (default: .factory-spec-review-cache)
  --no-cache              Disable cache layer entirely
  --judges <a,b,c>        Comma-separated subset of enabled judges (default: all 5)
  --claude-bin <path>     Override the claude binary path (test injection)
  --technical-plan <path> Override auto-resolution of paired technical-plan (cross-doc-consistency)
```

Auto-resolution of paired technical plan: given a spec at `docs/specs/<id>.md`, look for `docs/technical-plans/<id>.md`. Both `done/` subdirs are also probed (`docs/specs/done/<id>.md` ↔ `docs/technical-plans/done/<id>.md`). If neither exists → `cross-doc-consistency` judge skips (`applies()` returns false).

In `@wifo/factory-core/src/cli.ts`:

```ts
if (domain === 'spec') {
  if (command === 'lint') return runLint(rest, io);
  if (command === 'schema') return runSchema(rest, io);
  if (command === 'review') {                             // NEW — 2 lines
    const { runReviewCli } = await import('@wifo/factory-spec-review/cli');
    return runReviewCli(rest, io);
  }
  io.stderr(USAGE); io.exit(2); return;
}
```

Dynamic import keeps `@wifo/factory-core` dep-free at install time when reviewer isn't used (the new package is an optional peer dep). USAGE string updates to list `spec review`.

### Exit codes (mirror `factory spec lint` exactly)

- `0` — clean (zero findings) OR all findings are severity `info` / `warning`. stdout `OK\n`.
- `1` — at least one `error`-severity finding (judge defaults to `warning` in v0.0.4 — escalation per-judge in future point releases).
- `2` — bad CLI args (bad `--judges` value, no path, etc.).
- `3` — `claudeCliJudgeClient` couldn't spawn `claude` at all (analogous to `runtime/agent-failed`).

### `slice-sections.ts`

Regex-walks `spec.body` looking for `^## (.+?)\s*$` headings. Maps known names (case-sensitive, exact match against the canonical strings used by every spec in this repo today):

- `## Intent` → `intent`
- `## Constraints / Decisions` → `constraints`
- `## Subtasks` → `subtasks`
- `## Definition of Done` → `dod`

For each match, captures the slice up to the next `## ` heading or end-of-body. Returns `{ intent?, constraints?, subtasks?, dod?, headingLines: { intent?, constraints?, subtasks?, dod? } }`. Heading line numbers are 1-based absolute (computed from `spec.raw.source`'s newline offsets to match `frontmatter.bodyStartLine`'s convention).

Any judge that needs a section it didn't find emits `review/section-missing` (severity `info`) and skips its judge call. Pinned by H-3.

### Five judges (full prompt scaffolding lives in code, summarized here)

Each judge file exports a `const X_JUDGE: JudgeDef` and unit tests in a sibling `*.test.ts`.

**`internal-consistency`** — applies always. Reads `intent`, `constraints`, `subtasks`, `dod`, `scenarios`. Criterion: "Constraints reference deps that are declared; scenarios reference test files inside the implied cwd; DoD checks match the constraints; subtasks cover every scenario." Artifact: full body. Line: `## Constraints / Decisions` heading (when found).

**`judge-parity`** — applies always. Reads `scenarios`, `holdouts`. Criterion: "For scenarios that share a category (error UX, success path, performance), satisfaction kinds are uniform — if one error-UX scenario has a `judge:` line, others do too." Artifact: rendered list of `{ id, name, satisfactions }` per scenario. Line: `## Scenarios` heading.

**`dod-precision`** — applies when `dod` slice exists. Reads `dod`. Criterion: "Every check uses an explicit operator. 'X matches Y' / 'X validates Y' without specifying equal vs subset vs superset is imprecise. Prose like 'all tests pass' is fine — vagueness about set semantics is not." Artifact: `dod` slice. Line: `## Definition of Done` heading.

**`holdout-distinctness`** — applies when `holdouts.length > 0`. Reads `scenarios`, `holdouts`. Criterion: "Holdouts probe failure categories distinct from visible scenarios. Flag holdouts that overlap (paraphrase a visible scenario — overfit risk) AND holdouts that are completely unrelated (irrelevant to the spec's surface)." Artifact: rendered scenarios + holdouts. Line: `## Holdout Scenarios` heading (or undefined).

**`cross-doc-consistency`** — applies when paired `technical-plan` resolves. Reads `spec.body` + technical plan body. Criterion: "Spec and technical-plan agree on: error codes mentioned, public API names enumerated, default values, deferral/anti-goal lists. Disagreement → finding." Artifact: `## Spec ##\n<body>\n## Technical Plan ##\n<plan>`. Line: spec line 1 (the file as a whole).

Each judge gets fixture-based unit tests using a mocked `JudgeClient` that returns canned `Judgment` objects. The fixtures (`test-fixtures/inconsistent-deps.md` etc.) are real spec-shaped markdown files designed to elicit a specific finding when run against real claude — verified manually before tagging the release. Pipeline tests use mocks; prompt-quality tests are the manual smoke.

### Test strategy: mocked `JudgeClient` for CI, real-claude for release-gate smoke

CI tests inject a mock `JudgeClient` that returns predetermined `Judgment` objects — verifies the **pipeline** (slice → judge call → finding shape → exit code → cache write/read), not the **prompt quality**. Burns zero tokens in CI.

Prompt quality is a release-gate manual smoke: run each judge against its dedicated fixture with `claudeCliJudgeClient` and real claude, eyeball the `pass`/`reasoning`. Documented in `packages/spec-review/README.md`. If any judge's findings are noisy on the negative-control fixture (`good-spec.md`), block the release.

`claudeCliJudgeClient` itself gets a small subprocess test: a `fake-claude-judge.ts` script (mirrors `runtime/test-fixtures/fake-claude.ts`) emits a canned envelope with the strict-JSON `{"pass":...,"score":...,"reasoning":...}` body. The CI test spawns `bun fake-claude-judge.ts` via `--claude-bin`, asserts the parser handles both well-formed JSON and `{"prefix":"junk", ...the json...}` (the regex-extract fallback path).

### Confirmed constraints

- New package `@wifo/factory-spec-review` at `packages/spec-review/`, version `0.0.4`. Public surface = **10 names** (4 functions + 6 types). Locked at v0.0.4; future judges land via `JUDGE_REGISTRY` without new exports.
- 5 judges enabled by default in v0.0.4. Each judge defaults to `severity: 'warning'`. **No judge defaults to `error` in v0.0.4** — the reviewer's exit-1 condition is dormant by default until a judge is calibrated and promoted in a later point release. (Documented in README.)
- `ReviewFinding` shape mirrors `LintError`: `{ file?, line?, severity, code, message }`. Output format byte-identical to `factory spec lint` (same line template, same summary line, same `OK\n` clean output, same exit codes 0/1/2). Only difference: the `code` namespace (`review/...` vs `spec/...`).
- `claudeCliJudgeClient` spawns `claude -p --output-format json --allowedTools '[]' <prompt>`. Subscription auth (no API key). Parses the `result` field of the JSON envelope as strict JSON; falls back to regex-extracting the first `{...}` substring; throws on both failures (caught upstream → `review/judge-failed`).
- Cache key: `sha256(specBytes + ':' + ruleSetHash() + ':' + sortedJudges.join(','))`. `ruleSetHash()` over every judge's `code + defaultSeverity + buildPrompt(...)` static text. Default cache dir `.factory-spec-review-cache/` in cwd; override via `--cache-dir`; disable via `--no-cache`. Cache lives outside the `factory-context` DAG.
- `factory spec review <path>` recurses one level into directories (mirrors `factory spec lint`'s recursion behavior — verified against `lint.ts`). Each spec file is reviewed independently; one cache entry per file.
- Auto-resolution of paired technical plan: `docs/specs/<id>.md` ↔ `docs/technical-plans/<id>.md`; both `done/` subdirs probed. CLI flag `--technical-plan <path>` overrides. `cross-doc-consistency.applies()` returns `false` when neither resolves.
- `slice-sections.ts` recognizes the canonical heading strings used in every spec in this repo today: `## Intent`, `## Constraints / Decisions`, `## Subtasks`, `## Definition of Done`. Case-sensitive exact match. A spec using non-canonical wording → judges that depend on that section emit `review/section-missing` (severity `info`) and skip.
- `runReview` never throws. Every error path maps to a `ReviewFinding`. The reviewer running on a malformed spec or with a flaky `claude -p` produces a degraded report, not a crash.
- `@wifo/factory-core`'s public surface is unchanged in v0.0.4 (still 27 names). The CLI dispatch gains a 4-line branch that dynamic-imports `@wifo/factory-spec-review/cli` — `factory-core` does NOT import the reviewer at module load time.
- `@wifo/factory-harness`'s public surface is unchanged in v0.0.4. Reviewer reuses the existing `JudgeClient` interface as-is.
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere.

## 3. Risk Assessment

- **`claude -p` JSON envelope shape for the response field.** The `result` field is documented as the model's text output; for strict-JSON-mode prompts the model usually returns clean JSON, but any preamble (`Sure, here's the JSON: {...}`) breaks `JSON.parse`. Mitigation: regex-extract the first balanced `{...}` substring as a fallback. If both fail → `review/judge-failed` finding (severity `error`). Pinned by H-2. **Cost of being wrong**: every judge call can fail; reviewer's manual smoke against fixtures will catch noisy parsers before the release tags.
- **Subscription auth is environment-dependent.** `claude -p` needs an authenticated keychain (`claude` 2.1+ uses OAuth via macOS keychain on darwin). CI environments without an authenticated `claude` can't run reviewer integration tests against real claude. Mitigation: CI tests use the mocked `JudgeClient` only; the `claudeCliJudgeClient` subprocess test uses a `fake-claude-judge.ts` injected via `--claude-bin`, mirroring `factory-runtime`'s pattern. The release-gate smoke is manual.
- **Judge prompt drift = silent cache corruption.** Hand-edit a judge prompt without bumping a version → cached findings are now stale. Mitigation: `ruleSetHash()` covers the prompt text, not just a version string. Pinned by H-1.
- **Reviewer false positives early.** Five judges × N specs in CI = real friction if any judge is noisy. Mitigation: every judge ships at `severity: 'warning'` for v0.0.4. The reviewer's exit-1 condition is dormant by default. Promotion to `'error'` happens per-judge, post-calibration, in point releases. Documented in README.
- **Brittle section slicing.** A spec using `## Definition Of Done` (capital O) instead of `## Definition of Done` will trip the missing-section path → `review/section-missing` info finding for `dod-precision`. Acceptable degradation; the lint pass should be where heading conventions are enforced, not the reviewer. (Future v0.0.4.x may add a `format-strictness` judge to lint to require canonical heading wording.)
- **Cross-doc-consistency is the heaviest judge.** Reads spec body + tech-plan body; prompt grows linearly. Mitigation: cap artifact size at 100 KB total (truncate the longer of the two with a marker if needed); document in `cross-doc-consistency.ts`.
- **Cache key collisions.** `sha256` is collision-resistant; the only practical concern is hash-of-different-ruleSet-but-same-spec returning a cached result from before a judge edit. The `ruleSetHash()` design defeats this — pinned by H-1.
- **Public surface growth.** `@wifo/factory-spec-review` adds 10 new exports — but they're in a new package, so existing surface counts (`@wifo/factory-core` 27 names, `@wifo/factory-context` 18, `@wifo/factory-runtime` 19, `@wifo/factory-harness` ~16, `@wifo/factory-twin` ~7) are unchanged. Strict-equality DoD gates per package still hold.
- **Blast radius.** New package + 4-line CLI dispatch addition in `@wifo/factory-core`. No changes to `harness`, `runtime`, `context`, `twin`. `pnpm test` workspace-wide stays green; spec-review suite adds ~15-20 new tests.

## 4. Subtask Outline

Seven subtasks, ~1500-1700 LOC including tests. Full test pointers in `docs/specs/factory-spec-review-v0-0-4.md`.

- **T1** [config + types] — Package skeleton at `packages/spec-review/`. `package.json` (workspace deps on `@wifo/factory-core`, `@wifo/factory-harness`; ANTHROPIC SDK is NOT a dep). `tsconfig.json` + `tsconfig.build.json`. `src/index.ts` exporting the 10 locked names (initial type declarations, function stubs throw `Error('not implemented')`). `src/findings.ts` with `ReviewFinding`, `ReviewCode`, `ReviewSeverity` types + `formatFindings()` output mirror of `lint`. Tests for `formatFindings` byte-equivalence with `lint` output template (compare against a hardcoded expected string). **depends on nothing**. ~150 LOC.
- **T2** [feature] — `src/claude-cli-judge-client.ts`. Implements `JudgeClient`. Spawns `claude -p --output-format json --allowedTools '[]' <prompt>` via `Bun.spawn`. Composes prompt from criterion + artifact (with the strict-JSON instruction footer). Parses `result` field of the envelope: `JSON.parse` first; on failure, regex `/\{[^{}]*"pass"[^{}]*\}/`-extract and retry; throw `Error('judge/malformed-response')` on both failures. Tests: feed canned envelopes via `--claude-bin <fake-claude-judge.ts>`; assert clean JSON parses; assert JSON-with-prefix parses via fallback; assert garbage throws. New `test-fixtures/fake-claude-judge.ts` (~30 LOC; reads its argv, emits the appropriate envelope on stdout). **depends on T1**. ~250 LOC.
- **T3** [feature] — `src/slice-sections.ts`. Walks `spec.body` for canonical `## ` headings. Returns `{ intent?, constraints?, subtasks?, dod?, headingLines }`. Heading line numbers absolute (use `spec.raw.source` + `spec.frontmatter`'s offset info). Tests: a complete spec slices all 4 sections; a spec missing `## Definition of Done` returns `dod: undefined` + `headingLines.dod: undefined`; a spec with extra subsections (`### ...`) does NOT split on those — `## ` only. **depends on T1**. ~120 LOC.
- **T4** [feature] — `src/cache.ts` + `src/review.ts` + `src/judges/index.ts` (registry + `ruleSetHash()`). `runReview()` wires: cache lookup → slice → enabled-judges loop → JudgeClient calls → `ReviewFinding[]` → cache write. Cache atomic via tmp+rename. `ruleSetHash()` hashes serialized registry. Tests: cache hit returns identical `ReviewFinding[]` without invoking the JudgeClient (mock client throws if called); cache miss invokes; `--no-cache` skips both lookup and write; `JudgeClient.judge()` throws → `review/judge-failed` finding emitted, run continues; one judge's `applies()` returning false skips it cleanly. **depends on T1, T2, T3**. ~280 LOC.
- **T5** [feature] — Five judges in `src/judges/`: one file per judge. Each exports a `JudgeDef`. Sibling `*.test.ts` per judge using a mocked `JudgeClient` to verify finding shape (severity, code, message-flow-through), `applies()` logic, prompt construction (artifact contains the right slices), and line-number resolution. Real-claude smoke is manual (release-gate, NOT in CI). 5 fixtures (`test-fixtures/*.md`) — each a ~30-50-line spec designed to elicit one specific judge's finding. **depends on T4**. ~600 LOC including fixtures.
- **T6** [feature] — `src/cli.ts` in `@wifo/factory-spec-review`: `runReviewCli(args, io)` parses `--cache-dir`, `--no-cache`, `--judges`, `--claude-bin`, `--technical-plan`; auto-resolves `technical-plan` from spec path; recurses dirs (one level, mirrors lint); calls `runReview` per file; sorts findings (line then code); prints via `formatFindings`; exit codes 0/1/2/3. Then: `packages/core/src/cli.ts` gains 4-line dynamic-import branch for `command === 'review'`; `USAGE` string updates. Tests in `packages/spec-review/src/cli.test.ts` (CLI behaviors) + `packages/core/src/cli.test.ts` (dispatch — `factory spec review --help` reaches the new branch). **depends on T4, T5**. ~250 LOC.
- **T7** [chore] — `packages/spec-review/README.md`: usage example, 5 judges + per-judge severity table, calibration guide ("how to promote a judge from warning to error"), cache layout, the `claudeCliJudgeClient` subscription-auth note, the strict-JSON parsing strategy + fallback, the manual release-gate smoke procedure (`claude -p` against each fixture). `packages/core/README.md` adds a one-line pointer to the reviewer in the spec-quality workflow section. `ROADMAP.md` updates the v0.0.4 line to "shipped"; the deferral list moves to v0.0.4.x. Surface lock test: a unit test in `packages/spec-review/src/index.test.ts` enumerates the public exports and asserts `=== 10` (strict-equality gate). **depends on T1..T6**. ~250 LOC including README.

Total ~1600 LOC. Surface area: contained to `packages/spec-review/` (new) + a 4-line addition in `packages/core/src/cli.ts` + USAGE update.

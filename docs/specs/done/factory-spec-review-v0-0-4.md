---
id: factory-spec-review-v0-0-4
classification: deep
type: feat
status: ready
exemplars:
  - path: packages/core/src/lint.ts
    why: "Output shape, severity rules, and exit-code contract that `factory spec review` must mirror byte-for-byte. Reviewer's `formatFindings()` reproduces the `${file}:${line}  ${sev}  ${code.padEnd(28)}  ${message}\\n` template + the `${errors} error(s), ${warnings} warning(s)\\n` summary + clean `OK\\n` to stdout."
  - path: packages/core/src/cli.ts
    why: "Manual subcommand dispatch + `parseArgs(strict: true)` + injectable `CliIo`. The new `spec review` branch slots into the same if-chain; `runReviewCli` mirrors `runLint`'s shape."
  - path: packages/core/src/parser.ts
    why: "`parseSpec` produces the `Spec` shape every judge consumes: `{ frontmatter, body, scenarios, holdouts, raw }`. Reviewer never re-parses; callers do `parseSpec` then pass the result to `runReview`."
  - path: packages/harness/src/runners/judge.ts
    why: "`JudgeClient` interface + `Judgment` shape + `RECORD_JUDGMENT_TOOL`. `claudeCliJudgeClient` implements `JudgeClient` directly — zero changes to the harness package. Pseudo-scenario synthesis uses the existing scenario-shaped input."
  - path: packages/runtime/src/phases/implement.ts
    why: "`claude -p --output-format json --allowedTools <list> <prompt>` subprocess pattern. `claudeCliJudgeClient` mirrors the spawn args (with `--allowedTools '[]'` since judges are read-only) and the JSON-envelope parsing."
  - path: packages/runtime/test-fixtures/fake-claude.ts
    why: "Subprocess test fixture pattern. `test-fixtures/fake-claude-judge.ts` mirrors it — a tiny script that emits a canned envelope on stdout with a strict-JSON `result` body, injected via `--claude-bin` so CI never spawns real claude."
  - path: docs/specs/done/factory-runtime-v0-0-3.md
    why: "Spec format + the canonical section headings (`## Intent`, `## Constraints / Decisions`, `## Subtasks`, `## Definition of Done`) that `slice-sections.ts` regex-walks. Also the v0.0.3 'zero new exports' lock pattern that v0.0.4's per-package surfaces inherit (new package gets 10 exports; existing packages stay at their current counts)."
---

# factory-spec-review-v0-0-4 — Spec-quality reviewer: `factory spec review` runs 5 LLM judges on subscription auth, mirrors lint's output

## Intent

Close the spec-side feedback loop. Today, `factory spec lint` checks spec **format** (deterministic, free, fast); a human reviewer checks spec **quality** (slow, expensive, inconsistent). v0.0.4 ships `factory spec review <path>` — a second-pass linter that runs 5 LLM-as-judge prompts against the spec and emits findings in the same `${file}:${line}  ${sev}  ${code}  ${message}` shape as `lint`, with the same exit codes. New package `@wifo/factory-spec-review` (10 exports). Subscription-paid via a new `claudeCliJudgeClient` (spawns `claude -p`, mirrors `implementPhase`'s subprocess pattern; no `ANTHROPIC_API_KEY` required). Content-addressable cache makes re-runs free. The 5 v0.0.4 judges: `internal-consistency`, `judge-parity`, `dod-precision`, `holdout-distinctness`, `cross-doc-consistency`. Each defaults to `severity: 'warning'` (reviewer's exit-1 condition is dormant by default until per-judge calibration in later point releases). The other four candidates from BACKLOG (`api-surface-drift`, `feasibility`, `scope-creep`, plus `format-strictness` which is already covered by `lint`) are deferred to v0.0.4.x.

## Scenarios

**S-1** — Clean spec → exit 0, `OK\n`, zero `claude` spawns when cache is hot
  Given `packages/spec-review/test-fixtures/good-spec.md` (a hand-crafted spec with no parity gaps, precise DoD, distinct holdouts, paired technical-plan that agrees), a tmp `--cache-dir`, and a mocked `JudgeClient` that returns `{pass: true, score: 1, reasoning: 'ok'}` for every call
  When `runReview({ specPath, spec, judgeClient, cacheDir })` is invoked twice in succession (first call cold, second warm)
  Then call 1: `judgeClient.judge` invoked exactly 5 times (one per enabled judge); returns `[]` (no findings); writes `<cacheDir>/<hash>.json` containing `[]`. Call 2: `judgeClient.judge` invoked **zero** times (cache hit); returns `[]`. CLI invocation `factory spec review test-fixtures/good-spec.md --claude-bin <fake-judge> --cache-dir <tmp>` exits 0; stdout `OK\n`; stderr empty.
  Satisfaction:
    - test: `src/review.test.ts` "clean spec: 5 judges run on cold call, 0 on warm; cache file written and re-read"
    - test: `src/cli.test.ts` "good-spec.md → exit 0, stdout OK, stderr empty"

**S-2** — Spec with one quality defect → exit 0 (warning-only) with finding line in `lint`-format
  Given `test-fixtures/inconsistent-deps.md` (constraints reference a dep declared nowhere; everything else fine), a mocked `JudgeClient` that returns `{pass: false, score: 0.2, reasoning: 'Constraint mentions zod but no zod entry in subtasks or DoD'}` for `internal-consistency` and `{pass: true, ...}` for the other four
  When `runReview` is invoked
  Then findings is `[{file: '<path>', line: <constraints-heading-line>, severity: 'warning', code: 'review/internal-consistency', message: 'Constraint mentions zod but no zod entry in subtasks or DoD'}]`. CLI: stderr line `<path>:<line>  warning  review/internal-consistency      Constraint mentions zod but no zod entry in subtasks or DoD\n` (the code is left-padded to 28 chars matching `lint.ts`); summary `0 error(s), 1 warning(s)\n`; stdout empty (no `OK`); exit code `0` (warnings don't escalate).
  Satisfaction:
    - test: `src/review.test.ts` "inconsistent-deps: one warning finding from internal-consistency, others pass"
    - test: `src/cli.test.ts` "inconsistent-deps.md → exit 0 with stderr warning line in lint format + summary"
    - judge: "the formatted finding line is visually indistinguishable from `factory spec lint`'s output — a developer reading both checkers' output piped together can't tell which produced which line apart from the `review/` vs `spec/` code prefix"

**S-3** — `claudeCliJudgeClient` parses strict-JSON `result` field; falls back to regex-extract; throws on garbage
  Given `claudeCliJudgeClient({ claudeBin: '<fake-claude-judge>' })` and three subprocess scenarios driven by `FAKE_JUDGE_MODE`:
    (a) `clean-json`: envelope's `result` field is exactly `{"pass":false,"score":0.3,"reasoning":"vague DoD"}`
    (b) `prefixed-json`: envelope's `result` field is `Sure, here is the judgment: {"pass":false,"score":0.3,"reasoning":"vague DoD"}\n`
    (c) `garbage`: envelope's `result` field is `I cannot judge this.`
  When `judgeClient.judge({ scenario: pseudoScenario('review/dod-precision'), artifact: '...', criterion: '...' })` is called for each
  Then (a) returns `{pass: false, score: 0.3, reasoning: 'vague DoD'}` via direct `JSON.parse`. (b) returns the same `Judgment` via the regex-extract fallback (matches the first `{...}` substring containing `"pass"`). (c) throws an `Error` with message starting `judge/malformed-response:`. The CLI test running an integration of (c) shows the `runReview` pipeline catches it and emits a `review/judge-failed` finding with severity `error`.
  Satisfaction:
    - test: `src/claude-cli-judge-client.test.ts` "strict JSON: clean parse"
    - test: `src/claude-cli-judge-client.test.ts` "JSON with prefix: regex-extract fallback succeeds"
    - test: `src/claude-cli-judge-client.test.ts` "garbage response: throws judge/malformed-response"
    - test: `src/review.test.ts` "judge throw → review/judge-failed finding emitted with severity error; pipeline continues"

**S-4** — Per-judge applicability: `cross-doc-consistency` skips when no paired technical-plan; `holdout-distinctness` skips when no holdouts
  Given a spec at `<tmp>/docs/specs/no-tech-plan.md` (no paired file at `<tmp>/docs/technical-plans/no-tech-plan.md` and no `done/` variant) and a spec at `<tmp>/docs/specs/no-holdouts.md` (zero `## Holdout Scenarios` block)
  When `runReview` runs against each
  Then for `no-tech-plan.md`: `cross-doc-consistency.applies(spec, { hasTechnicalPlan: false }) === false`; the judge is NOT invoked; no `cross-doc-consistency` finding emitted; the judgement count is at most 4 (one per other judge that's enabled and applicable).
  And for `no-holdouts.md`: `holdout-distinctness.applies(spec, ctx) === false`; no `holdout-distinctness` finding; judgement count at most 4.
  And the CLI `--technical-plan <path>` flag overrides auto-resolution: a paired file at any user-specified path makes `cross-doc-consistency` applicable.
  Satisfaction:
    - test: `src/judges/cross-doc-consistency.test.ts` "applies() returns false when no paired technical-plan; returns true when --technical-plan overrides"
    - test: `src/judges/holdout-distinctness.test.ts` "applies() returns false when spec.holdouts.length === 0"
    - test: `src/cli.test.ts` "auto-resolves docs/specs/<id>.md ↔ docs/technical-plans/<id>.md and the done/ variants"

**S-5** — Section slicing: `slice-sections.ts` extracts canonical headings; missing section → `review/section-missing` info finding
  Given `test-fixtures/dod-vague.md` (has all 4 canonical headings: `## Intent`, `## Constraints / Decisions`, `## Subtasks`, `## Definition of Done`) and a `test-fixtures/no-dod.md` (everything except `## Definition of Done`)
  When each is sliced
  Then for `dod-vague.md`: `sliceSections(spec).dod` is the prose between `## Definition of Done` and the next `## ` heading or end-of-body; `headingLines.dod` is the absolute 1-based line of the heading. For `no-dod.md`: `sliceSections(spec).dod === undefined`; `headingLines.dod === undefined`. When `runReview` runs `dod-precision` against `no-dod.md`, it emits a `review/section-missing` finding (severity `info`, message `Section '## Definition of Done' not found; dod-precision skipped`) and does NOT invoke the JudgeClient for that judge.
  Satisfaction:
    - test: `src/slice-sections.test.ts` "extracts all 4 canonical sections with absolute heading lines; missing section returns undefined"
    - test: `src/slice-sections.test.ts` "does NOT split on ### subheadings — only ## headings"
    - test: `src/review.test.ts` "missing dod section → review/section-missing info finding emitted; JudgeClient not invoked for dod-precision"

**S-6** — Cache invariants: cache key changes when spec content, judge prompt, OR enabled-set changes; `--no-cache` skips lookup AND write
  Given a spec, a stable mocked JudgeClient, and a tmp `--cache-dir`
  When the same spec is reviewed three ways:
    (a) twice with identical inputs (warm cache hit)
    (b) once after editing the spec body (different `specBytes` → different `cacheKey` → cache miss)
    (c) once with `--judges internal-consistency,dod-precision` instead of all 5 (different `sortedJudges` → different `cacheKey` → cache miss)
    (d) once with `--no-cache` (skips both lookup and write — `<cacheDir>/<hash>.json` is NOT created even if findings would have cached)
  Then (a) call-2 invokes JudgeClient zero times. (b) call invokes JudgeClient 5 times; new cache file on disk. (c) call invokes JudgeClient 2 times; another new cache file on disk (different key from (a)/(b)). (d) call invokes JudgeClient 5 times; `<cacheDir>` contains exactly the files from (a)+(b)+(c) — no new file from (d).
  Satisfaction:
    - test: `src/cache.test.ts` "spec edit → different cache key → cache miss"
    - test: `src/cache.test.ts` "judges subset → different cache key → cache miss"
    - test: `src/review.test.ts` "--no-cache: lookup skipped, write skipped, cache dir unchanged"

**S-7** — `factory spec review <path>` end-to-end via `@wifo/factory-core`'s CLI dispatch
  Given the built `dist/cli.js` from `@wifo/factory-core` and a tmp dir containing `good-spec.md` + `inconsistent-deps.md`
  When `factory spec review <tmp> --claude-bin <fake-judge> --cache-dir <tmp-cache>` is invoked (directory recursion, one level mirroring `factory spec lint`)
  Then exit code `0` (no `error`-severity findings); stderr contains the `inconsistent-deps.md:<line>  warning  review/internal-consistency  ...` line and the `0 error(s), 1 warning(s)` summary; stdout contains `OK\n` ONLY for `good-spec.md` (one `OK` per clean file, mirroring `lint`).
  And given `factory spec review nonexistent.md`, exit code `1` (path not found, mirrors `lint`).
  And given `factory spec review path --judges nope` (unknown judge code), exit code `2` with stderr label `review/invalid-judges: unknown code 'nope'\n` (string label, NOT a `ReviewCode` value).
  And given the `USAGE` text, the new `spec review <path>` line appears alongside `spec lint <path>` and `spec schema`.
  Satisfaction:
    - test: `packages/spec-review/src/cli.test.ts` "directory recursion: clean files print OK, dirty files print findings"
    - test: `packages/spec-review/src/cli.test.ts` "--judges nope → exit 2 with stderr label review/invalid-judges"
    - test: `packages/core/src/cli.test.ts` "domain=spec command=review dynamic-imports @wifo/factory-spec-review/cli and dispatches"

## Holdout Scenarios

**H-1** — `ruleSetHash()` is over the judge prompt **content**, not just a version string; editing a judge's prompt invalidates the cache
  Given a spec at `test-fixtures/good-spec.md`, a tmp cache dir, and the registry's `INTERNAL_CONSISTENCY_JUDGE.buildPrompt` returning a fixed criterion string `"v1: foo"`
  When the spec is reviewed (cold) → cache file `<hash-A>.json` written; then `INTERNAL_CONSISTENCY_JUDGE.buildPrompt` is patched to return `"v1: bar"` (different criterion); spec is reviewed again
  Then the second review's `cacheKey` is different from `<hash-A>` (because `ruleSetHash()` re-serializes the registry every call and the judge's prompt content changed). The JudgeClient is invoked 5 times in the second review (cache miss). A new file `<hash-B>.json` exists in the cache dir, distinct from `<hash-A>.json`. Even though no version string was bumped manually, the cache invalidated correctly.
  And given the inverse: revert the patch back to `"v1: foo"`; re-review → cacheKey returns to `<hash-A>` → cache hit on the original entry → 0 JudgeClient calls.

**H-2** — Reviewer never crashes on bad JudgeClient output; one bad judge does not poison the run
  Given a spec, an injected `JudgeClient` whose `judge()` method behaves per-call as: judge 1 (`internal-consistency`) → returns valid `{pass: false}`; judge 2 (`judge-parity`) → throws `Error('judge/malformed-response: garbage')`; judge 3 (`dod-precision`) → returns valid `{pass: true}`; judge 4 (`holdout-distinctness`) → throws a network error (`Error('ECONNRESET')`); judge 5 (`cross-doc-consistency`) → returns valid `{pass: false}`
  When `runReview` is invoked
  Then findings array contains exactly 4 items in this order (sort: line then code): `[review/internal-consistency (warning), review/judge-failed (error, message: 'judge/malformed-response: garbage', code-context: judge-parity), review/judge-failed (error, message: 'ECONNRESET', code-context: holdout-distinctness), review/cross-doc-consistency (warning)]`. CLI: exit code `1` (because `judge-failed` is severity `error`); stderr lists all 4 lines; summary `2 error(s), 2 warning(s)`. The `dod-precision` judge passes silently (no finding emitted on pass). Cache file IS written with the full findings array (next run on same spec returns the same 4 findings without re-invoking the JudgeClient — even the failures are cached, so transient errors persist; this is a documented tradeoff — operators must `--no-cache` after fixing flaky network).
  And given a separate run with the same setup but `--no-cache`, the cache file is NOT written; a third run after the network heals (judge 4 now returns `{pass: true}`) produces only 3 findings instead of 4.

**H-3** — Section-slicing handles spec body edge cases: `## ` inside fenced code blocks is NOT a heading; trailing whitespace on heading lines is tolerated; the canonical headings are case-sensitive
  Given a spec body containing four edge cases:
    (a) a fenced code block (```` ```md ... ## Intent ... ``` ````) — the `## Intent` inside the fence is NOT a section heading
    (b) a heading with trailing spaces: `## Definition of Done   ` (3 trailing spaces) — IS recognized
    (c) a heading using lowercase: `## definition of done` — is NOT recognized (slice returns `dod: undefined`)
    (d) a heading using a different separator: `## Constraints/Decisions` (no spaces around `/`) — is NOT recognized (slice returns `constraints: undefined`)
  When `sliceSections(spec)` is called
  Then (a) `intent: undefined` (the fenced occurrence is skipped — slicer is fenced-block-aware via a simple state machine); (b) `dod` populated with prose, `headingLines.dod` set to the line of the trailing-whitespace heading; (c) `dod: undefined`, judges depending on it emit `review/section-missing`; (d) `constraints: undefined`, judges depending on it emit `review/section-missing`.
  And given a spec with the canonical wording `## Constraints / Decisions` (with surrounding spaces around `/`) — slicer recognizes it. The intentional strictness pushes spec authors toward consistent heading wording without making the reviewer brittle to whitespace.

**H-4** — Surface lock holds across all packages: only `@wifo/factory-spec-review` has new exports in v0.0.4
  Given the built `dist/index.js` of every workspace package after T7 lands
  When `Object.keys(await import('@wifo/factory-X'))` is enumerated for X ∈ {core, harness, runtime, context, twin}
  Then `@wifo/factory-core` exports exactly the 27 names it had after v0.0.3 (zero new exports — the CLI dispatch addition is internal-only and doesn't touch `index.ts`); `@wifo/factory-harness` ~16 names unchanged; `@wifo/factory-runtime` 19 names unchanged; `@wifo/factory-context` 18 names unchanged; `@wifo/factory-twin` ~7 names unchanged. **Only** `@wifo/factory-spec-review` is new, exporting exactly 10 names: `runReview`, `formatFindings`, `loadJudgeRegistry`, `claudeCliJudgeClient`, `ReviewFinding`, `ReviewCode`, `ReviewSeverity`, `RunReviewOptions`, `JudgeDef`, `ClaudeCliJudgeClientOptions`. (Strict equality at 10; type-only exports counted via `tsc --noEmit --isolatedModules`-style enumeration of `index.ts` named declarations.)

## Constraints / Decisions

- New package `@wifo/factory-spec-review` at `packages/spec-review/`. Version `0.0.4`. Workspace deps on `@wifo/factory-core` and `@wifo/factory-harness` (for `JudgeClient` interface). **NOT a dep of `@wifo/factory-core`** — `core`'s CLI dispatch dynamic-imports it on the `command === 'review'` branch.
- Public surface from `src/index.ts`: exactly **10 names** (4 functions + 6 types): `runReview`, `formatFindings`, `loadJudgeRegistry`, `claudeCliJudgeClient`, `ReviewFinding`, `ReviewCode`, `ReviewSeverity`, `RunReviewOptions`, `JudgeDef`, `ClaudeCliJudgeClientOptions`. Locked at v0.0.4. Future judges land via `JUDGE_REGISTRY` config; future fixes ship as field-level changes on existing types. Strict-equality DoD gate at 10.
- 5 judges enabled by default in v0.0.4: `internal-consistency`, `judge-parity`, `dod-precision`, `holdout-distinctness`, `cross-doc-consistency`. Each `JudgeDef.defaultSeverity = 'warning'`. The reviewer's exit-1 condition is therefore dormant by default. Promotion to `'error'` happens per-judge in later point releases, post-calibration.
- `ReviewCode` union has exactly **7 members** in v0.0.4: the 5 judge codes above + `'review/judge-failed'` (catch-all when JudgeClient throws) + `'review/section-missing'` (when slicer doesn't find a required section).
- `ReviewFinding` shape: `{ file?: string; line?: number; severity: ReviewSeverity; code: ReviewCode; message: string }` — same field set as `LintError` from `@wifo/factory-core`. `formatFindings(findings, { file })` produces output **byte-identical** to `lint`'s line template: `${file ?? '<input>'}${line !== undefined ? ':' + line : ''}  ${severity.padEnd(7)}  ${code.padEnd(28)}  ${message}\n`. Summary line `${errors} error(s), ${warnings} warning(s)\n` mirrors lint exactly. Clean → stdout `OK\n`.
- Exit codes (mirror `factory spec lint` exactly): `0` clean OR only `info`/`warning` findings; `1` ≥ 1 `error`-severity finding (or path-not-found, mirror lint); `2` bad CLI args (unknown judge code, missing path, etc.); `3` `claudeCliJudgeClient` couldn't spawn `claude` at all (analogous to `runtime/agent-failed`).
- `claudeCliJudgeClient` spawns `claude -p --output-format json --allowedTools '[]' <prompt>` via `Bun.spawn`. Subscription auth (no `ANTHROPIC_API_KEY`). Reads the `result` field of the JSON envelope; parses as strict JSON; on failure regex-extracts the first `{...}` substring containing `"pass"` and retries; throws `Error('judge/malformed-response: <detail>')` on both failures. The `--allowedTools '[]'` value (empty JSON array as a string) blocks all tool calls; judges are read-only.
- Judge prompt instructs the model to return strict JSON in the response text (no tool call): `Respond with a single JSON object on one line, with no surrounding prose: {"pass": <boolean>, "score": <number 0-1>, "reasoning": "<one or two sentences>"}`. The strict-JSON instruction is a static string in `claudeCliJudgeClient` (not in each judge's prompt), so future judges don't need to repeat it.
- Pseudo-scenario synthesis: each judge gets a synthetic `{ id, name, given, when, then }` triple with `id = judge.code`, `then = judge.criterion`. Zero changes to `@wifo/factory-harness`.
- `slice-sections.ts` recognizes the canonical heading strings used in every spec in this repo: `## Intent`, `## Constraints / Decisions`, `## Subtasks`, `## Definition of Done`. Case-sensitive exact match (with whitespace tolerance per H-3); `### ` subheadings are NOT split on. Fenced code blocks are skipped via a simple state machine. Missing section → judges depending on that section emit `review/section-missing` (severity `info`) and skip. Heading line numbers are absolute 1-based per `spec.raw.source`.
- Caching: `cacheKey = sha256(specBytes + ':' + ruleSetHash() + ':' + sortedJudges.join(','))`. `ruleSetHash() = sha256(JSON.stringify(serializeRegistry()))` where `serializeRegistry` flattens every judge's `code + defaultSeverity + buildPrompt(...)` static text. Files under `<cacheDir>/<cacheKey>.json` (atomic via tmp+rename). `--no-cache` skips both lookup AND write. Default `cacheDir`: `.factory-spec-review-cache` in cwd. Cache lives outside the `factory-context` DAG store.
- `runReview` never throws. JudgeClient errors → `review/judge-failed` finding (severity `error`). Slicer misses → `review/section-missing` (severity `info`). Bad cache file → treated as cache miss (no error surfaced).
- CLI surface: `factory spec review <path> [--cache-dir <p>] [--no-cache] [--judges <a,b,c>] [--claude-bin <p>] [--technical-plan <p>]`. Path = file or directory (one-level recursion mirroring `factory spec lint`). Auto-resolves paired technical-plan: `docs/specs/<id>.md` ↔ `docs/technical-plans/<id>.md`; both `done/` subdirs probed. `--technical-plan` overrides.
- `@wifo/factory-core`'s CLI dispatch (`packages/core/src/cli.ts`) gains a 4-line `if (domain === 'spec' && command === 'review')` branch that dynamic-imports `@wifo/factory-spec-review/cli`'s `runReviewCli`. `core`'s public surface stays at **27 names** (no `index.ts` change). USAGE string updates to list `spec review <path>`.
- Per-judge applicability: `cross-doc-consistency.applies()` returns true iff a paired technical-plan resolves; `holdout-distinctness.applies()` returns true iff `spec.holdouts.length > 0`; the other three apply unconditionally.
- Test strategy: pipeline tests inject a mocked `JudgeClient` (CI gate, burns zero tokens). `claudeCliJudgeClient` subprocess test uses `test-fixtures/fake-claude-judge.ts` (driven by `FAKE_JUDGE_MODE` env var; mirrors `runtime/test-fixtures/fake-claude.ts`'s pattern). Prompt-quality is a manual release-gate smoke against the 5 fixtures + `good-spec.md` (the negative control); documented in `packages/spec-review/README.md`. NOT a CI gate.
- Test fixtures committed to `packages/spec-review/test-fixtures/`: `good-spec.md`, `inconsistent-deps.md`, `parity-asymmetric.md`, `dod-vague.md`, `holdout-overlapping.md`, `cross-doc-mismatched/{spec,technical-plan}.md`, `fake-claude-judge.ts`. Each `.md` fixture is hand-crafted to elicit one specific judge's finding when run against real claude.
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere. Every type-only import uses `import type`. Every array/object index access is guarded.
- v0.0.4 explicitly does **not** ship: `review/api-surface-drift`, `review/feasibility`, `review/scope-creep` (deferred to v0.0.4.x with per-judge "this real spec would have caught X" justification); `review/format-strictness` (already covered by `factory spec lint`); PostToolUse hook for spec lint/review (lives in `~/.claude/settings.json`, separate from this repo); worktree sandbox; npm publishing of the workspace packages (deferred to v0.0.5).

## Subtasks

- **T1** [config + types] — Create `packages/spec-review/` with `package.json` (workspace deps on `@wifo/factory-core`, `@wifo/factory-harness`; no Anthropic SDK), `tsconfig.json`, `tsconfig.build.json`. `src/index.ts` exporting the 10 locked names (function stubs throw `Error('not implemented')` initially). `src/findings.ts` with `ReviewFinding` / `ReviewCode` / `ReviewSeverity` types + `formatFindings()` that reproduces `lint`'s output template byte-for-byte. Tests in `src/findings.test.ts`: `formatFindings` against hardcoded expected strings (compare line template vs `packages/core/src/lint.ts:171`'s template — must match modulo the `code` namespace). **depends on nothing**. ~150 LOC.
- **T2** [feature] — `src/claude-cli-judge-client.ts`. Implements `JudgeClient` interface from `@wifo/factory-harness`. `claudeCliJudgeClient({ claudeBin?: string, timeoutMs?: number }): JudgeClient` factory returning `{ judge: async (input) => {...} }`. Composes prompt = `<criterion>\n\nArtifact:\n<artifact>\n\nRespond with a single JSON object on one line, with no surrounding prose: {"pass": <boolean>, "score": <number 0-1>, "reasoning": "<one or two sentences>"}`. Spawns `Bun.spawn([claudeBin ?? 'claude', '-p', '--output-format', 'json', '--allowedTools', '[]', prompt])`; awaits stdout; `JSON.parse` envelope; reads `result` field; tries `JSON.parse(result.trim())` then regex `/\{[^{}]*?"pass"[^{}]*?\}/`-extract fallback; throws `Error('judge/malformed-response: <detail>')` on both. Tests in `src/claude-cli-judge-client.test.ts` using `test-fixtures/fake-claude-judge.ts` (~50 LOC; reads `FAKE_JUDGE_MODE`, emits matching envelope on stdout): `clean-json` mode, `prefixed-json` mode, `garbage` mode. **depends on T1**. ~280 LOC including fixture.
- **T3** [feature] — `src/slice-sections.ts`. Walks `spec.body` line-by-line with a fenced-block state machine (toggled by lines starting with ```` ``` ````). When NOT in a fence, matches `^## (Intent|Constraints / Decisions|Subtasks|Definition of Done)\s*$`. Captures the slice from the heading to the next `## ` heading or end-of-body. Returns `{ intent?, constraints?, subtasks?, dod?, headingLines: { intent?, constraints?, subtasks?, dod? } }`. Heading line numbers absolute 1-based (computed by counting newlines in `spec.raw.source` up to the heading offset). Tests in `src/slice-sections.test.ts` covering all H-3 cases: complete spec; missing section; fenced `## ` ignored; trailing whitespace tolerated; lowercase heading rejected; alternative separators rejected; `### ` subheadings ignored. **depends on T1**. ~150 LOC.
- **T4** [feature] — `src/cache.ts`, `src/judges/index.ts` (registry shell + `ruleSetHash()`), `src/review.ts` (the `runReview` pipeline). Cache: `cacheGet(cacheDir, cacheKey)` reads + parses JSON; returns `null` on any failure. `cacheSet(cacheDir, cacheKey, findings)` writes via tmp+rename; mkdir cacheDir on first write. `ruleSetHash()` over the serialized registry. `runReview`: cache lookup → slice → enabled-judges loop (parallel via `Promise.all`) → for each enabled judge: applicability check → section-missing check → JudgeClient call (with try/catch → `judge-failed` finding on throw) → if `pass === false` push finding → cache write → return findings (sorted line then code). Tests in `src/cache.test.ts` (atomic write; bad cache file treated as miss; key changes on spec edit / judges subset change) and `src/review.test.ts` (cache hit zero JudgeClient calls; one judge throws → others continue; missing section → section-missing finding; --no-cache skips lookup AND write). **depends on T1, T2, T3**. ~320 LOC.
- **T5** [feature] — Five judge files in `src/judges/`: `internal-consistency.ts`, `judge-parity.ts`, `dod-precision.ts`, `holdout-distinctness.ts`, `cross-doc-consistency.ts`. Each exports a `JudgeDef` with `code`, `defaultSeverity: 'warning'`, `applies(spec, ctx)`, `buildPrompt(spec, sliced, ctx)`. Sibling `*.test.ts` per judge using a mocked `JudgeClient` (returns `{pass: false, score, reasoning: 'mock'}` or `{pass: true}`) verifies: `applies()` truth table; `buildPrompt()` emits the right artifact (contains the right slices); finding has correct severity / code / message-passthrough / line. Five `.md` fixtures in `test-fixtures/`: each ~30-50 lines, hand-crafted to elicit ONE specific judge's finding when later run against real claude. `cross-doc-mismatched/` is a directory containing `spec.md` + `technical-plan.md` that explicitly disagree on a default value. **depends on T4**. ~600 LOC including fixtures.
- **T6** [feature] — `src/cli.ts` in `@wifo/factory-spec-review`: exports `runReviewCli(args, io: CliIo): Promise<void>`. Parses `<path>`, `--cache-dir`, `--no-cache`, `--judges <a,b,c>`, `--claude-bin`, `--technical-plan` via `node:util` `parseArgs(strict: true)`. Validates `--judges` against the 5 known codes (unknown → exit 2 with stderr label `review/invalid-judges: unknown code '<raw>'`). Auto-resolves paired technical-plan for `cross-doc-consistency`. Recurses one level into directories. For each spec: `parseSpec` (catch `SpecParseError` → exit 1 with the parse error printed); `runReview`; `formatFindings` to stderr; `OK\n` to stdout if zero findings. Exit code via the same logic as `lint`.
  Then in `packages/core/src/cli.ts`: add a 4-line branch in `runCli` for `domain === 'spec' && command === 'review'` that does `const { runReviewCli } = await import('@wifo/factory-spec-review/cli'); await runReviewCli(rest, io);`. Update `USAGE` to list `spec review <path>`.
  Tests in `packages/spec-review/src/cli.test.ts` (CLI behaviors against fake-claude-judge): directory recursion; clean file → OK; dirty file → finding line; `--judges nope` → exit 2 with stderr label; `--no-cache` flag honored; auto-resolution of paired technical-plan; `--technical-plan` override.
  Tests in `packages/core/src/cli.test.ts` (one new test): `runCli(['spec', 'review', '--help'], io)` reaches the new branch and dynamic-imports the reviewer (verified by mocking the module loader or by asserting the printed USAGE includes `spec review`).
  **depends on T4, T5**. ~280 LOC.
- **T7** [chore] — `packages/spec-review/README.md`: usage example, judges + per-judge severity table (all `warning` in v0.0.4), prompt for each judge (one short paragraph each), calibration guide (how to promote a judge from `warning` to `error` in a future point release), cache layout + invalidation rules, the `claudeCliJudgeClient` subscription-auth note (no API key), the strict-JSON-in-text parsing strategy + regex fallback, the `--no-cache` semantics, the manual release-gate smoke procedure (`bun run packages/spec-review/scripts/smoke.ts <fixture>` — script TBD, optional in v0.0.4 if scripted; otherwise documented manual command). `packages/core/README.md` adds a 1-line pointer to `factory spec review` in the spec-quality workflow section. `ROADMAP.md` updates the v0.0.4 entry to "shipped" + the deferral list moves to v0.0.4.x. Surface lock test in `packages/spec-review/src/index.test.ts`: `Object.keys(await import('../src/index.js'))` enumerates exactly 10 names (strict-equality gate); also assert `@wifo/factory-core` exports stay at 27 names, `@wifo/factory-harness` ~16, `@wifo/factory-runtime` 19, `@wifo/factory-context` 18, `@wifo/factory-twin` ~7 — pinned by H-4. **depends on T1..T6**. ~250 LOC including README.

## Definition of Done

- All visible scenarios (S-1..S-7) pass (tests green; judge criteria met).
- All holdout scenarios (H-1..H-4) pass at end-of-task review (run after T7 lands; no agent-iteration access during scenarios).
- `pnpm -C packages/spec-review typecheck` clean.
- `pnpm -C packages/spec-review test` green (`bun test`); `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean across the repo.
- `pnpm -C packages/spec-review build` produces a working `dist/cli.js` (or wherever the CLI export lives) importable by `@wifo/factory-core`.
- **Deterministic CI smoke (fake-judge)**: from the repo root, `pnpm exec factory spec review packages/spec-review/test-fixtures/good-spec.md --claude-bin packages/spec-review/test-fixtures/fake-claude-judge.ts --cache-dir <tmp>` (with `FAKE_JUDGE_MODE=clean-pass`) exits 0; stdout `OK\n`; tmp cache dir contains exactly 1 file. A second invocation immediately after exits 0 with zero `claude-bin` spawns (cache hit verified by inspecting fake-claude-judge's invocation counter — `FAKE_JUDGE_COUNTER_FILE` env var, mirrors `FAKE_CLAUDE_STATE_DIR` from v0.0.3).
- **Manual release-gate smoke (real claude, subscription auth)**: before tagging v0.0.4, manually run `pnpm exec factory spec review packages/spec-review/test-fixtures/<fixture>.md --no-cache` against real `claude` for each of the 5 fixtures + `good-spec.md` (the negative control). Assert: `good-spec.md` produces zero findings (or `info`-only findings); each `<judge>-relevant` fixture produces at least one finding from the targeted judge with a coherent `reasoning` message (judge-by-eye). Document the run output (per-fixture findings, total tokens) in the v0.0.4 release notes. NOT a CI gate (real-claude is non-deterministic + subscription-bound), but a **hard release-gate item**: v0.0.4 does not tag without all 6 fixtures eyeballed.
- Public API surface from `packages/spec-review/src/index.ts` matches the technical plan §2 exactly: 4 functions + 6 types = **10 names**. Strict-equality gate via the surface-lock test in T7.
- `@wifo/factory-core`'s public surface from `src/index.ts` is **strictly equal** to its v0.0.3 shape (27 names). The CLI dispatch branch is internal-only.
- `@wifo/factory-harness`'s public surface unchanged (~16 names; no edits to its `src/`).
- `@wifo/factory-runtime`, `@wifo/factory-context`, `@wifo/factory-twin` public surfaces unchanged (19, 18, ~7 respectively).
- `ReviewCode` union has exactly **7 members** at v0.0.4: 5 judge codes + `'review/judge-failed'` + `'review/section-missing'`. Strict-equality check on the union's membership (`type-fest`-style enumeration or hand-asserted in a unit test).
- `ReviewFinding` shape is structurally compatible with `LintError` (same five fields, same types): a `LintError | ReviewFinding` union types correctly without manual narrowing in `formatFindings`-equivalent calls.
- `formatFindings` output is byte-identical to `factory spec lint`'s output template (verified by string equality against a hardcoded expected output in T1's tests).
- README in `packages/spec-review/` documents: usage; the 5 judges + their criterion summaries; the `severity: 'warning'` default + the calibration guide; cache layout + invalidation; `claudeCliJudgeClient` subscription auth (no API key); strict-JSON parsing strategy + regex fallback; release-gate smoke procedure; the v0.0.4 → v0.0.4.x deferral list (the other 4 review angles).
- `packages/core/README.md` mentions `factory spec review` in the spec-quality workflow.
- `ROADMAP.md` v0.0.4 entry marked "shipped" with a one-paragraph summary; deferral list updated; v0.0.4.x entry created (or v0.0.5 if appropriate) listing the deferred judges + the npm-publish gap from `factory init`.
- v0.0.4 explicitly does **not** ship: the four deferred review angles, PostToolUse hook, worktree sandbox, holdout-aware automated convergence, scheduler, streaming cost monitoring, `explorePhase`/`planPhase` separation, domain packs, npm publishing.

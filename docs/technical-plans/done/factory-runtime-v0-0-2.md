# Technical Plan — `@wifo/factory-runtime` v0.0.2

## 1. Context

- v0.0.1 shipped the runtime skeleton + `validatePhase`. The five primitives (`@wifo/factory-core`, `-harness`, `-twin`, `-context`, `-runtime`) are all green; the worked example (`examples/slugify`) demonstrates the manual loop. The piece v0.0.2 closes is the **agent doing the implementation** — `factory-runtime run <spec>` should invoke an agent that edits files, then run `validate` against the result, all in one CLI call.
- `packages/runtime/src/` already follows the conventions v0.0.2 must keep: strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `import type` everywhere, factory-function pattern for built-in phases (`validatePhase(opts) → Phase`), `tryRegister` for idempotent record-type registration, `RuntimeError` with stable `code` field, manual subcommand dispatch in `cli.ts`, injectable `CliIo` for tests, Bun for tests.
- The locked exemplars for v0.0.2:
  - `packages/runtime/src/phases/validate.ts` — factory function pattern, `tryRegister`, `parents: [ctx.runId]`. New phase mirrors this exactly.
  - `packages/harness/src/runners/test.ts` — `Bun.spawn`-style subprocess + per-invocation timeout + ANSI strip + 4 KB tail cap. Subprocess wrapper for `claude` mirrors this.
  - `packages/runtime/src/cli.ts` — manual subcommand dispatch on `argv[0]`, `parseArgs` per subcommand, `CliIo` injection, exit-code mapping (0/1/2/3). New CLI flags slot into the same shape.
- `@wifo/factory-twin` was deliberately removed from `packages/runtime/package.json` in v0.0.1 (no usage). v0.0.2 re-adds it because `implementPhase` plumbs twin-recording config to the agent subprocess so user code's `fetch` can record/replay through it. The twin itself is not auto-wiring user fetch — the runtime sets env vars; the user's project test setup calls `wrapFetch` against them. Keeps the runtime's mechanism minimal.
- `claude` CLI is invoked headless via `claude -p ... --output-format json`. Subscription auth is implicit (no `ANTHROPIC_API_KEY` is read or set by the runtime). The chosen output format gives a single JSON envelope on stdout: `usage.input_tokens` for the cost cap, `is_error` for self-reported failure, `result` for the final text. (Originally the spec also locked `--bare` for reproducibility, but post-ship verification surfaced that `--bare` strictly disables OAuth/keychain reads in `claude` 2.1+ — incompatible with the locked subscription-auth model. We dropped `--bare` and rely on the rest of the locked surface (`-p`, `--allowedTools`, `--output-format json`) for reproducibility. Recorded in the post-mortem section below.)
- The cost cap is **post-hoc**: tokens are read from the JSON envelope after `claude` exits; if `usage.input_tokens > maxPromptTokens` the runtime persists the `factory-implement-report` (so the user sees what was wasted), then throws `RuntimeError({ code: 'runtime/cost-cap-exceeded' })`. v0.0.3 may add streaming cost monitoring; v0.0.2 commits to the honest design where the cap is a hard *stop*, not a hard *prevent*.
- No git worktree in v0.0.2 — the agent runs in the spec's project root cwd. Git-as-undo is the user's safety net (documented in the README).
- Cross-iteration record threading is **deferred to v0.0.3**. Iteration 2's `implementPhase` does not see iteration 1's `factory-validate-report`. With `--max-iterations` defaulting to 1 (unchanged from v0.0.1), this is observable only when the user opts into multiple iterations and is documented as a v0.0.3 follow-up.
- `examples/gh-stars/` is scaffolded (mirroring `examples/slugify/`): `package.json`, `tsconfig.json`, `.gitignore`, `src/`, `docs/specs/`, `docs/technical-plans/`, and a starter spec (`docs/specs/gh-stars-v1.md`) that the user runs through the full `[implement → validate]` loop. The directory is the v0.0.2 walkthrough surface; the actual `gh-stars` implementation is the agent's job.

## 2. Architecture Decisions

### Module layout

```
packages/runtime/src/
├── types.ts                   # unchanged from v0.0.1
├── errors.ts                  # +'runtime/cost-cap-exceeded', +'runtime/agent-failed' on RuntimeErrorCode
├── records.ts                 # +FactoryImplementReportSchema (re-exports tryRegister)
├── graph.ts                   # unchanged
├── runtime.ts                 # unchanged
├── phases/
│   ├── validate.ts            # unchanged
│   └── implement.ts           # NEW — implementPhase + claude subprocess wrapper + cost cap + report persist
├── cli.ts                     # +--no-implement, default graph [implement → validate], +implement-tuning flags
└── index.ts                   # +implementPhase, +ImplementPhaseOptions
```

`packages/runtime/src/phases/implement.ts` keeps the subprocess wrapper internal (not exported). Tests in `phases/implement.test.ts` exercise it via the public `implementPhase` factory by setting `claudePath` to a fake binary in `test-fixtures/`.

Test fixtures grow:

```
packages/runtime/test-fixtures/
├── all-pass.md                # unchanged
├── will-fail.md               # unchanged
├── trivial-pass.test.ts       # unchanged
├── trivial-fail.test.ts       # unchanged
├── needs-impl.md              # NEW — spec whose test references src/needs-impl.ts (created by fake-claude)
├── needs-impl.test.ts         # NEW — checks src/needs-impl.ts exports a fn
└── fake-claude.ts             # NEW — Bun-runnable shebang script ("claude" stand-in for tests)
```

`fake-claude.ts` reads stdin (the prompt), inspects env vars to pick a behavior (`FAKE_CLAUDE_MODE`, `FAKE_CLAUDE_TOKENS`, `FAKE_CLAUDE_EDIT_FILE`, `FAKE_CLAUDE_EDIT_CONTENT`, `FAKE_CLAUDE_EXIT_CODE`, `FAKE_CLAUDE_DELAY_MS`), and writes a deterministic JSON envelope to stdout. Modes covered: `success` (exits 0, valid JSON, optional file edit), `self-fail` (exits 0, valid JSON with `is_error: true`), `exit-nonzero` (exits non-zero, stderr message), `malformed-json` (exits 0 with non-JSON stdout), `hang` (sleeps past the test timeout — used to exercise the timeout path), `cost-overrun` (exits 0 with `usage.input_tokens` > 100k), `self-kill` (writes partial output to stdout, then `process.kill(process.pid, 'SIGTERM')` — exercises the killed-by-signal branch deterministically without the test runner having to send signals across processes), `echo-env` (exits 0, valid JSON whose `result` field embeds the values of `WIFO_TWIN_MODE` and `WIFO_TWIN_RECORDINGS_DIR` from its own env — used by S-5 to verify the env-var plumbing without coupling to `is_error`/`failureDetail`). Committed `+x` so spawn invokes the shebang directly.

### Public API

The full public surface from `src/index.ts` — **19 names** total (v0.0.1's 17 plus `implementPhase` and `ImplementPhaseOptions`). Adding a name in v0.0.2 requires updating this plan and the spec; the DoD's "matches §2" check is strict equality.

```ts
// runtime
export { run } from './runtime.js';

// graph
export { definePhase, definePhaseGraph } from './graph.js';

// built-in phases
export { validatePhase } from './phases/validate.js';
export type { ValidatePhaseOptions } from './phases/validate.js';
export { implementPhase } from './phases/implement.js';            // NEW
export type { ImplementPhaseOptions } from './phases/implement.js'; // NEW

// errors
export { RuntimeError } from './errors.js';
export type { RuntimeErrorCode } from './errors.js';

// types
export type {
  Phase,
  PhaseContext,
  PhaseResult,
  PhaseGraph,
  PhaseStatus,
  RunOptions,
  RunReport,
  RunStatus,
  PhaseInvocationResult,
  PhaseIterationResult,
} from './types.js';
```

`RuntimeErrorCode` (existing union) gains three members:

```ts
type RuntimeErrorCode =
  | 'runtime/graph-empty'
  | 'runtime/graph-duplicate-phase'
  | 'runtime/graph-unknown-phase'
  | 'runtime/graph-cycle'
  | 'runtime/invalid-max-iterations'
  | 'runtime/io-error'
  | 'runtime/cost-cap-exceeded'           // NEW — agent's reported usage.input_tokens > maxPromptTokens; report is persisted before the throw
  | 'runtime/agent-failed'                // NEW — coarse bucket for spawn failure / timeout / non-zero exit / malformed JSON output; specific reason in failureDetail
  | 'runtime/invalid-max-prompt-tokens';  // NEW — implementPhase({ maxPromptTokens }) called with non-positive integer; symmetric with 'runtime/invalid-max-iterations'
```

The set of codes stays stable; `'runtime/cost-cap-exceeded'` is the user-locked code for the cost-cap hard-stop. `'runtime/agent-failed'` is intentionally coarse — it covers spawn failure, exit-nonzero, output-invalid, and timeout. The `failureDetail` carries the specific reason as a prefix:

- `agent-spawn-failed: <error message>` — `claude` couldn't be spawned (e.g., `ENOENT` if not on PATH).
- `agent-exit-nonzero (code=<n>): <stderr tail>` — `claude` exited with a non-zero status.
- `agent-output-invalid: <reason>; output tail: <stdout tail>` — JSON parse failed or schema didn't match.
- `agent-timeout (after <ms>ms): <stderr tail>` — wall-clock timeout fired (default 600_000 ms).
- `agent-killed-by-signal <signal>: <stderr tail>` — child terminated by an external signal (not our timer).

Three new codes total (`'runtime/cost-cap-exceeded'`, `'runtime/agent-failed'`, `'runtime/invalid-max-prompt-tokens'`). The first is user-locked. The second is intentionally coarse — granular dispatch on agent sub-failures uses the `failureDetail` prefix above. The third is the constructor-time validation error for `implementPhase({ maxPromptTokens })` — symmetric with v0.0.1's `'runtime/invalid-max-iterations'` (validated when `run()` reads `options.maxIterations`); both are thrown synchronously before any record is written.

**Intentionally not exported** (internal): the subprocess wrapper (`spawnAgent` / `parseAgentJson` / file-diff helpers), `FactoryImplementReportSchema`, the prompt builder.

### `ImplementPhaseOptions`

```ts
import type { TwinMode } from '@wifo/factory-twin';

interface ImplementPhaseOptions {
  /** Working directory the `claude` subprocess runs in. Default: `dirname(spec.raw.filename) ?? process.cwd()`. */
  cwd?: string;

  /**
   * Hard cap on `usage.input_tokens` reported by the agent's JSON envelope.
   * If exceeded, the report is persisted (with `status: 'error'`) and the
   * runtime throws `RuntimeError({ code: 'runtime/cost-cap-exceeded' })`.
   * Default: 100_000.
   */
  maxPromptTokens?: number;

  /**
   * Comma-separated tool allowlist passed to `claude -p --allowedTools <value>`.
   * Default: `'Read,Edit,Write,Bash'`.
   */
  allowedTools?: string;

  /** Path to the `claude` executable. Default: `'claude'` (resolved on PATH). Tests pass an explicit path to a fake binary. */
  claudePath?: string;

  /** Wall-clock timeout for the agent invocation. Default: 600_000 ms (10 min). */
  timeoutMs?: number;

  /**
   * Twin recording configuration plumbed to the spawned subprocess via
   * `WIFO_TWIN_MODE` and `WIFO_TWIN_RECORDINGS_DIR` env vars.
   *   - `'off'` — env vars are not set; user code's fetch is unwrapped.
   *   - `{ mode, recordingsDir }` — env vars are set; user code's test setup is responsible for calling `wrapFetch` against them.
   * Default: `{ mode: 'record', recordingsDir: '<cwd>/.factory/twin-recordings' }`.
   */
  twin?: { mode?: TwinMode; recordingsDir?: string } | 'off';

  /** Optional text appended to the default prompt. Useful for callers who want to add extra constraints. */
  promptExtra?: string;
}
```

Inline anonymous `twin` shape avoids adding a third public type export. `TwinMode` is imported from `@wifo/factory-twin`; not re-exported (callers needing the type import it directly).

### Built-in phase: `implementPhase`

```ts
function implementPhase(opts: ImplementPhaseOptions = {}): Phase;
```

Returns a `Phase` named `'implement'`. Behavior per invocation:

0. **Validate options synchronously at factory-call time** (before the closure is constructed). This runs once when `implementPhase(opts)` is called, not per phase invocation:
   - If `opts.maxPromptTokens` is provided and is not a positive integer (`!Number.isInteger(n) || n <= 0`), throw `RuntimeError('runtime/invalid-max-prompt-tokens', 'must be a positive integer (got <value>)')`. Symmetric with how `run()` validates `maxIterations`. No record is written; the error propagates to the caller (or, in the CLI flow, gets caught and surfaces as exit 3 via the runtime's existing error handler).
   - Other options have no validation gates beyond TypeScript's compile-time checks (e.g., `claudePath` as `string`, `twin` as the documented union). Bad values surface as operational errors at invocation time.
1. **Resolve config** (per phase invocation, inside the closure).
   - `cwd = opts.cwd ?? (spec.raw.filename ? dirname(resolve(spec.raw.filename)) : process.cwd())`.
   - `maxPromptTokens = opts.maxPromptTokens ?? 100_000`.
   - `allowedTools = opts.allowedTools ?? 'Read,Edit,Write,Bash'`.
   - `claudePath = opts.claudePath ?? 'claude'`.
   - `timeoutMs = opts.timeoutMs ?? 600_000`.
   - `twinConfig`:
     - if `opts.twin === 'off'` → no env vars set.
     - else → `mode = opts.twin?.mode ?? 'record'`, `recordingsDir = opts.twin?.recordingsDir ?? join(cwd, '.factory/twin-recordings')`. The dir is `mkdir -p`'d when mode is `'record'` (write side); when mode is `'replay'`, missing dir is left alone (the wrapped `fetch` will throw `TwinNoMatchError` on first call — surfacing the misconfiguration to the user, not the runtime).
2. **Register the record type** via `tryRegister(ctx.contextStore, 'factory-implement-report', FactoryImplementReportSchema)`. Idempotent across iterations and across `run()` invocations (mirrors `validatePhase`).
3. **Build the prompt** (see §"Prompt construction" below).
4. **Snapshot pre-state** for diff capture: if `<cwd>/.git` exists, the post-run diff comes from `git diff --no-color` against `HEAD` (covers staged + unstaged). Else, walk the cwd (excluding `node_modules`, `.git`, `.factory`, and any path matched by a top-level `.gitignore`) and record SHA-256 of each file's content into a Map. Pre-state size cap: 5 MB total — if exceeded, diff capture degrades to "paths only" with `diff: ''` per touched file (logged via `ctx.log`).
5. **Spawn `claude`** via `child_process.spawn`:
   ```ts
   const child = spawn(claudePath, [
     '-p',
     '--allowedTools', allowedTools,
     '--output-format', 'json',
   ], {
     cwd,
     env: { ...process.env, ...twinEnvVars }, // additive — never replaces process.env
     stdio: ['pipe', 'pipe', 'pipe'],
   });
   child.stdin.end(prompt, 'utf8');
   ```
   Stdout is collected to a single `Buffer`; stderr is collected and also tailed line-by-line through `ctx.log` (prefix `[claude] `). Wall-clock timeout via `setTimeout` + `child.kill('SIGKILL')` on fire.
6. **On `child.error`** (typically `ENOENT` — `claude` not on PATH) → throw `RuntimeError('runtime/agent-failed', 'agent-spawn-failed: <message>')`. The factory-implement-report is **not** persisted in this branch (we have no envelope to record). The runtime catches the throw → factory-phase status='error' with the same detail.
7. **On `child.close`**:
   - **Timeout fired** → throw `RuntimeError('runtime/agent-failed', 'agent-timeout (after <ms>ms): <stderr tail>')`. No report persist (no envelope).
   - **Killed by signal (not our timer)** → throw `RuntimeError('runtime/agent-failed', 'agent-killed-by-signal <signal>: <stderr tail>')`. No report persist.
   - **Exit code non-zero** → throw `RuntimeError('runtime/agent-failed', 'agent-exit-nonzero (code=<n>): <stderr tail>')`. No report persist (the envelope, if any, is unreliable when claude exits non-zero — typically auth failure / network).
   - **Exit code 0**: parse stdout as JSON.
     - **Parse fails** → throw `RuntimeError('runtime/agent-failed', 'agent-output-invalid: <reason>; output tail: <stdout tail>')`. No report persist.
     - **Parse succeeds** → continue.
8. **Compute post-state diff**: if git, run `git diff --no-color` once and split per-file. Else, walk the cwd again and compare SHA-256s; for changed files, compute a unified diff via a small in-process diff routine (or store before/after content if simpler). `filesChanged: { path, diff }[]` where `path` is relative to `cwd`.
9. **Extract token counts** from the parsed envelope:
   ```ts
   const u = parsed?.usage ?? {};
   const tokens = {
     input: numOr0(u.input_tokens),
     output: numOr0(u.output_tokens),
     cacheCreate: numOrUndef(u.cache_creation_input_tokens),
     cacheRead: numOrUndef(u.cache_read_input_tokens),
     total: numOr0(u.input_tokens) + numOr0(u.output_tokens) + numOr0(u.cache_creation_input_tokens) + numOr0(u.cache_read_input_tokens),
   };
   ```
   `numOr0` / `numOrUndef` defensively coerce missing/non-numeric fields. The cap check uses `tokens.input` only — this matches the user's "max prompt tokens" framing.
10. **Extract `toolsUsed`** (best-effort): try `parsed.tool_uses` (if present, an array of `{ name, ... }` or `string`) and dedup. If the envelope doesn't expose tool-use info, infer from disk delta: any new file → add `'Write'`; any modified file → add `'Edit'`; any non-empty stderr line matching `^\$ ` → add `'Bash'`. The field is honest about being best-effort; the real source of truth is `filesChanged`.
11. **Extract `result` and determine status**: capture `result = String(parsed.result ?? '')` unconditionally — this becomes the report's `result` field regardless of `is_error`. Then:
    - `parsed.is_error === true` → `status = 'fail'`, `failureDetail = (result !== '' ? result : String(parsed.subtype ?? 'agent self-reported failure'))`.
    - else → `status = 'pass'`, `failureDetail` stays `undefined`.

    Storing `result` independently of `failureDetail` gives the audit trail one place to look for "what did the agent say it did?" on every persisted report (success and failure alike) and decouples S-5's env-var-plumbing test from `is_error` semantics.
12. **Cost-cap check**: if `tokens.input > maxPromptTokens` →
    - Override `status` to `'error'` and overwrite `failureDetail` to:
      `cost-cap-exceeded: input_tokens=<n> > maxPromptTokens=<cap>` (any prior `failureDetail` from `is_error: true` is replaced — the cost overrun is the dominant signal). `result` is preserved on the persisted report.
    - **Persist the factory-implement-report** with the overridden status (so the user sees what was wasted, including the agent's `result` text).
    - **Throw** `RuntimeError('runtime/cost-cap-exceeded', '<the same prefixed detail line>')`.
    - The runtime catches the throw → factory-phase status='error'. The implement-report exists on disk with `parents: [ctx.runId]` — discoverable via `factory-context tree <runId>` even though it's not in `factory-phase.outputRecordIds` (because the phase threw before returning).
13. **Persist the factory-implement-report** (non-cost-cap path) with `parents: [ctx.runId]`. Payload shape per §"Record schema" below — `result` is always populated; `failureDetail` is populated only on `status: 'fail'`.
14. **Return** `{ status, records: [implementReportRecord] }`. The `'pass'` and `'fail'` cases both return — the runtime sees `'fail'` and continues to `validate` in the same iteration (validate may pass or fail; it is the judge of correctness). Only `'error'` (cost-cap path, via throw) aborts the run.

### Prompt construction

```ts
function buildPrompt(args: {
  spec: Spec;
  cwd: string;
  iteration: number;
  maxIterations: number;
  promptExtra?: string;
}): string {
  return [
    'You are an automated coding agent in a software factory. Your task is to',
    'implement a software change defined by a Software Factory spec.',
    '',
    'The spec is the contract. The tests in its `test:` lines define correctness.',
    'Your job: edit files in the working directory below so those tests pass.',
    '',
    '# Spec',
    '',
    args.spec.raw.source,
    '',
    '# Working directory',
    '',
    args.cwd,
    '',
    '# Tools',
    '',
    'You have these tools: Read, Edit, Write, Bash. Use them.',
    '',
    '# Constraints',
    '',
    '- Do NOT modify the spec file under `docs/specs/`. The spec is the contract.',
    '- Do NOT add, remove, or upgrade dependencies (no `pnpm add`, `npm install`, `bun add`).',
    '- Do NOT touch files outside the working directory.',
    '- Bash is for running tests and inspecting state. Avoid destructive shell',
    '  commands (no `rm -rf`, `git reset --hard`, `pnpm prune`).',
    '- Keep changes minimal and focused on satisfying the spec\'s `test:` lines.',
    '',
    '# What "done" looks like',
    '',
    '- The tests referenced by the spec\'s `test:` lines pass when you run them',
    '  from the working directory.',
    '- Your final message summarizes what you did: which files you touched and why.',
    '',
    `This is iteration ${args.iteration} of ${args.maxIterations}. The factory will run`,
    'the validate phase next.',
    '',
    'When you are confident the implementation is complete, finish your turn.',
    ...(args.promptExtra ? ['', '# Extra instructions', '', args.promptExtra] : []),
  ].join('\n');
}
```

Cross-iteration context (failures from prior iterations) is **not** appended in v0.0.2 — pinned by deferral. v0.0.3 will extend `buildPrompt` with a `priorValidateReport?: FactoryValidateReportPayload` field.

### Record schema: `factory-implement-report`

```ts
const FactoryImplementReportSchema = z.object({
  specId: z.string(),
  specPath: z.string().optional(),
  iteration: z.number().int().positive(),
  startedAt: z.string(),                    // ISO-8601 UTC
  durationMs: z.number().int().nonnegative(),
  cwd: z.string(),
  prompt: z.string(),                       // full prompt sent to agent
  allowedTools: z.string(),
  claudePath: z.string(),
  status: z.enum(['pass', 'fail', 'error']),
  exitCode: z.number().int().nullable(),    // null if killed by signal / timeout
  signal: z.string().optional(),            // populated when killed by signal
  result: z.string(),                       // agent's final message text from JSON envelope; always populated when the report is persisted (possibly empty); independent of is_error
  filesChanged: z.array(
    z.object({
      path: z.string(),                     // relative to cwd
      diff: z.string(),                     // unified diff or '' if size cap hit
    }),
  ),
  toolsUsed: z.array(z.string()),           // best-effort, see §"Extract toolsUsed"
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheCreate: z.number().int().nonnegative().optional(),
    cacheRead: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative(),
  }),
  failureDetail: z.string().optional(),     // populated on status='fail' (is_error=true) or status='error' (cost-cap-exceeded); independent of result
});
```

Parents: `[ctx.runId]`. The DAG gains `factory-run → factory-implement-report` alongside the existing `factory-run → factory-validate-report`. The parallel `factory-run → factory-phase` chain captures both phase events as before, with `outputRecordIds` cross-referencing the report (except in the cost-cap-throw case where the phase has no outputs).

The `prompt` field stores the full prompt as sent. Specs can reach a few KB; storing them inline keeps the report self-contained for debugging without spelunking the spec at run time. If specs grow much larger in the future, a content-addressed pointer can replace this field — but for v0.0.2 the inline string is honest.

The `claudeJson` raw envelope is **not** stored. The fields we extract are explicit; storing the raw JSON would couple the schema to claude CLI's evolving output format. If the user wants the raw envelope, they can re-run with the same prompt or the runtime can grow a "verbose" mode in v0.0.3.

### Iteration semantics for `[implement → validate]`

The runtime's existing iteration loop (unchanged from v0.0.1) handles the new graph cleanly:

- **Iteration 1, implement passes** → validate runs. If validate passes → converged. If validate fails → iteration 1 status `'fail'`, loop continues if budget allows.
- **Iteration 1, implement fails (`is_error: true` in JSON)** → validate runs anyway (the runtime continues phases on `'fail'`, breaks on `'error'`). Validate decides whether the partial state still satisfies the spec.
- **Iteration 1, implement errors (cost cap, spawn-failed, etc.)** → run aborts. Validate skipped. RunStatus = `'error'`.
- **Iteration 2 (only if `--max-iterations > 1`)**: implement runs again from the current cwd state. v0.0.2 has no cross-iteration context plumbing, so the prompt is identical to iteration 1's. The agent picks up whatever changes were on disk from iteration 1 and continues. This is observable by the user; the README documents it as "iteration 2 in v0.0.2 is essentially a re-run with the agent's prior changes already applied — useful only when iteration 1's agent crashed mid-edit. Iteration auto-loop with cross-iteration context is v0.0.3."

The default `--max-iterations` stays `1` (unchanged from v0.0.1; v0.0.2 keeps the human-triggered iteration model per the user's locked scope).

### Twin env-var plumbing

When `opts.twin !== 'off'` (the default), implementPhase sets two environment variables in the spawned subprocess:

```
WIFO_TWIN_MODE=record|replay
WIFO_TWIN_RECORDINGS_DIR=<absolute path>
```

These are **additive** to `process.env` (the spawn merges `{ ...process.env, ...twinEnvVars }`). The user's project test setup (typically a Bun preload or a top-of-test-file import) is responsible for actually wrapping `globalThis.fetch`:

```ts
// example: examples/gh-stars/src/twin-setup.ts
import { wrapFetch } from '@wifo/factory-twin';

const mode = process.env.WIFO_TWIN_MODE;
const dir = process.env.WIFO_TWIN_RECORDINGS_DIR;
if (mode && dir) {
  globalThis.fetch = wrapFetch(globalThis.fetch, { mode, recordingsDir: dir });
}
```

The runtime does **not** auto-inject this preload. The user opts in by importing the setup at the top of their test files (or via `bunfig.toml` `[test] preload`). This is the simplest plumbing that satisfies "wrapped in record-mode by default" — the *defaults* are record-mode; the *mechanism* is opt-in by user code.

The same env vars propagate from `process.env` into `validatePhase`'s subsequent `bun test` invocations because `runHarness` inherits the parent's environment. This means if the user's project wraps `fetch` in their test setup, the same wrapping applies during both implement (when the agent's Bash invocations run user code) and validate (when the harness runs `bun test`). Recordings made during implement are replayable during validate — that's the v0.0.2 happy path the gh-stars demo exercises.

When `opts.twin === 'off'` (explicit disable), the env vars are not set, the recordings dir is not created, and user code's `wrapFetch` setup is a no-op (the `if (mode && dir)` guard short-circuits).

### File-diff capture

Two implementations chosen at runtime by the presence of `<cwd>/.git`:

**Git path** (preferred, when `.git` exists):

```bash
git -C <cwd> diff --no-color HEAD --
```

The single combined diff is split per file by parsing `diff --git a/<path> b/<path>` headers. Output: `filesChanged: { path, diff }[]` with `diff` being the per-file unified diff hunk(s).

**Hash path** (fallback, when `.git` does not exist):

1. Pre-state walk: collect SHA-256 of every file's content under cwd, excluding a hardcoded ignore list: `node_modules/`, `.git/`, `.factory/`, `dist/`, `build/`, `coverage/`, `.next/`, `.turbo/`. The walk does **not** parse `.gitignore` (node:fs doesn't honor it natively, and a partial parser is a footgun). Skip files > 1 MB (record path with `diff: ''` if changed). Cap total pre-state size at 5 MB; if exceeded, fall back to "paths only" mode for the entire phase (every changed file gets `diff: ''`, and `ctx.log` emits a one-line warning).
2. Post-state walk: same algorithm, intersect with pre-state. For each path with a different hash (or new path), compute a unified diff via a small in-process diff (e.g., `node:diff` is not built-in — implement minimally with `diffLines`-style logic, or use a tiny dep like `diff` if added; for v0.0.2 we go without a new dep and store before/after content concatenated with a separator — honest about being a degraded mode).

The `git` path is the v0.0.2 happy path because the gh-stars demo (and slugify, and most user projects) is a git repo. The hash fallback exists so unit tests against scratch dirs without `.git` still produce a non-empty `filesChanged`.

### CLI

```
factory-runtime run <spec-path> [flags]

Flags:
  --max-iterations <n>          Max iterations (default: 1; v0.0.3 may flip to 5)
  --context-dir <path>          Context store directory (default: ./context)
  --scenario <ids>              Comma-separated scenario ids (e.g. S-1,S-2,H-1)
  --no-judge                    Skip judge satisfactions in the harness
  --no-implement                Use the v0.0.1 graph [validate] only (skip the agent invocation)
  --max-prompt-tokens <n>       Hard cap on agent input tokens (default: 100000)
  --claude-bin <path>           Path to the claude executable (default: 'claude' on PATH)
  --twin-mode <record|replay|off>  Twin recording mode (default: record)
  --twin-recordings-dir <path>  Twin recordings directory (default: <cwd>/.factory/twin-recordings)
```

Behavior changes vs v0.0.1:

1. **Default graph** is now `[implement → validate]` — `definePhaseGraph([implementPhase(implOpts), validatePhase(valOpts)], [['implement', 'validate']])`. Both phase-options objects pin `cwd: process.cwd()` explicitly so the agent's edits and the harness's `bun test` invocation resolve against the same tree (validatePhase already defaults to dirname-of-spec when `cwd` isn't provided; passing `process.cwd()` explicitly to both keeps them symmetric and aligns with v0.0.1's CLI behavior). Pinned by §"Confirmed constraints".
2. **`--no-implement`** drops back to `[validate]` only, with no edges. The CLI does not even instantiate `implementPhase` in this mode (so missing `claude` on PATH is not a problem for `--no-implement` users), nor does it parse the implement-tuning flags (`--max-prompt-tokens`, `--claude-bin`, `--twin-*` are ignored when `--no-implement` is set; the CLI emits no warning — they're simply inert in that mode).
3. **`--max-prompt-tokens 0` or non-numeric** → exit 2 with stderr line `runtime/invalid-max-prompt-tokens: --max-prompt-tokens must be a positive integer (got '<raw>')` (parsed via the same positive-integer validator as `--max-iterations`). The CLI emits the prefix manually (matching the v0.0.1 `--max-iterations` pattern); the actual `RuntimeError({ code: 'runtime/invalid-max-prompt-tokens' })` only fires when programmatic callers construct `implementPhase({ maxPromptTokens: 0 })` directly — symmetric with how `runtime/invalid-max-iterations` works.
4. **`--twin-mode off`** → `opts.twin = 'off'`. Other values (`record`, `replay`) → `opts.twin = { mode: <value>, recordingsDir: <flag-or-default> }`. Unknown values exit 2 with stderr line `runtime/invalid-twin-mode: --twin-mode must be one of 'record', 'replay', 'off' (got '<raw>')` (no RuntimeErrorCode addition — pure CLI validation).
5. **Exit codes unchanged**: `0` converged, `1` no-converge, `2` usage error, `3` operational error.
6. **Summary lines unchanged in shape**, but the `'error'` line for a cost-cap abort surfaces the failureDetail directly:
   `factory-runtime: error during phase 'implement' iteration <n> (run=<runId>)\n  detail: cost-cap-exceeded: input_tokens=<actual> > maxPromptTokens=<cap>\n`
   The runtime's existing `'error'` handler reads `failureDetail` from the persisted factory-phase record — no CLI changes needed here.

The CLI does not expose `--allowed-tools`, `--timeout-ms`, or `--prompt-extra` in v0.0.2. Those are programmatic-API knobs (`ImplementPhaseOptions`); CLI users who need them edit the entry point. Adding a CLI flag for every option becomes the v0.0.3 polish if the demand exists.

### Confirmed constraints

- Public API surface is the §2 list above (19 names: 5 functions + 1 class + 13 types). Strict equality enforced by the DoD.
- `RuntimeErrorCode` gains exactly three members: `'runtime/cost-cap-exceeded'`, `'runtime/agent-failed'`, `'runtime/invalid-max-prompt-tokens'`. The existing six are unchanged. Adding members to the union does **not** change the public name count (still 19); the type name `RuntimeErrorCode` is a single export whose membership grows.
- `implementPhase(opts?)` is a factory: returns a `Phase` named `'implement'`. Mirrors `validatePhase` exactly.
- `implementPhase(opts)` validates `opts.maxPromptTokens` synchronously at factory-call time: a non-positive-integer value throws `RuntimeError({ code: 'runtime/invalid-max-prompt-tokens' })` before the closure is constructed. Symmetric with `run()`'s validation of `options.maxIterations`. No record is written.
- `factory-implement-report` carries a `result: string` field that is **always populated** when the report is persisted (success or failure path; possibly empty string if the agent's envelope had no `result`). `failureDetail` is independent of `result` — it's populated only on `status: 'fail'` (agent self-reported failure) or `status: 'error'` (cost-cap-exceeded). The audit trail's "what did the agent say it did" question always resolves to `result`; "what went wrong" resolves to `failureDetail`. Pinned by S-1's judge and S-5's plumbing test.
- The CLI passes `cwd: process.cwd()` explicitly to **both** `implementPhase` and `validatePhase` so the agent's edits and the harness's `bun test` subprocess resolve against the same tree. Without this, `implementPhase` would default to `dirname(spec.raw.filename)` while v0.0.1's CLI passes `process.cwd()` to `validatePhase` — causing the agent and validate to operate on different trees when the spec lives in a subdirectory of the cwd. Pinned by S-6 / T6.
- The agent subprocess is `claude -p --allowedTools <list> --output-format json` with the prompt on stdin. No `ANTHROPIC_API_KEY` is read or set by the runtime (subscription auth is implicit). The `--bare` flag from the original lock was dropped post-ship — see the post-mortem note in §1 — because it strictly disables OAuth/keychain reads, conflicting with the subscription-auth requirement.
- Default tool allowlist is `'Read,Edit,Write,Bash'`. Bash is unrestricted at the CLI flag level; constraints come via the prompt.
- Cost cap is post-hoc on `usage.input_tokens` against `maxPromptTokens` (default 100_000). On overrun, the factory-implement-report is persisted with `status: 'error'` *before* `RuntimeError({ code: 'runtime/cost-cap-exceeded' })` is thrown, so the user can audit the wasted run via `factory-context tree <runId>`. The implement-report's `parents: [ctx.runId]` keeps it discoverable even though it is not in `factory-phase.outputRecordIds` (the phase threw before returning).
- Wall-clock timeout is `timeoutMs` (default 600_000 ms = 10 min). Timeout fires `SIGKILL`; the runtime throws `RuntimeError({ code: 'runtime/agent-failed' })` with `'agent-timeout'` prefix in `failureDetail`.
- Spawn failure (`ENOENT` for missing `claude` binary), exit-nonzero, malformed-JSON output, and timeout all surface as `RuntimeError({ code: 'runtime/agent-failed' })` with a `failureDetail` prefix that names the specific reason. No factory-implement-report is persisted in these branches (no envelope to record).
- `is_error: true` in the parsed JSON envelope → `status: 'fail'` (not `'error'`). Validate still runs in the same iteration. The factory-implement-report is persisted with `status: 'fail'` and the agent's self-reported reason in `failureDetail`.
- File-diff capture: `git diff --no-color HEAD --` if `<cwd>/.git` exists; SHA-256 hash walk fallback otherwise. `filesChanged: { path, diff }[]`. Total pre-state size cap 5 MB; exceeding it degrades to "paths only" with `diff: ''` and a one-line `ctx.log` warning.
- `toolsUsed` is best-effort: extracted from `parsed.tool_uses` if present; inferred from disk delta + stderr otherwise. The field's array shape is stable; specific contents are honest about being approximate.
- Twin plumbing: `WIFO_TWIN_MODE` and `WIFO_TWIN_RECORDINGS_DIR` env vars are set on the spawned subprocess (additive to `process.env`). Default mode `'record'`, default dir `<cwd>/.factory/twin-recordings`. `opts.twin === 'off'` skips both. The user's project is responsible for calling `wrapFetch` against these env vars in their test setup.
- Cross-iteration context plumbing is **deferred to v0.0.3**. v0.0.2's prompt does not include prior iterations' validate-report failures.
- `--max-iterations` default stays `1`. v0.0.2 is the human-triggered single-shot model per the user's locked scope.
- New CLI flags: `--no-implement`, `--max-prompt-tokens`, `--claude-bin`, `--twin-mode`, `--twin-recordings-dir`. `--max-prompt-tokens` accepts positive integers only (mirrors `--max-iterations` validation; exit 2 on bad value).
- `--no-implement` builds the v0.0.1 `[validate]` graph and does not instantiate `implementPhase` at all — missing `claude` on PATH is not a precondition for that mode.
- Strict ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. Every type import uses `import type`. Every array/object index access is guarded.
- `@wifo/factory-twin` is **re-added** to `packages/runtime/package.json` `dependencies` at T1 (it's now actually used: `import type { TwinMode } from '@wifo/factory-twin'` in `phases/implement.ts`).
- `examples/gh-stars/` mirrors `examples/slugify/`: scaffold-only — `package.json`, `tsconfig.json`, `.gitignore`, empty `src/`, `docs/specs/`, `docs/technical-plans/`. Includes a starter `docs/specs/gh-stars-v1.md` so the user can run `pnpm exec factory-runtime run docs/specs/gh-stars-v1.md` immediately. The agent fills in `src/`. README walks through the v0.0.2 loop.

## 3. Risk Assessment

- **`claude` CLI behavior assumptions**: this plan commits to (a) `claude -p` reading the prompt from stdin when no positional is given, (b) `--output-format json` producing a single JSON envelope on stdout with `usage.input_tokens` and `is_error` fields. If the actual CLI's behavior differs, the implementer surfaces it during T3 and we patch the spawn args. The fake-claude binary insulates unit tests from this; integration verification is part of the gh-stars walkthrough at T7. (The original lock also included `--bare`, but real-world verification on `claude` 2.1.123 showed that flag strictly disables OAuth/keychain reads — incompatible with subscription auth. Dropped post-ship; the rest of the surface preserves the reproducibility intent.)
- **Token-count field name drift**: `usage.input_tokens` vs `usage.prompt_tokens` vs other variations. The defensive extractor (`numOr0(u.input_tokens)`) handles this gracefully — if the field is absent, the cap check uses `0` and never trips. The risk is *under-counting*, not over-counting; the user's first real run flags it via "cost cap never trips even on long sessions." Documented in the README as a known v0.0.2 calibration point.
- **`is_error` semantics**: claude CLI uses `is_error: true` for max-turns / execution errors; the runtime maps this to `status: 'fail'` (not `'error'`). The risk is over-mapping (a transient agent error gets treated as a real failure). Validate runs anyway, so the user still sees whether the partial state satisfies the spec. Acceptable for v0.0.2.
- **Cost-cap is retroactive, not preventive**: the agent has already used the tokens by the time we read the envelope. v0.0.2 commits to "hard-stop on overrun" (post-hoc abort), not "prevent overrun" (which would require streaming token monitoring — v0.0.3 territory). Pinned in §2; documented in README.
- **Disk-diff blast radius**: the agent has full `Read,Edit,Write,Bash` access in the spec's project root cwd. A pathological agent could `rm -rf` everything. Mitigation in v0.0.2: prompt-level constraint ("avoid destructive shell commands"); user runs in a git repo; documented. Worktree sandbox is v0.0.3+. Pinned by user lock.
- **`@wifo/factory-twin` re-add**: pulls the dep back into the runtime workspace. No runtime imports from twin beyond `import type { TwinMode }` in `ImplementPhaseOptions` — the actual `wrapFetch` call lives in user code. Lockfile churn is small.
- **`--no-implement` parity with v0.0.1**: a subtle risk is that the new default graph plumbing accidentally changes something in the `[validate]`-only path (e.g., extra type registration, different summary line). H-2 catches this: `--no-implement` produces *exactly* the v0.0.1 on-disk record set (one factory-run, one factory-phase per iteration, one factory-validate-report per iteration; no factory-implement-report).
- **Subprocess hang under timeout**: `child.kill('SIGKILL')` on timeout is the safe choice (mirrors harness's runner). `claude` running shell commands via Bash that themselves spawn long-lived processes could leak orphans. v0.0.2 accepts this; v0.0.3 may switch to process-group kill if it's an issue in practice.
- **Stdin write closing before claude is ready**: `child.stdin.end(prompt, 'utf8')` writes-and-closes synchronously. If claude expects stdin open during streaming (it doesn't, with `-p`), this would deadlock. Documented assumption; tested via fake-claude reading stdin to EOF.
- **Pre-state hash walk performance**: a 1000-file project with ~100 KB average files takes ~100 ms. Acceptable for v0.0.2. Cap at 5 MB total to bound worst-case cost; degrade gracefully on overflow.
- **Shared `process.env` across phases**: setting `WIFO_TWIN_MODE` etc. in `process.env` is not done — env vars are merged into the spawned child only (`{ ...process.env, ...twinEnvVars }`). This avoids polluting the parent process and surprising downstream code. Pinned in §2.
- **Hash collision in factory-implement-report**: the payload includes `iteration` and `startedAt`, so two iterations of the same phase with otherwise identical envelopes don't collide on id. Two iterations producing byte-identical reports across different runs (same prompt, same agent output) *would* collide — but that's content addressing working as intended, not a bug.
- **gh-stars demo scope**: the agent has to write a working CLI with caching and rate-limit handling. If iteration 1 doesn't converge, the user re-runs manually (v0.0.2 model). The DoD does not require gh-stars to converge in 1 iteration — only that the loop executes end-to-end and produces a typed report. Pinned by the roadmap.
- **Blast radius**: contained to `packages/runtime/` (additive: new phase, errors-union extension, CLI flags) and `examples/gh-stars/` (new scaffold). No changes to `core`/`harness`/`twin`/`context`. `pnpm test` workspace-wide stays green; the runtime suite grows by the implementPhase tests + new CLI tests.

## 4. Subtask Outline

Eight subtasks, ~1230 LOC source plus tests. Full test pointers in `docs/specs/factory-runtime-v0-0-2.md`.

- **T1** [config] — Bump `packages/runtime/package.json` to `0.0.2`; **re-add `@wifo/factory-twin: workspace:*`** to `dependencies`; create empty source files (`src/phases/implement.ts`); create test fixtures dir entries for `needs-impl.md`, `needs-impl.test.ts`, and a placeholder `fake-claude.ts` (filled in T5). ~30 LOC.
- **T2** [feature] — `src/errors.ts` extension: add `'runtime/cost-cap-exceeded'`, `'runtime/agent-failed'`, and `'runtime/invalid-max-prompt-tokens'` to `RuntimeErrorCode` (three new members; existing six unchanged). `src/records.ts` extension: add `FactoryImplementReportSchema` (zod schema per the data-model decision above, including the `result: z.string()` field that is always populated when the report is persisted); export the inferred `FactoryImplementReportPayload` type internally (not in public surface). Tests: schema accept/reject for the new schema (including a payload with `result: ''` empty string and `failureDetail: undefined`, which is the success path's persistence shape); `RuntimeError` `instanceof` + each of the three new `code` values discriminate cleanly. **depends on nothing new** (pure extensions). ~140 LOC.
- **T3** [feature] — Internal subprocess wrapper helpers in `src/phases/implement.ts` (not exported): `spawnAgent({ claudePath, allowedTools, cwd, env, prompt, timeoutMs, log })` returning `Promise<{ exitCode, signal?, stdout, stderr }>` (or rejecting with `RuntimeError({ code: 'runtime/agent-failed' })` on spawn-error / timeout / exit-nonzero / killed-by-signal); `parseAgentJson(stdout)` returning the typed envelope or throwing `RuntimeError({ code: 'runtime/agent-failed' })` with `'agent-output-invalid'` prefix; ANSI-strip + 4 KB tail cap helpers (lifted from harness's runner — duplicated, not depended-on, since runtime should not depend on harness internals). Tests via fake-claude binary covering: spawn-success, spawn-failed (`claudePath` set to nonexistent path), exit-nonzero, malformed-json, timeout (SIGKILL), kill-by-external-signal. **depends on T2**. ~280 LOC.
- **T4** [feature] — `implementPhase(opts)` factory in `src/phases/implement.ts`: factory-call-time validation of `opts.maxPromptTokens` (non-positive → `RuntimeError({ code: 'runtime/invalid-max-prompt-tokens' })` thrown synchronously before the closure is constructed); prompt builder; twin env-var resolution; file-diff capture (git path + hash fallback with the hardcoded ignore list per §"File-diff capture" — no `.gitignore` parsing); token extraction with defensive coercion; `result` extraction (`String(parsed.result ?? '')` always, regardless of `is_error`) — populated on every persisted report; status mapping (`is_error: true → 'fail'`, else `'pass'`); cost-cap check (overrun → persist report with `'error'` and overwrite `failureDetail` with `cost-cap-exceeded: …` while preserving `result` → throw `RuntimeError({ code: 'runtime/cost-cap-exceeded' })`); record persistence with `parents: [ctx.runId]`; `tryRegister` for the new schema; `ctx.log` forwarding for stderr tail (prefix `[claude] `). Tests: happy path (status `'pass'` + report payload assertions on prompt / files / tools / tokens / exitCode / `result` non-empty / `failureDetail` undefined / parents), `is_error: true` → `'fail'` with persisted report (asserts both `result` and `failureDetail` populated), cost-cap → both records on disk + thrown `RuntimeError` (asserts `result` preserved on the persisted report even though `failureDetail` was overwritten to the `cost-cap-exceeded:` line), `implementPhase({ maxPromptTokens: 0 })` throws synchronously before any record is written, twin env vars set on subprocess (verified via the `echo-env` fake-claude mode embedding `WIFO_TWIN_MODE` and `WIFO_TWIN_RECORDINGS_DIR` into the JSON envelope's `result` field — assertion runs against `payload.result`), `twin: 'off'` skips env vars and dir creation. **depends on T2, T3**. ~330 LOC.
- **T5** [feature] — Test fixtures: `test-fixtures/fake-claude.ts` (Bun shebang script, `+x`, supports all FAKE_CLAUDE_MODE values listed in §2), `test-fixtures/needs-impl.md` (spec referencing `test-fixtures/needs-impl.test.ts`), `test-fixtures/needs-impl.test.ts` (a `bun test` that asserts `src/needs-impl.ts` exports a function — the fake-claude in success mode writes that file, making the validate phase pass). Integration test in `phases/implement.test.ts` exercising `implementPhase + validatePhase` end-to-end against `needs-impl.md` with the fake binary. **depends on T3, T4**. ~180 LOC.
- **T6** [feature] — `src/cli.ts` extension: add `--no-implement`, `--max-prompt-tokens`, `--claude-bin`, `--twin-mode`, `--twin-recordings-dir` flags; flip default graph to `[implement → validate]` with the `['implement', 'validate']` edge. **Pin both phase factories' `cwd` to `process.cwd()` explicitly** — `validatePhase({ cwd: process.cwd(), ... })` (already the v0.0.1 behavior) and `implementPhase({ cwd: process.cwd(), ... })` — so the agent's edits and the harness's `bun test` invocation resolve against the same tree. Route `opts.maxPromptTokens` / `opts.claudePath` / `opts.twin` into `implementPhase` from the parsed flags. `--max-prompt-tokens 0` (or non-numeric) → exit 2 with stderr line `runtime/invalid-max-prompt-tokens: --max-prompt-tokens must be a positive integer (got '<raw>')` (manual emit, mirrors `--max-iterations`). `--twin-mode <unknown>` → exit 2 with stderr line `runtime/invalid-twin-mode: ...`. CLI tests via `Bun.spawn`: default flow with `claudePath` overridden via `--claude-bin <fake>` (covers happy path + cost-cap exit 3 with the `cost-cap-exceeded:` detail line + `--no-implement` parity with v0.0.1's record set). **depends on T4**. ~260 LOC.
- **T7** [chore] — `examples/gh-stars/`: scaffold mirroring `examples/slugify/` (`package.json` declaring `@wifo/factory-runtime`, `@wifo/factory-twin`, `@wifo/factory-context`, `@wifo/factory-core` as `workspace:*`; `tsconfig.json`; `.gitignore` excluding `.factory/` and `node_modules/`; empty `src/`; `docs/specs/gh-stars-v1.md` starter spec covering the GitHub stargazers + caching + rate-limit scenarios; `docs/technical-plans/`; `README.md` walking the v0.0.2 loop). The starter spec is one the user can edit; the agent fills in `src/`. ~100 LOC (mostly README + spec). **depends on T6** (CLI flags need to be settled to document correctly).
- **T8** [chore] — `src/index.ts` re-exports updated to add `implementPhase` and `ImplementPhaseOptions` (19 names total); `packages/runtime/README.md` expanded with: programmatic example using `implementPhase`, the new CLI flags, the on-disk record types (now: factory-run, factory-phase, factory-validate-report, factory-implement-report) and parent chain, the cost-cap design (post-hoc, hard-stop), the twin env-var convention with example test setup, the `is_error → 'fail'` semantics, the v0.0.2 single-iteration model with v0.0.3 cross-iteration follow-up, the `RuntimeError.code` list including the three new codes, the `claude` CLI prerequisite. **depends on T2..T7**. ~120 LOC.

Total LOC ≈ 1230. Surface area: changes confined to `packages/runtime/` and one new scaffold under `examples/gh-stars/`.

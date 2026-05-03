# Technical plan — dod-verifier-v0-0-10

## 1. Context

### What exists today

- `factory-runtime run` ships with a `[implement → validate]` graph (since v0.0.3). Convergence is decided by `validatePhase`'s output: every scenario's `test:` lines pass + every `judge:` line passes. `## Definition of Done` bullets are documentation only — the runtime never reads or executes them.
- The harness's judge runner (`packages/harness/src/judge.ts`) handles `judge:` lines via `claude -p` subprocess. It is the existing path for LLM-judged criteria; it does NOT execute Bash.
- `validatePhase` (`packages/runtime/src/phases/validate.ts`) iterates scenarios. Per scenario, runs `bun test --filter <pattern>` for `test:` lines, calls the judge client for `judge:` lines.
- Convergence in `runtime.ts` (line ~243): an iteration converges when every phase's status is `'pass'`; iterates while any phase is `'fail'`; aborts on any `'error'`.
- v0.0.5 added `# Prior validate report` section in `implementPhase`'s prompt (cross-iteration threading) — failed scenarios are summarized for the next iteration's agent. Same pattern can carry "failed DoD shell gates."
- v0.0.9 shipped scaffold scripts (`typecheck`, `test`, `check`, `build`) — DoD bullets like `` `pnpm typecheck` `` are now actually runnable in fresh `factory init` projects. Without v0.0.9, this work was premature.

### Patterns to follow

- **New phase shape:** mirror `validatePhase` and `implementPhase`. Export a factory function `dodPhase(options)` that returns a `Phase` (per `definePhase` in `graph.ts`). The phase's `run(ctx)` does the work and returns `PhaseResult` with `records` containing the new `factory-dod-report` record.
- **New record type:** mirror `FactoryValidateReportSchema`. Register in `records.ts`; `tryRegister` at runtime startup; persist via `putOrWrap`.
- **Cross-iteration threading:** when iteration N fails, iteration N+1's `implementPhase` gets a `# Prior DoD report` section (added to the existing prior-report machinery in `phases/implement.ts`).
- **CLI flag pattern:** `--skip-dod-phase` (boolean), mirrors `--no-judge`. Reads optional config from `factory.config.json runtime.skipDodPhase`. CLI > config > built-in default.

### Constraints the existing architecture imposes

- `validatePhase` is the existing convergence gate. `dodPhase` is added AFTER `validatePhase` in the default graph. Iteration converges when BOTH pass. If `validatePhase` fails, `dodPhase` is still attempted (so the agent sees both failure surfaces in iteration N+1's prompt).
- The harness's judge runner is reused for non-shell DoD bullets (the bullets that say "Public API surface unchanged across every package" stay LLM-judged). DoD-verifier scans bullets, classifies each as `shell-runnable` or `judge`, executes shell ones via Bash subprocess, dispatches judge ones to the existing harness judge client.
- `factory.config.json`'s `runtime.*` schema is forward-compat: new keys land via `.partial()` extension. `runtime.skipDodPhase?: boolean` slots in cleanly.
- The default graph in `runtime/src/cli.ts` is built fresh per invocation. Adding `dodPhase` to the default ordering is a one-line change there. Programmatic callers building their own graph keep current control.

## 2. Architecture decisions

### New built-in: `dodPhase`

```ts
// packages/runtime/src/phases/dod.ts
export interface DodPhaseOptions {
  cwd: string;
  /** Optional shell binary; default 'bash'. Test injection point. */
  shellBin?: string;
  /** Per-DoD-bullet timeout. Default 60_000. Errors → fail with stderr captured. */
  timeoutMs?: number;
  /** Optional override for the harness judge client (for non-shell bullets). */
  judgeClient?: JudgeClient;
}

export function dodPhase(opts: DodPhaseOptions): Phase;
```

Phase behavior:
1. Read the spec's body via `ctx.spec.body`.
2. Slice the `## Definition of Done` section via `findSection(spec.body, 'Definition of Done')` (existing helper from `@wifo/factory-core`).
3. Parse each bullet via a new `parseDodBullets(section)` helper exported from `@wifo/factory-core`.
4. For each bullet:
   - If `kind: 'shell'` → spawn `bash -c <command>` from `opts.cwd`; capture stdout/stderr; record exit code.
   - If `kind: 'judge'` → call `opts.judgeClient.judge({...})` mirroring `validatePhase`'s judge dispatch shape.
5. Aggregate results. Persist a `factory-dod-report` record. Return phase status:
   - `'pass'` if every bullet passed.
   - `'fail'` if any bullet failed (run got a non-zero exit OR judge returned `pass: false`).
   - `'error'` if a bullet's execution itself errored (timeout, missing shell, etc.).

### DoD bullet parser (`parseDodBullets`)

NEW in `@wifo/factory-core/src/parser.ts` (exported alongside `parseSpec`).

```ts
export type DodBullet =
  | { kind: 'shell'; command: string; line: number; raw: string }
  | { kind: 'judge'; criterion: string; line: number; raw: string };

export function parseDodBullets(dodSection: SectionExtract): DodBullet[];
```

Heuristic:
- Each `- ` bullet line under `## Definition of Done` is a candidate.
- If the bullet body contains EXACTLY ONE backtick-wrapped token AND that token starts with a known runner (`pnpm`, `bun`, `npm`, `node`, `tsc`, `git`, `pnpm exec`, `npx`, `bash`, `sh`, `make`, `./` prefix) OR contains shell pipes/redirects: classify as `shell`. Strip the backticks; the inner text is the command.
- If the bullet body contains MULTIPLE backtick-wrapped tokens: classify as `judge` (ambiguous; the LLM judges whether the criterion holds).
- If the bullet has zero backticks and is plain prose: classify as `judge`.
- Locked runner allowlist (no shell injection from arbitrary commands): see Constraints below.

### New context record: `factory-dod-report`

```ts
// packages/runtime/src/records.ts
export const FactoryDodReportSchema = z.object({
  specId: z.string(),
  iteration: z.number().int().positive(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  bullets: z.array(z.object({
    kind: z.enum(['shell', 'judge']),
    bullet: z.string(),
    status: z.enum(['pass', 'fail', 'error']),
    command: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
    stderrTail: z.string().optional(),
    judgeReasoning: z.string().optional(),
    durationMs: z.number().int().nonnegative(),
  })),
  summary: z.object({
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  status: z.enum(['pass', 'fail', 'error']),
});
```

### `RunOptions.skipDodPhase?: boolean`

Field-level addition. When `true`, the dodPhase is excluded from the default graph (`runtime/src/cli.ts` checks the flag and omits dodPhase from the constructed graph). Programmatic callers building their own graph aren't affected — they include or exclude dodPhase as they choose.

### CLI flag

`--skip-dod-phase` (boolean). Mirrors `--no-judge`. `factory.config.json` `runtime.skipDodPhase` extends the existing partial schema.

### Default-graph wiring

`runtime/src/cli.ts`'s graph composition becomes:
```
[implement, validate, dod] with edges [['implement', 'validate'], ['validate', 'dod']]
```
when `--no-implement` is absent and `--skip-dod-phase` is absent. Other combinations:
- `--no-implement --skip-dod-phase` → `[validate]`
- `--no-implement` → `[validate, dod]`
- `--skip-dod-phase` → `[implement, validate]`

### Cross-iteration threading

`implementPhase`'s `buildPrompt` (since v0.0.3) emits `# Prior validate report` when iteration ≥ 2. v0.0.10 adds a parallel `# Prior DoD report` section listing failed shell commands + their stderr-tails (truncated per the v0.0.3 1KB-per-line + 50KB-section caps). The prompt becomes:
```
# Implementation guidelines (v0.0.5)
# Spec
[spec body]
# Prior validate report (v0.0.3, when iter ≥ 2 + validate failed)
[failed scenarios summary]
# Prior DoD report (NEW v0.0.10, when iter ≥ 2 + dod failed)
[failed DoD bullets summary]
# Working directory
[...]
```

Both prior-report sections are byte-stable across iterations of the same failure (cache-friendly), per the v0.0.5 invariant. The `# Implementation guidelines` and `# Spec` sections remain bytewise identical across iterations as they are today.

### Convergence semantics (locked)

An iteration converges when every phase's status is `'pass'`. With dodPhase added, convergence requires implement-pass AND validate-pass AND dod-pass. The runtime's existing `aggregateIterationStatus` logic is generic across phase names — no changes needed.

`runReport.iterationCount` reflects the number of iterations actually run. `runReport.iterations[].phases` includes the new dodPhase invocation per iteration.

## 3. Risk assessment

### Blast radius

- **Existing `factory-runtime run` callers without explicit graphs:** behavior changes — convergence now requires DoD shell gates pass. Specs that ship today with aspirational DoD bullets ("typecheck green") that referenced scripts that don't exist would have converged in v0.0.9 (test phase passes, DoD ignored); in v0.0.10 they'll fail until the scaffold scripts are present (closes the v0.0.6 BASELINE trust gap by design). Backwards compat preserved via `--skip-dod-phase` flag and `factory.config.json runtime.skipDodPhase: true`.
- **Specs in `docs/specs/done/`** (already shipped) — not affected; their convergence happened pre-v0.0.10. Future re-runs of those specs would now fail DoD if the scaffold's scripts aren't present. Acceptable: the maintainer should fix the scaffold scripts (which v0.0.9 already did) before re-running.
- **Programmatic `run()` callers building their own graphs:** unaffected unless they explicitly add `dodPhase` to their graph. They opt in.

### Migration concerns

- New record type registers via `tryRegister` at runtime startup. No migration needed for existing context stores.
- The default graph change is opt-out via flag — strict back-compat is preserved.
- `RunOptions.skipDodPhase` is optional. Existing programmatic callers don't break.

### Performance

- Each shell DoD bullet spawns a Bash subprocess. Typical specs have 3-5 DoD bullets; per-iteration overhead is on the order of a few seconds (typecheck + test + check). Worth measuring on the v0.0.10 BASELINE re-run.
- The judge dispatch for non-shell bullets adds N more `claude -p` subprocess calls per iteration when iterations need them (the existing harness `--no-judge` flag already extends to dodPhase via the new `--skip-dod-phase` knob). Cost: same per-judge as `validatePhase`'s judge dispatches.
- Token impact: cross-iteration threading adds one new section to the prompt (cache-friendly, byte-stable per-iteration), bounded by the existing v0.0.3 50KB cap.

### Failure modes worth pinning in tests

- A DoD bullet referencing a script that doesn't exist (e.g., `` `pnpm lint` `` when `lint` script isn't defined) → bash exits non-zero → dodPhase fails → next iteration's prompt shows the failure → agent fixes the script or the spec.
- A DoD bullet that times out (long-running command) → dodPhase records `'error'` + the timeout-ms in `stderrTail` → iteration aborts.
- A DoD section that's empty (LIGHT specs that only say "All scenarios pass") → dodPhase reports zero bullets, status: 'pass'. No-op convergence.
- A DoD bullet with multiple backticks (e.g., "`pnpm typecheck` and `pnpm test` both pass") → classified as `'judge'`; routed to LLM judge.
- `--skip-dod-phase` flag → dodPhase NOT in graph; no `factory-dod-report` records persisted.

## 4. Public API surface deltas

- `@wifo/factory-runtime/src/index.ts`: 21 → **23** names. Two new exports:
  - `dodPhase` (function from `packages/runtime/src/phases/dod.ts`)
  - `DodPhaseOptions` (type)
- `RunOptions.skipDodPhase?: boolean` — field-level addition on already-exported type.
- `RunReport`: no schema change; `iterations[].phases` array gains an entry per iteration when dodPhase is in the graph.
- `RuntimeErrorCode`: no new codes. dodPhase failures land as `'fail'` status (iteration retries) or `'error'` status (mirrors implementPhase's `runtime/agent-failed` shape — for DoD that's `runtime/dod-bullet-error` IF a bullet errored, but we resolve this as a string-label-only stderr line, mirroring `runtime/invalid-twin-mode`'s pattern).

`@wifo/factory-core/src/index.ts`: 29 → **31** names. Two new exports:
- `parseDodBullets` (function from `packages/core/src/parser.ts`)
- `DodBullet` (type)

## 5. Locked decisions worth pinning in the spec

- **Shell allowlist (locked):** the bullet parser classifies a backtick-wrapped token as `shell` ONLY if its first whitespace-separated word matches one of `pnpm`, `bun`, `npm`, `node`, `tsc`, `git`, `npx`, `bash`, `sh`, `make`, `pwd`, `ls`, OR if it begins with `./` or `../` (relative path to a script). Anything else → `'judge'`. Conservative; prevents accidental shell injection from prose mishaps.
- **Bullet body must contain EXACTLY ONE backtick-wrapped token to qualify as shell.** Multiple backticks → judge. Mirrors the harness's existing test-line conservatism.
- **DoD bullets without backticks are always `'judge'`.** No "magic detection" of plain-prose commands.
- **Bullet timeout default: 60_000 ms** per shell bullet. Total dodPhase wall-clock is bullet-count × per-bullet-timeout in worst case. The runtime's per-spec `--max-agent-timeout-ms` does NOT apply to DoD shell commands — they're not agent subprocesses. Separate timeout knob: `dodPhase`'s `timeoutMs` option (default 60_000).
- **`--skip-dod-phase` is opt-out, not opt-in.** v0.0.10 ships with DoD-verifier on by default. `factory.config.json runtime.skipDodPhase: true` is the persistent escape hatch. CLI flag overrides config. Aligns with the v0.0.5.1 precedence pattern.
- **DoD bullet results are persisted per-iteration in `factory-dod-report`.** `factory-context tree --direction down <runId>` walks DoD reports as run descendants (mirrors validate-reports).

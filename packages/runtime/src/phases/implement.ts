import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { type Dirent, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { ContextRecord } from '@wifo/factory-context';
import type { Spec } from '@wifo/factory-core';
import type { TwinMode } from '@wifo/factory-twin';
import { RuntimeError } from '../errors.js';
import { definePhase } from '../graph.js';
import { FactoryImplementReportSchema, tryRegister } from '../records.js';
import type { Phase } from '../types.js';

// ----- subprocess wrapper internals (T3) ---------------------------------
// Lifted from packages/harness/src/runners/test.ts (we duplicate the small
// helpers rather than depending on harness internals — runtime should not
// import harness's private modules).

const STDERR_TAIL_LINES = 20;
const STDERR_TAIL_BYTES = 4 * 1024;
const TRUNCATION_MARKER = '\n… [truncated]';

// v0.0.12 — telemetry capture for agent-exit-nonzero. Last 10 KB of stderr,
// byte-truncated (NOT line-truncated) so multi-byte chars at the truncation
// boundary don't desync downstream parsers. When truncated, prepend the
// `... [truncated, original size <N> bytes]\n` marker so consumers can tell.
const STDERR_TAIL_BYTES_10KB = 10 * 1024;

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC byte is required to match ANSI CSI escape sequences
// biome-ignore lint/complexity/useRegexLiterals: literal would require an unescaped ESC, which biome also rejects
const ANSI_PATTERN = new RegExp('\\x1b\\[[0-9;]*[A-Za-z]', 'g');

/** Strip ANSI escape sequences from text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * v0.0.12 — Byte-truncate stderr to the last 10 KB. UTF-8 safe at the
 * boundary: prepended marker `... [truncated, original size <N> bytes]\n`
 * names the original byte count when truncation happened. Short stderr
 * stored in full (no marker). Distinct from `tailDetail` (which trims by
 * line + ANSI-strips for prompt-friendly display) — this preserves raw
 * bytes for diagnosis.
 */
export function captureStderrTail(stderr: string): string {
  const buf = Buffer.from(stderr, 'utf8');
  if (buf.byteLength <= STDERR_TAIL_BYTES_10KB) return stderr;
  const slice = buf.subarray(buf.byteLength - STDERR_TAIL_BYTES_10KB);
  return `… [truncated, original size ${buf.byteLength} bytes]\n${slice.toString('utf8')}`;
}

/**
 * Trim a long captured stream to the last N lines, then cap byte length with
 * a truncation marker so a runaway producer can't balloon the report.
 */
export function tailDetail(text: string): string {
  const stripped = stripAnsi(text).trimEnd();
  const lines = stripped.split('\n');
  const tail = lines.slice(Math.max(0, lines.length - STDERR_TAIL_LINES)).join('\n');
  if (Buffer.byteLength(tail, 'utf8') <= STDERR_TAIL_BYTES) return tail;
  let acc = '';
  for (let i = tail.length; i > 0; i--) {
    const slice = tail.slice(i - 1);
    if (Buffer.byteLength(slice, 'utf8') > STDERR_TAIL_BYTES) {
      return TRUNCATION_MARKER + acc;
    }
    acc = slice;
  }
  return acc;
}

export interface SpawnAgentOptions {
  claudePath: string;
  allowedTools: string;
  cwd: string;
  env: Record<string, string | undefined>;
  prompt: string;
  timeoutMs: number;
  log: (line: string) => void;
}

export interface AgentSpawnResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn `claude -p --allowedTools <list> --output-format json`, write the
 * prompt to its stdin, and resolve with the captured streams on a clean
 * exit (any exit code). Rejects with `RuntimeError({ code:
 * 'runtime/agent-failed' })` for every operational failure, with a
 * `failureDetail` prefix that names the specific reason:
 *   - agent-spawn-failed: ENOENT or other spawn error
 *   - agent-timeout (after Nms): wall-clock timeout fired (we sent SIGKILL)
 *   - agent-killed-by-signal SIG: child was killed by a signal we did not send
 *
 * Note: a non-zero exit code is **not** an operational failure here — it's
 * surfaced via the resolved result's `exitCode` field. The caller decides
 * whether to throw on non-zero (T4 does, with the `agent-exit-nonzero`
 * prefix).
 *
 * The v0.0.2 spec called for `--bare` for reproducibility, but in claude
 * 2.1+ `--bare` strictly disables OAuth/keychain reads — making it
 * incompatible with the locked subscription-auth model (no API key). We
 * drop `--bare` and rely on the rest of the locked surface
 * (`--allowedTools`, headless `-p`, structured `--output-format json`)
 * for reproducibility. The spec's intent (subscription auth, headless,
 * structured capture) is preserved.
 *
 * v0.0.14 — `--setting-sources project,local` excludes user-level
 * settings (`~/.claude/settings.json`) where global plugin/skill
 * auto-suggestion hooks live (e.g., the Vercel/Next.js skill injection
 * the v0.0.13 implement-phase agent reported as false-positive noise).
 * OAuth/keychain auth is unaffected because credentials live outside
 * settings.json, so subscription auth is preserved. Project-level
 * (`<cwd>/.claude/settings.json`) and local (`*.local.json`) hooks
 * still load — only user-level global noise is filtered.
 */
export function spawnAgent(opts: SpawnAgentOptions): Promise<AgentSpawnResult> {
  return new Promise<AgentSpawnResult>((resolvePromise, rejectPromise) => {
    const child = spawn(
      opts.claudePath,
      [
        '-p',
        '--allowedTools',
        opts.allowedTools,
        '--output-format',
        'json',
        '--setting-sources',
        'project,local',
      ],
      {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      // Tail stderr lines through ctx.log so the user sees progress while the
      // agent runs (claude may write its own progress hints to stderr).
      const text = chunk.toString('utf8');
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trimEnd();
        if (line !== '') opts.log(`[claude] ${stripAnsi(line)}`);
      }
    });

    let timedOut = false;
    let settled = false;
    const settle = (action: 'resolve' | 'reject', payload: AgentSpawnResult | RuntimeError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (action === 'resolve') resolvePromise(payload as AgentSpawnResult);
      else rejectPromise(payload as RuntimeError);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.on('error', (err) => {
      // Typically ENOENT — claude binary not on PATH.
      settle(
        'reject',
        new RuntimeError('runtime/agent-failed', `agent-spawn-failed: ${err.message}`),
      );
    });

    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (timedOut) {
        settle(
          'reject',
          new RuntimeError(
            'runtime/agent-failed',
            `agent-timeout (after ${opts.timeoutMs}ms): ${tailDetail(stderr)}`,
          ),
        );
        return;
      }

      if (code === null && signal !== null) {
        settle(
          'reject',
          new RuntimeError(
            'runtime/agent-failed',
            `agent-killed-by-signal ${signal}: ${tailDetail(stderr)}`,
          ),
        );
        return;
      }

      settle('resolve', {
        exitCode: code ?? -1,
        signal,
        stdout,
        stderr,
      });
    });

    // Write the prompt and close stdin so claude reads to EOF.
    child.stdin?.end(opts.prompt, 'utf8');
  });
}

/**
 * The subset of fields the runtime cares about from `claude -p
 * --output-format json`'s stdout envelope. Defensive: every field is
 * optional and unknown-typed; T4's extractor coerces with `numOr0` /
 * `String(...)` / fallbacks.
 */
export interface AgentJsonEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  // The `tool_uses` field's exact shape varies by claude CLI version; we
  // accept either a name array or an object array and dedup string names.
  tool_uses?: unknown;
}

/**
 * Parse the agent's stdout as a single JSON envelope. Throws
 * `RuntimeError({ code: 'runtime/agent-failed' })` with `agent-output-invalid`
 * prefix on parse failure; the `output tail` in the message helps diagnose
 * malformed CLI banners or partial writes.
 */
export function parseAgentJson(stdout: string): AgentJsonEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new RuntimeError(
      'runtime/agent-failed',
      `agent-output-invalid: ${reason}; output tail: ${tailDetail(stdout)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new RuntimeError(
      'runtime/agent-failed',
      `agent-output-invalid: stdout did not parse to a JSON object; output tail: ${tailDetail(stdout)}`,
    );
  }
  return parsed as AgentJsonEnvelope;
}

// ----- implementPhase factory (T4) ---------------------------------------

const DEFAULT_MAX_PROMPT_TOKENS = 100_000;
const DEFAULT_ALLOWED_TOOLS = 'Read,Edit,Write,Bash';
const DEFAULT_CLAUDE_PATH = 'claude';
export const DEFAULT_TIMEOUT_MS = 600_000; // 10 min
const DEFAULT_TWIN_DIR = '.factory/twin-recordings';

const HASH_WALK_IGNORE = new Set([
  'node_modules',
  '.git',
  '.factory',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);
const HASH_WALK_FILE_BYTES_CAP = 1 * 1024 * 1024; // 1 MB per file
const HASH_WALK_TOTAL_BYTES_CAP = 5 * 1024 * 1024; // 5 MB total

export interface ImplementPhaseOptions {
  cwd?: string;
  maxPromptTokens?: number;
  allowedTools?: string;
  claudePath?: string;
  timeoutMs?: number;
  twin?: { mode?: TwinMode; recordingsDir?: string } | 'off';
  promptExtra?: string;
}

interface FileSnapshot {
  hashes: Map<string, string>;
  truncated: boolean;
}

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// v0.0.3 — Prior validate report section bounds.
const PRIOR_DETAIL_PER_LINE_BYTES_CAP = 1024; // 1 KB per scenario bullet's failureDetail
const PRIOR_SECTION_TOTAL_BYTES_CAP = 50 * 1024; // 50 KB section total
const TRUNCATION_SUFFIX = '… [truncated]';

interface PriorScenarioSatisfaction {
  detail?: unknown;
  status?: unknown;
}
interface PriorScenarioRecord {
  scenarioId?: unknown;
  status?: unknown;
  satisfactions?: unknown;
}
interface PriorValidatePayload {
  scenarios?: unknown;
}

// v0.0.10 — Prior DoD report shape (subset of FactoryDodReportPayload).
interface PriorDodBullet {
  kind?: unknown;
  status?: unknown;
  command?: unknown;
  exitCode?: unknown;
  stderrTail?: unknown;
  judgeReasoning?: unknown;
  bullet?: unknown;
}
interface PriorDodPayload {
  bullets?: unknown;
  status?: unknown;
}

// v0.0.11 — Prior holdout section bounds. Tighter section-total cap than
// the validate section's 50 KB because we emit IDs only (no body text).
const PRIOR_HOLDOUT_SECTION_TOTAL_BYTES_CAP = 10 * 1024; // 10 KB section total

interface PriorHoldoutScenario {
  scenarioId?: unknown;
  status?: unknown;
}
interface PriorValidatePayloadWithHoldouts extends PriorValidatePayload {
  holdouts?: unknown;
}

/**
 * Resolve a scenario's name from the spec's scenarios then holdouts. Falls
 * back to a literal '(name not in spec)' marker when the id is unknown.
 */
function resolveScenarioName(spec: Spec, scenarioId: string): string {
  for (const s of spec.scenarios) if (s.id === scenarioId) return s.name;
  for (const h of spec.holdouts) if (h.id === scenarioId) return h.name;
  return '(name not in spec)';
}

/**
 * Build the failureDetail body for one prior-failed scenario by joining
 * non-empty SatisfactionResult.detail strings with `; `. Empty → marker.
 * Truncated to 1 KB with a trailing marker.
 */
function buildPriorScenarioDetail(rec: PriorScenarioRecord): string {
  const sats = Array.isArray(rec.satisfactions) ? rec.satisfactions : [];
  const parts: string[] = [];
  for (const s of sats) {
    const sat = s as PriorScenarioSatisfaction;
    if (typeof sat.detail !== 'string') continue;
    const trimmed = sat.detail.trim();
    if (trimmed === '') continue;
    parts.push(trimmed);
  }
  const joined = parts.length === 0 ? '(no detail recorded)' : parts.join('; ');
  if (Buffer.byteLength(joined, 'utf8') <= PRIOR_DETAIL_PER_LINE_BYTES_CAP) return joined;
  // Truncate to fit cap minus suffix bytes.
  const suffixBytes = Buffer.byteLength(TRUNCATION_SUFFIX, 'utf8');
  const targetBytes = Math.max(0, PRIOR_DETAIL_PER_LINE_BYTES_CAP - suffixBytes);
  // Walk down byte length until we fit.
  let cut = joined.length;
  while (cut > 0 && Buffer.byteLength(joined.slice(0, cut), 'utf8') > targetBytes) cut--;
  return `${joined.slice(0, cut)}${TRUNCATION_SUFFIX}`;
}

interface PriorSectionResult {
  text: string; // empty string when no section should be emitted
  truncated: boolean; // true when section-total cap forced a tail trim
}

/**
 * Compose the `# Prior validate report` section from the prior validate-report
 * payload. Emits only failed scenarios (status !== 'pass'), preserving the
 * payload's order. Returns empty `text` when no failures (or no record).
 */
function buildPriorValidateSection(
  spec: Spec,
  priorPayload: PriorValidatePayload,
): PriorSectionResult {
  const scenarios = Array.isArray(priorPayload.scenarios) ? priorPayload.scenarios : [];
  const bullets: string[] = [];
  for (const raw of scenarios) {
    const rec = raw as PriorScenarioRecord;
    if (typeof rec.scenarioId !== 'string') continue;
    if (rec.status === 'pass') continue; // failed = anything not pass; skipped is also dropped (per spec — only fail/error are surfaced)
    if (rec.status !== 'fail' && rec.status !== 'error') continue;
    const name = resolveScenarioName(spec, rec.scenarioId);
    const detail = buildPriorScenarioDetail(rec);
    bullets.push(`- **${rec.scenarioId} — ${name}**: ${detail}`);
  }
  if (bullets.length === 0) return { text: '', truncated: false };

  const header = [
    '# Prior validate report',
    '',
    'The previous iteration validated and reported the following failed',
    'scenarios. Read them carefully — your task is to make them pass without',
    'breaking the ones that already passed.',
    '',
  ];
  const acc: string[] = [...header];
  let usedBytes = Buffer.byteLength(acc.join('\n'), 'utf8');
  let truncated = false;
  for (const b of bullets) {
    const next = Buffer.byteLength(`${b}\n`, 'utf8');
    if (usedBytes + next > PRIOR_SECTION_TOTAL_BYTES_CAP) {
      truncated = true;
      break;
    }
    acc.push(b);
    usedBytes += next;
  }
  return { text: acc.join('\n'), truncated };
}

/**
 * v0.0.10 — Compose the `# Prior DoD report` section from the prior
 * dod-report payload. Emits only failed bullets (status === 'fail' or
 * 'error'), preserving the payload's order. Returns empty `text` when no
 * failures (or no record). Uses the same per-line + section-total caps as
 * `buildPriorValidateSection`; truncation marker is distinct so the
 * runtime log line `[runtime] truncated prior-DoD section` is unambiguous.
 */
function buildPriorDodSection(priorPayload: PriorDodPayload): PriorSectionResult {
  const bullets = Array.isArray(priorPayload.bullets) ? priorPayload.bullets : [];
  const lines: string[] = [];
  for (const raw of bullets) {
    const b = raw as PriorDodBullet;
    if (b.status !== 'fail' && b.status !== 'error') continue;
    let line: string;
    if (b.kind === 'shell') {
      const command = typeof b.command === 'string' ? b.command : '';
      const exitCodeStr =
        typeof b.exitCode === 'number' ? String(b.exitCode) : b.exitCode === null ? 'null' : '?';
      const stderrTail = typeof b.stderrTail === 'string' ? b.stderrTail.replace(/\n/g, ' ') : '';
      line = `**\`${command}\`** — exit ${exitCodeStr}: ${stderrTail}`;
    } else {
      // judge bullet — surface the criterion + reasoning
      const criterion = typeof b.bullet === 'string' ? b.bullet.replace(/^[-*]\s*/, '') : '';
      const reasoning = typeof b.judgeReasoning === 'string' ? b.judgeReasoning : '';
      line = `**${criterion}** — ${reasoning}`;
    }
    if (Buffer.byteLength(line, 'utf8') > PRIOR_DETAIL_PER_LINE_BYTES_CAP) {
      const suffixBytes = Buffer.byteLength(TRUNCATION_SUFFIX, 'utf8');
      const targetBytes = Math.max(0, PRIOR_DETAIL_PER_LINE_BYTES_CAP - suffixBytes);
      let cut = line.length;
      while (cut > 0 && Buffer.byteLength(line.slice(0, cut), 'utf8') > targetBytes) cut--;
      line = `${line.slice(0, cut)}${TRUNCATION_SUFFIX}`;
    }
    lines.push(line);
  }
  if (lines.length === 0) return { text: '', truncated: false };

  const header = ['# Prior DoD report', ''];
  const acc: string[] = [...header];
  let usedBytes = Buffer.byteLength(acc.join('\n'), 'utf8');
  let truncated = false;
  for (const l of lines) {
    const next = Buffer.byteLength(`${l}\n`, 'utf8');
    if (usedBytes + next > PRIOR_SECTION_TOTAL_BYTES_CAP) {
      truncated = true;
      break;
    }
    acc.push(l);
    usedBytes += next;
  }
  return { text: acc.join('\n'), truncated };
}

/**
 * v0.0.11 — Compose the `# Prior holdout fail` section from the prior
 * validate-report's `holdouts` array. Emits **only** the IDs of failed
 * holdouts (status === 'fail' or 'error'); the criterion text is never
 * surfaced — preserves the v0.0.4 overfit guard invariant. Returns empty
 * `text` when no failed holdouts (or no `holdouts` array).
 *
 * The locked format is byte-stable across iterations of the same failure
 * (cache-friendly for `claude -p`'s prompt cache). Per-line cap 1 KB;
 * section-total cap 10 KB (tighter than the validate section's 50 KB —
 * IDs are short, so one-shot truncation is plenty).
 */
function buildPriorHoldoutSection(
  priorPayload: PriorValidatePayloadWithHoldouts,
  iteration: number,
): PriorSectionResult {
  const holdouts = Array.isArray(priorPayload.holdouts) ? priorPayload.holdouts : [];
  const failedIds: string[] = [];
  for (const raw of holdouts) {
    const rec = raw as PriorHoldoutScenario;
    if (typeof rec.scenarioId !== 'string') continue;
    if (rec.status !== 'fail' && rec.status !== 'error') continue;
    failedIds.push(rec.scenarioId);
  }
  if (failedIds.length === 0) return { text: '', truncated: false };

  const priorIter = Math.max(1, iteration - 1);
  const header = [
    '# Prior holdout fail',
    '',
    `Iteration ${priorIter}'s visible scenarios passed but the following holdouts failed:`,
    '',
  ];
  const footer = [
    '',
    'These holdouts are intentionally hidden — their content is NOT shown to you.',
    'Fix the underlying behavior so they pass without looking them up.',
  ];

  // Build bullet lines (per-line cap 1 KB).
  const bullets: string[] = [];
  for (const id of failedIds) {
    let line = `- **${id}**`;
    if (Buffer.byteLength(line, 'utf8') > PRIOR_DETAIL_PER_LINE_BYTES_CAP) {
      const suffixBytes = Buffer.byteLength(TRUNCATION_SUFFIX, 'utf8');
      const targetBytes = Math.max(0, PRIOR_DETAIL_PER_LINE_BYTES_CAP - suffixBytes);
      let cut = line.length;
      while (cut > 0 && Buffer.byteLength(line.slice(0, cut), 'utf8') > targetBytes) cut--;
      line = `${line.slice(0, cut)}${TRUNCATION_SUFFIX}`;
    }
    bullets.push(line);
  }

  // Apply section-total cap. Reserve room for the footer so the section is
  // always closed cleanly (closing prose isn't dropped by truncation).
  const headerBytes = Buffer.byteLength(`${header.join('\n')}\n`, 'utf8');
  const footerBytes = Buffer.byteLength(`${footer.join('\n')}\n`, 'utf8');
  const availableForBullets = PRIOR_HOLDOUT_SECTION_TOTAL_BYTES_CAP - headerBytes - footerBytes;
  const acc: string[] = [];
  let usedBullets = 0;
  let truncated = false;
  for (const b of bullets) {
    const next = Buffer.byteLength(`${b}\n`, 'utf8');
    if (usedBullets + next > availableForBullets) {
      truncated = true;
      break;
    }
    acc.push(b);
    usedBullets += next;
  }
  return { text: [...header, ...acc, ...footer].join('\n'), truncated };
}

// v0.0.5 — Behavior-prior prompt prefix. Stable across iterations so the bytes
// are byte-identical and `claude -p`'s ephemeral cache hits the same key on
// every implement spawn. NOT exported from the package's public surface
// (`src/index.ts`) — internal-only. Length budget pinned by tests at ≤ 2 KB
// (~500 tokens / ~2.5% of the default 100k per-phase cap).
export const IMPLEMENTATION_GUIDELINES = `# Implementation guidelines

Read these before reading the spec, and revisit them when you're tempted to expand scope:

- **State your assumptions.** If something is ambiguous, say so. If multiple interpretations exist, name them — don't pick silently. Push back when warranted.
- **Minimum code that solves the problem.** No features beyond what was asked. No abstractions for single-use code. No "flexibility" or "configurability" the spec didn't request. If you wrote 200 lines and it could be 50, rewrite it.
- **Surgical changes only.** Edit what the spec requires; leave adjacent code, comments, and formatting alone. Match existing style. If you notice unrelated dead code, mention it — don't delete it.
- **Define verifiable success criteria, then loop.** Every change should map to a \`test:\` line, a \`judge:\` line, or a Constraint in the spec. Run the tests yourself before finishing — "the tests will pass" is not the same as "I ran them and they pass".`;

export function buildPrompt(args: {
  specSource: string;
  cwd: string;
  iteration: number;
  promptExtra?: string;
  priorSection?: string;
  /**
   * v0.0.10 — Optional `# Prior DoD report` section. Emitted after
   * `priorSection` (the v0.0.3 prior-validate section) and before
   * `# Working directory`. Byte-stable across iterations of the same
   * failure for cache friendliness.
   */
  priorDodSection?: string;
  /**
   * v0.0.11 — Optional `# Prior holdout fail` section. IDs-only (preserves
   * the overfit guard invariant). Emitted after `priorDodSection` and
   * before `# Working directory`.
   */
  priorHoldoutSection?: string;
}): string {
  const lines = [
    'You are an automated coding agent in a software factory. Your task is to',
    'implement a software change defined by a Software Factory spec.',
    '',
    'The spec is the contract. The tests in its `test:` lines define correctness.',
    'Your job: edit files in the working directory below so those tests pass.',
    '',
    IMPLEMENTATION_GUIDELINES,
    '',
    '# Spec',
    '',
    args.specSource,
    '',
  ];
  if (args.priorSection !== undefined && args.priorSection !== '') {
    lines.push(args.priorSection, '');
  }
  if (args.priorDodSection !== undefined && args.priorDodSection !== '') {
    lines.push(args.priorDodSection, '');
  }
  if (args.priorHoldoutSection !== undefined && args.priorHoldoutSection !== '') {
    lines.push(args.priorHoldoutSection, '');
  }
  lines.push(
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
    "- Keep changes minimal and focused on satisfying the spec's `test:` lines.",
    '',
    '# What "done" looks like',
    '',
    "- The tests referenced by the spec's `test:` lines pass when you run them",
    '  from the working directory.',
    '- Your final message summarizes what you did: which files you touched and why.',
    '',
    `This is iteration ${args.iteration} of the run. The factory will run the validate phase next.`,
    '',
    'When you are confident the implementation is complete, finish your turn.',
  );
  if (args.promptExtra !== undefined && args.promptExtra !== '') {
    lines.push('', '# Extra instructions', '', args.promptExtra);
  }
  return lines.join('\n');
}

function snapshotFiles(cwd: string): FileSnapshot {
  const hashes = new Map<string, string>();
  let totalBytes = 0;
  let truncated = false;

  function walk(absDir: string): void {
    if (truncated) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (HASH_WALK_IGNORE.has(entry.name)) continue;
      const absChild = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(absChild);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(absChild);
      } catch {
        continue;
      }
      if (stat.size > HASH_WALK_FILE_BYTES_CAP) {
        // Record presence with a sentinel hash so post-walk knows to mark it
        // changed if mtime moves; we don't load the content.
        hashes.set(relative(cwd, absChild), `__too_large__:${stat.mtimeMs}`);
        continue;
      }
      if (totalBytes + stat.size > HASH_WALK_TOTAL_BYTES_CAP) {
        truncated = true;
        return;
      }
      let buf: Buffer;
      try {
        buf = readFileSync(absChild);
      } catch {
        continue;
      }
      totalBytes += buf.byteLength;
      hashes.set(relative(cwd, absChild), createHash('sha256').update(buf).digest('hex'));
    }
  }

  walk(cwd);
  return { hashes, truncated };
}

interface FileChangeEntry {
  path: string;
  diff: string;
}

/**
 * v0.0.5.1 — Snapshot the working tree as a path → sha256-hex map. Invoked
 * before AND after the agent spawn. The diff between pre and post is the
 * canonical attribution surface for `filesChanged`. Replaces v0.0.5's
 * post-run `git diff HEAD --` (which missed untracked-created files) and
 * couldn't distinguish agent edits from pre-existing dirty content.
 *
 * In a git repo, `git ls-files -co --exclude-standard -z` enumerates the
 * working tree (tracked + untracked, respecting .gitignore). Outside a git
 * repo, falls back to the directory walk in `snapshotFiles`.
 */
function captureFileSnapshot(cwd: string): Map<string, string> {
  if (existsSync(join(cwd, '.git'))) {
    const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status === 0 && typeof result.stdout === 'string') {
      const hashes = new Map<string, string>();
      const paths = result.stdout.split('\0').filter((p) => p !== '');
      for (const path of paths) {
        try {
          const buf = readFileSync(join(cwd, path));
          hashes.set(path, createHash('sha256').update(buf).digest('hex'));
        } catch {
          // file may be tracked-but-deleted from disk; skip.
        }
      }
      return hashes;
    }
  }
  return snapshotFiles(cwd).hashes;
}

/**
 * v0.0.5.1 — The set of paths reported by `git status --porcelain` at
 * pre-implement time. Used to filter out paths whose pre-state already
 * differed from HEAD; we cannot honestly attribute later changes to those
 * paths to the agent (the maintainer's pre-existing edit could be the
 * reason post-snapshot differs). Empty when not in a git repo.
 *
 * Trade-off: false negatives (under-attributing the agent's work on
 * pre-dirty files) are preferable to false positives (over-attributing).
 * The maintainer keeps a clean tree if they want full audit fidelity.
 */
function captureDirtyPaths(cwd: string): Set<string> {
  const dirty = new Set<string>();
  if (!existsSync(join(cwd, '.git'))) return dirty;
  const result = spawnSync('git', ['status', '--porcelain', '-z'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') return dirty;
  // -z format: each entry is "XY <path>\0". Rename/copy entries are followed
  // by a separate "<origpath>\0" record; capture both sides so a pre-rename
  // doesn't leak into the post-diff as a phantom create + delete.
  const entries = result.stdout.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined || entry === '') continue;
    if (entry.length < 3) continue;
    const xy = entry.slice(0, 2);
    dirty.add(entry.slice(3));
    if (xy[0] === 'R' || xy[0] === 'C') {
      i++;
      const orig = entries[i];
      if (orig !== undefined && orig !== '') dirty.add(orig);
    }
  }
  return dirty;
}

function captureFileChanges(args: {
  cwd: string;
  pre: Map<string, string>;
  post: Map<string, string>;
  dirty: Set<string>;
}): FileChangeEntry[] {
  const changed: FileChangeEntry[] = [];
  // Created (in post, not in pre) and modified (in both with differing hash).
  for (const [path, hash] of args.post) {
    if (args.dirty.has(path)) continue;
    if (args.pre.get(path) === hash) continue;
    changed.push({ path, diff: simpleDiff('', safeReadRel(args.cwd, path)) });
  }
  // Deleted (in pre, not in post).
  for (const [path] of args.pre) {
    if (args.dirty.has(path)) continue;
    if (args.post.has(path)) continue;
    changed.push({ path, diff: simpleDiff('deleted', '') });
  }
  return changed;
}

function safeReadRel(cwd: string, relPath: string): string {
  try {
    return readFileSync(join(cwd, relPath), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Minimal before/after representation. Not a unified diff — the v0.0.5.1
 * snapshot path stores hashes only, so we don't have pre-content available.
 * `diff` is best-effort; the canonical audit signal is `path`.
 */
function simpleDiff(before: string, after: string): string {
  if (before === '' && after !== '') return `+ ${after}`;
  if (before !== '' && after === '') return `- ${before}`;
  return `--- before\n${before}\n--- after\n${after}`;
}

function extractToolsUsed(env: AgentJsonEnvelope, files: FileChangeEntry[]): string[] {
  const set = new Set<string>();
  // Try the envelope's tool_uses field — accept array of strings or
  // array of objects with `name`.
  if (Array.isArray(env.tool_uses)) {
    for (const item of env.tool_uses) {
      if (typeof item === 'string') {
        set.add(item);
      } else if (item !== null && typeof item === 'object' && 'name' in item) {
        const name = (item as { name?: unknown }).name;
        if (typeof name === 'string') set.add(name);
      }
    }
  }
  if (set.size > 0) return [...set];
  // Heuristic from disk delta.
  for (const f of files) {
    if (f.diff.startsWith('+ ')) set.add('Write');
    else set.add('Edit');
  }
  return [...set];
}

interface ResolvedTwin {
  envVars: Record<string, string>;
  recordingsDir: string | null;
}

function resolveTwin(twin: ImplementPhaseOptions['twin'], cwd: string): ResolvedTwin {
  if (twin === 'off') {
    return { envVars: {}, recordingsDir: null };
  }
  const mode: TwinMode = twin?.mode ?? 'record';
  const recordingsDir = resolve(twin?.recordingsDir ?? join(cwd, DEFAULT_TWIN_DIR));
  if (mode === 'record') {
    mkdirSync(recordingsDir, { recursive: true });
  }
  return {
    envVars: {
      WIFO_TWIN_MODE: mode,
      WIFO_TWIN_RECORDINGS_DIR: recordingsDir,
    },
    recordingsDir,
  };
}

function validateMaxPromptTokens(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new RuntimeError(
      'runtime/invalid-max-prompt-tokens',
      `must be a positive integer (got '${String(value)}')`,
    );
  }
}

/**
 * Built-in phase factory: returns a `Phase` named `'implement'` that
 * subprocesses out to `claude -p --allowedTools <list> --bare
 * --output-format json` (subscription auth, no `ANTHROPIC_API_KEY`
 * required), captures the agent's output and disk delta into a
 * `factory-implement-report` record (`parents: [ctx.runId]`), and
 * enforces a hard cost cap on `usage.input_tokens`.
 *
 * Validates `opts.maxPromptTokens` synchronously at factory-call time —
 * non-positive values throw `RuntimeError({ code:
 * 'runtime/invalid-max-prompt-tokens' })` before the closure is
 * constructed. Symmetric with how `run()` validates `maxIterations`.
 */
export function implementPhase(opts: ImplementPhaseOptions = {}): Phase {
  validateMaxPromptTokens(opts.maxPromptTokens);

  return definePhase('implement', async (ctx) => {
    tryRegister(ctx.contextStore, 'factory-implement-report', FactoryImplementReportSchema);

    // v0.0.11 — `ctx.cwd` (set by runtime when worktree mode is enabled)
    // wins over `opts.cwd` so the agent's edits land in the isolated
    // worktree, never the maintainer's main tree.
    const cwd =
      ctx.cwd ??
      opts.cwd ??
      (ctx.spec.raw.filename !== undefined
        ? dirname(resolve(ctx.spec.raw.filename))
        : process.cwd());
    const maxPromptTokens = opts.maxPromptTokens ?? DEFAULT_MAX_PROMPT_TOKENS;
    const allowedTools = opts.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
    const claudePath = opts.claudePath ?? DEFAULT_CLAUDE_PATH;
    // v0.0.5.2 — Resolution order: explicit per-phase opt > runtime-threaded
    // ctx.maxAgentTimeoutMs (set from RunOptions.maxAgentTimeoutMs by run())
    // > the built-in 600_000 default. The explicit constructor option wins so
    // programmatic callers that pin a per-phase timeout still get it.
    const timeoutMs = opts.timeoutMs ?? ctx.maxAgentTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const twin = resolveTwin(opts.twin, cwd);

    // v0.0.3 — extract the prior iteration's factory-validate-report from
    // ctx.inputs (populated by the runtime for root phases on iter ≥ 2). The
    // record's id flows into payload.priorValidateReportId AND extends the
    // implement-report's parents. The payload's failed scenarios feed the
    // # Prior validate report prompt section.
    const priorValidateRecord: ContextRecord | undefined = ctx.inputs.find(
      (r) => r.type === 'factory-validate-report',
    );
    const priorValidateReportId = priorValidateRecord?.id;
    const priorSection =
      priorValidateRecord !== undefined
        ? buildPriorValidateSection(ctx.spec, priorValidateRecord.payload as PriorValidatePayload)
        : { text: '', truncated: false };
    if (priorSection.truncated) {
      ctx.log('[runtime] truncated prior-validate section');
    }

    // v0.0.10 — prior DoD report threading (parallel to v0.0.3 validate
    // threading). Threaded via ctx.inputs from the prior iteration's
    // terminal phase (dodPhase in the default v0.0.10 graph).
    const priorDodRecord: ContextRecord | undefined = ctx.inputs.find(
      (r) => r.type === 'factory-dod-report',
    );
    const priorDodSection =
      priorDodRecord !== undefined
        ? buildPriorDodSection(priorDodRecord.payload as PriorDodPayload)
        : { text: '', truncated: false };
    if (priorDodSection.truncated) {
      ctx.log('[runtime] truncated prior-DoD section');
    }

    // v0.0.11 — prior holdout fail section (IDs-only). Reads the
    // `holdouts` array from the same prior validate-report (when
    // checkHoldouts was enabled in the prior iteration). The section is
    // intentionally a separate emitter from the prior-validate section so
    // the byte layout stays stable: failed visible scenarios go to
    // `priorSection`; failed holdouts go to `priorHoldoutSection`.
    const priorHoldoutSection =
      priorValidateRecord !== undefined
        ? buildPriorHoldoutSection(
            priorValidateRecord.payload as PriorValidatePayloadWithHoldouts,
            ctx.iteration,
          )
        : { text: '', truncated: false };
    if (priorHoldoutSection.truncated) {
      ctx.log('[runtime] truncated prior-holdouts section');
    }

    const prompt = buildPrompt({
      specSource: ctx.spec.raw.source,
      cwd,
      iteration: ctx.iteration,
      ...(priorSection.text !== '' ? { priorSection: priorSection.text } : {}),
      ...(priorDodSection.text !== '' ? { priorDodSection: priorDodSection.text } : {}),
      ...(priorHoldoutSection.text !== '' ? { priorHoldoutSection: priorHoldoutSection.text } : {}),
      ...(opts.promptExtra !== undefined ? { promptExtra: opts.promptExtra } : {}),
    });

    const startedAt = new Date();
    const t0 = performance.now();

    // v0.0.5.1 — Pre-implement snapshot of the working tree (path → hash) +
    // the set of paths that were already dirty against HEAD. After the agent
    // returns we re-snapshot and diff: created/modified/deleted minus the
    // pre-dirty set is the agent's verifiable contribution this iteration.
    // Replaces v0.0.5's post-run `git diff HEAD --`, which missed untracked
    // creates and over-attributed pre-dirty edits.
    const pre = captureFileSnapshot(cwd);
    const dirty = captureDirtyPaths(cwd);

    // Spawn the agent. Operational failures throw RuntimeError({ code:
    // 'runtime/agent-failed' }) via spawnAgent — we let those propagate;
    // the runtime catches them as factory-phase status='error'.
    const spawnResult = await spawnAgent({
      claudePath,
      allowedTools,
      cwd,
      env: { ...process.env, ...twin.envVars },
      prompt,
      timeoutMs,
      log: ctx.log,
    });

    // Non-zero exit code → operational failure. v0.0.12 telemetry: persist a
    // factory-implement-report with status='error' and failureDetail.stderrTail
    // BEFORE throwing, so the agent's last 10 KB of stderr is recoverable from
    // the context store without re-running. Status classification is unchanged
    // — the runtime still treats this iteration as 'error'.
    if (spawnResult.exitCode !== 0) {
      const message = `agent-exit-nonzero (code=${spawnResult.exitCode}): ${tailDetail(spawnResult.stderr)}`;
      const post = captureFileSnapshot(cwd);
      const filesChangedExit = captureFileChanges({ cwd, pre, post, dirty });
      const filesChangedDebugExit = {
        preSnapshot: [...pre.keys()].sort(),
        postSnapshot: [...post.keys()].sort(),
      };
      const durationMsExit = Math.round(performance.now() - t0);
      const exitPayload = {
        specId: ctx.spec.frontmatter.id,
        ...(ctx.spec.raw.filename !== undefined ? { specPath: ctx.spec.raw.filename } : {}),
        iteration: ctx.iteration,
        startedAt: startedAt.toISOString(),
        durationMs: durationMsExit,
        cwd,
        prompt,
        allowedTools,
        claudePath,
        status: 'error' as const,
        exitCode: spawnResult.exitCode,
        ...(spawnResult.signal !== null ? { signal: spawnResult.signal } : {}),
        result: '',
        filesChanged: filesChangedExit,
        filesChangedDebug: filesChangedDebugExit,
        toolsUsed: [] as string[],
        tokens: { input: 0, output: 0, charged: 0, total: 0 },
        failureDetail: {
          message,
          stderrTail: captureStderrTail(spawnResult.stderr),
        },
        ...(priorValidateReportId !== undefined ? { priorValidateReportId } : {}),
      };
      const exitParents =
        priorValidateReportId !== undefined ? [ctx.runId, priorValidateReportId] : [ctx.runId];
      await ctx.contextStore.put('factory-implement-report', exitPayload, { parents: exitParents });
      throw new RuntimeError('runtime/agent-failed', message);
    }

    // Parse the envelope. Throws RuntimeError({ code: 'runtime/agent-failed' })
    // with agent-output-invalid prefix on parse failure.
    const envelope = parseAgentJson(spawnResult.stdout);

    // Capture file changes via pre/post snapshot diff, filtered by pre-dirty.
    // v0.0.12 — also expose pre/post snapshots as a side-channel `filesChangedDebug`
    // so under-attribution bugs in the comparison are diagnosable from the record.
    const post = captureFileSnapshot(cwd);
    const filesChanged = captureFileChanges({ cwd, pre, post, dirty });
    const filesChangedDebug = {
      preSnapshot: [...pre.keys()].sort(),
      postSnapshot: [...post.keys()].sort(),
    };

    // Token extraction.
    const u = envelope.usage ?? {};
    const tokensInput = numOr0(u.input_tokens);
    const tokensOutput = numOr0(u.output_tokens);
    const cacheCreate = numOrUndef(u.cache_creation_input_tokens);
    const cacheRead = numOrUndef(u.cache_read_input_tokens);
    const tokensTotal = tokensInput + tokensOutput + (cacheCreate ?? 0) + (cacheRead ?? 0);
    // v0.0.11 — `charged` is the budget-relevant value (input + output).
    // Cache reads/creates are free per Anthropic's pricing; the runtime's
    // budget enforcement and surface metrics should track `charged`, not
    // the SDK's cache-aware `total`.
    const tokensCharged = tokensInput + tokensOutput;

    // Result text — always populated, regardless of is_error.
    const result = String(envelope.result ?? '');

    // Status mapping.
    let status: 'pass' | 'fail' | 'error';
    let failureDetail: string | undefined;
    if (envelope.is_error === true) {
      status = 'fail';
      failureDetail =
        result !== '' ? result : String(envelope.subtype ?? 'agent self-reported failure');
    } else {
      status = 'pass';
    }

    // Cost-cap check (post-hoc): if exceeded, override to 'error', overwrite
    // failureDetail (with the descriptive 'cost-cap-exceeded:' prefix on the
    // persisted report), persist the report so the user sees what was wasted,
    // then throw RuntimeError with the numeric body alone — RuntimeError's
    // `.message` automatically prepends `runtime/cost-cap-exceeded: `, so
    // doubling the descriptive prefix would produce noise in the CLI's detail
    // line.
    const overran = tokensInput > maxPromptTokens;
    const costCapDetailBody = `input_tokens=${tokensInput} > maxPromptTokens=${maxPromptTokens}`;
    if (overran) {
      status = 'error';
      failureDetail = `cost-cap-exceeded: ${costCapDetailBody}`;
    }

    const durationMs = Math.round(performance.now() - t0);
    const toolsUsed = extractToolsUsed(envelope, filesChanged);

    const payload = {
      specId: ctx.spec.frontmatter.id,
      ...(ctx.spec.raw.filename !== undefined ? { specPath: ctx.spec.raw.filename } : {}),
      iteration: ctx.iteration,
      startedAt: startedAt.toISOString(),
      durationMs,
      cwd,
      prompt,
      allowedTools,
      claudePath,
      status,
      exitCode: spawnResult.exitCode,
      ...(spawnResult.signal !== null ? { signal: spawnResult.signal } : {}),
      result,
      filesChanged,
      filesChangedDebug,
      toolsUsed,
      tokens: {
        input: tokensInput,
        output: tokensOutput,
        charged: tokensCharged,
        ...(cacheCreate !== undefined ? { cacheCreate } : {}),
        ...(cacheRead !== undefined ? { cacheRead } : {}),
        total: tokensTotal,
      },
      ...(failureDetail !== undefined ? { failureDetail } : {}),
      ...(priorValidateReportId !== undefined ? { priorValidateReportId } : {}),
    };

    // v0.0.3 — parents extend with the prior iteration's validate-report id
    // when one was threaded via ctx.inputs.
    const parents =
      priorValidateReportId !== undefined ? [ctx.runId, priorValidateReportId] : [ctx.runId];
    const id = await ctx.contextStore.put('factory-implement-report', payload, { parents });

    if (overran) {
      // Persist before throwing. The runtime catches this as factory-phase
      // status='error'; the implement-report exists on disk with
      // parents=[runId] (discoverable via `factory-context tree <runId>`),
      // even though it's not in factory-phase.outputRecordIds because the
      // phase threw before returning.
      throw new RuntimeError('runtime/cost-cap-exceeded', costCapDetailBody);
    }

    const record = await ctx.contextStore.get(id);
    if (record === null) {
      // Defensive — unreachable since put just succeeded.
      return { status: 'error', records: [] };
    }
    return { status, records: [record] };
  });
}

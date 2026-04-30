import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { type Dirent, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC byte is required to match ANSI CSI escape sequences
// biome-ignore lint/complexity/useRegexLiterals: literal would require an unescaped ESC, which biome also rejects
const ANSI_PATTERN = new RegExp('\\x1b\\[[0-9;]*[A-Za-z]', 'g');

/** Strip ANSI escape sequences from text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
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
 * Spawn `claude -p --allowedTools <list> --bare --output-format json`,
 * write the prompt to its stdin, and resolve with the captured streams on
 * a clean exit (any exit code). Rejects with `RuntimeError({ code:
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
 */
export function spawnAgent(opts: SpawnAgentOptions): Promise<AgentSpawnResult> {
  return new Promise<AgentSpawnResult>((resolvePromise, rejectPromise) => {
    const child = spawn(
      opts.claudePath,
      ['-p', '--allowedTools', opts.allowedTools, '--bare', '--output-format', 'json'],
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
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min
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

function buildPrompt(args: {
  specSource: string;
  cwd: string;
  iteration: number;
  promptExtra?: string;
}): string {
  const lines = [
    'You are an automated coding agent in a software factory. Your task is to',
    'implement a software change defined by a Software Factory spec.',
    '',
    'The spec is the contract. The tests in its `test:` lines define correctness.',
    'Your job: edit files in the working directory below so those tests pass.',
    '',
    '# Spec',
    '',
    args.specSource,
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
  ];
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

function captureFileChanges(args: {
  cwd: string;
  pre: FileSnapshot | null;
  log: (line: string) => void;
}): FileChangeEntry[] {
  // Git path: spawn git diff --no-color HEAD --
  if (existsSync(join(args.cwd, '.git'))) {
    const result = spawnSync('git', ['diff', '--no-color', 'HEAD', '--'], {
      cwd: args.cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status === 0 && result.stdout) {
      return parseGitDiff(result.stdout);
    }
    // Fall through to hash-based capture if git diff fails (e.g. no HEAD yet).
  }

  // Hash fallback.
  if (args.pre === null) return [];
  if (args.pre.truncated) {
    args.log(
      'implement: pre-state file walk exceeded 5 MB cap; recording paths only without diffs',
    );
  }
  const post = snapshotFiles(args.cwd);
  const changed: FileChangeEntry[] = [];
  // Modified files (in pre with different hash) and new files (not in pre).
  for (const [path, hash] of post.hashes) {
    const preHash = args.pre.hashes.get(path);
    if (preHash === hash) continue;
    if (args.pre.truncated || post.truncated) {
      changed.push({ path, diff: '' });
      continue;
    }
    const preContent = preHash !== undefined ? safeReadRel(args.cwd, path) : '';
    const postContent = safeReadRel(args.cwd, path);
    changed.push({ path, diff: simpleDiff(preContent, postContent) });
  }
  // Deleted files.
  for (const [path] of args.pre.hashes) {
    if (post.hashes.has(path)) continue;
    if (args.pre.truncated) {
      changed.push({ path, diff: '' });
      continue;
    }
    const preContent = safeReadRel(args.cwd, path);
    changed.push({ path, diff: simpleDiff(preContent, '') });
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
 * Minimal before/after representation. Not a unified diff — for the hash
 * fallback we just record both sides separated by a marker line. The git
 * path produces the real unified diff and is the v0.0.2 happy path.
 */
function simpleDiff(before: string, after: string): string {
  if (before === '' && after !== '') return `+ ${after}`;
  if (before !== '' && after === '') return `- ${before}`;
  return `--- before\n${before}\n--- after\n${after}`;
}

/**
 * Split a combined `git diff` blob into per-file entries. Each chunk starts
 * with `diff --git a/<path> b/<path>` — we extract the b-side path.
 */
function parseGitDiff(diff: string): FileChangeEntry[] {
  const entries: FileChangeEntry[] = [];
  const HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
  const lines = diff.split('\n');
  let currentPath: string | null = null;
  let currentBuf: string[] = [];
  for (const line of lines) {
    const match = HEADER.exec(line);
    if (match !== null) {
      if (currentPath !== null) {
        entries.push({ path: currentPath, diff: currentBuf.join('\n') });
      }
      currentPath = match[2] ?? match[1] ?? null;
      currentBuf = [line];
      continue;
    }
    currentBuf.push(line);
  }
  if (currentPath !== null) {
    entries.push({ path: currentPath, diff: currentBuf.join('\n') });
  }
  return entries;
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

    const cwd =
      opts.cwd ??
      (ctx.spec.raw.filename !== undefined
        ? dirname(resolve(ctx.spec.raw.filename))
        : process.cwd());
    const maxPromptTokens = opts.maxPromptTokens ?? DEFAULT_MAX_PROMPT_TOKENS;
    const allowedTools = opts.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
    const claudePath = opts.claudePath ?? DEFAULT_CLAUDE_PATH;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const twin = resolveTwin(opts.twin, cwd);

    const prompt = buildPrompt({
      specSource: ctx.spec.raw.source,
      cwd,
      iteration: ctx.iteration,
      ...(opts.promptExtra !== undefined ? { promptExtra: opts.promptExtra } : {}),
    });

    const startedAt = new Date();
    const t0 = performance.now();

    // Pre-state snapshot for hash-based diff fallback. The git path doesn't
    // need this, but we don't know which path we'll use until we look at the
    // cwd's .git presence — and even then git diff may fail (e.g. no HEAD).
    // Cheap to pre-walk; bounded by HASH_WALK_TOTAL_BYTES_CAP.
    const pre = existsSync(join(cwd, '.git')) ? null : snapshotFiles(cwd);

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

    // Non-zero exit code → operational failure. No envelope to record.
    if (spawnResult.exitCode !== 0) {
      throw new RuntimeError(
        'runtime/agent-failed',
        `agent-exit-nonzero (code=${spawnResult.exitCode}): ${tailDetail(spawnResult.stderr)}`,
      );
    }

    // Parse the envelope. Throws RuntimeError({ code: 'runtime/agent-failed' })
    // with agent-output-invalid prefix on parse failure.
    const envelope = parseAgentJson(spawnResult.stdout);

    // Capture file changes (git path or hash fallback).
    const filesChanged = captureFileChanges({ cwd, pre, log: ctx.log });

    // Token extraction.
    const u = envelope.usage ?? {};
    const tokensInput = numOr0(u.input_tokens);
    const tokensOutput = numOr0(u.output_tokens);
    const cacheCreate = numOrUndef(u.cache_creation_input_tokens);
    const cacheRead = numOrUndef(u.cache_read_input_tokens);
    const tokensTotal = tokensInput + tokensOutput + (cacheCreate ?? 0) + (cacheRead ?? 0);

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
      toolsUsed,
      tokens: {
        input: tokensInput,
        output: tokensOutput,
        ...(cacheCreate !== undefined ? { cacheCreate } : {}),
        ...(cacheRead !== undefined ? { cacheRead } : {}),
        total: tokensTotal,
      },
      ...(failureDetail !== undefined ? { failureDetail } : {}),
    };

    const id = await ctx.contextStore.put('factory-implement-report', payload, {
      parents: [ctx.runId],
    });

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

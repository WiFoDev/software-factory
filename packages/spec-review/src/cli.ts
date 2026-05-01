#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SpecParseError, parseSpec } from '@wifo/factory-core';
import { claudeCliJudgeClient } from './claude-cli-judge-client.js';
import { type ReviewFinding, formatFindings } from './findings.js';
import { defaultEnabledJudges, type loadJudgeRegistry } from './judges/index.js';
import { runReview } from './review.js';

const USAGE = `Usage:
  factory spec review <path> [flags]

Path: a .md file or a directory (recurses into subdirectories for *.md).

Flags:
  --cache-dir <path>      Cache directory (default: .factory-spec-review-cache)
  --no-cache              Disable cache layer entirely
  --judges <a,b,c>        Comma-separated subset of enabled judges (default: all 5)
  --claude-bin <path>     Override the claude binary path (test injection)
  --technical-plan <path> Override auto-resolution of paired technical-plan
  --timeout-ms <n>        Per-judge timeout in milliseconds (default: 60000)
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  exit: (code: number) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  exit: (code) => {
    process.stdout.write('', () => {
      process.stderr.write('', () => process.exit(code));
    });
  },
};

const KNOWN_JUDGE_CODES = new Set(defaultEnabledJudges());

export async function runReviewCli(args: string[], io: CliIo = defaultIo): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        'cache-dir': { type: 'string' },
        'no-cache': { type: 'boolean' },
        judges: { type: 'string' },
        'claude-bin': { type: 'string' },
        'technical-plan': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr(`${msg}\n${USAGE}`);
    io.exit(2);
    return;
  }

  const target = parsed.positionals[0];
  if (target === undefined) {
    io.stderr(`Missing <path>\n${USAGE}`);
    io.exit(2);
    return;
  }

  // Validate --judges if supplied.
  let judges:
    | ReturnType<typeof loadJudgeRegistry>[keyof ReturnType<typeof loadJudgeRegistry>]['code'][]
    | undefined;
  const judgesRaw = parsed.values.judges;
  if (typeof judgesRaw === 'string') {
    const parts = judgesRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const p of parts) {
      const namespaced = p.startsWith('review/') ? p : `review/${p}`;
      if (!KNOWN_JUDGE_CODES.has(namespaced as typeof judges extends Array<infer T> ? T : never)) {
        io.stderr(`review/invalid-judges: unknown code '${p}'\n`);
        io.exit(2);
        return;
      }
    }
    judges = parts.map(
      (p) =>
        (p.startsWith('review/') ? p : `review/${p}`) as ReturnType<
          typeof defaultEnabledJudges
        >[number],
    );
  }

  // Validate --timeout-ms.
  const timeoutRaw = parsed.values['timeout-ms'];
  let timeoutMs: number | undefined;
  if (typeof timeoutRaw === 'string') {
    const n = Number.parseInt(timeoutRaw, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== timeoutRaw.trim()) {
      io.stderr(
        `review/invalid-timeout-ms: --timeout-ms must be a positive integer (got '${timeoutRaw}')\n`,
      );
      io.exit(2);
      return;
    }
    timeoutMs = n;
  }

  const cacheDir = parsed.values['no-cache']
    ? undefined
    : typeof parsed.values['cache-dir'] === 'string'
      ? resolve(process.cwd(), parsed.values['cache-dir'])
      : resolve(process.cwd(), '.factory-spec-review-cache');

  const claudeBin =
    typeof parsed.values['claude-bin'] === 'string' ? parsed.values['claude-bin'] : undefined;

  const technicalPlanOverride =
    typeof parsed.values['technical-plan'] === 'string'
      ? parsed.values['technical-plan']
      : undefined;

  const judgeClient = claudeCliJudgeClient({
    ...(claudeBin !== undefined ? { claudeBin } : {}),
  });

  // Resolve target → list of spec files.
  const targetPath = resolve(process.cwd(), target);
  let files: string[];
  try {
    files = collectMarkdownFiles(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      io.stderr(`Path not found: ${target}\n`);
      io.exit(1);
      return;
    }
    throw err;
  }
  if (files.length === 0) {
    io.stderr(`No markdown files found at ${target}\n`);
    io.exit(1);
    return;
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  let okFiles = 0;

  for (const file of files) {
    const rel = relative(process.cwd(), file) || file;
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.stderr(`${rel}  error    review/io-failed              ${msg}\n`);
      totalErrors += 1;
      continue;
    }

    let spec: ReturnType<typeof parseSpec> | undefined;
    try {
      spec = parseSpec(source, { filename: rel });
    } catch (err) {
      if (err instanceof SpecParseError) {
        for (const issue of err.issues) {
          const linePart = issue.line !== undefined ? `:${issue.line}` : '';
          io.stderr(`${rel}${linePart}  error    review/spec-parse-failed     ${issue.message}\n`);
          totalErrors += 1;
        }
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        io.stderr(`${rel}  error    review/spec-parse-failed      ${msg}\n`);
        totalErrors += 1;
      }
      continue;
    }

    // Auto-resolve paired technical-plan unless overridden.
    const techPath = technicalPlanOverride ?? autoResolveTechnicalPlan(file);
    const technicalPlan = techPath !== undefined ? readTextOr(techPath) : undefined;

    let findings: ReviewFinding[];
    try {
      findings = await runReview({
        specPath: rel,
        spec,
        judgeClient,
        cacheDir,
        ...(judges !== undefined ? { judges } : {}),
        ...(technicalPlan !== undefined ? { technicalPlan } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
    } catch (err) {
      // runReview itself doesn't throw — but a bug here would hit this path.
      const msg = err instanceof Error ? err.message : String(err);
      io.stderr(`${rel}  error    review/run-failed             ${msg}\n`);
      totalErrors += 1;
      continue;
    }

    if (findings.length === 0) {
      io.stdout(`${rel}: OK\n`);
      okFiles += 1;
      continue;
    }
    io.stderr(formatFindings(findings, { file: rel }));
    totalErrors += findings.filter((f) => f.severity === 'error').length;
    totalWarnings += findings.filter((f) => f.severity === 'warning').length;
  }

  if (totalErrors === 0 && totalWarnings === 0 && okFiles === files.length) {
    // All clean.
    io.exit(0);
    return;
  }

  io.exit(totalErrors > 0 ? 1 : 0);
}

function collectMarkdownFiles(target: string): string[] {
  const stat = statSync(target);
  if (stat.isFile()) {
    return target.endsWith('.md') ? [target] : [];
  }
  if (!stat.isDirectory()) return [];
  const out: string[] = [];
  const entries = readdirSync(target, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    const dir =
      (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
      (entry as unknown as { path?: string }).path ??
      target;
    out.push(join(dir, entry.name));
  }
  return out.sort();
}

function autoResolveTechnicalPlan(specFile: string): string | undefined {
  // Probe the four canonical locations:
  //   docs/specs/<id>.md ↔ docs/technical-plans/<id>.md
  //   docs/specs/done/<id>.md ↔ docs/technical-plans/done/<id>.md
  // We replace the `specs` segment with `technical-plans` in the spec's path.
  const dir = dirname(specFile);
  const filename = specFile.slice(dir.length + 1);
  const candidates: string[] = [];
  if (dir.includes(`${'/'}specs${'/'}`) || dir.endsWith(`${'/'}specs`)) {
    candidates.push(specFile.replace(/\/specs\//g, '/technical-plans/'));
    candidates.push(specFile.replace(/\/specs$/, '/technical-plans'));
  }
  if (dir.endsWith('/specs/done') || dir.endsWith('/specs')) {
    candidates.push(
      join(
        dir.replace('/specs/done', '/technical-plans/done').replace('/specs', '/technical-plans'),
        filename,
      ),
    );
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

function readTextOr(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

if (typeof process !== 'undefined' && Array.isArray(process.argv)) {
  const entry = process.argv[1];
  if (entry !== undefined) {
    let isMain = false;
    try {
      isMain = realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
    } catch {
      // not a file:// URL
    }
    if (isMain) {
      runReviewCli(process.argv.slice(2)).catch((err) => {
        process.stderr.write(
          `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
        );
        process.exit(3);
      });
    }
  }
}

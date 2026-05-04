import { spawn } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { watch } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { lintSpec } from './lint.js';

export interface WatchSpecsOptions {
  rootPath: string;
  debounceMs?: number;
  review?: boolean;
  claudeBin?: string;
  logLine: (line: string) => void;
}

export function watchSpecs(opts: WatchSpecsOptions): { stop: () => Promise<void> } {
  const debounceMs = opts.debounceMs ?? 200;
  const root = resolve(opts.rootPath);
  const ac = new AbortController();
  const timers = new Map<string, NodeJS.Timeout>();
  const inflight = new Set<Promise<void>>();
  let stopped = false;

  const onChange = (filename: string): void => {
    if (stopped) return;
    if (!filename.endsWith('.md')) return;
    const absPath = isAbsolute(filename) ? filename : resolve(root, filename);
    const existing = timers.get(absPath);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(absPath);
      const p = processChange(absPath, opts).finally(() => inflight.delete(p));
      inflight.add(p);
    }, debounceMs);
    timers.set(absPath, timer);
  };

  void (async () => {
    try {
      const watcher = watch(root, { recursive: true, signal: ac.signal });
      for await (const event of watcher) {
        if (event.filename === null) continue;
        onChange(event.filename);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      opts.logLine(`factory spec watch: error ${msg}\n`);
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      ac.abort();
      await Promise.allSettled([...inflight]);
    },
  };
}

async function processChange(absPath: string, opts: WatchSpecsOptions): Promise<void> {
  let exists = true;
  try {
    statSync(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') exists = false;
    else throw err;
  }
  if (!exists) {
    opts.logLine(`${absPath}: deleted\n`);
    return;
  }

  let source: string;
  try {
    source = readFileSync(absPath, 'utf8');
  } catch {
    return;
  }

  const errors = lintSpec(source, { filename: absPath });
  for (const err of errors) {
    const linePart = err.line !== undefined ? `:${err.line}` : '';
    const sev = err.severity === 'error' ? 'error  ' : 'warning';
    opts.logLine(`${absPath}${linePart}  ${sev}  ${err.code.padEnd(28)}  ${err.message}\n`);
  }
  const errCount = errors.filter((e) => e.severity === 'error').length;
  const warnCount = errors.filter((e) => e.severity === 'warning').length;
  opts.logLine(
    `${absPath}: ${errCount} error${errCount === 1 ? '' : 's'}, ${warnCount} warning${warnCount === 1 ? '' : 's'}\n`,
  );

  if (opts.review === true && errCount === 0) {
    await runReviewExternal(absPath, opts.claudeBin, opts.logLine);
  }
}

async function runReviewExternal(
  file: string,
  claudeBin: string | undefined,
  logLine: (line: string) => void,
): Promise<void> {
  const cliPath = process.env.FACTORY_SPEC_REVIEW_CLI ?? findSpecReviewCli();
  if (cliPath === null || cliPath === undefined) {
    logLine('spec/review-unavailable: install @wifo/factory-spec-review\n');
    return;
  }
  const reviewArgs = ['--no-cache'];
  if (claudeBin !== undefined) {
    reviewArgs.push('--claude-bin', claudeBin);
  }
  reviewArgs.push(file);

  const isTs = cliPath.endsWith('.ts');
  const cmd = isTs ? 'bun' : 'node';
  const fullArgs = isTs ? ['run', cliPath, ...reviewArgs] : [cliPath, ...reviewArgs];

  await new Promise<void>((resolvePromise) => {
    const child = spawn(cmd, fullArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      err += c.toString('utf8');
    });
    child.on('error', (e) => {
      logLine(`spec/review-spawn-failed: ${e.message}\n`);
      resolvePromise();
    });
    child.on('close', () => {
      if (out.length > 0) logLine(out);
      if (err.length > 0) logLine(err);
      resolvePromise();
    });
  });
}

function findSpecReviewCli(): string | null {
  let cur = process.cwd();
  while (true) {
    const candidate = join(cur, 'node_modules', '@wifo', 'factory-spec-review', 'dist', 'cli.js');
    try {
      statSync(candidate);
      return realpathSync(candidate);
    } catch {
      // not present at this level
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

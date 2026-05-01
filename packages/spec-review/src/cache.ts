// Content-addressable cache for review findings. Key = sha256(specBytes :
// ruleSetHash : sortedJudges). Values are JSON-serialized ReviewFinding[].
// Atomic writes via tmp+rename. Bad cache entries (parse failure, shape
// mismatch) are treated as cache miss — never crash the run.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewFinding, ReviewSeverity } from './findings.js';

export function computeCacheKey(args: {
  specBytes: string;
  ruleSetHash: string;
  enabledJudges: string[];
}): string {
  const sortedJudges = [...args.enabledJudges].sort().join(',');
  const composite = `${args.specBytes}:${args.ruleSetHash}:${sortedJudges}`;
  return createHash('sha256').update(composite).digest('hex');
}

export function cacheGet(cacheDir: string, cacheKey: string): ReviewFinding[] | null {
  const path = join(cacheDir, `${cacheKey}.json`);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const findings: ReviewFinding[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return null;
    const f = item as Record<string, unknown>;
    const severity = f.severity;
    const code = f.code;
    const message = f.message;
    if (typeof code !== 'string' || typeof message !== 'string') return null;
    if (severity !== 'error' && severity !== 'warning' && severity !== 'info') return null;
    const out: ReviewFinding = {
      severity: severity as ReviewSeverity,
      // Cast — we trust our own writer; runtime validation above gates content.
      code: code as ReviewFinding['code'],
      message,
    };
    if (typeof f.file === 'string') out.file = f.file;
    if (typeof f.line === 'number') out.line = f.line;
    findings.push(out);
  }
  return findings;
}

export function cacheSet(cacheDir: string, cacheKey: string, findings: ReviewFinding[]): void {
  mkdirSync(cacheDir, { recursive: true });
  const tmpName = `.${cacheKey}.${randomBytes(4).toString('hex')}.tmp`;
  const tmpPath = join(cacheDir, tmpName);
  const finalPath = join(cacheDir, `${cacheKey}.json`);
  writeFileSync(tmpPath, JSON.stringify(findings, null, 2));
  renameSync(tmpPath, finalPath);
}

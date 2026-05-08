import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ResolveContextDirInput {
  cliFlag?: string | undefined;
  configValue?: string | undefined;
}

/**
 * v0.0.14 universal default. Matches the directory `factory init` creates.
 * Replaces the v0.0.13 split where `factory-runtime` defaulted to `./.factory`
 * but `factory finish-task` and `factory-context` defaulted to `./context`.
 */
export const FACTORY_CONTEXT_DIR_DEFAULT = './.factory';

/**
 * Pure resolver for the `--context-dir` precedence chain shared by every CLI
 * that reads the factory context store. Precedence:
 *   CLI flag > factory.config.json runtime.contextDir > universal default.
 *
 * Returns the unresolved path string — callers `resolve(cwd, ...)` themselves
 * so the helper stays pure (deterministic on inputs, no `process.cwd()` reads).
 */
export function resolveContextDir(input: ResolveContextDirInput): string {
  if (input.cliFlag !== undefined) return input.cliFlag;
  if (input.configValue !== undefined) return input.configValue;
  return FACTORY_CONTEXT_DIR_DEFAULT;
}

/**
 * Read `runtime.contextDir` from `<cwd>/factory.config.json` if present.
 * Returns undefined for missing/malformed/non-string values — config is
 * optional by design (mirrors the factory-runtime config-loader pattern).
 */
export function readContextDirFromConfig(cwd: string): string | undefined {
  const path = resolve(cwd, 'factory.config.json');
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const runtime = (parsed as { runtime?: unknown }).runtime;
    if (runtime === null || typeof runtime !== 'object') return undefined;
    const v = (runtime as { contextDir?: unknown }).contextDir;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

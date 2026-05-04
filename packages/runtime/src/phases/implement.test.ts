import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContextStore } from '@wifo/factory-context';
import { parseSpec } from '@wifo/factory-core';
import { RuntimeError } from '../errors.js';
import {
  FactoryDodReportSchema,
  FactoryImplementReportSchema,
  FactoryRunSchema,
  FactoryValidateReportSchema,
  tryRegister,
} from '../records.js';
import type { PhaseContext } from '../types.js';
import {
  DEFAULT_TIMEOUT_MS,
  IMPLEMENTATION_GUIDELINES,
  buildPrompt,
  implementPhase,
  parseAgentJson,
  spawnAgent,
  stripAnsi,
  tailDetail,
} from './implement.js';
import { validatePhase } from './validate.js';

const RUNTIME_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const FIXTURES = resolve(RUNTIME_ROOT, 'test-fixtures');
const FAKE_CLAUDE = resolve(FIXTURES, 'fake-claude.ts');

function defaultLog(): (line: string) => void {
  return () => {};
}

// ----- helpers -----------------------------------------------------------

describe('stripAnsi', () => {
  test('strips colour and cursor escape sequences', () => {
    const input = '[31mred[0m[2K[1Aclear';
    expect(stripAnsi(input)).toBe('redclear');
  });
});

describe('tailDetail', () => {
  test('keeps the last 20 lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n');
    const tailed = tailDetail(lines);
    expect(tailed.split('\n')).toHaveLength(20);
    expect(tailed.endsWith('line29')).toBe(true);
  });

  test('caps byte length with truncation marker on enormous input', () => {
    const huge = 'a'.repeat(50_000);
    const tailed = tailDetail(huge);
    expect(tailed).toContain('… [truncated]');
    expect(Buffer.byteLength(tailed, 'utf8')).toBeLessThan(5_000);
  });
});

// ----- buildPrompt — Implementation guidelines (v0.0.5) -----------------

describe('buildPrompt — Implementation guidelines section (v0.0.5)', () => {
  test('buildPrompt emits Implementation guidelines section before # Spec', () => {
    const prompt = buildPrompt({
      specSource: 'fake spec source',
      cwd: '/tmp/work',
      iteration: 1,
    });
    const guidelinesIdx = prompt.indexOf('# Implementation guidelines');
    const specIdx = prompt.indexOf('# Spec');
    expect(guidelinesIdx).toBeGreaterThan(-1);
    expect(specIdx).toBeGreaterThan(-1);
    expect(guidelinesIdx).toBeLessThan(specIdx);
    // Four behavior-prior bullet substrings (case-insensitive — the locked
    // text capitalizes the phrase starts).
    const lower = prompt.toLowerCase();
    expect(lower).toContain('state your assumptions');
    expect(lower).toContain('minimum code');
    expect(lower).toContain('surgical');
    expect(lower).toContain('verifiable');
    // Section is followed by a blank line then # Spec.
    expect(prompt.slice(0, specIdx).endsWith('\n\n')).toBe(true);
  });

  test('Implementation guidelines section is byte-identical across iterations 1..5', () => {
    const prompts = [1, 2, 3, 4, 5].map((iter) =>
      buildPrompt({
        specSource: 'fake spec source',
        cwd: '/tmp/work',
        iteration: iter,
      }),
    );
    const sections = prompts.map((p) =>
      p.slice(p.indexOf('# Implementation guidelines'), p.indexOf('# Spec')),
    );
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i]).toBe(sections[0] ?? '');
    }
  });

  test('Implementation guidelines section bytes are stable under different priorSection inputs', () => {
    const promptNoPrior = buildPrompt({
      specSource: 'fake spec source',
      cwd: '/tmp/work',
      iteration: 2,
    });
    const promptWithPrior = buildPrompt({
      specSource: 'fake spec source',
      cwd: '/tmp/work',
      iteration: 2,
      priorSection: '# Prior validate report\n\n- **S-1 — sample**: failed something',
    });
    const promptDifferentPrior = buildPrompt({
      specSource: 'fake spec source',
      cwd: '/tmp/work',
      iteration: 2,
      priorSection: '# Prior validate report\n\n- **S-2 — other**: a totally different failure',
    });
    const extract = (p: string): string =>
      p.slice(p.indexOf('# Implementation guidelines'), p.indexOf('# Spec'));
    expect(extract(promptNoPrior)).toBe(extract(promptWithPrior));
    expect(extract(promptWithPrior)).toBe(extract(promptDifferentPrior));
    // Identical input → identical output (byte-stable).
    const a = buildPrompt({
      specSource: 'fake spec source',
      cwd: '/tmp/work',
      iteration: 1,
    });
    const b = buildPrompt({
      specSource: 'fake spec source',
      cwd: '/tmp/work',
      iteration: 1,
    });
    expect(a).toBe(b);
  });

  test('IMPLEMENTATION_GUIDELINES is under the 2 KB cap', () => {
    expect(Buffer.byteLength(IMPLEMENTATION_GUIDELINES, 'utf8')).toBeLessThanOrEqual(2048);
  });

  test('buildPrompt output preserves v0.0.4 section ordering with the new section inserted before # Spec', () => {
    const priorSection = '# Prior validate report\n\n- **S-1 — sample**: failed something';
    const prompt = buildPrompt({
      specSource: 'fake spec source',
      cwd: '/tmp/work',
      iteration: 2,
      priorSection,
    });
    const idxOpening = prompt.indexOf('You are an automated coding agent');
    const idxGuidelines = prompt.indexOf('# Implementation guidelines');
    const idxSpec = prompt.indexOf('# Spec\n');
    const idxPrior = prompt.indexOf('# Prior validate report');
    const idxWorking = prompt.indexOf('# Working directory');
    const idxTools = prompt.indexOf('# Tools');
    const idxConstraints = prompt.indexOf('# Constraints');
    const idxDone = prompt.indexOf('# What "done" looks like');
    const idxClosing = prompt.indexOf('finish your turn');
    expect(idxOpening).toBeGreaterThan(-1);
    expect(idxGuidelines).toBeGreaterThan(idxOpening);
    expect(idxSpec).toBeGreaterThan(idxGuidelines);
    expect(idxPrior).toBeGreaterThan(idxSpec);
    expect(idxWorking).toBeGreaterThan(idxPrior);
    expect(idxTools).toBeGreaterThan(idxWorking);
    expect(idxConstraints).toBeGreaterThan(idxTools);
    expect(idxDone).toBeGreaterThan(idxConstraints);
    expect(idxClosing).toBeGreaterThan(idxDone);
  });
});

// ----- parseAgentJson ----------------------------------------------------

describe('parseAgentJson', () => {
  test('returns the parsed envelope on valid JSON', () => {
    const env = parseAgentJson(
      JSON.stringify({ type: 'result', is_error: false, usage: { input_tokens: 100 } }),
    );
    expect(env.is_error).toBe(false);
    expect(env.usage?.input_tokens).toBe(100);
  });

  test('throws RuntimeError({ code: agent-failed }) with agent-output-invalid prefix on bad JSON', () => {
    try {
      parseAgentJson('not json at all');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      const re = err as RuntimeError;
      expect(re.code).toBe('runtime/agent-failed');
      expect(re.message).toContain('agent-output-invalid:');
      expect(re.message).toContain('output tail:');
    }
  });

  test('rejects non-object JSON (e.g. a literal number)', () => {
    expect(() => parseAgentJson('42')).toThrow(
      /agent-output-invalid: stdout did not parse to a JSON object/,
    );
  });
});

// ----- spawnAgent --------------------------------------------------------

describe('spawnAgent', () => {
  test('returns exit-0 envelope on FAKE_CLAUDE_MODE=success', async () => {
    // Run the fake in a tmp cwd so its `success` mode default-write
    // (`src/needs-impl.ts`) lands in the tmp dir, not in packages/runtime/src.
    const cwd = mkdtempSync(join(tmpdir(), 'spawn-agent-'));
    try {
      const result = await spawnAgent({
        claudePath: FAKE_CLAUDE,
        allowedTools: 'Read,Edit,Write,Bash',
        cwd,
        env: { ...process.env, FAKE_CLAUDE_MODE: 'success', FAKE_CLAUDE_TOKENS: '5000' },
        prompt: 'a tiny prompt',
        timeoutMs: 10_000,
        log: defaultLog(),
      });
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBe(null);
      const env = parseAgentJson(result.stdout);
      expect(env.is_error).toBe(false);
      expect(env.usage?.input_tokens).toBe(5000);
      // stdin propagation: the fake echoes the first 80 chars of the prompt.
      expect((env as { _prompt_first_80?: string })._prompt_first_80).toBe('a tiny prompt');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('returns exit-1 result (NOT throws) on FAKE_CLAUDE_MODE=exit-nonzero — caller decides', async () => {
    const result = await spawnAgent({
      claudePath: FAKE_CLAUDE,
      allowedTools: 'Read,Edit,Write,Bash',
      cwd: RUNTIME_ROOT,
      env: {
        ...process.env,
        FAKE_CLAUDE_MODE: 'exit-nonzero',
        FAKE_CLAUDE_EXIT_CODE: '1',
      },
      prompt: '',
      timeoutMs: 10_000,
      log: defaultLog(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('authentication failed');
  });

  test('rejects with agent-spawn-failed when claudePath does not exist', async () => {
    try {
      await spawnAgent({
        claudePath: '/this/does/not/exist/claude-bin',
        allowedTools: 'Read,Edit,Write,Bash',
        cwd: RUNTIME_ROOT,
        env: { ...process.env },
        prompt: '',
        timeoutMs: 10_000,
        log: defaultLog(),
      });
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      const re = err as RuntimeError;
      expect(re.code).toBe('runtime/agent-failed');
      expect(re.message).toContain('agent-spawn-failed:');
    }
  });

  test('rejects with agent-timeout when child exceeds timeoutMs', async () => {
    try {
      await spawnAgent({
        claudePath: FAKE_CLAUDE,
        allowedTools: 'Read,Edit,Write,Bash',
        cwd: RUNTIME_ROOT,
        env: { ...process.env, FAKE_CLAUDE_MODE: 'hang' },
        prompt: '',
        timeoutMs: 200,
        log: defaultLog(),
      });
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      const re = err as RuntimeError;
      expect(re.code).toBe('runtime/agent-failed');
      expect(re.message).toContain('agent-timeout (after 200ms):');
    }
  });

  test('rejects with agent-killed-by-signal when child is killed by an external signal', async () => {
    try {
      await spawnAgent({
        claudePath: FAKE_CLAUDE,
        allowedTools: 'Read,Edit,Write,Bash',
        cwd: RUNTIME_ROOT,
        env: { ...process.env, FAKE_CLAUDE_MODE: 'self-kill' },
        prompt: '',
        timeoutMs: 10_000,
        log: defaultLog(),
      });
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      const re = err as RuntimeError;
      expect(re.code).toBe('runtime/agent-failed');
      expect(re.message).toMatch(/agent-killed-by-signal SIG(TERM|KILL):/);
    }
  });

  test('forwards stderr lines through the log callback (prefixed with [claude])', async () => {
    const logged: string[] = [];
    await spawnAgent({
      claudePath: FAKE_CLAUDE,
      allowedTools: 'Read,Edit,Write,Bash',
      cwd: RUNTIME_ROOT,
      env: { ...process.env, FAKE_CLAUDE_MODE: 'exit-nonzero' },
      prompt: '',
      timeoutMs: 10_000,
      log: (line) => logged.push(line),
    });
    expect(
      logged.some((l) => l.startsWith('[claude] ') && l.includes('authentication failed')),
    ).toBe(true);
  });
});

// ----- implementPhase factory --------------------------------------------

let storeDir: string;
let workDir: string;
let workSpecPath: string;

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'runtime-implement-store-'));
  workDir = mkdtempSync(join(tmpdir(), 'runtime-implement-work-'));
  // Copy the fixture spec + test into workDir so the agent edits land in an
  // isolated tree (and the post-run cleanup is straightforward). We copy the
  // markdown source and the bun-test sibling so the spec's `test:` path
  // resolves when validate runs against workDir.
  const specMd = readFileSync(join(FIXTURES, 'needs-impl.md'), 'utf8');
  const testTs = readFileSync(join(FIXTURES, 'needs-impl.test.ts'), 'utf8');
  Bun.write(join(workDir, 'needs-impl.md'), specMd);
  Bun.write(join(workDir, 'needs-impl.test.ts'), testTs);
  workSpecPath = join(workDir, 'needs-impl.md');
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

async function setupCtx(): Promise<{ ctx: PhaseContext; runId: string }> {
  const store = createContextStore({ dir: storeDir });
  tryRegister(store, 'factory-run', FactoryRunSchema);
  tryRegister(store, 'factory-implement-report', FactoryImplementReportSchema);
  tryRegister(store, 'factory-validate-report', FactoryValidateReportSchema);

  const runId = await store.put(
    'factory-run',
    {
      specId: 'runtime-smoke-needs-impl',
      graphPhases: ['implement', 'validate'],
      maxIterations: 1,
      startedAt: new Date().toISOString(),
    },
    { parents: [] },
  );

  const source = readFileSync(workSpecPath, 'utf8');
  const spec = parseSpec(source, { filename: workSpecPath });

  const ctx: PhaseContext = {
    spec,
    contextStore: store,
    log: () => {},
    runId,
    iteration: 1,
    inputs: [],
  };
  return { ctx, runId };
}

describe('implementPhase — happy path (S-1)', () => {
  test('exits 0, JSON valid, no overrun → status=pass; report persisted with parents=[runId] and full payload (result populated, failureDetail undefined)', async () => {
    const { ctx, runId } = await setupCtx();

    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    expect(phase.name).toBe('implement');

    // Configure the fake to write src/needs-impl.ts and report a custom result.
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '5000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    process.env.FAKE_CLAUDE_RESULT = 'I implemented impl() in src/needs-impl.ts';

    try {
      const result = await phase.run(ctx);
      expect(result.status).toBe('pass');
      expect(result.records.length).toBe(1);

      const record = result.records[0];
      expect(record).toBeDefined();
      expect(record?.type).toBe('factory-implement-report');
      expect(record?.parents).toEqual([runId]);

      const payload = record?.payload as {
        status: string;
        iteration: number;
        exitCode: number | null;
        cwd: string;
        prompt: string;
        allowedTools: string;
        claudePath: string;
        result: string;
        failureDetail?: string;
        tokens: { input: number; output: number; total: number };
        filesChanged: { path: string; diff: string }[];
        toolsUsed: string[];
      };
      expect(payload.status).toBe('pass');
      expect(payload.iteration).toBe(1);
      expect(payload.exitCode).toBe(0);
      expect(payload.cwd).toBe(workDir);
      expect(payload.allowedTools).toBe('Read,Edit,Write,Bash');
      expect(payload.claudePath).toBe(FAKE_CLAUDE);
      expect(payload.result).toBe('I implemented impl() in src/needs-impl.ts');
      expect(payload.failureDetail).toBeUndefined();
      expect(payload.tokens.input).toBe(5000);
      expect(payload.tokens.total).toBeGreaterThanOrEqual(5000);
      // Prompt contains the spec source as a substring.
      expect(payload.prompt).toContain('runtime-smoke-needs-impl');
      expect(payload.prompt).toContain('# Working directory');
      expect(payload.prompt).toContain(workDir);
      // The fake's edit landed.
      expect(existsSync(join(workDir, 'src/needs-impl.ts'))).toBe(true);
      // filesChanged has at least one entry.
      expect(payload.filesChanged.length).toBeGreaterThanOrEqual(1);
      expect(payload.toolsUsed.length).toBeGreaterThan(0);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_RESULT');
    }
  });
});

describe('implementPhase — cost cap (S-2)', () => {
  test('overrun → report persisted with status=error and result preserved before RuntimeError is thrown', async () => {
    const { ctx, runId } = await setupCtx();

    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
      maxPromptTokens: 100_000,
    });

    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '150000';
    process.env.FAKE_CLAUDE_RESULT = 'I edited src/needs-impl.ts despite the budget overrun';

    try {
      let thrown: unknown;
      try {
        await phase.run(ctx);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      const re = thrown as RuntimeError;
      expect(re.code).toBe('runtime/cost-cap-exceeded');
      expect(re.message).toContain(
        'cost-cap-exceeded: input_tokens=150000 > maxPromptTokens=100000',
      );

      // The report exists on disk with status=error and result preserved.
      const store = createContextStore({ dir: storeDir });
      tryRegister(store, 'factory-implement-report', FactoryImplementReportSchema);
      const records = await store.list({ type: 'factory-implement-report' });
      expect(records.length).toBe(1);
      const rec = records[0];
      expect(rec?.parents).toEqual([runId]);
      const payload = rec?.payload as {
        status: string;
        result: string;
        failureDetail?: string;
        tokens: { input: number };
      };
      expect(payload.status).toBe('error');
      expect(payload.result).toBe('I edited src/needs-impl.ts despite the budget overrun');
      expect(payload.failureDetail).toContain(
        'cost-cap-exceeded: input_tokens=150000 > maxPromptTokens=100000',
      );
      expect(payload.tokens.input).toBe(150000);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_RESULT');
    }
  });

  test('implementPhase({ maxPromptTokens: 0 }) throws RuntimeError({ code: invalid-max-prompt-tokens }) synchronously', () => {
    expect(() => implementPhase({ maxPromptTokens: 0 })).toThrow(RuntimeError);
    try {
      implementPhase({ maxPromptTokens: 0 });
    } catch (err) {
      const re = err as RuntimeError;
      expect(re.code).toBe('runtime/invalid-max-prompt-tokens');
      expect(re.message).toContain('must be a positive integer');
    }
  });

  test('implementPhase({ maxPromptTokens: -5 }) and ({ maxPromptTokens: 1.5 }) both reject synchronously', () => {
    expect(() => implementPhase({ maxPromptTokens: -5 })).toThrow(RuntimeError);
    expect(() => implementPhase({ maxPromptTokens: 1.5 })).toThrow(RuntimeError);
  });
});

describe('implementPhase — operational failures (S-3)', () => {
  test('(a) spawn-failed: claudePath does not exist → runtime/agent-failed with agent-spawn-failed prefix; no implement-report persisted', async () => {
    const { ctx } = await setupCtx();
    const phase = implementPhase({
      cwd: workDir,
      claudePath: '/this/does/not/exist/claude-bin',
      twin: 'off',
    });
    let thrown: unknown;
    try {
      await phase.run(ctx);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
    const re = thrown as RuntimeError;
    expect(re.code).toBe('runtime/agent-failed');
    expect(re.message).toContain('agent-spawn-failed:');

    const store = createContextStore({ dir: storeDir });
    tryRegister(store, 'factory-implement-report', FactoryImplementReportSchema);
    const records = await store.list({ type: 'factory-implement-report' });
    expect(records.length).toBe(0);
  });

  test('(b) exit-nonzero: claude exits 1 with stderr → runtime/agent-failed with agent-exit-nonzero prefix and stderr tail', async () => {
    const { ctx } = await setupCtx();
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'exit-nonzero';
    process.env.FAKE_CLAUDE_EXIT_CODE = '1';
    try {
      let thrown: unknown;
      try {
        await phase.run(ctx);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      const re = thrown as RuntimeError;
      expect(re.code).toBe('runtime/agent-failed');
      expect(re.message).toContain('agent-exit-nonzero (code=1):');
      expect(re.message).toContain('authentication failed');

      const store = createContextStore({ dir: storeDir });
      tryRegister(store, 'factory-implement-report', FactoryImplementReportSchema);
      const records = await store.list({ type: 'factory-implement-report' });
      expect(records.length).toBe(0);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EXIT_CODE');
    }
  });

  test('(c) malformed-json: claude exits 0 with non-JSON stdout → runtime/agent-failed with agent-output-invalid prefix', async () => {
    const { ctx } = await setupCtx();
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'malformed-json';
    try {
      let thrown: unknown;
      try {
        await phase.run(ctx);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      const re = thrown as RuntimeError;
      expect(re.code).toBe('runtime/agent-failed');
      expect(re.message).toContain('agent-output-invalid:');
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
    }
  });

  test('(d) hang: child exceeds timeoutMs → runtime/agent-failed with agent-timeout prefix', async () => {
    const { ctx } = await setupCtx();
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
      timeoutMs: 200,
    });
    process.env.FAKE_CLAUDE_MODE = 'hang';
    try {
      let thrown: unknown;
      try {
        await phase.run(ctx);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      const re = thrown as RuntimeError;
      expect(re.code).toBe('runtime/agent-failed');
      expect(re.message).toContain('agent-timeout (after 200ms):');
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
    }
  });

  test('(e) self-kill: child SIGTERM-self → runtime/agent-failed with agent-killed-by-signal prefix', async () => {
    const { ctx } = await setupCtx();
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'self-kill';
    try {
      let thrown: unknown;
      try {
        await phase.run(ctx);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      const re = thrown as RuntimeError;
      expect(re.code).toBe('runtime/agent-failed');
      expect(re.message).toMatch(/agent-killed-by-signal SIG(TERM|KILL):/);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
    }
  });
});

describe('implementPhase — self-fail (S-4)', () => {
  test('is_error: true → status=fail with both result and failureDetail populated; validate still runs through run()', async () => {
    const { ctx } = await setupCtx();
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'self-fail';
    process.env.FAKE_CLAUDE_TOKENS = '5000';
    process.env.FAKE_CLAUDE_RESULT = 'I could not complete the task';
    try {
      const result = await phase.run(ctx);
      expect(result.status).toBe('fail');
      expect(result.records.length).toBe(1);
      const record = result.records[0];
      const payload = record?.payload as {
        status: string;
        exitCode: number | null;
        result: string;
        failureDetail?: string;
        tokens: { input: number };
      };
      expect(payload.status).toBe('fail');
      expect(payload.exitCode).toBe(0);
      expect(payload.result).toBe('I could not complete the task');
      expect(payload.failureDetail).toBe('I could not complete the task');
      expect(payload.tokens.input).toBe(5000);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_RESULT');
    }
  });
});

describe('implementPhase — twin env vars (S-5)', () => {
  test('twin: { mode: record, recordingsDir } sets WIFO_TWIN_* on the subprocess (verified via payload.result echo); parent process.env unchanged; dir is mkdir -p', async () => {
    const { ctx } = await setupCtx();
    const recordingsDir = join(storeDir, 'twin-test-S5');
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: { mode: 'record', recordingsDir },
    });
    process.env.FAKE_CLAUDE_MODE = 'echo-env';
    process.env.FAKE_CLAUDE_TOKENS = '5000';
    try {
      const result = await phase.run(ctx);
      expect(result.status).toBe('pass');
      const payload = result.records[0]?.payload as {
        result: string;
        failureDetail?: string;
      };
      expect(payload.result).toContain('WIFO_TWIN_MODE=record');
      expect(payload.result).toContain(`WIFO_TWIN_RECORDINGS_DIR=${recordingsDir}`);
      expect(payload.failureDetail).toBeUndefined();
      expect(process.env.WIFO_TWIN_MODE).toBeUndefined();
      expect(process.env.WIFO_TWIN_RECORDINGS_DIR).toBeUndefined();
      expect(existsSync(recordingsDir)).toBe(true);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
    }
  });

  test('twin: "off" skips env vars and recordings dir creation', async () => {
    const { ctx } = await setupCtx();
    const recordingsDir = join(storeDir, 'twin-test-S5-off');
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'echo-env';
    process.env.FAKE_CLAUDE_TOKENS = '5000';
    try {
      const result = await phase.run(ctx);
      const payload = result.records[0]?.payload as { result: string };
      expect(payload.result).toBe('WIFO_TWIN_MODE= WIFO_TWIN_RECORDINGS_DIR=');
      expect(existsSync(recordingsDir)).toBe(false);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
    }
  });
});

// ----- v0.0.3: prior validate-report threading --------------------------

async function makePriorValidateRecord(
  store: ReturnType<typeof createContextStore>,
  runId: string,
  scenarios: ReadonlyArray<{
    scenarioId: string;
    status: 'pass' | 'fail' | 'error' | 'skipped';
    detail?: string;
  }>,
): Promise<{ id: string; record: NonNullable<Awaited<ReturnType<typeof store.get>>> }> {
  tryRegister(store, 'factory-validate-report', FactoryValidateReportSchema);
  const summary = { pass: 0, fail: 0, error: 0, skipped: 0 };
  for (const s of scenarios) summary[s.status]++;
  const reportStatus = summary.error > 0 ? 'error' : summary.fail > 0 ? 'fail' : 'pass';
  const id = await store.put(
    'factory-validate-report',
    {
      specId: 'runtime-smoke-needs-impl',
      startedAt: new Date().toISOString(),
      durationMs: 100,
      scenarios: scenarios.map((s) => ({
        scenarioId: s.scenarioId,
        status: s.status,
        satisfactions:
          s.detail !== undefined ? [{ kind: 'test', detail: s.detail, status: s.status }] : [],
      })),
      summary,
      status: reportStatus,
    },
    { parents: [runId] },
  );
  const record = await store.get(id);
  if (record === null) throw new Error('vanished');
  return { id, record };
}

describe('implementPhase — v0.0.3 prior validate-report threading', () => {
  test('iter 1 (no prior in ctx.inputs): prompt has no Prior section; payload.priorValidateReportId undefined; parents=[runId]', async () => {
    const { ctx, runId } = await setupCtx();
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    try {
      const result = await phase.run(ctx);
      expect(result.status).toBe('pass');
      const rec = result.records[0];
      expect(rec).toBeDefined();
      const payload = rec?.payload as {
        prompt: string;
        priorValidateReportId?: string;
      };
      expect(payload.prompt).not.toContain('# Prior validate report');
      expect(payload.priorValidateReportId).toBeUndefined();
      expect(rec?.parents).toEqual([runId]);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('iter 2 (prior in ctx.inputs): prompt has Prior section with failed scenarios only; payload.priorValidateReportId set; parents=[runId, priorId]', async () => {
    const { ctx, runId } = await setupCtx();
    // Build a synthetic prior validate-report and inject it via ctx.inputs
    const { id: priorId, record: priorRec } = await makePriorValidateRecord(
      ctx.contextStore,
      runId,
      [
        { scenarioId: 'S-1', status: 'pass' },
        { scenarioId: 'S-2', status: 'fail', detail: 'expected 42, got undefined' },
        { scenarioId: 'S-3', status: 'error', detail: 'TypeError: x is not a function' },
      ],
    );
    const ctxWithPrior: PhaseContext = { ...ctx, iteration: 2, inputs: [priorRec] };

    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    try {
      const result = await phase.run(ctxWithPrior);
      expect(result.status).toBe('pass');
      const rec = result.records[0];
      const payload = rec?.payload as {
        prompt: string;
        priorValidateReportId?: string;
      };

      // Section emitted with failed scenarios only (S-2, S-3); S-1 (pass) excluded.
      // Use the bullet prefix `- **` to disambiguate from the spec source's own
      // scenario headings (which use `**S-N**` without the leading `- `).
      expect(payload.prompt).toContain('# Prior validate report');
      expect(payload.prompt).toContain('- **S-2');
      expect(payload.prompt).toContain('expected 42, got undefined');
      expect(payload.prompt).toContain('- **S-3');
      expect(payload.prompt).toContain('TypeError: x is not a function');
      expect(payload.prompt).not.toContain('- **S-1');

      // Section sits between # Spec and # Working directory.
      const specIdx = payload.prompt.indexOf('# Spec\n');
      const priorIdx = payload.prompt.indexOf('# Prior validate report');
      const workingIdx = payload.prompt.indexOf('# Working directory');
      expect(specIdx).toBeGreaterThan(-1);
      expect(priorIdx).toBeGreaterThan(specIdx);
      expect(workingIdx).toBeGreaterThan(priorIdx);

      expect(payload.priorValidateReportId).toBe(priorId);
      expect(rec?.parents).toEqual([runId, priorId]);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('all-pass prior validate-report (defensive case): section omitted; priorValidateReportId still set (record was found in ctx.inputs)', async () => {
    const { ctx, runId } = await setupCtx();
    const { id: priorId, record: priorRec } = await makePriorValidateRecord(
      ctx.contextStore,
      runId,
      [{ scenarioId: 'S-1', status: 'pass' }],
    );
    const ctxWithPrior: PhaseContext = { ...ctx, iteration: 2, inputs: [priorRec] };

    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    try {
      const result = await phase.run(ctxWithPrior);
      const rec = result.records[0];
      const payload = rec?.payload as {
        prompt: string;
        priorValidateReportId?: string;
      };
      expect(payload.prompt).not.toContain('# Prior validate report');
      // The record was found in ctx.inputs even though it had no failures —
      // payload.priorValidateReportId reflects discovery, not section emission.
      expect(payload.priorValidateReportId).toBe(priorId);
      expect(rec?.parents).toEqual([runId, priorId]);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('per-line truncation: detail > 1KB is truncated with ellipsis marker', async () => {
    const { ctx, runId } = await setupCtx();
    const huge = 'x'.repeat(2000);
    const { record: priorRec } = await makePriorValidateRecord(ctx.contextStore, runId, [
      { scenarioId: 'S-1', status: 'fail', detail: huge },
    ]);
    const ctxWithPrior: PhaseContext = { ...ctx, iteration: 2, inputs: [priorRec] };
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    try {
      const result = await phase.run(ctxWithPrior);
      const payload = result.records[0]?.payload as { prompt: string };
      expect(payload.prompt).toContain('# Prior validate report');
      expect(payload.prompt).toContain('… [truncated]');
      // The bullet's content (between the bullet's `: ` and the truncation marker)
      // is bounded by 1KB minus the marker bytes.
      const bulletStart = payload.prompt.indexOf('**S-1');
      const bulletEnd = payload.prompt.indexOf('\n', bulletStart);
      const bulletLine = payload.prompt.slice(bulletStart, bulletEnd);
      expect(Buffer.byteLength(bulletLine, 'utf8')).toBeLessThan(1100);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('section-total truncation: when bullets sum > 50KB, tail is dropped + [runtime] log line emitted', async () => {
    const { ctx, runId } = await setupCtx();
    // Each fail scenario's body caps at ~1KB → 60 fails ≈ 60+ KB → exceeds 50KB total.
    const fails = Array.from({ length: 60 }, (_, i) => ({
      scenarioId: `S-${i + 1}`,
      status: 'fail' as const,
      detail: 'x'.repeat(900),
    }));
    const { record: priorRec } = await makePriorValidateRecord(ctx.contextStore, runId, fails);
    const logLines: string[] = [];
    const ctxWithPrior: PhaseContext = {
      ...ctx,
      iteration: 2,
      inputs: [priorRec],
      log: (l) => logLines.push(l),
    };
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    try {
      const result = await phase.run(ctxWithPrior);
      const payload = result.records[0]?.payload as { prompt: string };
      expect(payload.prompt).toContain('# Prior validate report');
      // The section is bounded — not all 60 bullets present (bound by 50KB).
      const bulletCount = (payload.prompt.match(/^- \*\*S-/gm) ?? []).length;
      expect(bulletCount).toBeLessThan(60);
      expect(bulletCount).toBeGreaterThan(0);
      expect(logLines).toContain('[runtime] truncated prior-validate section');
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('scenario-name resolution: scenarios → holdouts → fallback', async () => {
    const { ctx, runId } = await setupCtx();
    const { record: priorRec } = await makePriorValidateRecord(ctx.contextStore, runId, [
      { scenarioId: 'S-1', status: 'fail', detail: 'first' }, // exists in spec.scenarios
      { scenarioId: 'H-1', status: 'fail', detail: 'second' }, // not in scenarios; not in holdouts (needs-impl.md has neither H-1)
      { scenarioId: 'NOPE', status: 'fail', detail: 'third' }, // unknown
    ]);
    const ctxWithPrior: PhaseContext = { ...ctx, iteration: 2, inputs: [priorRec] };
    const phase = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    try {
      const result = await phase.run(ctxWithPrior);
      const payload = result.records[0]?.payload as { prompt: string };
      // S-1 resolves to its actual scenario name from needs-impl.md
      expect(payload.prompt).toMatch(/\*\*S-1 — .+\*\*: first/);
      // H-1 / NOPE fall back to the marker
      expect(payload.prompt).toContain('**H-1 — (name not in spec)**: second');
      expect(payload.prompt).toContain('**NOPE — (name not in spec)**: third');
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });
});

// ----- v0.0.3: multi-iteration integration via run() ---------------------

import { definePhaseGraph } from '../graph.js';
import { run } from '../runtime.js';

describe('run() — v0.0.3 multi-iter integration (fail-then-pass)', () => {
  test('iter 1 fails, iter 2 passes; parent chain extends; prior section threaded into iter-2 prompt', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'fake-claude-state-'));
    // Use the needs-iter2 fixtures and copy them into a workdir (the integration
    // test wants a clean tree where the agent can write src/needs-iter2.ts).
    const workDir2 = mkdtempSync(join(tmpdir(), 'runtime-iter2-work-'));
    const ctxDir = mkdtempSync(join(tmpdir(), 'runtime-iter2-ctx-'));
    try {
      const specMd = readFileSync(join(FIXTURES, 'needs-iter2.md'), 'utf8');
      const testTs = readFileSync(join(FIXTURES, 'needs-iter2.test.ts'), 'utf8');
      Bun.write(join(workDir2, 'needs-iter2.md'), specMd);
      Bun.write(join(workDir2, 'needs-iter2.test.ts'), testTs);
      const specPath = join(workDir2, 'needs-iter2.md');

      const source = readFileSync(specPath, 'utf8');
      const spec = parseSpec(source, { filename: specPath });

      const store = createContextStore({ dir: ctxDir });
      const impl = implementPhase({
        cwd: workDir2,
        claudePath: FAKE_CLAUDE,
        twin: 'off',
      });
      const val = validatePhase({ cwd: workDir2, noJudge: true });
      const graph = definePhaseGraph([impl, val], [['implement', 'validate']]);

      process.env.FAKE_CLAUDE_MODE = 'fail-then-pass';
      process.env.FAKE_CLAUDE_STATE_DIR = stateDir;
      process.env.FAKE_CLAUDE_TOKENS = '1000';
      try {
        const report = await run({
          spec,
          graph,
          contextStore: store,
          // Default maxIterations = 5; default maxTotalTokens = 500_000. Fake
          // reports 1000 tokens.input + 200 tokens.output per iter — well under cap.
        });

        expect(report.status).toBe('converged');
        expect(report.iterationCount).toBe(2);

        const implReports = await store.list({ type: 'factory-implement-report' });
        const valReports = await store.list({ type: 'factory-validate-report' });
        expect(implReports.length).toBe(2);
        expect(valReports.length).toBe(2);

        const iter1Impl = implReports.find(
          (r) => (r.payload as { iteration: number }).iteration === 1,
        );
        const iter2Impl = implReports.find(
          (r) => (r.payload as { iteration: number }).iteration === 2,
        );
        const iter1Val = valReports.find((r) =>
          (r.payload as { scenarios: { status: string }[] }).scenarios.some(
            (s) => s.status === 'fail',
          ),
        );
        const iter2Val = valReports.find(
          (r) => (r.payload as { status: string }).status === 'pass',
        );

        expect(iter1Impl).toBeDefined();
        expect(iter2Impl).toBeDefined();
        expect(iter1Val).toBeDefined();
        expect(iter2Val).toBeDefined();

        // iter 1 implement: parents = [runId], no priorValidateReportId
        expect(iter1Impl?.parents).toEqual([report.runId]);
        const iter1ImplPayload = iter1Impl?.payload as {
          priorValidateReportId?: string;
          prompt: string;
        };
        expect(iter1ImplPayload.priorValidateReportId).toBeUndefined();
        expect(iter1ImplPayload.prompt).not.toContain('# Prior validate report');

        // iter 2 implement: parents = [runId, iter1ValId]; priorValidateReportId points at iter1Val
        expect(iter2Impl?.parents).toEqual([report.runId, iter1Val?.id ?? '']);
        const iter2ImplPayload = iter2Impl?.payload as {
          priorValidateReportId?: string;
          prompt: string;
          result: string;
        };
        expect(iter2ImplPayload.priorValidateReportId).toBe(iter1Val?.id ?? '');
        expect(iter2ImplPayload.prompt).toContain('# Prior validate report');
        // Fake-claude embeds PRIOR=yes when it saw the section
        expect(iter2ImplPayload.result).toContain('PRIOR=yes');

        // iter 1 validate: parents = [runId, iter1ImplId]
        expect(iter1Val?.parents).toEqual([report.runId, iter1Impl?.id ?? '']);
        // iter 2 validate: parents = [runId, iter2ImplId]
        expect(iter2Val?.parents).toEqual([report.runId, iter2Impl?.id ?? '']);

        // factory-context tree walk: starting from iter2Val, parents reach runId
        // through the iter2Impl → iter1Val → iter1Impl chain.
        expect(iter2Val?.parents).toContain(report.runId);
        expect(iter2Impl?.parents).toContain(report.runId);
        expect(iter1Val?.parents).toContain(report.runId);
        expect(iter1Impl?.parents).toContain(report.runId);
      } finally {
        Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
        Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_STATE_DIR');
        Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(workDir2, { recursive: true, force: true });
      rmSync(ctxDir, { recursive: true, force: true });
    }
  });
});

describe('run() — v0.0.3 H-4 holdout: iter-3 priorValidateReportId points at iter-2 (single-step, not transitive)', () => {
  test('fail-fail-then-pass: iter 3 priorValidateReportId === iter-2-validate-report.id (NOT iter 1)', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'fake-claude-state-'));
    const workDir3 = mkdtempSync(join(tmpdir(), 'runtime-iter3-work-'));
    const ctxDir = mkdtempSync(join(tmpdir(), 'runtime-iter3-ctx-'));
    try {
      const specMd = readFileSync(join(FIXTURES, 'needs-iter2.md'), 'utf8');
      const testTs = readFileSync(join(FIXTURES, 'needs-iter2.test.ts'), 'utf8');
      Bun.write(join(workDir3, 'needs-iter2.md'), specMd);
      Bun.write(join(workDir3, 'needs-iter2.test.ts'), testTs);
      const specPath = join(workDir3, 'needs-iter2.md');
      const source = readFileSync(specPath, 'utf8');
      const spec = parseSpec(source, { filename: specPath });

      const store = createContextStore({ dir: ctxDir });
      const impl = implementPhase({
        cwd: workDir3,
        claudePath: FAKE_CLAUDE,
        twin: 'off',
      });
      const val = validatePhase({ cwd: workDir3, noJudge: true });
      const graph = definePhaseGraph([impl, val], [['implement', 'validate']]);

      process.env.FAKE_CLAUDE_MODE = 'fail-fail-then-pass';
      process.env.FAKE_CLAUDE_STATE_DIR = stateDir;
      process.env.FAKE_CLAUDE_TOKENS = '1000';
      try {
        const report = await run({ spec, graph, contextStore: store });
        expect(report.status).toBe('converged');
        expect(report.iterationCount).toBe(3);

        const implReports = await store.list({ type: 'factory-implement-report' });
        const valReports = await store.list({ type: 'factory-validate-report' });
        expect(implReports.length).toBe(3);
        expect(valReports.length).toBe(3);

        const byIter = (
          recs: Awaited<ReturnType<typeof store.list>>,
        ): Record<number, (typeof recs)[number]> => {
          const m: Record<number, (typeof recs)[number]> = {};
          for (const r of recs) {
            const it = (r.payload as { iteration?: number }).iteration;
            if (typeof it === 'number') m[it] = r;
          }
          return m;
        };
        const implByIter = byIter(implReports);
        // validate-reports don't have iteration in payload — derive from the
        // implement-report they're paired with via parents.
        const valByIter: Record<number, (typeof valReports)[number]> = {};
        for (const v of valReports) {
          const implParent = v.parents[1];
          for (const [it, impl] of Object.entries(implByIter)) {
            if (impl.id === implParent) valByIter[Number(it)] = v;
          }
        }

        // iter 1 impl: parents=[runId], no priorValidateReportId
        expect(implByIter[1]?.parents).toEqual([report.runId]);
        expect(
          (implByIter[1]?.payload as { priorValidateReportId?: string }).priorValidateReportId,
        ).toBeUndefined();

        // iter 2 impl: parents=[runId, iter1ValId]; priorValidateReportId=iter1Val.id
        expect(implByIter[2]?.parents).toEqual([report.runId, valByIter[1]?.id ?? '']);
        expect(
          (implByIter[2]?.payload as { priorValidateReportId?: string }).priorValidateReportId,
        ).toBe(valByIter[1]?.id);

        // iter 3 impl: parents=[runId, iter2ValId] (NOT iter1ValId);
        // priorValidateReportId=iter2Val.id (single-step, not transitive)
        expect(implByIter[3]?.parents).toEqual([report.runId, valByIter[2]?.id ?? '']);
        expect(
          (implByIter[3]?.payload as { priorValidateReportId?: string }).priorValidateReportId,
        ).toBe(valByIter[2]?.id);
        expect(
          (implByIter[3]?.payload as { priorValidateReportId?: string }).priorValidateReportId,
        ).not.toBe(valByIter[1]?.id);

        // The iter-3 prompt's # Prior validate report quotes iter-2's failed scenarios
        // (specifically the 'iter2 returns 42' scenario from S-1, which failed in iter 2's
        // validate run because the fake wrote a stub returning 0).
        const iter3Prompt = (implByIter[3]?.payload as { prompt: string }).prompt;
        expect(iter3Prompt).toContain('# Prior validate report');
        expect(iter3Prompt).toContain('- **S-1');
      } finally {
        Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
        Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_STATE_DIR');
        Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(workDir3, { recursive: true, force: true });
      rmSync(ctxDir, { recursive: true, force: true });
    }
  });
});

describe('implementPhase — integration with validatePhase', () => {
  test('implement (success, edits src/needs-impl.ts) followed by validate (passes) — both reports persisted with parents=[runId]', async () => {
    const { ctx, runId } = await setupCtx();
    const impl = implementPhase({
      cwd: workDir,
      claudePath: FAKE_CLAUDE,
      twin: 'off',
    });
    const val = validatePhase({ cwd: workDir, noJudge: true });

    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    process.env.FAKE_CLAUDE_RESULT = 'wrote src/needs-impl.ts';

    try {
      const implResult = await impl.run(ctx);
      expect(implResult.status).toBe('pass');

      const valResult = await val.run(ctx);
      expect(valResult.status).toBe('pass');

      // Both reports on disk with parents=[runId].
      expect(implResult.records[0]?.parents).toEqual([runId]);
      expect(valResult.records[0]?.parents).toEqual([runId]);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_RESULT');
    }
  });
});

// ----- v0.0.5.1: filesChanged audit reliability ---------------------------

describe('implementPhase — filesChanged audit reliability (v0.0.5.1)', () => {
  function runGit(args: string[], cwd: string): void {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? ''}${r.stdout ?? ''}`);
    }
  }

  function gitInit(dir: string): void {
    runGit(['init', '-q'], dir);
    runGit(['config', 'user.name', 'test'], dir);
    runGit(['config', 'user.email', 'test@test.example'], dir);
    runGit(['config', 'commit.gpgsign', 'false'], dir);
  }

  let v051WorkDir: string;
  let v051StoreDir: string;

  beforeEach(() => {
    v051WorkDir = mkdtempSync(join(tmpdir(), 'runtime-impl-v051-work-'));
    v051StoreDir = mkdtempSync(join(tmpdir(), 'runtime-impl-v051-store-'));
  });

  afterEach(() => {
    rmSync(v051WorkDir, { recursive: true, force: true });
    rmSync(v051StoreDir, { recursive: true, force: true });
  });

  async function buildCtx(dir: string): Promise<PhaseContext> {
    const store = createContextStore({ dir: v051StoreDir });
    tryRegister(store, 'factory-run', FactoryRunSchema);
    tryRegister(store, 'factory-implement-report', FactoryImplementReportSchema);

    const specPath = join(dir, 'v051-spec.md');
    writeFileSync(
      specPath,
      `---
id: v051-fileschanged
classification: light
type: fix
status: ready
---

# v051-fileschanged

## Scenarios

**S-1** — sample
  Given a thing
  When something
  Then something
  Satisfaction:
    - judge: works

## Definition of Done

- it works
`,
    );
    runGit(['add', 'v051-spec.md'], dir);
    runGit(['commit', '-q', '-m', 'spec'], dir);

    const runId = await store.put(
      'factory-run',
      {
        specId: 'v051-fileschanged',
        graphPhases: ['implement'],
        maxIterations: 1,
        startedAt: new Date().toISOString(),
      },
      { parents: [] },
    );

    const source = readFileSync(specPath, 'utf8');
    const spec = parseSpec(source, { filename: specPath });
    return {
      spec,
      contextStore: store,
      log: () => {},
      runId,
      iteration: 1,
      inputs: [],
    };
  }

  function pathsOf(records: readonly { payload: unknown }[]): string[] {
    const payload = records[0]?.payload as { filesChanged: { path: string }[] };
    return payload.filesChanged.map((f) => f.path);
  }

  test('filesChanged includes newly created files', async () => {
    gitInit(v051WorkDir);
    const ctx = await buildCtx(v051WorkDir);
    const phase = implementPhase({ cwd: v051WorkDir, claudePath: FAKE_CLAUDE, twin: 'off' });

    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(v051WorkDir, 'src/foo.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export const foo = 42;\n';
    try {
      const result = await phase.run(ctx);
      expect(result.status).toBe('pass');
      expect(pathsOf(result.records)).toContain('src/foo.ts');
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('filesChanged includes modified tracked files (regression gate)', async () => {
    gitInit(v051WorkDir);
    mkdirSync(join(v051WorkDir, 'src'), { recursive: true });
    writeFileSync(join(v051WorkDir, 'src/foo.ts'), 'export const foo = 1;\n');
    runGit(['add', 'src/foo.ts'], v051WorkDir);
    runGit(['commit', '-q', '-m', 'init foo'], v051WorkDir);
    const ctx = await buildCtx(v051WorkDir);
    const phase = implementPhase({ cwd: v051WorkDir, claudePath: FAKE_CLAUDE, twin: 'off' });

    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(v051WorkDir, 'src/foo.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export const foo = 42;\n';
    try {
      const result = await phase.run(ctx);
      expect(result.status).toBe('pass');
      expect(pathsOf(result.records)).toContain('src/foo.ts');
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('filesChanged excludes pre-dirty files', async () => {
    gitInit(v051WorkDir);
    writeFileSync(join(v051WorkDir, 'JOURNAL.md'), '# initial\n');
    runGit(['add', 'JOURNAL.md'], v051WorkDir);
    runGit(['commit', '-q', '-m', 'init journal'], v051WorkDir);
    const ctx = await buildCtx(v051WorkDir);
    // Make JOURNAL.md pre-dirty (uncommitted maintainer edit) before the phase runs.
    writeFileSync(join(v051WorkDir, 'JOURNAL.md'), '# initial\nmaintainer added this line\n');

    const phase = implementPhase({ cwd: v051WorkDir, claudePath: FAKE_CLAUDE, twin: 'off' });

    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(v051WorkDir, 'JOURNAL.md');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = '# initial\nthe agent wrote this\n';
    try {
      const result = await phase.run(ctx);
      expect(result.status).toBe('pass');
      expect(pathsOf(result.records)).not.toContain('JOURNAL.md');
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('filesChanged includes deleted files', async () => {
    gitInit(v051WorkDir);
    mkdirSync(join(v051WorkDir, 'src'), { recursive: true });
    writeFileSync(join(v051WorkDir, 'src/old.ts'), 'export const old = 1;\n');
    runGit(['add', 'src/old.ts'], v051WorkDir);
    runGit(['commit', '-q', '-m', 'init old'], v051WorkDir);
    const ctx = await buildCtx(v051WorkDir);
    const phase = implementPhase({ cwd: v051WorkDir, claudePath: FAKE_CLAUDE, twin: 'off' });

    process.env.FAKE_CLAUDE_MODE = 'delete';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(v051WorkDir, 'src/old.ts');
    try {
      const result = await phase.run(ctx);
      expect(result.status).toBe('pass');
      expect(pathsOf(result.records)).toContain('src/old.ts');
      expect(existsSync(join(v051WorkDir, 'src/old.ts'))).toBe(false);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
    }
  });
});

// ----- v0.0.5.2: configurable per-phase agent timeout (S-1) --------------

describe('implementPhase — configurable agent timeout (v0.0.5.2)', () => {
  test('default agent timeout remains 600000ms when no override is provided', () => {
    // Regression gate: the hardcoded default timeout used by implementPhase
    // when neither the explicit `timeoutMs` opt nor `ctx.maxAgentTimeoutMs`
    // is set. Byte-equal to v0.0.5 behavior — moving this constant changes
    // the default agent wall-clock budget for every existing call site.
    expect(DEFAULT_TIMEOUT_MS).toBe(600_000);
  });
});

// ----- v0.0.10: Prior DoD report threading (S-4) ------------------------

async function makePriorDodRecord(
  store: ReturnType<typeof createContextStore>,
  runId: string,
  bullets: ReadonlyArray<{
    kind: 'shell' | 'judge';
    bullet?: string;
    status: 'pass' | 'fail' | 'error';
    command?: string;
    exitCode?: number | null;
    stderrTail?: string;
    judgeReasoning?: string;
  }>,
): Promise<{ id: string; record: NonNullable<Awaited<ReturnType<typeof store.get>>> }> {
  tryRegister(store, 'factory-dod-report', FactoryDodReportSchema);
  const summary = { pass: 0, fail: 0, error: 0, skipped: 0 };
  for (const b of bullets) summary[b.status]++;
  const reportStatus = summary.error > 0 ? 'error' : summary.fail > 0 ? 'fail' : 'pass';
  const id = await store.put(
    'factory-dod-report',
    {
      specId: 'runtime-smoke-needs-impl',
      iteration: 1,
      startedAt: new Date().toISOString(),
      durationMs: 100,
      bullets: bullets.map((b) => ({
        kind: b.kind,
        bullet: b.bullet ?? `- \`${b.command ?? '?'}\``,
        status: b.status,
        ...(b.command !== undefined ? { command: b.command } : {}),
        ...(b.exitCode !== undefined ? { exitCode: b.exitCode } : {}),
        ...(b.stderrTail !== undefined ? { stderrTail: b.stderrTail } : {}),
        ...(b.judgeReasoning !== undefined ? { judgeReasoning: b.judgeReasoning } : {}),
        durationMs: 50,
      })),
      summary,
      status: reportStatus,
    },
    { parents: [runId] },
  );
  const record = await store.get(id);
  if (record === null) throw new Error('vanished');
  return { id, record };
}

describe('implementPhase — v0.0.10 Prior DoD report threading (S-4)', () => {
  test('buildPrompt emits Prior DoD report section when prior dod-report is in inputs', async () => {
    const { ctx, runId } = await setupCtx();
    const { record: priorRec } = await makePriorDodRecord(ctx.contextStore, runId, [
      {
        kind: 'shell',
        command: 'pnpm typecheck',
        status: 'fail',
        exitCode: 1,
        stderrTail: 'src/foo.ts:5: error TS2322: Type "x" is not assignable to "y"',
      },
    ]);
    const ctxWithPrior: PhaseContext = { ...ctx, iteration: 2, inputs: [priorRec] };
    const phase = implementPhase({ cwd: workDir, claudePath: FAKE_CLAUDE, twin: 'off' });
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    try {
      const result = await phase.run(ctxWithPrior);
      const payload = result.records[0]?.payload as { prompt: string };
      expect(payload.prompt).toContain('# Prior DoD report');
      expect(payload.prompt).toContain('**`pnpm typecheck`** — exit 1:');
      expect(payload.prompt).toContain('error TS2322');
      // Section sits before # Working directory.
      const dodIdx = payload.prompt.indexOf('# Prior DoD report');
      const workingIdx = payload.prompt.indexOf('# Working directory');
      expect(dodIdx).toBeGreaterThan(-1);
      expect(workingIdx).toBeGreaterThan(dodIdx);
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('Prior DoD report section is byte-stable across iterations with the same failure', async () => {
    const { ctx, runId } = await setupCtx();
    const { record: priorRec } = await makePriorDodRecord(ctx.contextStore, runId, [
      {
        kind: 'shell',
        command: 'pnpm typecheck',
        status: 'fail',
        exitCode: 1,
        stderrTail: 'foo',
      },
    ]);
    const phase = implementPhase({ cwd: workDir, claudePath: FAKE_CLAUDE, twin: 'off' });
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    try {
      const ctx2: PhaseContext = { ...ctx, iteration: 2, inputs: [priorRec] };
      const r1 = await phase.run(ctx2);
      const ctx3: PhaseContext = { ...ctx, iteration: 3, inputs: [priorRec] };
      const r2 = await phase.run(ctx3);
      const p1 = (r1.records[0]?.payload as { prompt: string }).prompt;
      const p2 = (r2.records[0]?.payload as { prompt: string }).prompt;
      const sectionOf = (p: string): string => {
        const start = p.indexOf('# Prior DoD report');
        const end = p.indexOf('# Working directory');
        return p.slice(start, end);
      };
      expect(sectionOf(p1)).toBe(sectionOf(p2));
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });

  test('buildPrompt does not emit Prior DoD report when no dod-report in inputs', async () => {
    const { ctx } = await setupCtx();
    const phase = implementPhase({ cwd: workDir, claudePath: FAKE_CLAUDE, twin: 'off' });
    process.env.FAKE_CLAUDE_MODE = 'success';
    process.env.FAKE_CLAUDE_TOKENS = '1000';
    process.env.FAKE_CLAUDE_EDIT_FILE = join(workDir, 'src/needs-impl.ts');
    process.env.FAKE_CLAUDE_EDIT_CONTENT = 'export function impl() { return 42; }\n';
    try {
      const result = await phase.run(ctx);
      const payload = result.records[0]?.payload as { prompt: string };
      expect(payload.prompt).not.toContain('# Prior DoD report');
    } finally {
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_MODE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_TOKENS');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_FILE');
      Reflect.deleteProperty(process.env, 'FAKE_CLAUDE_EDIT_CONTENT');
    }
  });
});

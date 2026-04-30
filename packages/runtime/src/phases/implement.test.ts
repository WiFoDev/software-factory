import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuntimeError } from '../errors.js';
import { parseAgentJson, spawnAgent, stripAnsi, tailDetail } from './implement.js';

const RUNTIME_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const FAKE_CLAUDE = resolve(RUNTIME_ROOT, 'test-fixtures/fake-claude.ts');

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
    expect(() => parseAgentJson('42')).toThrow(/agent-output-invalid: stdout did not parse to a JSON object/);
  });
});

// ----- spawnAgent --------------------------------------------------------

describe('spawnAgent', () => {
  test('returns exit-0 envelope on FAKE_CLAUDE_MODE=success', async () => {
    const result = await spawnAgent({
      claudePath: FAKE_CLAUDE,
      allowedTools: 'Read,Edit,Write,Bash',
      cwd: RUNTIME_ROOT,
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
    expect(logged.some((l) => l.startsWith('[claude] ') && l.includes('authentication failed'))).toBe(true);
  });
});

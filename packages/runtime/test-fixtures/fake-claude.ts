#!/usr/bin/env bun
// Test stand-in for the `claude` CLI. Reads stdin (the prompt) to EOF and
// writes a deterministic JSON envelope to stdout.
//
// Behavior is selected via env vars:
//   FAKE_CLAUDE_MODE         success | self-fail | exit-nonzero | malformed-json
//                            | hang | cost-overrun | echo-env | self-kill
//                            (default: success)
//   FAKE_CLAUDE_TOKENS       usage.input_tokens to report (default: 5000)
//   FAKE_CLAUDE_OUTPUT_TOKENS  usage.output_tokens (default: 200)
//   FAKE_CLAUDE_RESULT       overrides envelope.result text (default: per-mode)
//   FAKE_CLAUDE_EDIT_FILE    path (relative to cwd) to create/overwrite
//   FAKE_CLAUDE_EDIT_CONTENT content for the edited file (default: 'export const x = 1;')
//   FAKE_CLAUDE_EXIT_CODE    exit code for `exit-nonzero` mode (default: 1)
//   FAKE_CLAUDE_DELAY_MS     sleep before writing output (used with `hang`)
//   FAKE_CLAUDE_TOOL_USES    JSON-encoded array for envelope.tool_uses (default: ['Read','Edit'])
//
// Drain stdin so the parent's writeable side closes cleanly even when we
// don't need the prompt content.

const reader = (Bun.stdin as unknown as { stream(): ReadableStream<Uint8Array> }).stream().getReader();
let prompt = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  if (value) prompt += new TextDecoder().decode(value);
}

const mode = process.env.FAKE_CLAUDE_MODE ?? 'success';
const tokens = Number(process.env.FAKE_CLAUDE_TOKENS ?? '5000');
const outputTokens = Number(process.env.FAKE_CLAUDE_OUTPUT_TOKENS ?? '200');
const exitCode = Number(process.env.FAKE_CLAUDE_EXIT_CODE ?? '1');
const editFile = process.env.FAKE_CLAUDE_EDIT_FILE;
const editContent = process.env.FAKE_CLAUDE_EDIT_CONTENT ?? 'export const x = 1;\n';
const delayMs = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? '0');
const toolUsesRaw = process.env.FAKE_CLAUDE_TOOL_USES;

if (delayMs > 0) {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

function makeEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const toolUses = toolUsesRaw !== undefined ? JSON.parse(toolUsesRaw) : ['Read', 'Edit'];
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: process.env.FAKE_CLAUDE_RESULT ?? 'fake-claude: success',
    duration_ms: 100,
    num_turns: 1,
    total_cost_usd: 0.001,
    usage: {
      input_tokens: tokens,
      output_tokens: outputTokens,
    },
    tool_uses: toolUses,
    // Hint for callers to verify stdin propagation worked. Truncated for log size.
    _prompt_first_80: prompt.slice(0, 80),
    ...overrides,
  };
}

switch (mode) {
  case 'success': {
    if (editFile !== undefined) {
      await Bun.write(editFile, editContent);
    }
    process.stdout.write(JSON.stringify(makeEnvelope()));
    process.exit(0);
  }
  case 'self-fail': {
    process.stdout.write(
      JSON.stringify(
        makeEnvelope({
          subtype: 'error_max_turns',
          is_error: true,
          result: process.env.FAKE_CLAUDE_RESULT ?? 'I could not complete the task',
        }),
      ),
    );
    process.exit(0);
  }
  case 'exit-nonzero': {
    process.stderr.write('claude: authentication failed\n');
    process.exit(exitCode);
  }
  case 'malformed-json': {
    process.stdout.write('not actually JSON');
    process.exit(0);
  }
  case 'hang': {
    // Sleep beyond any reasonable test timeout. The runtime's wall-clock
    // timeout will SIGKILL us.
    await new Promise<void>(() => {
      // never resolves
    });
    process.exit(0); // unreachable
  }
  case 'cost-overrun': {
    if (editFile !== undefined) {
      await Bun.write(editFile, editContent);
    }
    process.stdout.write(
      JSON.stringify(
        makeEnvelope({
          // Force an overrun regardless of FAKE_CLAUDE_TOKENS.
          usage: {
            input_tokens: Math.max(tokens, 150_000),
            output_tokens: outputTokens,
          },
          result:
            process.env.FAKE_CLAUDE_RESULT ??
            'I edited src/needs-impl.ts despite the budget overrun',
        }),
      ),
    );
    process.exit(0);
  }
  case 'echo-env': {
    const twinMode = process.env.WIFO_TWIN_MODE ?? '';
    const twinDir = process.env.WIFO_TWIN_RECORDINGS_DIR ?? '';
    process.stdout.write(
      JSON.stringify(
        makeEnvelope({
          result: `WIFO_TWIN_MODE=${twinMode} WIFO_TWIN_RECORDINGS_DIR=${twinDir}`,
        }),
      ),
    );
    process.exit(0);
  }
  case 'self-kill': {
    // Write a partial fragment, flush, then send SIGTERM to ourselves so the
    // runtime sees a child closed by signal (not by our timer). Deterministic
    // and platform-independent.
    process.stdout.write('{"type":"result","subtype":"par');
    process.stdout.once('drain', () => process.kill(process.pid, 'SIGTERM'));
    if (!process.stdout.writableNeedDrain) {
      process.kill(process.pid, 'SIGTERM');
    }
    // Hold the event loop so the signal can deliver before exit.
    await new Promise<void>((r) => setTimeout(r, 5_000));
    process.exit(0); // unreachable
  }
  default: {
    process.stderr.write(`fake-claude: unknown FAKE_CLAUDE_MODE='${mode}'\n`);
    process.exit(2);
  }
}

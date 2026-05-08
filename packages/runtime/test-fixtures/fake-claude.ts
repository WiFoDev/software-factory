#!/usr/bin/env bun
// Test stand-in for the `claude` CLI. Reads stdin (the prompt) to EOF and
// writes a deterministic JSON envelope to stdout.
//
// Behavior is selected via env vars:
//   FAKE_CLAUDE_MODE         success | self-fail | exit-nonzero | malformed-json
//                            | hang | cost-overrun | echo-env | self-kill
//                            | fail-then-pass | fail-fail-then-pass | delete
//                            (default: success)
//   FAKE_CLAUDE_STATE_DIR    directory holding `counter` for fail-then-pass /
//                            fail-fail-then-pass modes (required for those)
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

const reader = (Bun.stdin as unknown as { stream(): ReadableStream<Uint8Array> })
  .stream()
  .getReader();
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

// v0.0.14 — detect the no-hooks flag in argv. The runtime spawns claude with
// `--setting-sources project,local` to skip user-level hooks (the source of
// skill-injection noise) while preserving OAuth/keychain auth. Tests assert
// the marker fields below to verify the flag and HOME both propagate.
function findSettingSourcesArg(argv: string[]): string | undefined {
  const idx = argv.indexOf('--setting-sources');
  if (idx === -1) return undefined;
  return argv[idx + 1];
}
const settingSourcesArg = findSettingSourcesArg(process.argv);
const homeIsSet = typeof process.env.HOME === 'string' && process.env.HOME !== '';

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
    // v0.0.14 — markers for the no-hooks-flag spec. `_setting_sources_arg`
    // captures the value passed to `--setting-sources` (or undefined when
    // missing). `_home_set` reflects whether HOME is set in the spawn env
    // — auth lives in HOME/keychain, so this is the auth-preservation
    // smoke check.
    _setting_sources_arg: settingSourcesArg,
    _home_set: homeIsSet,
    ...overrides,
  };
}

// Each branch terminates via process.exit(); we use if/else rather than a
// switch so biome's noFallthroughSwitchClause doesn't flag the unreachable
// fall-throughs (each branch genuinely cannot fall through, but biome's
// static analysis doesn't model process.exit as a terminating call).

if (mode === 'success') {
  // Default behavior: write src/needs-impl.ts (relative to cwd) with the
  // canonical impl that satisfies the needs-impl.md fixture. This makes the
  // smoke command self-contained — `cd <fixture-dir> && node dist/cli.js
  // run needs-impl.md --no-judge --claude-bin <fake>` converges with no
  // env-var ceremony. Tests that need different behavior set
  // FAKE_CLAUDE_EDIT_FILE explicitly.
  const targetFile = editFile ?? 'src/needs-impl.ts';
  const targetContent =
    process.env.FAKE_CLAUDE_EDIT_CONTENT ??
    (editFile === undefined ? 'export function impl() { return 42; }\n' : editContent);
  await Bun.write(targetFile, targetContent);
  process.stdout.write(JSON.stringify(makeEnvelope()));
  process.exit(0);
} else if (mode === 'self-fail') {
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
} else if (mode === 'exit-nonzero') {
  process.stderr.write('claude: authentication failed\n');
  // v0.0.12 — optional stderr padding for the agent-exit-nonzero stderrTail
  // capture tests. Emit `padBytes` of additional stderr so we can exercise
  // both the < 10 KB (stored in full) and ≥ 10 KB (truncated with marker)
  // paths.
  const padBytes = Number(process.env.FAKE_CLAUDE_STDERR_PAD_BYTES ?? '0');
  if (padBytes > 0) {
    process.stderr.write('A'.repeat(padBytes));
  }
  process.exit(exitCode);
} else if (mode === 'malformed-json') {
  process.stdout.write('not actually JSON');
  process.exit(0);
} else if (mode === 'hang') {
  // Sleep beyond any reasonable test timeout. The runtime's wall-clock
  // timeout will SIGKILL us.
  await new Promise<void>(() => {
    // never resolves
  });
  process.exit(0); // unreachable
} else if (mode === 'cost-overrun') {
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
          process.env.FAKE_CLAUDE_RESULT ?? 'I edited src/needs-impl.ts despite the budget overrun',
      }),
    ),
  );
  process.exit(0);
} else if (mode === 'echo-env') {
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
} else if (mode === 'fail-then-pass' || mode === 'fail-fail-then-pass') {
  // Multi-iteration integration mode. Driven by a counter file that the test
  // harness mkdtemp's before invoking the runtime. Each invocation reads the
  // counter, increments it, and chooses behavior. iter 1 fails (writes a stub
  // that fails the validate test + is_error: true). iter 2 (or 3 for fail-fail)
  // passes (writes the satisfying impl + is_error: false).
  const stateDir = process.env.FAKE_CLAUDE_STATE_DIR;
  if (stateDir === undefined || stateDir === '') {
    process.stderr.write('fake-claude: FAKE_CLAUDE_STATE_DIR required for fail-then-pass mode\n');
    process.exit(2);
  }
  const counterPath = `${stateDir}/counter`;
  let counter = 0;
  try {
    const raw = await Bun.file(counterPath).text();
    counter = Number.parseInt(raw, 10);
    if (!Number.isFinite(counter)) counter = 0;
  } catch {
    counter = 0;
  }
  await Bun.write(counterPath, String(counter + 1));

  const failsRequired = mode === 'fail-then-pass' ? 1 : 2;
  const targetFile = editFile ?? 'src/needs-iter2.ts';
  const isFailIteration = counter < failsRequired;

  // Embed prior-section detection into result so tests can assert that the
  // # Prior validate report appears on the second+ invocation's prompt.
  const sawPrior = prompt.includes('# Prior validate report');
  const sawPriorTag = sawPrior ? 'PRIOR=yes' : 'PRIOR=no';

  if (isFailIteration) {
    // Write a stub that fails the test (returns 0 instead of 42) so validate
    // fails this iteration, triggering another loop.
    const stubContent = 'export function iter2() { return 0; }\n';
    await Bun.write(targetFile, stubContent);
    process.stdout.write(
      JSON.stringify(
        makeEnvelope({
          subtype: 'error_max_turns',
          is_error: true,
          result:
            process.env.FAKE_CLAUDE_RESULT ??
            `iter ${counter + 1}: wrote a stub (will fail validate) | ${sawPriorTag}`,
        }),
      ),
    );
    process.exit(0);
  } else {
    // Write the satisfying impl.
    const passContent = 'export function iter2() { return 42; }\n';
    await Bun.write(targetFile, passContent);
    process.stdout.write(
      JSON.stringify(
        makeEnvelope({
          result:
            process.env.FAKE_CLAUDE_RESULT ??
            `iter ${counter + 1}: wrote the satisfying impl | ${sawPriorTag}`,
        }),
      ),
    );
    process.exit(0);
  }
} else if (mode === 'delete') {
  // Delete FAKE_CLAUDE_EDIT_FILE (absolute path) and emit a success envelope.
  // Used by v0.0.5.1 filesChanged tests to exercise the deleted-file path.
  if (editFile !== undefined) {
    try {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(editFile);
    } catch {
      // ignore — test asserts post-state, not deletion success
    }
  }
  process.stdout.write(
    JSON.stringify(
      makeEnvelope({
        result: process.env.FAKE_CLAUDE_RESULT ?? 'fake-claude: deleted',
      }),
    ),
  );
  process.exit(0);
} else if (mode === 'self-kill') {
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
} else {
  process.stderr.write(`fake-claude: unknown FAKE_CLAUDE_MODE='${mode}'\n`);
  process.exit(2);
}

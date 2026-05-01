#!/usr/bin/env bun
// Test stand-in for `claude -p` when used by claudeCliJudgeClient. Reads
// stdin (the prompt) to EOF and writes a deterministic JSON envelope to
// stdout. Behavior selected via FAKE_JUDGE_MODE env var:
//
//   clean-json    envelope.result = `{"pass":false,"score":0.3,"reasoning":"vague DoD"}`
//   prefixed-json envelope.result = `Sure, here is the judgment: {"pass":false,"score":0.3,"reasoning":"vague DoD"}\n`
//   garbage       envelope.result = `I cannot judge this.`
//   pass          envelope.result = `{"pass":true,"score":1,"reasoning":"ok"}`
//   exit-nonzero  exits 1 with stderr `claude: not authenticated`
//   hang          sleeps forever (lets the timeout fire)
//
// FAKE_JUDGE_COUNTER_FILE (optional): each invocation increments the integer
// in this file by 1 (creates with value 0 if missing). Lets tests count
// spawn invocations across cache-hit/miss scenarios.

const reader = (Bun.stdin as unknown as { stream(): ReadableStream<Uint8Array> })
  .stream()
  .getReader();
let prompt = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  if (value) prompt += new TextDecoder().decode(value);
}

const counterFile = process.env.FAKE_JUDGE_COUNTER_FILE;
if (counterFile !== undefined) {
  const file = Bun.file(counterFile);
  let counter = 0;
  if (await file.exists()) {
    const text = await file.text();
    const parsed = Number.parseInt(text.trim(), 10);
    counter = Number.isFinite(parsed) ? parsed : 0;
  }
  await Bun.write(counterFile, String(counter + 1));
}

const mode = process.env.FAKE_JUDGE_MODE ?? 'pass';

function envelope(result: string): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    duration_ms: 50,
    num_turns: 1,
    total_cost_usd: 0,
    usage: { input_tokens: 100, output_tokens: 30 },
    _prompt_first_80: prompt.slice(0, 80),
  });
}

if (mode === 'clean-json') {
  process.stdout.write(envelope('{"pass":false,"score":0.3,"reasoning":"vague DoD"}'));
  process.exit(0);
} else if (mode === 'prefixed-json') {
  process.stdout.write(
    envelope('Sure, here is the judgment: {"pass":false,"score":0.3,"reasoning":"vague DoD"}\n'),
  );
  process.exit(0);
} else if (mode === 'garbage') {
  process.stdout.write(envelope('I cannot judge this.'));
  process.exit(0);
} else if (mode === 'pass') {
  process.stdout.write(envelope('{"pass":true,"score":1,"reasoning":"ok"}'));
  process.exit(0);
} else if (mode === 'exit-nonzero') {
  process.stderr.write('claude: not authenticated\n');
  process.exit(1);
} else if (mode === 'hang') {
  await new Promise<void>(() => {
    // never resolves
  });
  process.exit(0);
} else {
  process.stderr.write(`fake-claude-judge: unknown FAKE_JUDGE_MODE='${mode}'\n`);
  process.exit(2);
}

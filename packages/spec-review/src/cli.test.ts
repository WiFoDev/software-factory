import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dir, 'cli.ts');
const FAKE_JUDGE = resolve(import.meta.dir, '..', 'test-fixtures', 'fake-claude-judge.ts');

const VALID_SPEC = [
  '---',
  'id: demo',
  'classification: light',
  'type: feat',
  'status: ready',
  '---',
  '',
  '## Intent',
  'Add a thing.',
  '',
  '## Constraints / Decisions',
  '- uses zod',
  '',
  '## Scenarios',
  '**S-1** — happy',
  '  Given a',
  '  When b',
  '  Then c',
  '  Satisfaction:',
  '    - test: src/foo.test.ts',
  '',
  '## Definition of Done',
  '- all tests pass',
  '',
].join('\n');

async function runCliProc(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

let dir: string;
let cacheDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-review-cli-'));
  cacheDir = mkdtempSync(join(tmpdir(), 'spec-review-cache-cli-'));
});
afterEach(async () => {
  await Bun.$`rm -rf ${dir} ${cacheDir}`.quiet().nothrow();
});

describe('factory spec review CLI', () => {
  test('clean spec → exit 0, stdout `<file>: OK`', async () => {
    const path = join(dir, 'good.md');
    writeFileSync(path, VALID_SPEC);
    const r = await runCliProc(['--claude-bin', FAKE_JUDGE, '--cache-dir', cacheDir, path], {
      FAKE_JUDGE_MODE: 'pass',
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  test('judge fails → finding line in lint format on stderr; exit 0 (warnings only)', async () => {
    const path = join(dir, 'flagged.md');
    writeFileSync(path, VALID_SPEC);
    const r = await runCliProc(['--claude-bin', FAKE_JUDGE, '--cache-dir', cacheDir, path], {
      FAKE_JUDGE_MODE: 'clean-json' /* every judge returns pass:false */,
    });
    expect(r.exitCode).toBe(0); // warnings don't escalate
    expect(r.stderr).toContain('warning');
    expect(r.stderr).toContain('review/');
    expect(r.stderr).toContain('vague DoD');
  });

  test('--judges nope → exit 2 with stderr label review/invalid-judges', async () => {
    const path = join(dir, 'spec.md');
    writeFileSync(path, VALID_SPEC);
    const r = await runCliProc(
      ['--claude-bin', FAKE_JUDGE, '--cache-dir', cacheDir, '--judges', 'nope', path],
      { FAKE_JUDGE_MODE: 'pass' },
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('review/invalid-judges');
    expect(r.stderr).toContain("unknown code 'nope'");
  });

  test('--judges with comma-separated valid codes restricts the run', async () => {
    const path = join(dir, 'spec.md');
    const counterFile = join(dir, 'counter');
    writeFileSync(path, VALID_SPEC);
    const r = await runCliProc(
      [
        '--claude-bin',
        FAKE_JUDGE,
        '--cache-dir',
        cacheDir,
        '--judges',
        'review/dod-precision',
        path,
      ],
      { FAKE_JUDGE_MODE: 'pass', FAKE_JUDGE_COUNTER_FILE: counterFile },
    );
    expect(r.exitCode).toBe(0);
    // Only one judge ran.
    const counter = Number((await Bun.file(counterFile).text()).trim());
    expect(counter).toBe(1);
  });

  test('--no-cache: judges always invoked; cache dir not populated', async () => {
    const path = join(dir, 'spec.md');
    const counterFile = join(dir, 'counter');
    writeFileSync(path, VALID_SPEC);
    await runCliProc(['--claude-bin', FAKE_JUDGE, '--no-cache', path], {
      FAKE_JUDGE_MODE: 'pass',
      FAKE_JUDGE_COUNTER_FILE: counterFile,
    });
    const after1 = Number((await Bun.file(counterFile).text()).trim());
    await runCliProc(['--claude-bin', FAKE_JUDGE, '--no-cache', path], {
      FAKE_JUDGE_MODE: 'pass',
      FAKE_JUDGE_COUNTER_FILE: counterFile,
    });
    const after2 = Number((await Bun.file(counterFile).text()).trim());
    // Second run also called the judge (cache disabled).
    expect(after2).toBe(after1 * 2);
  });

  test('cache hit: second run zero invocations', async () => {
    const path = join(dir, 'spec.md');
    const counterFile = join(dir, 'counter');
    writeFileSync(path, VALID_SPEC);
    await runCliProc(['--claude-bin', FAKE_JUDGE, '--cache-dir', cacheDir, path], {
      FAKE_JUDGE_MODE: 'pass',
      FAKE_JUDGE_COUNTER_FILE: counterFile,
    });
    const after1 = Number((await Bun.file(counterFile).text()).trim());
    await runCliProc(['--claude-bin', FAKE_JUDGE, '--cache-dir', cacheDir, path], {
      FAKE_JUDGE_MODE: 'pass',
      FAKE_JUDGE_COUNTER_FILE: counterFile,
    });
    const after2 = Number((await Bun.file(counterFile).text()).trim());
    expect(after2).toBe(after1); // no new spawns
  });

  test('directory recursion: clean files print OK', async () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'a.md'), VALID_SPEC);
    writeFileSync(join(dir, 'sub/b.md'), VALID_SPEC);
    writeFileSync(join(dir, 'c.txt'), 'ignored');
    const r = await runCliProc(['--claude-bin', FAKE_JUDGE, '--cache-dir', cacheDir, dir], {
      FAKE_JUDGE_MODE: 'pass',
    });
    expect(r.exitCode).toBe(0);
    const okLines = (r.stdout.match(/OK/g) ?? []).length;
    expect(okLines).toBeGreaterThanOrEqual(2);
  });

  test('missing path → exit 1', async () => {
    const r = await runCliProc(['--claude-bin', FAKE_JUDGE, '/definitely/not/a/path-xyz.md']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Path not found');
  });

  test('missing positional → exit 2', async () => {
    const r = await runCliProc(['--claude-bin', FAKE_JUDGE]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Missing <path>');
  });

  test('--timeout-ms invalid → exit 2', async () => {
    const path = join(dir, 'spec.md');
    writeFileSync(path, VALID_SPEC);
    const r = await runCliProc(['--claude-bin', FAKE_JUDGE, '--timeout-ms', '0', path], {
      FAKE_JUDGE_MODE: 'pass',
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('review/invalid-timeout-ms');
  });

  test('CLI loads depends-on dep from docs/specs/ and threads it to cross-doc-consistency', async () => {
    const specsDir = join(dir, 'docs', 'specs');
    mkdirSync(specsDir, { recursive: true });
    const counterFile = join(dir, 'counter');
    writeFileSync(join(specsDir, 'helper.md'), VALID_SPEC);
    const dependentSpec = VALID_SPEC.replace(
      'status: ready\n',
      'status: ready\ndepends-on:\n  - helper\n',
    );
    writeFileSync(join(specsDir, 'dependent.md'), dependentSpec);
    const r = await runCliProc(
      ['--claude-bin', FAKE_JUDGE, '--cache-dir', cacheDir, join(specsDir, 'dependent.md')],
      { FAKE_JUDGE_MODE: 'pass', FAKE_JUDGE_COUNTER_FILE: counterFile },
    );
    expect(r.exitCode).toBe(0);
    const counter = Number((await Bun.file(counterFile).text()).trim());
    // VALID_SPEC has 1 scenario; with deps loaded, cross-doc-consistency
    // applies via depsCount > 0 (no plan). v0.0.10 also runs scope-creep
    // (always applies):
    //   internal-consistency + dod-precision + cross-doc-consistency
    //   + scope-creep = 4.
    expect(counter).toBe(4);
  });

  test('CLI emits review/dep-not-found warning when declared dep is missing', async () => {
    const specsDir = join(dir, 'docs', 'specs');
    mkdirSync(specsDir, { recursive: true });
    const dependentSpec = VALID_SPEC.replace(
      'status: ready\n',
      'status: ready\ndepends-on:\n  - ghost\n',
    );
    writeFileSync(join(specsDir, 'dependent.md'), dependentSpec);
    const r = await runCliProc(
      ['--claude-bin', FAKE_JUDGE, '--cache-dir', cacheDir, join(specsDir, 'dependent.md')],
      { FAKE_JUDGE_MODE: 'pass' },
    );
    expect(r.stderr).toContain('review/dep-not-found');
    expect(r.stderr).toContain("'ghost'");
  });

  test('auto-resolves paired technical-plan: docs/specs/<id>.md ↔ docs/technical-plans/<id>.md', async () => {
    const specsDir = join(dir, 'docs', 'specs');
    const planDir = join(dir, 'docs', 'technical-plans');
    mkdirSync(specsDir, { recursive: true });
    mkdirSync(planDir, { recursive: true });
    const counterFile = join(dir, 'counter');
    writeFileSync(join(specsDir, 'demo.md'), VALID_SPEC);
    writeFileSync(join(planDir, 'demo.md'), '# Tech plan\n\n## Architecture\nOne thing.');
    const r = await runCliProc(
      ['--claude-bin', FAKE_JUDGE, '--cache-dir', cacheDir, join(specsDir, 'demo.md')],
      { FAKE_JUDGE_MODE: 'pass', FAKE_JUDGE_COUNTER_FILE: counterFile },
    );
    expect(r.exitCode).toBe(0);
    const counter = Number((await Bun.file(counterFile).text()).trim());
    // VALID_SPEC has 1 scenario, no holdouts. With tech-plan present:
    //   internal-consistency + dod-precision + cross-doc-consistency
    //   + api-surface-drift (v0.0.10, requires plan) + scope-creep
    //   (v0.0.10, always) = 5.
    //   judge-parity skips (needs > 1 scenario); holdout-distinctness skips;
    //   feasibility skips (no Subtasks LOC estimates).
    expect(counter).toBe(5);
  });
});

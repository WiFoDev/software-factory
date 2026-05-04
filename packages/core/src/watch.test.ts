import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { watchSpecs } from './watch';

const VALID_SPEC = [
  '---',
  'id: demo-1',
  'classification: light',
  'type: feat',
  'status: ready',
  '---',
  '',
  '## Intent',
  'Add a thing.',
  '',
  '## Scenarios',
  '**S-1** — happy',
  '  Given a',
  '  When b',
  '  Then c',
  '  Satisfaction:',
  '    - test: src/foo.test.ts',
  '',
  '## Constraints / Decisions',
  '- uses zod',
  '',
  '## Definition of Done',
  '- all tests pass',
  '',
].join('\n');

const BROKEN_SPEC = VALID_SPEC.replace('id: demo-1\n', '');

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'factory-watch-'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface Capture {
  out: string;
  logLine: (line: string) => void;
}

function makeCapture(): Capture {
  const c: Capture = {
    out: '',
    logLine: (line) => {
      c.out += line;
    },
  };
  return c;
}

let dir: string;
beforeEach(() => {
  dir = tmpDir();
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe('factory spec watch', () => {
  test('factory spec watch lints on file change', async () => {
    const filePath = join(dir, 'foo.md');
    writeFileSync(filePath, VALID_SPEC);
    // Wait for FSEvents to settle so the pre-watcher write doesn't replay.
    await sleep(500);
    const cap = makeCapture();
    const handle = watchSpecs({
      rootPath: dir,
      debounceMs: 50,
      logLine: cap.logLine,
    });
    // Wait for the watcher to attach.
    await sleep(300);
    writeFileSync(filePath, BROKEN_SPEC);
    // Wait past debounce + processing.
    await sleep(600);
    await handle.stop();
    expect(cap.out).toContain('frontmatter/missing-field');
    expect(cap.out).toContain(filePath);
  });

  test('factory spec watch lints on file create', async () => {
    const cap = makeCapture();
    const handle = watchSpecs({
      rootPath: dir,
      debounceMs: 50,
      logLine: cap.logLine,
    });
    await sleep(300);
    const filePath = join(dir, 'fresh.md');
    writeFileSync(filePath, VALID_SPEC);
    await sleep(600);
    await handle.stop();
    expect(cap.out).toContain(filePath);
    // Valid spec → 0 errors, 0 warnings summary line.
    expect(cap.out).toContain('0 errors, 0 warnings');
  });

  test('factory spec watch ignores non-md files', async () => {
    const cap = makeCapture();
    const handle = watchSpecs({
      rootPath: dir,
      debounceMs: 50,
      logLine: cap.logLine,
    });
    await sleep(300);
    writeFileSync(join(dir, 'package.json'), '{}\n');
    writeFileSync(join(dir, 'src.ts'), 'export {};\n');
    await sleep(500);
    await handle.stop();
    expect(cap.out).toBe('');
  });

  test('non-md file changes are ignored', async () => {
    const filePath = join(dir, 'note.txt');
    writeFileSync(filePath, 'before');
    await sleep(500);
    const cap = makeCapture();
    const handle = watchSpecs({
      rootPath: dir,
      debounceMs: 50,
      logLine: cap.logLine,
    });
    await sleep(300);
    writeFileSync(filePath, 'after');
    await sleep(500);
    await handle.stop();
    expect(cap.out).toBe('');
  });

  test('debounces rapid changes within 200ms window', async () => {
    const filePath = join(dir, 'rapid.md');
    writeFileSync(filePath, VALID_SPEC);
    await sleep(500);
    const cap = makeCapture();
    const handle = watchSpecs({
      rootPath: dir,
      debounceMs: 200,
      logLine: cap.logLine,
    });
    await sleep(300);
    // Five rapid saves within the 200ms window — should collapse to one lint.
    for (let i = 0; i < 5; i++) {
      writeFileSync(filePath, `${VALID_SPEC}\n<!-- ${i} -->\n`);
      await sleep(20);
    }
    await sleep(800);
    await handle.stop();
    // Count summary lines for this file — should be exactly 1 despite 5 saves.
    const summaryRegex = new RegExp(
      `^${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: \\d+ error.* \\d+ warning`,
      'gm',
    );
    const matches = cap.out.match(summaryRegex) ?? [];
    expect(matches.length).toBe(1);
  });

  test('SIGINT exits 0 cleanly', async () => {
    const cliPath = resolve(import.meta.dir, 'cli.ts');
    const proc = Bun.spawn(['bun', 'run', cliPath, 'spec', 'watch', dir], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    // Let the watcher install + attach.
    await sleep(500);
    proc.kill('SIGINT');
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toContain('factory spec watch: stopping');
  });

  test('watch --review runs lint then review on each change', async () => {
    const filePath = join(dir, 'spec.md');
    writeFileSync(filePath, VALID_SPEC);
    await sleep(500);
    const cap = makeCapture();
    const reviewCli = resolve(import.meta.dir, '..', '..', 'spec-review', 'src', 'cli.ts');
    const fakeJudge = resolve(
      import.meta.dir,
      '..',
      '..',
      'spec-review',
      'test-fixtures',
      'fake-claude-judge.ts',
    );
    const prevReviewCli = process.env.FACTORY_SPEC_REVIEW_CLI;
    const prevMode = process.env.FAKE_JUDGE_MODE;
    process.env.FACTORY_SPEC_REVIEW_CLI = reviewCli;
    process.env.FAKE_JUDGE_MODE = 'pass';
    try {
      const handle = watchSpecs({
        rootPath: dir,
        debounceMs: 50,
        review: true,
        claudeBin: fakeJudge,
        logLine: cap.logLine,
      });
      await sleep(300);
      writeFileSync(filePath, `${VALID_SPEC}\n<!-- bump -->\n`);
      // Review takes longer than lint — give it generous headroom.
      await sleep(8000);
      await handle.stop();
      const lintIdx = cap.out.indexOf('0 errors, 0 warnings');
      const reviewIdx = cap.out.indexOf(': OK');
      expect(lintIdx).toBeGreaterThanOrEqual(0);
      expect(reviewIdx).toBeGreaterThanOrEqual(0);
      // Review output appears AFTER lint summary.
      expect(reviewIdx).toBeGreaterThan(lintIdx);
    } finally {
      if (prevReviewCli === undefined)
        Reflect.deleteProperty(process.env, 'FACTORY_SPEC_REVIEW_CLI');
      else process.env.FACTORY_SPEC_REVIEW_CLI = prevReviewCli;
      if (prevMode === undefined) Reflect.deleteProperty(process.env, 'FAKE_JUDGE_MODE');
      else process.env.FAKE_JUDGE_MODE = prevMode;
    }
  }, 20000);

  test('watch skips review when lint fails', async () => {
    const filePath = join(dir, 'broken.md');
    writeFileSync(filePath, VALID_SPEC);
    await sleep(500);
    const cap = makeCapture();
    const reviewCli = resolve(import.meta.dir, '..', '..', 'spec-review', 'src', 'cli.ts');
    const fakeJudge = resolve(
      import.meta.dir,
      '..',
      '..',
      'spec-review',
      'test-fixtures',
      'fake-claude-judge.ts',
    );
    const prevReviewCli = process.env.FACTORY_SPEC_REVIEW_CLI;
    const prevMode = process.env.FAKE_JUDGE_MODE;
    process.env.FACTORY_SPEC_REVIEW_CLI = reviewCli;
    process.env.FAKE_JUDGE_MODE = 'pass';
    try {
      const handle = watchSpecs({
        rootPath: dir,
        debounceMs: 50,
        review: true,
        claudeBin: fakeJudge,
        logLine: cap.logLine,
      });
      await sleep(300);
      writeFileSync(filePath, BROKEN_SPEC);
      await sleep(2000);
      await handle.stop();
      // Lint error appears, but no review OK marker should appear.
      expect(cap.out).toContain('frontmatter/missing-field');
      expect(cap.out).not.toContain(': OK');
    } finally {
      if (prevReviewCli === undefined)
        Reflect.deleteProperty(process.env, 'FACTORY_SPEC_REVIEW_CLI');
      else process.env.FACTORY_SPEC_REVIEW_CLI = prevReviewCli;
      if (prevMode === undefined) Reflect.deleteProperty(process.env, 'FAKE_JUDGE_MODE');
      else process.env.FAKE_JUDGE_MODE = prevMode;
    }
  }, 10000);

  test('deletion emits a one-line notice and continues watching', async () => {
    const filePath = join(dir, 'gone.md');
    writeFileSync(filePath, VALID_SPEC);
    await sleep(500);
    const cap = makeCapture();
    const handle = watchSpecs({
      rootPath: dir,
      debounceMs: 50,
      logLine: cap.logLine,
    });
    await sleep(300);
    unlinkSync(filePath);
    await sleep(500);
    await handle.stop();
    expect(cap.out).toContain(`${filePath}: deleted`);
  });
});

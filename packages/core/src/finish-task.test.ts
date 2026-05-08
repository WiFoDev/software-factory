import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readContextDirFromConfig, resolveContextDir } from './context-dir.js';
import { finishTask, getRunConvergenceStatus } from './finish-task.js';

interface RecordEnvelope {
  version: 1;
  id: string;
  type: string;
  recordedAt: string;
  parents: string[];
  payload: unknown;
}

function tmpCtxAndDir(): { ctxDir: string; specsDir: string } {
  return {
    ctxDir: mkdtempSync(join(tmpdir(), 'factory-finish-batch-ctx-')),
    specsDir: mkdtempSync(join(tmpdir(), 'factory-finish-batch-specs-')),
  };
}

function writeRecord(ctxDir: string, record: RecordEnvelope): void {
  writeFileSync(join(ctxDir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

function writeSequence(
  ctxDir: string,
  seqId: string,
  topoOrder: string[],
  recordedAt = '2026-05-05T00:00:00.000Z',
): void {
  writeRecord(ctxDir, {
    version: 1,
    id: seqId,
    type: 'factory-sequence',
    recordedAt,
    parents: [],
    payload: {
      specsDir: '/tmp/specs',
      topoOrder,
      startedAt: recordedAt,
      continueOnFail: false,
    },
  });
}

// Records are persisted as `<id>.json` and only id-shaped filenames (16 hex
// chars) are read back — so every fixture id below uses the [0-9a-f]{16}
// alphabet. `phaseSuffix` differentiates phase records within a single test.
function phaseIdFor(runId: string, phaseSuffix: string): string {
  return `${runId.slice(0, 8)}${phaseSuffix}`.padEnd(16, '0').slice(0, 16);
}

function writeConvergedRun(
  ctxDir: string,
  runId: string,
  seqId: string,
  specId: string,
  recordedAt = '2026-05-05T00:00:01.000Z',
  phaseSuffix = 'aaaaaaaa',
): void {
  writeRecord(ctxDir, {
    version: 1,
    id: runId,
    type: 'factory-run',
    recordedAt,
    parents: [seqId],
    payload: {
      specId,
      graphPhases: ['validate'],
      maxIterations: 5,
      startedAt: recordedAt,
    },
  });
  writeRecord(ctxDir, {
    version: 1,
    id: phaseIdFor(runId, phaseSuffix),
    type: 'factory-phase',
    recordedAt: '2026-05-05T00:00:02.000Z',
    parents: [runId],
    payload: {
      phaseName: 'validate',
      iteration: 1,
      status: 'pass',
      durationMs: 10,
      outputRecordIds: [],
    },
  });
}

function writeNonConvergedRun(
  ctxDir: string,
  runId: string,
  seqId: string,
  specId: string,
  phaseSuffix = 'bbbbbbbb',
): void {
  writeRecord(ctxDir, {
    version: 1,
    id: runId,
    type: 'factory-run',
    recordedAt: '2026-05-05T00:00:01.000Z',
    parents: [seqId],
    payload: {
      specId,
      graphPhases: ['validate'],
      maxIterations: 5,
      startedAt: '2026-05-05T00:00:01.000Z',
    },
  });
  writeRecord(ctxDir, {
    version: 1,
    id: phaseIdFor(runId, phaseSuffix),
    type: 'factory-phase',
    recordedAt: '2026-05-05T00:00:02.000Z',
    parents: [runId],
    payload: {
      phaseName: 'validate',
      iteration: 1,
      status: 'fail',
      durationMs: 10,
      outputRecordIds: [],
    },
  });
}

function writeSpecFile(specsDir: string, specId: string): string {
  const path = join(specsDir, `${specId}.md`);
  writeFileSync(path, `---\nid: ${specId}\n---\n# spec\n`);
  return path;
}

function readShippedRecords(ctxDir: string): Array<{
  id: string;
  parents: string[];
  payload: { specId: string; fromPath: string; toPath: string; shippedAt: string };
}> {
  const out: Array<{
    id: string;
    parents: string[];
    payload: { specId: string; fromPath: string; toPath: string; shippedAt: string };
  }> = [];
  for (const f of readdirSync(ctxDir)) {
    if (!f.endsWith('.json')) continue;
    const rec = JSON.parse(readFileSync(join(ctxDir, f), 'utf8')) as RecordEnvelope;
    if (rec.type !== 'factory-spec-shipped') continue;
    out.push({
      id: rec.id,
      parents: rec.parents,
      payload: rec.payload as {
        specId: string;
        fromPath: string;
        toPath: string;
        shippedAt: string;
      },
    });
  }
  return out;
}

// ----- v0.0.14: --context-dir universal default + auto-detect (S-1) ----------

describe('factory finish-task --context-dir resolution (v0.0.14)', () => {
  // The CLI's runFinishTask reads the CLI flag, calls readContextDirFromConfig,
  // then resolveContextDir, then invokes finishTask with the resolved dir.
  // These tests exercise the same code path the CLI uses, end-to-end (lib +
  // helpers), without going through parseArgs.
  function setupTmpProject(): { tmp: string; specsDir: string } {
    const tmp = mkdtempSync(join(tmpdir(), 'factory-finish-resolve-'));
    const specsDir = join(tmp, 'docs', 'specs');
    mkdirSync(specsDir, { recursive: true });
    return { tmp, specsDir };
  }

  test('factory finish-task default --context-dir resolves to ./.factory', async () => {
    const { tmp, specsDir } = setupTmpProject();
    // .factory/ holds the records (the v0.0.14 universal default).
    const factoryDir = join(tmp, '.factory');
    mkdirSync(factoryDir);
    const seqId = '00112233aabbccdd';
    const specId = 'demo-spec';
    const runId = 'aa00000000000001';
    writeSequence(factoryDir, seqId, [specId]);
    writeConvergedRun(factoryDir, runId, seqId, specId);
    writeSpecFile(specsDir, specId);
    // No ./context/ dir, no factory.config.json.
    expect(existsSync(join(tmp, 'context'))).toBe(false);
    expect(existsSync(join(tmp, 'factory.config.json'))).toBe(false);

    const originalCwd = process.cwd();
    process.chdir(tmp);
    try {
      // Mimic the CLI's resolution chain.
      const cliFlag = undefined;
      const configValue = readContextDirFromConfig(process.cwd());
      expect(configValue).toBeUndefined();
      const contextDirRaw = resolveContextDir({ cliFlag, configValue });
      expect(contextDirRaw).toBe('./.factory');

      const contextDir = resolve(process.cwd(), contextDirRaw);
      const result = await finishTask({ specId, dir: specsDir, contextDir });
      expect(result.runId).toBe(runId);
      expect(existsSync(join(specsDir, `${specId}.md`))).toBe(false);
      expect(existsSync(join(specsDir, 'done', `${specId}.md`))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('factory.config.json runtime.contextDir wins over universal default', async () => {
    const { tmp, specsDir } = setupTmpProject();
    // Records live in ./custom-records, NOT in ./.factory.
    const customDir = join(tmp, 'custom-records');
    mkdirSync(customDir);
    const seqId = '00112233aabbccdd';
    const specId = 'demo-spec';
    const runId = 'aa00000000000002';
    writeSequence(customDir, seqId, [specId]);
    writeConvergedRun(customDir, runId, seqId, specId);
    writeSpecFile(specsDir, specId);
    // factory.config.json points runtime.contextDir at ./custom-records.
    writeFileSync(
      join(tmp, 'factory.config.json'),
      JSON.stringify({ runtime: { contextDir: './custom-records' } }, null, 2),
    );

    const originalCwd = process.cwd();
    process.chdir(tmp);
    try {
      const cliFlag = undefined;
      const configValue = readContextDirFromConfig(process.cwd());
      expect(configValue).toBe('./custom-records');
      const contextDirRaw = resolveContextDir({ cliFlag, configValue });
      expect(contextDirRaw).toBe('./custom-records');

      const contextDir = resolve(process.cwd(), contextDirRaw);
      const result = await finishTask({ specId, dir: specsDir, contextDir });
      expect(result.runId).toBe(runId);
      expect(existsSync(join(specsDir, 'done', `${specId}.md`))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('--context-dir CLI flag wins over factory.config.json', async () => {
    const { tmp, specsDir } = setupTmpProject();
    // Records live in ./elsewhere; ./custom-records is empty (would fail).
    const elsewhereDir = join(tmp, 'elsewhere');
    mkdirSync(elsewhereDir);
    mkdirSync(join(tmp, 'custom-records'));
    const seqId = '00112233aabbccdd';
    const specId = 'demo-spec';
    const runId = 'aa00000000000003';
    writeSequence(elsewhereDir, seqId, [specId]);
    writeConvergedRun(elsewhereDir, runId, seqId, specId);
    writeSpecFile(specsDir, specId);
    // Config points at ./custom-records (which is empty — finish would fail).
    writeFileSync(
      join(tmp, 'factory.config.json'),
      JSON.stringify({ runtime: { contextDir: './custom-records' } }, null, 2),
    );

    const originalCwd = process.cwd();
    process.chdir(tmp);
    try {
      // CLI flag wins — config value should be ignored.
      const cliFlag = './elsewhere';
      const configValue = readContextDirFromConfig(process.cwd());
      expect(configValue).toBe('./custom-records');
      const contextDirRaw = resolveContextDir({ cliFlag, configValue });
      expect(contextDirRaw).toBe('./elsewhere');

      const contextDir = resolve(process.cwd(), contextDirRaw);
      const result = await finishTask({ specId, dir: specsDir, contextDir });
      expect(result.runId).toBe(runId);
      expect(existsSync(join(specsDir, 'done', `${specId}.md`))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('finishTask --all-converged batch ship-cycle (v0.0.14)', () => {
  test('--all-converged moves every converged spec from the most recent factory-sequence', async () => {
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const seqId = '00112233aabbccdd';
    const specs = [
      'core-store-and-slug',
      'shorten-endpoint',
      'redirect-with-click-tracking',
      'stats-endpoint',
    ];
    writeSequence(ctxDir, seqId, specs);
    const runIds = ['aa00000000000001', 'bb00000000000002', 'cc00000000000003', 'dd00000000000004'];
    for (let i = 0; i < specs.length; i++) {
      writeConvergedRun(ctxDir, runIds[i] as string, seqId, specs[i] as string);
      writeSpecFile(specsDir, specs[i] as string);
    }

    const result = await finishTask({ allConverged: true, dir: specsDir, contextDir: ctxDir });

    expect(result.factorySequenceId).toBe(seqId);
    expect(result.shipped.length).toBe(4);
    for (let i = 0; i < specs.length; i++) {
      const id = specs[i] as string;
      expect(existsSync(join(specsDir, `${id}.md`))).toBe(false);
      expect(existsSync(join(specsDir, 'done', `${id}.md`))).toBe(true);
    }
    // Per-spec ship results carry the right runId + specId.
    const shippedSpecIds = result.shipped.map((s) => s.specId).sort();
    expect(shippedSpecIds).toEqual([...specs].sort());

    // Persisted factory-spec-shipped records: one per moved spec, parents = [<runId>].
    const shippedRecords = readShippedRecords(ctxDir);
    expect(shippedRecords.length).toBe(4);
    for (const rec of shippedRecords) {
      expect(rec.parents.length).toBe(1);
      const matchingRunIdx = specs.indexOf(rec.payload.specId);
      expect(matchingRunIdx).toBeGreaterThanOrEqual(0);
      expect(rec.parents[0]).toBe(runIds[matchingRunIdx] as string);
      expect(rec.payload.shippedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test('--all-converged skips non-converged specs in the same sequence', async () => {
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const seqId = '00112233aabbccdd';
    const okSpecs = ['core-store-and-slug', 'shorten-endpoint'];
    const failSpecs = ['redirect-with-click-tracking', 'stats-endpoint'];
    writeSequence(ctxDir, seqId, [...okSpecs, ...failSpecs]);
    writeConvergedRun(ctxDir, 'a100000000000000', seqId, okSpecs[0] as string);
    writeConvergedRun(ctxDir, 'a200000000000000', seqId, okSpecs[1] as string);
    writeNonConvergedRun(ctxDir, 'b100000000000000', seqId, failSpecs[0] as string);
    writeNonConvergedRun(ctxDir, 'b200000000000000', seqId, failSpecs[1] as string);
    for (const id of [...okSpecs, ...failSpecs]) writeSpecFile(specsDir, id);

    const result = await finishTask({ allConverged: true, dir: specsDir, contextDir: ctxDir });

    expect(result.shipped.length).toBe(2);
    for (const id of okSpecs) {
      expect(existsSync(join(specsDir, `${id}.md`))).toBe(false);
      expect(existsSync(join(specsDir, 'done', `${id}.md`))).toBe(true);
    }
    // Errored specs stay at <dir>/<id>.md for the maintainer to retry.
    for (const id of failSpecs) {
      expect(existsSync(join(specsDir, `${id}.md`))).toBe(true);
      expect(existsSync(join(specsDir, 'done', `${id}.md`))).toBe(false);
    }
  });

  test('--since <id> targets a specific factory-sequence', async () => {
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const seqOldId = 'aaaaaaaaaaaaaaaa';
    const seqNewId = 'bbbbbbbbbbbbbbbb';
    writeSequence(ctxDir, seqOldId, ['old-a', 'old-b', 'old-c'], '2026-05-01T00:00:00.000Z');
    writeSequence(
      ctxDir,
      seqNewId,
      ['new-a', 'new-b', 'new-c', 'new-d'],
      '2026-05-04T00:00:00.000Z',
    );

    const oldSpecs = ['old-a', 'old-b', 'old-c'];
    const newSpecs = ['new-a', 'new-b', 'new-c', 'new-d'];
    // Distinct hex prefixes per runId so phase ids don't collide.
    const oldRunPrefixes = ['c1', 'c2', 'c3'];
    const newRunPrefixes = ['d1', 'd2', 'd3', 'd4'];
    for (let i = 0; i < oldSpecs.length; i++) {
      writeConvergedRun(
        ctxDir,
        `${oldRunPrefixes[i]}00000000000000`.slice(0, 16),
        seqOldId,
        oldSpecs[i] as string,
        '2026-05-01T00:00:01.000Z',
      );
      writeSpecFile(specsDir, oldSpecs[i] as string);
    }
    for (let i = 0; i < newSpecs.length; i++) {
      writeConvergedRun(
        ctxDir,
        `${newRunPrefixes[i]}00000000000000`.slice(0, 16),
        seqNewId,
        newSpecs[i] as string,
        '2026-05-04T00:00:01.000Z',
      );
      writeSpecFile(specsDir, newSpecs[i] as string);
    }

    const result = await finishTask({
      allConverged: true,
      since: seqOldId,
      dir: specsDir,
      contextDir: ctxDir,
    });

    expect(result.factorySequenceId).toBe(seqOldId);
    expect(result.shipped.length).toBe(3);
    // Old specs moved.
    for (const id of oldSpecs) {
      expect(existsSync(join(specsDir, `${id}.md`))).toBe(false);
      expect(existsSync(join(specsDir, 'done', `${id}.md`))).toBe(true);
    }
    // New specs untouched.
    for (const id of newSpecs) {
      expect(existsSync(join(specsDir, `${id}.md`))).toBe(true);
      expect(existsSync(join(specsDir, 'done', `${id}.md`))).toBe(false);
    }
  });

  test('--since with unknown id refuses gracefully', async () => {
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const seqId = 'aaaaaaaaaaaaaaaa';
    writeSequence(ctxDir, seqId, ['some-spec']);
    writeConvergedRun(ctxDir, '0000000000000001', seqId, 'some-spec');
    const stayPath = writeSpecFile(specsDir, 'some-spec');

    let caught: unknown;
    try {
      await finishTask({
        allConverged: true,
        since: 'ffffffffffffffff',
        dir: specsDir,
        contextDir: ctxDir,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'factory: no factory-sequence found with id ffffffffffffffff',
    );
    // No specs moved.
    expect(existsSync(stayPath)).toBe(true);
    expect(existsSync(join(specsDir, 'done', 'some-spec.md'))).toBe(false);
  });

  // ----- v0.0.14: status-aggregator + skip-on-no-converge ---------------------

  // Multi-iteration runs: each phase needs a unique 16-hex id. We derive a
  // distinct id per (run, iter, phase) tuple so the on-disk store can hold
  // them all simultaneously.
  function phaseId(runId: string, iter: number, slot: number): string {
    const base = runId.slice(0, 8);
    const tail = `${iter.toString(16).padStart(4, '0')}${slot.toString(16).padStart(4, '0')}`;
    return `${base}${tail}`.padEnd(16, '0').slice(0, 16);
  }

  function writeRun(
    ctxDir: string,
    runId: string,
    seqId: string,
    specId: string,
    recordedAt = '2026-05-05T00:00:01.000Z',
  ): void {
    writeRecord(ctxDir, {
      version: 1,
      id: runId,
      type: 'factory-run',
      recordedAt,
      parents: [seqId],
      payload: {
        specId,
        graphPhases: ['implement', 'validate'],
        maxIterations: 5,
        startedAt: recordedAt,
      },
    });
  }

  function writePhase(
    ctxDir: string,
    runId: string,
    iteration: number,
    slot: number,
    phaseName: string,
    status: string,
    recordedAt: string,
  ): void {
    writeRecord(ctxDir, {
      version: 1,
      id: phaseId(runId, iteration, slot),
      type: 'factory-phase',
      recordedAt,
      parents: [runId],
      payload: {
        phaseName,
        iteration,
        status,
        durationMs: 10,
        outputRecordIds: [],
      },
    });
  }

  test('--all-converged skips specs whose factory-run terminal phase was fail/error', async () => {
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const seqId = '00112233aabbccdd';
    const specA = 'spec-a';
    const specB = 'spec-b';
    writeSequence(ctxDir, seqId, [specA, specB]);

    // spec-A: single-iteration converged run.
    const runA = 'aa00000000000001';
    writeRun(ctxDir, runA, seqId, specA);
    writePhase(ctxDir, runA, 1, 0, 'implement', 'pass', '2026-05-05T00:00:02.000Z');
    writePhase(ctxDir, runA, 1, 1, 'validate', 'pass', '2026-05-05T00:00:03.000Z');
    writeSpecFile(specsDir, specA);

    // spec-B: final iteration's terminal phase fails → no-converge.
    const runB = 'bb00000000000001';
    writeRun(ctxDir, runB, seqId, specB);
    writePhase(ctxDir, runB, 1, 0, 'implement', 'pass', '2026-05-05T00:00:02.000Z');
    writePhase(ctxDir, runB, 1, 1, 'validate', 'fail', '2026-05-05T00:00:03.000Z');
    const specBPath = writeSpecFile(specsDir, specB);

    const result = await finishTask({ allConverged: true, dir: specsDir, contextDir: ctxDir });

    expect(result.factorySequenceId).toBe(seqId);
    expect(result.shipped.length).toBe(1);
    expect(result.shipped[0]?.specId).toBe(specA);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]).toEqual({ specId: specB, runId: runB, terminalPhase: 'fail' });

    // spec-A moved; spec-B stays at <dir>/<id>.md (no-converge → maintainer retries).
    expect(existsSync(join(specsDir, `${specA}.md`))).toBe(false);
    expect(existsSync(join(specsDir, 'done', `${specA}.md`))).toBe(true);
    expect(existsSync(specBPath)).toBe(true);
    expect(existsSync(join(specsDir, 'done', `${specB}.md`))).toBe(false);
  });

  test('--all-converged with all-no-converge sequence is a safe no-op', async () => {
    const { ctxDir, specsDir } = tmpCtxAndDir();
    const seqId = '00112233aabbccdd';
    const specs = ['fail-a', 'fail-b', 'fail-c'];
    writeSequence(ctxDir, seqId, specs);

    const runIds = ['aa00000000000001', 'bb00000000000001', 'cc00000000000001'];
    for (let i = 0; i < specs.length; i++) {
      const runId = runIds[i] as string;
      const specId = specs[i] as string;
      writeRun(ctxDir, runId, seqId, specId);
      // Final iteration terminal status='error' → no-converge.
      writePhase(ctxDir, runId, 1, 0, 'implement', 'pass', '2026-05-05T00:00:02.000Z');
      writePhase(ctxDir, runId, 1, 1, 'validate', 'error', '2026-05-05T00:00:03.000Z');
      writeSpecFile(specsDir, specId);
    }

    const result = await finishTask({ allConverged: true, dir: specsDir, contextDir: ctxDir });

    // Idempotent — exit 0, ship nothing, every no-converge spec stays put.
    expect(result.factorySequenceId).toBe(seqId);
    expect(result.shipped.length).toBe(0);
    expect(result.skipped.length).toBe(3);
    for (const id of specs) {
      expect(existsSync(join(specsDir, `${id}.md`))).toBe(true);
      expect(existsSync(join(specsDir, 'done', `${id}.md`))).toBe(false);
    }
    for (const s of result.skipped) {
      expect(s.terminalPhase).toBe('error');
    }
  });

  test("status-aggregator helper recognizes converged run via final iteration's terminal phase", async () => {
    const { ctxDir } = tmpCtxAndDir();
    const seqId = '00112233aabbccdd';
    const runId = 'aa00000000000099';
    writeSequence(ctxDir, seqId, ['multi-iter']);
    writeRun(ctxDir, runId, seqId, 'multi-iter');
    // iter 1: implement: pass / validate: fail
    writePhase(ctxDir, runId, 1, 0, 'implement', 'pass', '2026-05-05T00:00:01.000Z');
    writePhase(ctxDir, runId, 1, 1, 'validate', 'fail', '2026-05-05T00:00:02.000Z');
    // iter 2: implement: pass / validate: fail
    writePhase(ctxDir, runId, 2, 0, 'implement', 'pass', '2026-05-05T00:00:03.000Z');
    writePhase(ctxDir, runId, 2, 1, 'validate', 'fail', '2026-05-05T00:00:04.000Z');
    // iter 3 (FINAL): implement: pass / validate: pass / dod: pass
    writePhase(ctxDir, runId, 3, 0, 'implement', 'pass', '2026-05-05T00:00:05.000Z');
    writePhase(ctxDir, runId, 3, 1, 'validate', 'pass', '2026-05-05T00:00:06.000Z');
    writePhase(ctxDir, runId, 3, 2, 'dod', 'pass', '2026-05-05T00:00:07.000Z');

    const status = await getRunConvergenceStatus(ctxDir, runId);

    expect(status).toEqual({ converged: true, terminalPhase: 'pass' });
  });

  test("status-aggregator helper recognizes no-converge run via final iteration's terminal-phase status", async () => {
    const { ctxDir } = tmpCtxAndDir();
    const seqId = '00112233aabbccdd';
    const runId = 'bb00000000000099';
    writeSequence(ctxDir, seqId, ['multi-iter-fail']);
    writeRun(ctxDir, runId, seqId, 'multi-iter-fail');
    // iter 1: implement: pass / validate: pass (a passing iteration ...)
    writePhase(ctxDir, runId, 1, 0, 'implement', 'pass', '2026-05-05T00:00:01.000Z');
    writePhase(ctxDir, runId, 1, 1, 'validate', 'pass', '2026-05-05T00:00:02.000Z');
    // iter 2 (FINAL): implement: pass / validate: fail (... but the FINAL iteration fails)
    writePhase(ctxDir, runId, 2, 0, 'implement', 'pass', '2026-05-05T00:00:03.000Z');
    writePhase(ctxDir, runId, 2, 1, 'validate', 'fail', '2026-05-05T00:00:04.000Z');

    const status = await getRunConvergenceStatus(ctxDir, runId);

    // Final iteration's terminal phase = fail → not converged.
    expect(status).toEqual({ converged: false, terminalPhase: 'fail' });
  });

  test('positional finish-task <id> behavior unchanged from v0.0.12', async () => {
    const { ctxDir, specsDir } = tmpCtxAndDir();
    // v0.0.12 fixture shape: factory-run with no parent sequence + a single
    // converged factory-phase. Positional path was always status-checked via
    // the per-iteration isRunConverged predicate; v0.0.14 leaves that path
    // alone (S-3).
    const specId = 'positional-spec';
    const runId = 'cc00000000000001';
    writeRecord(ctxDir, {
      version: 1,
      id: runId,
      type: 'factory-run',
      recordedAt: '2026-05-05T00:00:00.000Z',
      parents: [],
      payload: {
        specId,
        graphPhases: ['validate'],
        maxIterations: 5,
        startedAt: '2026-05-05T00:00:00.000Z',
      },
    });
    writeRecord(ctxDir, {
      version: 1,
      id: phaseId(runId, 1, 0),
      type: 'factory-phase',
      recordedAt: '2026-05-05T00:00:01.000Z',
      parents: [runId],
      payload: {
        phaseName: 'validate',
        iteration: 1,
        status: 'pass',
        durationMs: 10,
        outputRecordIds: [],
      },
    });
    const fromPath = writeSpecFile(specsDir, specId);

    const result = await finishTask({ specId, dir: specsDir, contextDir: ctxDir });

    // v0.0.12 contract preserved verbatim:
    expect(result.runId).toBe(runId);
    expect(result.specId).toBe(specId);
    expect(result.fromPath).toBe(fromPath);
    expect(result.toPath).toBe(join(specsDir, 'done', `${specId}.md`));
    expect(existsSync(fromPath)).toBe(false);
    expect(existsSync(result.toPath)).toBe(true);

    // Persisted factory-spec-shipped record parents = [runId].
    const shipped = readShippedRecords(ctxDir);
    expect(shipped.length).toBe(1);
    expect(shipped[0]?.parents).toEqual([runId]);
    expect(shipped[0]?.payload.specId).toBe(specId);
  });

  test('--all-converged refuses when no factory-sequence exists', async () => {
    const { ctxDir, specsDir } = tmpCtxAndDir();
    // Single-spec converged run with no parent sequence (mimics legacy
    // factory-runtime run invocation).
    writeRecord(ctxDir, {
      version: 1,
      id: '0000000000000001',
      type: 'factory-run',
      recordedAt: '2026-05-05T00:00:00.000Z',
      parents: [],
      payload: {
        specId: 'lonely-spec',
        graphPhases: ['validate'],
        maxIterations: 5,
        startedAt: '2026-05-05T00:00:00.000Z',
      },
    });
    const stayPath = writeSpecFile(specsDir, 'lonely-spec');

    let caught: unknown;
    try {
      await finishTask({ allConverged: true, dir: specsDir, contextDir: ctxDir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      `factory: no factory-sequence found in context dir; --all-converged requires at least one run-sequence invocation. Use 'factory finish-task <spec-id>' for individual specs.`,
    );
    expect(existsSync(stayPath)).toBe(true);
  });
});

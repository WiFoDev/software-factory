import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishTask } from './finish-task.js';

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

describe('finishTask --all-converged batch ship-cycle (v0.0.13)', () => {
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

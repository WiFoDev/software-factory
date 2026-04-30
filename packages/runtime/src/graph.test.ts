import { describe, expect, test } from 'bun:test';
import { RuntimeError } from './errors.js';
import { definePhase, definePhaseGraph } from './graph.js';
import type { Phase } from './types.js';

const noopRun = async () => ({ status: 'pass' as const, records: [] });

function p(name: string): Phase {
  return definePhase(name, noopRun);
}

describe('definePhase', () => {
  test('returns { name, run } verbatim', () => {
    const fn = noopRun;
    const phase = definePhase('foo', fn);
    expect(phase.name).toBe('foo');
    expect(phase.run).toBe(fn);
  });
});

describe('definePhaseGraph — topological order', () => {
  test('linear chain a → b → c yields [a, b, c]', () => {
    const graph = definePhaseGraph(
      [p('a'), p('b'), p('c')],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );
    expect([...graph.topoOrder]).toEqual(['a', 'b', 'c']);
  });

  test('diamond a → {b, c} with insertion-order tiebreak', () => {
    const graph = definePhaseGraph(
      [p('a'), p('b'), p('c')],
      [
        ['a', 'b'],
        ['a', 'c'],
      ],
    );
    expect([...graph.topoOrder]).toEqual(['a', 'b', 'c']);
  });

  test('insertion-order tiebreak respects phases[] order, not edge order', () => {
    const graph = definePhaseGraph(
      [p('c'), p('b'), p('a')],
      [
        ['a', 'b'],
        ['a', 'c'],
      ],
    );
    // a is still first (only in-degree-zero); among {b, c}, c comes first (earlier in phases[])
    expect([...graph.topoOrder]).toEqual(['a', 'c', 'b']);
  });

  test('single-phase graph with no edges', () => {
    const graph = definePhaseGraph([p('only')], []);
    expect([...graph.topoOrder]).toEqual(['only']);
    expect(graph.edges.length).toBe(0);
    expect(graph.phases.length).toBe(1);
  });

  test('returned graph is frozen', () => {
    const graph = definePhaseGraph([p('a')], []);
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.topoOrder)).toBe(true);
    expect(Object.isFrozen(graph.phases)).toBe(true);
    expect(Object.isFrozen(graph.edges)).toBe(true);
  });
});

describe('definePhaseGraph — rejection', () => {
  test('rejects empty phases[] with runtime/graph-empty', () => {
    let caught: unknown;
    try {
      definePhaseGraph([], []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).code).toBe('runtime/graph-empty');
  });

  test('rejects duplicate phase names with runtime/graph-duplicate-phase', () => {
    let caught: unknown;
    try {
      definePhaseGraph([p('x'), p('y'), p('x')], []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).code).toBe('runtime/graph-duplicate-phase');
    expect((caught as RuntimeError).message).toContain("'x'");
  });

  test('rejects edge with unknown `from` endpoint', () => {
    let caught: unknown;
    try {
      definePhaseGraph([p('a'), p('b')], [['ghost', 'a']]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).code).toBe('runtime/graph-unknown-phase');
    expect((caught as RuntimeError).message).toContain("'ghost'");
  });

  test('rejects edge with unknown `to` endpoint', () => {
    let caught: unknown;
    try {
      definePhaseGraph([p('a'), p('b')], [['a', 'ghost']]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).code).toBe('runtime/graph-unknown-phase');
  });

  test('rejects self-loop x → x as runtime/graph-cycle', () => {
    let caught: unknown;
    try {
      definePhaseGraph([p('x')], [['x', 'x']]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).code).toBe('runtime/graph-cycle');
    expect((caught as RuntimeError).message).toContain('x');
  });

  test('rejects 2-cycle x ↔ y as runtime/graph-cycle', () => {
    let caught: unknown;
    try {
      definePhaseGraph(
        [p('x'), p('y')],
        [
          ['x', 'y'],
          ['y', 'x'],
        ],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).code).toBe('runtime/graph-cycle');
  });

  test('rejects 3-cycle a → b → c → a as runtime/graph-cycle', () => {
    let caught: unknown;
    try {
      definePhaseGraph(
        [p('a'), p('b'), p('c')],
        [
          ['a', 'b'],
          ['b', 'c'],
          ['c', 'a'],
        ],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).code).toBe('runtime/graph-cycle');
  });
});

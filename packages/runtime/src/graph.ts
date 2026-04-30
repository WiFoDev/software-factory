import { RuntimeError } from './errors.js';
import type { Phase, PhaseContext, PhaseGraph, PhaseResult } from './types.js';

export function definePhase(name: string, fn: (ctx: PhaseContext) => Promise<PhaseResult>): Phase {
  return { name, run: fn };
}

/**
 * Build a frozen phase graph. Validates synchronously: rejects empty `phases`,
 * duplicate phase names, edges referencing unknown phases, and cycles. On
 * success, returns the graph with `topoOrder` computed by Kahn's algorithm
 * with an insertion-order tiebreak among in-degree-zero peers.
 */
export function definePhaseGraph(
  phases: ReadonlyArray<Phase>,
  edges: ReadonlyArray<readonly [string, string]>,
): PhaseGraph {
  if (phases.length === 0) {
    throw new RuntimeError('runtime/graph-empty', 'at least one phase required');
  }

  const seen = new Set<string>();
  const indexByName = new Map<string, number>();
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    if (phase === undefined) continue;
    if (seen.has(phase.name)) {
      throw new RuntimeError(
        'runtime/graph-duplicate-phase',
        `phase '${phase.name}' appears twice in phases[]`,
      );
    }
    seen.add(phase.name);
    indexByName.set(phase.name, i);
  }

  for (const edge of edges) {
    const [from, to] = edge;
    if (!seen.has(from)) {
      throw new RuntimeError(
        'runtime/graph-unknown-phase',
        `edge references unknown phase '${from}'`,
      );
    }
    if (!seen.has(to)) {
      throw new RuntimeError(
        'runtime/graph-unknown-phase',
        `edge references unknown phase '${to}'`,
      );
    }
  }

  // Build adjacency + in-degree maps.
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const phase of phases) {
    adj.set(phase.name, []);
    inDegree.set(phase.name, 0);
  }
  for (const [from, to] of edges) {
    const successors = adj.get(from);
    if (successors !== undefined) successors.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  // Kahn's algorithm with insertion-order tiebreak.
  const topoOrder: string[] = [];
  const remaining = new Set(phases.map((p) => p.name));

  while (remaining.size > 0) {
    let chosen: string | undefined;
    let chosenIndex = Number.POSITIVE_INFINITY;
    for (const name of remaining) {
      if ((inDegree.get(name) ?? 0) !== 0) continue;
      const idx = indexByName.get(name) ?? Number.POSITIVE_INFINITY;
      if (idx < chosenIndex) {
        chosen = name;
        chosenIndex = idx;
      }
    }
    if (chosen === undefined) {
      throw new RuntimeError(
        'runtime/graph-cycle',
        `cycle detected through: ${[...remaining].join(', ')}`,
      );
    }
    topoOrder.push(chosen);
    remaining.delete(chosen);
    for (const successor of adj.get(chosen) ?? []) {
      inDegree.set(successor, (inDegree.get(successor) ?? 0) - 1);
    }
  }

  const frozenEdges = Object.freeze(edges.map((e) => Object.freeze([e[0], e[1]] as const)));
  return Object.freeze({
    phases: Object.freeze([...phases]),
    edges: frozenEdges,
    topoOrder: Object.freeze(topoOrder),
  });
}

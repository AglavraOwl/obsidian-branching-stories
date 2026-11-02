import { NodeMeta } from "./tree";

/** `$0` / `$0.0042` / `$0.025` / `$1.20`: enough digits that small amounts do not all look the same. */
export function fmtCost(n: number): string {
  if (!(n > 0)) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/** Cost sums carry float noise (0.1 + 0.2): keep eight decimals. */
export const roundCost = (n: number): number => Math.round(n * 1e8) / 1e8;

/** Generation plus summaries of one node. */
export function nodeCost(m: NodeMeta): number {
  return (m.cost ?? 0) + (m.summaryCost ?? 0);
}

/** What the nodes on a path cost together (generation and summaries). */
export function pathCost(path: NodeMeta[]): number {
  return roundCost(path.reduce((sum, m) => sum + nodeCost(m), 0));
}

export interface ModelCost {
  model: string;
  nodes: number;
  cost: number;
}

export interface StoryCost {
  generation: number;
  summaries: number;
  tagging: number;
  total: number;
  /** Nodes that have a recorded generation cost, and those that do not (stopped, failed, LM Studio, older). */
  nodesWithCost: number;
  nodesWithoutCost: number;
  /** Generation cost per model, most expensive first. */
  byModel: ModelCost[];
}

/** Everything spent in a story. `tagging` is the sum recorded on its fragments. */
export function storyCost(nodes: NodeMeta[], tagging: number): StoryCost {
  let generation = 0;
  let summaries = 0;
  let withCost = 0;
  const models = new Map<string, ModelCost>();
  for (const m of nodes) {
    summaries += m.summaryCost ?? 0;
    if (m.cost === undefined) continue;
    generation += m.cost;
    withCost++;
    const key = m.model || "(unknown model)";
    const entry = models.get(key) ?? { model: key, nodes: 0, cost: 0 };
    entry.nodes++;
    entry.cost += m.cost;
    models.set(key, entry);
  }
  return {
    generation: roundCost(generation),
    summaries: roundCost(summaries),
    tagging: roundCost(tagging),
    total: roundCost(generation + summaries + tagging),
    nodesWithCost: withCost,
    nodesWithoutCost: nodes.length - withCost,
    byModel: [...models.values()].map((e) => ({ ...e, cost: roundCost(e.cost) })).sort((a, b) => b.cost - a.cost),
  };
}

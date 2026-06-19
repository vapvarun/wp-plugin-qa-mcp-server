import { writeFileSync, readFileSync } from 'node:fs';
import { fileExists } from '../shared-utils.js';
import type { FlowGraph, FlowNode, FlowEdge, FlowNodeKind, FlowEdgeKind } from '../types.js';

export function nodeId(kind: FlowNodeKind, key: string): string { return `${kind}:${key}`; }

export function emptyGraph(repos: { free: string; pro?: string }, generated: string): FlowGraph {
  return { nodes: {}, edges: [], fingerprints: {}, repos, generated };
}

export function addNode(g: FlowGraph, node: FlowNode): void { g.nodes[node.id] = node; }
export function addEdge(g: FlowGraph, edge: FlowEdge): void { g.edges.push(edge); }

export function inbound(g: FlowGraph, id: string, kinds?: FlowEdgeKind[]): FlowEdge[] {
  return g.edges.filter(e => e.to === id && (!kinds || kinds.includes(e.kind)));
}
export function outbound(g: FlowGraph, id: string, kinds?: FlowEdgeKind[]): FlowEdge[] {
  return g.edges.filter(e => e.from === id && (!kinds || kinds.includes(e.kind)));
}
export function nodesByKind(g: FlowGraph, kind: FlowNodeKind): FlowNode[] {
  return Object.values(g.nodes).filter(n => n.kind === kind);
}

export function writeGraph(path: string, g: FlowGraph): void { writeFileSync(path, JSON.stringify(g)); }
export function readGraph(path: string): FlowGraph | null {
  if (!fileExists(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as FlowGraph; } catch { return null; }
}

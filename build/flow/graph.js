import { writeFileSync, readFileSync } from 'node:fs';
import { fileExists } from '../shared-utils.js';
export function nodeId(kind, key) { return `${kind}:${key}`; }
export function emptyGraph(repos, generated) {
    return { nodes: {}, edges: [], fingerprints: {}, repos, generated, referencedNames: [] };
}
export function addNode(g, node) { g.nodes[node.id] = node; }
export function addEdge(g, edge) { g.edges.push(edge); }
export function inbound(g, id, kinds) {
    return g.edges.filter(e => e.to === id && (!kinds || kinds.includes(e.kind)));
}
export function outbound(g, id, kinds) {
    return g.edges.filter(e => e.from === id && (!kinds || kinds.includes(e.kind)));
}
export function nodesByKind(g, kind) {
    return Object.values(g.nodes).filter(n => n.kind === kind);
}
export function writeGraph(path, g) { writeFileSync(path, JSON.stringify(g)); }
export function readGraph(path) {
    if (!fileExists(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=graph.js.map
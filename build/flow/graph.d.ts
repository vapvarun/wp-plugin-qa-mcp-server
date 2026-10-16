import type { FlowGraph, FlowNode, FlowEdge, FlowNodeKind, FlowEdgeKind } from '../types.js';
export declare function nodeId(kind: FlowNodeKind, key: string): string;
export declare function emptyGraph(repos: {
    free: string;
    pro?: string;
}, generated: string): FlowGraph;
export declare function addNode(g: FlowGraph, node: FlowNode): void;
export declare function addEdge(g: FlowGraph, edge: FlowEdge): void;
export declare function inbound(g: FlowGraph, id: string, kinds?: FlowEdgeKind[]): FlowEdge[];
export declare function outbound(g: FlowGraph, id: string, kinds?: FlowEdgeKind[]): FlowEdge[];
export declare function nodesByKind(g: FlowGraph, kind: FlowNodeKind): FlowNode[];
export declare function writeGraph(path: string, g: FlowGraph): void;
export declare function readGraph(path: string): FlowGraph | null;

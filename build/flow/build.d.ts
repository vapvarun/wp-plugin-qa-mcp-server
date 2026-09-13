import type { FlowGraph } from '../types.js';
export declare function buildGraph(opts: {
    freeRoot: string;
    proRoot?: string;
    generated: string;
}): FlowGraph;
export declare function buildOrUpdate(opts: {
    freeRoot: string;
    proRoot?: string;
    generated: string;
}): FlowGraph;

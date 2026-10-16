import type { CheckerResult, FlowGraph } from './types.js';
export declare function checkLogicFlow(g: FlowGraph, journeys: Array<{
    id: string;
    name: string;
    entry: string;
}>): CheckerResult;

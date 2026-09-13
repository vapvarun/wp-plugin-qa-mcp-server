import type { CheckerResult, FlowGraph } from './types.js';
export declare function isEntrypoint(rel: string): boolean;
export declare function checkTemplateUsage(g: FlowGraph, repoRoots: string[]): CheckerResult;

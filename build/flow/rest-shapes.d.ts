import type { FlowGraph } from '../types.js';
export declare function normalizeMethod(raw: string): string;
export declare function extractShapeKeys(php: string): string[];
export declare function extractJsReads(js: string, routeUrl: string): string[];
export declare function addRestRoutes(g: FlowGraph, repoRoot: string, repo: 'free' | 'pro'): void;
export declare function addJsConsumers(g: FlowGraph, repoRoot: string, repo: 'free' | 'pro'): void;

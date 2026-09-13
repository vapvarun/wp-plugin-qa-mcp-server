import type { FlowGraph } from '../types.js';
export interface PhpSymbol {
    kind: 'function' | 'method';
    name: string;
    class: string | null;
    fqn: string;
    file: string;
    line: number;
    bodyHash: string;
    bodyLen: number;
    params: string[];
    visibility: string | null;
    abstract: boolean;
}
export interface PhpCall {
    fromFqn: string | null;
    toName: string;
    viaService: string | null;
    file: string;
    line: number;
}
export interface PhpReg {
    hook: string;
    callback: string;
    mechanism: string;
    file: string;
    line: number;
}
export interface PhpBind {
    id: string;
    class: string;
    file: string;
    line: number;
}
export interface PhpFacts {
    symbols: PhpSymbol[];
    calls: PhpCall[];
    registrations: PhpReg[];
    serviceBindings: PhpBind[];
    hooksFired: {
        hook: string;
        file: string;
        line: number;
    }[];
    templatesLoaded: {
        template: string;
        argKeys: string[];
        file: string;
        line: number;
    }[];
    errors: {
        file: string;
        message: string;
    }[];
    referencedNames?: string[];
}
export declare function ingestPhpFacts(g: FlowGraph, facts: PhpFacts, repo: 'free' | 'pro'): void;

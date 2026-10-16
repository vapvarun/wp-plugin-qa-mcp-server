import type { CheckerIssue } from '../types.js';
export interface FlowBaseline {
    suppressions: {
        id: string;
        reason: string;
    }[];
}
export declare function loadBaseline(path: string): FlowBaseline;
export declare function applyBaseline(issues: CheckerIssue[], baseline: {
    suppressions: {
        id: string;
        reason?: string;
    }[];
}): CheckerIssue[];

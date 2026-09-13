import type { CheckerResult } from './types.js';
export declare function runFlowAudit(opts: {
    freeRoot: string;
    proRoot?: string;
    generated: string;
}): {
    results: CheckerResult[];
    report: string;
    errorCount: number;
};

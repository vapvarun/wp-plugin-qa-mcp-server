import type { CheckerResult } from '../types.js';
export declare function renderReport(results: CheckerResult[], meta: {
    generated: string;
    repos: string[];
}): string;

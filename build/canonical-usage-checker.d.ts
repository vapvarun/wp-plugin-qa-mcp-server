import { type CanonicalRule } from './flow/canonical-rules.js';
import type { CheckerResult } from './types.js';
export declare function stripPhpComments(content: string): string;
export declare function scanForRule(content: string, rule: CanonicalRule): number[];
export declare function checkCanonicalUsage(repoRoots: string[]): CheckerResult;

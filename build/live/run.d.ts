import { type KnownFailure } from './config.js';
import { type Row } from './checks.js';
import type { WpCli } from './wp.js';
export interface RunOptions {
    pluginPath: string;
    wp: WpCli;
    mode?: 'fast' | 'full';
    /** Check classes or guard ids to limit the run to. */
    only?: string[];
    /** Site the crawl walks: a clean install of the release zip. Defaults to the configured site. */
    freshSiteUrl?: string;
    artifactsDir?: string;
}
export interface Ledger {
    ok: boolean;
    mode: string;
    summary: {
        pass: number;
        fail: number;
        skip: number;
    };
    rows: Row[];
    dangling: string[];
    unguarded_failures: string[];
    /** Failures matched to an open card in audit/known-failures.json. */
    known: string[];
    /** known-failures.json entries that matched nothing this run: fixed, so remove them. */
    stale_known: string[];
}
export declare function runChecks(o: RunOptions): Promise<Ledger>;
/**
 * Known failures stay visible but do not fail the gate; each one names its open card.
 * A row is excused only when every finding in it is filed, so a new finding in the same row still fails.
 */
export declare function applyKnown(rows: Row[], known: KnownFailure[]): {
    known: string[];
    stale: string[];
};
export declare function formatLedger(l: Ledger): string;

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
    /** True only for verdict PASS. */
    ok: boolean;
    /** FAIL: a row failed or a guard dangles. INCOMPLETE: nothing failed, but part of the gate did not run. */
    verdict: 'PASS' | 'FAIL' | 'INCOMPLETE';
    /** What did not run. Never counted as a pass. */
    incomplete: string[];
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
 * The gate's verdict. A skip that is not a known, carded failure is a check that did not run, and a
 * full run that never opened the site (`ranLive` false: the config holds only release checks) checked
 * no behaviour. Neither fails the gate; neither is a pass.
 */
export declare function judge(rows: Row[], dangling: string[], ranLive: boolean): {
    verdict: Ledger['verdict'];
    incomplete: string[];
};
/**
 * Known failures stay visible but do not fail the gate; each one names its open card.
 * A row is excused only when every finding in it is filed, so a new finding in the same row still fails.
 */
export declare function applyKnown(rows: Row[], known: KnownFailure[]): {
    known: string[];
    stale: string[];
};
export declare function formatLedger(l: Ledger): string;

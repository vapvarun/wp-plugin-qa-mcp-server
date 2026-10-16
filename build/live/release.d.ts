import type { ReleaseConfig } from './config.js';
import type { Row } from './checks.js';
export declare function checkPot(pluginPath: string, r: ReleaseConfig, slug: string, wpBin?: string): Row;
/** A make-pot step followed by `|| …` or with errors sent to /dev/null ships a stale .pot silently. */
export declare function checkBuild(pluginPath: string, r: ReleaseConfig): Row;
/** Root-anchored entries of .distignore (what build scripts pass to rsync) plus configured prefixes. */
export declare function excludedPaths(pluginPath: string, r: ReleaseConfig): {
    prefixes: string[];
    names: string[];
};
/** Shipped code that names an excluded path must check the file exists, or it breaks only on real installs. */
export declare function checkRefs(pluginPath: string, r: ReleaseConfig): Row;

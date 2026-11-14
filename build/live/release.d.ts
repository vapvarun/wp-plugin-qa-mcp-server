import type { ReleaseConfig } from './config.js';
import type { Row } from './checks.js';
export declare function checkPot(pluginPath: string, r: ReleaseConfig, slug: string, wpBin?: string): Row;
/** A make-pot step followed by `|| …` or with errors sent to /dev/null ships a stale .pot silently. */
export declare function checkBuild(pluginPath: string, r: ReleaseConfig): Row;
interface Rule {
    re: RegExp;
    dirOnly: boolean;
    negated: boolean;
}
/**
 * One .distignore line as a gitignore-style rule: a leading or inner "/"
 * anchors it to the plugin root, otherwise it matches that name at any depth;
 * a trailing "/" limits it to directories; "!" re-includes; "#" is a comment.
 */
export declare function distignoreRule(raw: string, forceAnchor?: boolean): Rule | null;
export interface Excluded {
    /** Every directory the zip leaves out, as "path/" relative to the plugin root. */
    dirs: string[];
    /** Shipped .php / .js files. */
    files: string[];
}
/** Walk the plugin applying .distignore (last matching rule wins) plus the configured `release.excluded` prefixes. */
export declare function excludedPaths(pluginPath: string, r: ReleaseConfig): Excluded;
/**
 * Blank out comments, keeping line numbers and string contents. PHP is only
 * parsed inside <?php ... ?>, so apostrophes and "#" in template HTML are left
 * alone. Limits: heredoc bodies and JS regex literals are read as code, so a
 * "//" or quote inside one can blank the rest of that line.
 */
export declare function stripComments(src: string, php: boolean): string;
/** Shipped code that names an excluded path must check the file exists, or it breaks only on real installs. */
export declare function checkRefs(pluginPath: string, r: ReleaseConfig): Row;
export {};

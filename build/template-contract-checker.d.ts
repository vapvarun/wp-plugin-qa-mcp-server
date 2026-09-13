/**
 * WP Plugin QA MCP Server - Template Contract Checker
 *
 * Loader <-> template contract drift. Catches the silent-bug class where a
 * template reads a variable the loader never supplies, so it renders blank /
 * a notice and nothing else detects it. WPCS/PHPStan/Plugin Check analyze
 * files in isolation and cannot see the loader<->template contract.
 *
 * Two loader conventions are auto-detected (v3 generalization):
 *
 *   1. WooCommerce-style template helper:
 *        wc_get_template( 'foo.php', array( 'a' => … ) )
 *        {prefix}_get_template( 'foo.php', array( … ) )
 *      The args-array keys are the variables the template may read.
 *
 *   2. View-data resolver registry (e.g. Learnomy's Template_Loader):
 *        $view_data_resolvers = array( 'course' => 'X\\Single_Course_View_Data', … );
 *        $template_map        = array( 'course' => 'course/classic.php', … );
 *      A per-route resolver class exposes `resolve(): array`; the loader
 *      extract()s that array into the template. The resolver's returned keys
 *      are the variables the template may read.
 *
 * Optional per-plugin override: `audit/template-contracts.json`
 *   { "whitelisted_vars": ["slug","route", …],          // loader/route vars
 *     "contracts": [ { "template": "x.php", "resolver": "includes/.../class-x.php",
 *                      "also_supplies": ["k"] } ] }       // explicit pairs
 *
 * Conservative by design: PHP/WordPress globals, $this, loop variables,
 * locally assigned variables, and (for resolvers) the over-approximated set
 * of every literal array key in the resolver file are all treated as
 * supplied — the check biases to false-negatives over false-positives so the
 * manifest layer stays clean.
 */
import type { CheckerResult } from './types.js';
export type TemplateContractMode = 'wc-loader' | 'resolver' | 'config' | 'mixed' | 'none';
export interface TemplateContractAnalysis {
    mode: TemplateContractMode;
    /** Templates that had a resolvable contract and were checked. */
    checked: number;
    result: CheckerResult;
}
/** Public tool entry — returns the CheckerResult only (back-compat). */
export declare function checkTemplateContracts(pluginPath: string): CheckerResult;
/** Richer entry used by the v3 manifest layer: also reports the detected mode. */
export declare function analyzeTemplateContracts(pluginPath: string): TemplateContractAnalysis;
export interface HygieneFinding {
    file: string;
    line: number;
    rule: string;
    snippet: string;
    hint: string;
}
export interface TemplateHygiene {
    zeroLogic: {
        checkedFiles: number;
        findings: HygieneFinding[];
    };
    components: {
        checkedFiles: number;
        findings: HygieneFinding[];
    };
}
/**
 * TC1 (zero-logic templates) + TC3 (shared-component usage). Both are config-
 * refined and emitted as v3 manifest layers. Deterministic; findings sorted by
 * the caller. TC1 strips comments/HTML so a $wpdb in a comment isn't flagged;
 * TC3 matches raw lines because markup is what matters.
 */
export declare function analyzeTemplateHygiene(pluginPath: string): TemplateHygiene;

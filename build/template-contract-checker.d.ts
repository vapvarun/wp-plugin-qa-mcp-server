/**
 * WP Plugin QA MCP Server - Template Contract Checker
 *
 * Loader <-> template contract drift. Catches the silent-bug class where a
 * template uses a variable that the loader never puts into the `$args`
 * passed to the template helper. WPCS cannot see this because it analyzes
 * files in isolation — this check is cross-layer.
 *
 * Supported loader calls (common WooCommerce-style convention):
 *
 *   wc_get_template( 'foo.php', array( 'a' => … ) )
 *   {prefix}_get_template( 'foo.php', array( 'a' => … ) )
 *   {prefix}_get_template_html( 'foo.php', array( 'a' => … ) )
 *
 * The callee resolves the template file, the args keys become the
 * variables the template is allowed to read, and anything consumed in
 * the template outside that set is contract drift.
 *
 * This is intentionally conservative: only variables that clearly look
 * like loader-supplied template data are checked. PHP globals, $this,
 * $wpdb, loop variables (foreach, for), arguments received from another
 * include, and variables assigned inside the template itself are all
 * excluded.
 */
import type { CheckerResult } from './types.js';
export declare function checkTemplateContracts(pluginPath: string): CheckerResult;

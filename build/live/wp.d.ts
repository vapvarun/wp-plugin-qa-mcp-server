export interface WpCli {
    /** WP-CLI executable or a site wrapper script (e.g. one that sets the MySQL socket). */
    bin: string;
    /** WordPress root, passed as --path when set. */
    root?: string;
}
export declare function wpEval(cli: WpCli, php: string, vars?: Record<string, unknown>): unknown;

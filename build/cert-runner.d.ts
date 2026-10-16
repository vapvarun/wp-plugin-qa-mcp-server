/**
 * WP Plugin QA MCP Server - Functional Certification delegate.
 *
 * The deterministic behavioural gate. This does NOT analyse code or return
 * advisory prose — that was the failure mode of the older `wppqa_check_*`
 * tools. It SHELLS OUT to the plugin's own `wp <namespace> cert --json`
 * command (the Certify engine that lives in the plugin, see
 * docs/plans/functional-certification-system.md) and returns the raw,
 * machine-verified ledger: every gated setting flipped + asserted, every route
 * booted, every uncovered surface reported as a HOLE.
 *
 * Division of labour (the rule that makes this trustworthy):
 *   - The engine (code) decides pass/fail. Deterministic.
 *   - The MCP (here) only transports the verdict.
 *   - The LLM may PROPOSE new oracles for HOLEs — it never IS the check.
 *
 * Plugin-agnostic: any plugin exposing a `cert` WP-CLI subcommand works; the
 * caller supplies the WP root and the CLI namespace.
 */
export interface CertifyOptions {
    /** Absolute path to the WordPress root the plugin is active on. */
    wpRoot: string;
    /** Plugin CLI namespace, e.g. "buddynext" → `wp buddynext cert`. */
    cliNamespace: string;
    /** Optional single check: "contract" | "boot". Omit to run all. */
    check?: string;
}
export interface CertifyLedger {
    ok: boolean;
    summary: Record<string, number>;
    rows: Array<{
        check: string;
        entity: string;
        status: string;
        detail: string;
    }>;
}
export interface CertifyResult {
    ran: boolean;
    ledger?: CertifyLedger;
    /** Raw stdout when JSON could not be parsed (engine missing, error, etc.). */
    raw?: string;
    error?: string;
}
/**
 * Run the plugin's Certify engine and return its ledger.
 *
 * `wp ... cert --json` prints the ledger then exits non-zero on failure, so a
 * thrown execFileSync error still carries the ledger on its stdout — we parse
 * that rather than treating a "red" gate as a transport error.
 */
export declare function runCertify(opts: CertifyOptions): CertifyResult;
/**
 * Render the ledger as a compact, human-skimmable summary for the MCP caller,
 * leading with what matters: failures, then holes (the self-improvement
 * backlog), then the headline counts.
 */
export declare function formatCertify(result: CertifyResult): string;
/**
 * Run the GENERIC engine (plugin-agnostic) against any plugin: scan it to a manifest,
 * write the manifest to /tmp, then `wp eval-file engine/cert-engine.php <manifest> [oracles]`.
 * This is the path that works for all 100+ products with no per-plugin PHP.
 */
export declare function runEngine(opts: {
    wpRoot: string;
    pluginPath: string;
    oraclesPath?: string;
    rescan?: boolean;
}): CertifyResult;
/** Format the generic engine ledger: failures first, then candidates (unconfirmed), then counts. */
export declare function formatEngine(result: CertifyResult): string;

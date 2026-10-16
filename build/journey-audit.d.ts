/**
 * Journey-audit module — customer-experience matrix per release, plugin-agnostic.
 *
 * The MCP owns the *method* (three lenses, severity rubric, briefing prompt
 * shape, matrix consolidation). Each plugin owns its *journeys* — they live
 * in the plugin tree at:
 *
 *   <plugin_path>/docs/audit/journeys.json
 *
 * That file is the source of truth for which customer surfaces matter and
 * what the customer expects from each. A new plugin scaffolds a starter
 * via wppqa_audit_init_journeys and then edits the file to fit its product.
 *
 * Three exported functions, three new MCP tools:
 *
 *   wppqa_audit_init_journeys      -> initJourneys()
 *   wppqa_audit_get_briefing       -> getBriefing()
 *   wppqa_audit_consolidate_matrix -> consolidateMatrix()
 *
 * Dispatching the per-journey audits is the caller's job (Claude's Agent
 * tool), not the MCP's. The MCP returns the briefing prompts; Claude runs
 * them in parallel; Claude calls back to consolidateMatrix when done.
 */
export interface JourneyFeature {
    id: string;
    name: string;
    expectation: string;
}
export interface Journey {
    id: string;
    name: string;
    perspective: string;
    features: JourneyFeature[];
}
export interface JourneyLens {
    id: string;
    label: string;
    prompt: string;
}
export interface SeverityLevel {
    emoji: string;
    label: string;
}
export interface JourneysFile {
    /** A short label for the audit, e.g. "Forum / community plugin (Jetonomy)". */
    product_name: string;
    /** Free-form description of what the audit covers. */
    description?: string;
    /** Three customer-facing lenses. The MCP supplies a default if absent. */
    lenses?: JourneyLens[];
    /** Severity rubric. The MCP supplies a default if absent. */
    severity_rubric?: SeverityLevel[];
    /** Customer journeys; one Sonnet sub-agent runs per journey in parallel. */
    journeys: Journey[];
}
export declare function initJourneys(args: {
    plugin_path: string;
    force?: boolean;
    starter_only?: boolean;
}): {
    created: boolean;
    path: string;
    source: 'auto-discovery' | 'starter' | 'preserved';
    surfaces_discovered?: number;
    preview: string;
};
export interface BriefingArgs {
    plugin_path: string;
    site_url?: string;
    output_dir?: string;
}
export interface JourneyBriefing {
    journey_id: string;
    journey_name: string;
    prompt: string;
    output_path: string;
}
export declare function getBriefing(args: BriefingArgs): {
    product_name: string;
    briefings: JourneyBriefing[];
    consolidate_hint: string;
};
export interface CoverageReport {
    total_manifest_surfaces: number;
    covered: number;
    coverage_percent: number;
    missing: Array<{
        surface_kind: string;
        identifier: string;
        suggestion: string;
    }>;
}
export declare function coverageCheck(args: {
    plugin_path: string;
}): CoverageReport;
export interface ConsolidateArgs {
    report_paths: string[];
    plugin_path: string;
    output_path: string;
}
export declare function consolidateMatrix(args: ConsolidateArgs): {
    output_path: string;
    totals: {
        red: number;
        yellow: number;
        green: number;
        skipped: number;
        total: number;
    };
    reds: string[];
};

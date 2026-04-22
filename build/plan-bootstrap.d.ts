/**
 * WP Plugin QA MCP Server - Plan Bootstrap
 * Scans a plugin and scaffolds `plan/` (role matrix, fresh-install fixture,
 * per-feature flow stubs, regression README, coverage checklist). Output is
 * schema-compatible with `wppqa_probe_roles` and `wppqa_run_flow`. Every
 * scaffolded value is derived from the live scanner manifest.
 */
import type { PluginManifest } from './types.js';
export interface BootstrapPlanOptions {
    pluginPath: string;
    overwrite?: boolean;
    scanManifestCache?: PluginManifest;
}
export interface BootstrapReport {
    pluginSlug: string;
    pluginName: string;
    planDir: string;
    created: string[];
    skipped: {
        path: string;
        reason: string;
    }[];
    stats: {
        restRoutes: number;
        ajaxActions: number;
        shortcodes: number;
        cpts: number;
        adminPages: number;
        cronEvents: number;
        flowsSeeded: number;
        fixturesSeeded: number;
    };
    nextSteps: string[];
}
export declare function bootstrapPlan(opts: BootstrapPlanOptions): Promise<BootstrapReport>;

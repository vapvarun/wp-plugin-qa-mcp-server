/**
 * WP Plugin QA MCP Server - Database Checker
 * MySQL checks for custom tables, settings, CPT storage, data cleanup,
 * orphaned options, transient cleanup, dbDelta schema, charset/collation.
 * Uses HTTP-based checks against running WP site + static analysis. No direct shell usage.
 */
import type { CheckerResult, PluginManifest } from './types.js';
export declare function checkDatabase(manifest: PluginManifest, siteUrl: string): Promise<CheckerResult>;

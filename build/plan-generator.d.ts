/**
 * WP Plugin QA MCP Server - Test Plan Generator
 * Converts a PluginManifest into a prioritized TestPlan with 13 categories.
 */
import type { PluginManifest, TestPlan } from './types.js';
/**
 * Generate a complete test plan from a plugin manifest.
 */
export declare function generateTestPlan(manifest: PluginManifest): TestPlan;

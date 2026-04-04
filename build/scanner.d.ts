/**
 * WP Plugin QA MCP Server - Plugin Scanner
 * 21 regex scanners for comprehensive feature discovery
 * + cross-layer wiring analysis (HTML->JS->PHP)
 */
import type { PluginManifest } from './types.js';
/**
 * Scan a plugin directory and return a complete PluginManifest.
 */
export declare function scanPlugin(pluginPath: string): PluginManifest;

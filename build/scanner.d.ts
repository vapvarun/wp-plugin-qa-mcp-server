/**
 * WP Plugin QA MCP Server - Plugin Scanner
 * 21 regex scanners for comprehensive feature discovery
 * + cross-layer wiring analysis (HTML->JS->PHP)
 */
import type { PluginManifest, ShortcodeInfo, RestRouteInfo, AdminPageInfo, CronJobInfo, TemplateFileInfo, OptionWiringInfo, HookListenerInfo, FeatureGroupInfo, FrontendJsInfo } from './types.js';
/**
 * Scan a plugin directory and return a complete PluginManifest.
 */
export declare function scanPlugin(pluginPath: string): PluginManifest;
export declare function scanShortcodes(phpFiles: string[], contents: Map<string, string>, pluginPath: string): ShortcodeInfo[];
export declare function scanRestRoutes(phpFiles: string[], contents: Map<string, string>, pluginPath: string): RestRouteInfo[];
export declare function scanAdminPages(phpFiles: string[], contents: Map<string, string>, pluginPath: string): AdminPageInfo[];
export declare function scanOptionsWiring(phpFiles: string[], contents: Map<string, string>, pluginPath: string): OptionWiringInfo[];
export declare function scanHookListeners(phpFiles: string[], contents: Map<string, string>, pluginPath: string): HookListenerInfo[];
export declare function scanFeatureGroups(optionsWiring: OptionWiringInfo[], restRoutes: RestRouteInfo[], templates: TemplateFileInfo[], adminPages: AdminPageInfo[], phpContents: Map<string, string>): FeatureGroupInfo[];
export declare function scanFrontendJs(pluginPath: string): FrontendJsInfo[];
export declare function scanCronJobs(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CronJobInfo[];

/**
 * WP Plugin QA MCP Server - Shared Utilities
 * Reused from wpcs-mcp-server with additions for QA-specific needs.
 */
/**
 * Find all PHP files in a directory tree, excluding common non-project dirs.
 */
export declare function findPhpFiles(dir: string, excludeDirs?: string[], files?: string[]): string[];
/**
 * Find files by extension in a directory tree.
 */
export declare function findFilesByExt(dir: string, ext: string, excludeDirs?: string[], files?: string[]): string[];
/**
 * Find JS files (non-minified).
 */
export declare function findJsFiles(dir: string, excludeDirs?: string[]): string[];
/**
 * Find JSON files in a directory tree (for block.json discovery).
 */
export declare function findJsonFiles(dir: string, filename: string, excludeDirs?: string[], files?: string[]): string[];
/**
 * Get the 1-based line number for a character offset in a string.
 */
export declare function getLineNumber(content: string, index: number): number;
/**
 * Get a relative path from a project root.
 */
export declare function relativePath(filePath: string, projectPath: string): string;
/**
 * Safely read a file, return empty string on error.
 */
export declare function safeReadFile(filePath: string): string;
/**
 * Count total lines across all files.
 */
export declare function countLines(files: string[]): number;
/**
 * Detect plugin slug from directory name.
 */
export declare function detectPluginSlug(pluginPath: string): string;
/**
 * Check if a directory exists and is readable.
 */
export declare function dirExists(dir: string): boolean;
/**
 * Check if a file exists.
 */
export declare function fileExists(filePath: string): boolean;
export declare function generateTestId(category: string): string;
/**
 * Reset ID counter (for fresh test plan generation).
 */
export declare function resetIdCounter(): void;

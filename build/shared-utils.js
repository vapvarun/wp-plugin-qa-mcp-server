/**
 * WP Plugin QA MCP Server - Shared Utilities
 * Reused from wpcs-mcp-server with additions for QA-specific needs.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
// Directories excluded from every static check. `tests` is here because
// test fixtures routinely contain deliberately-malformed HTML strings,
// mock secrets, and $wpdb calls that a grep-based scanner flags as
// production issues. `bin` is plugin-provided install scripts.
const DEFAULT_EXCLUDE_DIRS = [
    'vendor',
    'node_modules',
    'build',
    'dist',
    '.git',
    '.svn',
    'tests',
    'test',
    '__tests__',
    'bin',
];
/**
 * Find all PHP files in a directory tree, excluding common non-project dirs.
 */
export function findPhpFiles(dir, excludeDirs = DEFAULT_EXCLUDE_DIRS, files = []) {
    try {
        const items = readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            const fullPath = join(dir, item.name);
            if (item.isDirectory()) {
                if (!excludeDirs.includes(item.name)) {
                    findPhpFiles(fullPath, excludeDirs, files);
                }
            }
            else if (item.name.endsWith('.php')) {
                files.push(fullPath);
            }
        }
    }
    catch {
        // Ignore permission errors, missing dirs
    }
    return files;
}
/**
 * Find files by extension in a directory tree.
 */
export function findFilesByExt(dir, ext, excludeDirs = DEFAULT_EXCLUDE_DIRS, files = []) {
    try {
        const items = readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            const fullPath = join(dir, item.name);
            if (item.isDirectory()) {
                if (!excludeDirs.includes(item.name)) {
                    findFilesByExt(fullPath, ext, excludeDirs, files);
                }
            }
            else if (item.name.endsWith(ext)) {
                files.push(fullPath);
            }
        }
    }
    catch {
        // Ignore errors
    }
    return files;
}
/**
 * Find JS files (non-minified).
 */
export function findJsFiles(dir, excludeDirs = DEFAULT_EXCLUDE_DIRS) {
    const allJs = findFilesByExt(dir, '.js', excludeDirs);
    return allJs.filter(f => !f.endsWith('.min.js') && !f.includes('/build/') && !f.includes('/dist/'));
}
/**
 * Find JSON files in a directory tree (for block.json discovery).
 */
export function findJsonFiles(dir, filename, excludeDirs = DEFAULT_EXCLUDE_DIRS, files = []) {
    try {
        const items = readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            const fullPath = join(dir, item.name);
            if (item.isDirectory()) {
                if (!excludeDirs.includes(item.name)) {
                    findJsonFiles(fullPath, filename, excludeDirs, files);
                }
            }
            else if (item.name === filename) {
                files.push(fullPath);
            }
        }
    }
    catch {
        // Ignore errors
    }
    return files;
}
/**
 * Get the 1-based line number for a character offset in a string.
 */
export function getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
}
/**
 * Get a relative path from a project root.
 */
export function relativePath(filePath, projectPath) {
    return filePath.startsWith(projectPath + '/') ? filePath.slice(projectPath.length + 1) : filePath;
}
/**
 * Safely read a file, return empty string on error.
 */
export function safeReadFile(filePath) {
    try {
        return readFileSync(filePath, 'utf-8');
    }
    catch {
        return '';
    }
}
/**
 * Count total lines across all files.
 */
export function countLines(files) {
    let total = 0;
    for (const file of files) {
        try {
            const content = readFileSync(file, 'utf-8');
            total += content.split('\n').length;
        }
        catch {
            // skip
        }
    }
    return total;
}
/**
 * Detect plugin slug from directory name.
 */
export function detectPluginSlug(pluginPath) {
    return basename(pluginPath);
}
/**
 * Check if a directory exists and is readable.
 */
export function dirExists(dir) {
    try {
        const stat = statSync(dir);
        return stat.isDirectory();
    }
    catch {
        return false;
    }
}
/**
 * Check if a file exists.
 */
export function fileExists(filePath) {
    try {
        const stat = statSync(filePath);
        return stat.isFile();
    }
    catch {
        return false;
    }
}
/**
 * Generate a unique test ID.
 */
let idCounter = 0;
export function generateTestId(category) {
    idCounter++;
    return `${category.toUpperCase()}-${String(idCounter).padStart(3, '0')}`;
}
/**
 * Reset ID counter (for fresh test plan generation).
 */
export function resetIdCounter() {
    idCounter = 0;
}
//# sourceMappingURL=shared-utils.js.map
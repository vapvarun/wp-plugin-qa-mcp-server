/**
 * WP Plugin QA MCP Server - Database Checker
 * MySQL checks for custom tables, settings, CPT storage, data cleanup,
 * orphaned options, transient cleanup, dbDelta schema, charset/collation.
 * Uses HTTP-based checks against running WP site + static analysis. No direct shell usage.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { generateTestId, findPhpFiles, relativePath, getLineNumber, safeReadFile } from './shared-utils.js';
export async function checkDatabase(manifest, siteUrl) {
    const startTime = Date.now();
    const issues = [];
    const baseUrl = siteUrl.replace(/\/$/, '');
    let authCookie = '';
    let wpNonce = '';
    try {
        const loginResp = await fetch(`${baseUrl}/?autologin=1`, { redirect: 'manual' });
        const setCookies = loginResp.headers.getSetCookie?.() || [];
        authCookie = setCookies.filter(c => c.includes('wordpress_logged_in')).join('; ');
        if (authCookie) {
            const nonceResp = await fetch(`${baseUrl}/wp-admin/admin-ajax.php?action=rest-nonce`, {
                headers: { 'Cookie': authCookie },
            });
            if (nonceResp.ok)
                wpNonce = await nonceResp.text();
        }
    }
    catch (e) {
        issues.push({
            id: generateTestId('database'), category: 'database', severity: 'critical', type: 'error',
            title: 'Cannot connect to site for DB checks',
            message: `Failed to connect to ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`,
            file: '', line: 0, code: 'site-unreachable',
        });
        return { category: 'database', issues, passed: 0, failed: 1, skipped: 0, duration: Date.now() - startTime };
    }
    // Check CPT registration via REST
    for (const cpt of manifest.features.cpts) {
        if (cpt.hasRest) {
            try {
                const resp = await fetch(`${baseUrl}/wp-json/wp/v2/types/${cpt.postType}`, {
                    headers: { 'Cookie': authCookie, 'X-WP-Nonce': wpNonce },
                });
                if (resp.status === 404) {
                    issues.push({
                        id: generateTestId('database'), category: 'database', severity: 'high', type: 'error',
                        title: `CPT "${cpt.postType}" not registered in REST API`,
                        message: `CPT has show_in_rest=true but not found at /wp-json/wp/v2/types/${cpt.postType}`,
                        file: cpt.file, line: cpt.line, code: 'cpt-not-in-rest',
                    });
                }
            }
            catch { /* skip */ }
        }
    }
    // Static checks
    issues.push(...checkDataCleanup(manifest));
    issues.push(...checkAutoloadOptions(manifest));
    issues.push(...checkOrphanedOptions(manifest));
    issues.push(...checkTransientCleanup(manifest));
    issues.push(...checkDbDeltaSchema(manifest));
    issues.push(...checkCharsetCollation(manifest));
    const failed = issues.filter(i => i.type === 'error').length;
    const totalChecks = manifest.features.dbTables.length + manifest.features.settings.length + 6; // 6 static check categories
    return {
        category: 'database',
        issues,
        passed: Math.max(0, totalChecks - failed),
        failed,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
function checkDataCleanup(manifest) {
    const issues = [];
    const uninstallFile = join(manifest.pluginPath, 'uninstall.php');
    const hasUninstallFile = existsSync(uninstallFile);
    // Use the canonical scanner output instead of re-walking the PHP tree.
    // ActivationHookInfo records every register_uninstall_hook call with
    // type === 'uninstall'; an absent record means no hook is registered.
    const hasUninstallHook = manifest.features.activationHooks.some((h) => h.type === 'uninstall');
    if (!hasUninstallFile && !hasUninstallHook) {
        if (manifest.features.dbTables.length > 0 || manifest.features.settings.length > 0) {
            issues.push({
                id: generateTestId('database'), category: 'database', severity: 'medium', type: 'warning',
                title: 'No data cleanup on uninstall',
                message: 'Plugin creates DB tables/options but has no uninstall.php or register_uninstall_hook',
                file: '', line: 0, code: 'no-uninstall-cleanup',
                fix: 'Create uninstall.php to clean up custom tables and options',
            });
        }
    }
    return issues;
}
function checkAutoloadOptions(manifest) {
    const issues = [];
    const phpFiles = findPhpFiles(manifest.pluginPath);
    for (const file of phpFiles) {
        try {
            const content = readFileSync(file, 'utf-8');
            const rel = relativePath(file, manifest.pluginPath);
            const updatePattern = /update_option\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\$\w+)\s*\)/g;
            let match;
            while ((match = updatePattern.exec(content)) !== null) {
                const varName = match[2].toLowerCase();
                if (/list|all|cache|data|log|history|stats|report/i.test(varName)) {
                    const contextEnd = Math.min(match.index + match[0].length + 50, content.length);
                    const after = content.substring(match.index, contextEnd);
                    if (!/false|no/.test(after)) {
                        issues.push({
                            id: generateTestId('database'), category: 'database', severity: 'medium', type: 'info',
                            title: `Option "${match[1]}" may need autoload=false`,
                            message: `update_option for "${match[1]}" stores "${match[2]}" which may be large`,
                            file: rel, line: getLineNumber(content, match.index),
                            code: 'potential-autoload-issue',
                        });
                    }
                }
            }
        }
        catch { /* skip */ }
    }
    return issues;
}
function checkOrphanedOptions(manifest) {
    const issues = [];
    const phpFiles = findPhpFiles(manifest.pluginPath);
    const slug = manifest.header.slug || manifest.header.textDomain;
    const prefix = slug.replace(/-/g, '_');
    const writtenOptions = new Map();
    const readOptions = new Set();
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, manifest.pluginPath);
        const writePattern = /(?:add_option|update_option)\s*\(\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = writePattern.exec(content)) !== null) {
            const optName = match[1];
            if (optName.includes(prefix) || optName.includes(slug)) {
                if (!writtenOptions.has(optName)) {
                    writtenOptions.set(optName, { file: rel, line: getLineNumber(content, match.index) });
                }
            }
        }
        const readPattern = /get_option\s*\(\s*['"]([^'"]+)['"]/g;
        while ((match = readPattern.exec(content)) !== null) {
            readOptions.add(match[1]);
        }
    }
    const orphaned = [];
    for (const [optName] of writtenOptions) {
        if (!readOptions.has(optName)) {
            orphaned.push(optName);
        }
    }
    if (orphaned.length > 0) {
        issues.push({
            id: generateTestId('database'), category: 'database', severity: 'low', type: 'info',
            title: `${orphaned.length} potentially orphaned options`,
            message: `Options stored but never read with get_option(): ${orphaned.slice(0, 5).join(', ')}${orphaned.length > 5 ? ` and ${orphaned.length - 5} more` : ''}`,
            file: '', line: 0, code: 'orphaned-options',
            fix: 'Remove unused options or verify they are read dynamically',
        });
    }
    return issues;
}
function checkTransientCleanup(manifest) {
    const issues = [];
    const phpFiles = findPhpFiles(manifest.pluginPath);
    const setTransients = new Set();
    const deletedTransients = new Set();
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const setPattern = /set_transient\s*\(\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = setPattern.exec(content)) !== null) {
            setTransients.add(match[1]);
        }
        const deletePattern = /delete_transient\s*\(\s*['"]([^'"]+)['"]/g;
        while ((match = deletePattern.exec(content)) !== null) {
            deletedTransients.add(match[1]);
        }
    }
    const neverDeleted = [];
    for (const t of setTransients) {
        if (!deletedTransients.has(t)) {
            neverDeleted.push(t);
        }
    }
    if (neverDeleted.length > 0) {
        issues.push({
            id: generateTestId('database'), category: 'database', severity: 'low', type: 'warning',
            title: `${neverDeleted.length} transients never explicitly deleted`,
            message: `Transients set but never deleted: ${neverDeleted.slice(0, 5).join(', ')}${neverDeleted.length > 5 ? ` and ${neverDeleted.length - 5} more` : ''}. Ensure cleanup on deactivation/uninstall.`,
            file: '', line: 0, code: 'transient-no-cleanup',
            fix: 'Add delete_transient() calls in deactivation hook or uninstall.php',
        });
    }
    return issues;
}
function checkDbDeltaSchema(manifest) {
    const issues = [];
    if (manifest.features.dbTables.length === 0)
        return issues;
    const phpFiles = findPhpFiles(manifest.pluginPath);
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, manifest.pluginPath);
        if (!/dbDelta/.test(content))
            continue;
        const createMatches = content.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?['"]/gi);
        if (createMatches) {
            for (const cm of createMatches) {
                const idx = content.indexOf(cm);
                const context = content.substring(Math.max(0, idx - 100), idx + cm.length + 200);
                if (!/\$wpdb->prefix|\$table_prefix|\{?\$prefix\}?/.test(context)) {
                    issues.push({
                        id: generateTestId('database'), category: 'database', severity: 'high', type: 'error',
                        title: 'CREATE TABLE without $wpdb->prefix',
                        message: 'Custom tables must use $wpdb->prefix to support multisite and custom table prefixes',
                        file: rel, line: getLineNumber(content, idx), code: 'dbdelta-no-prefix',
                        fix: 'Use "$wpdb->prefix . \'your_table\'" for the table name',
                    });
                }
                const schemaEnd = content.indexOf(';', idx);
                const schema = content.substring(idx, schemaEnd > 0 ? schemaEnd : idx + 1000);
                if (!/PRIMARY\s+KEY/i.test(schema)) {
                    issues.push({
                        id: generateTestId('database'), category: 'database', severity: 'medium', type: 'warning',
                        title: 'CREATE TABLE without PRIMARY KEY',
                        message: 'Custom tables should have a PRIMARY KEY for proper indexing. dbDelta requires "PRIMARY KEY" on its own line.',
                        file: rel, line: getLineNumber(content, idx), code: 'dbdelta-no-primary-key',
                        fix: 'Add PRIMARY KEY definition to the table schema',
                    });
                }
                if (!/\$charset_collate|\$wpdb->get_charset_collate|CHARSET|COLLATE/i.test(schema)) {
                    issues.push({
                        id: generateTestId('database'), category: 'database', severity: 'medium', type: 'warning',
                        title: 'CREATE TABLE without charset/collation',
                        message: 'Custom tables should use $wpdb->get_charset_collate() to match WordPress defaults',
                        file: rel, line: getLineNumber(content, idx), code: 'dbdelta-no-charset',
                        fix: 'Append $wpdb->get_charset_collate() to the CREATE TABLE statement',
                    });
                }
            }
        }
        if (/dbDelta\s*\(/.test(content) && !/require.*upgrade\.php/.test(content)) {
            const idx = content.indexOf('dbDelta');
            issues.push({
                id: generateTestId('database'), category: 'database', severity: 'medium', type: 'warning',
                title: 'dbDelta called without including upgrade.php',
                message: 'dbDelta() requires wp-admin/includes/upgrade.php to be loaded first',
                file: rel, line: getLineNumber(content, idx), code: 'dbdelta-no-upgrade-include',
                fix: "Add: require_once ABSPATH . 'wp-admin/includes/upgrade.php';",
            });
        }
    }
    return issues;
}
function checkCharsetCollation(manifest) {
    const issues = [];
    if (manifest.features.dbTables.length === 0)
        return issues;
    const phpFiles = findPhpFiles(manifest.pluginPath);
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, manifest.pluginPath);
        const hardcodedCharset = /(?:DEFAULT\s+)?CHARSET\s*=\s*(?:utf8mb4|utf8|latin1)/gi;
        let match;
        while ((match = hardcodedCharset.exec(content)) !== null) {
            const context = content.substring(Math.max(0, match.index - 200), match.index + match[0].length);
            if (!/get_charset_collate/.test(context)) {
                issues.push({
                    id: generateTestId('database'), category: 'database', severity: 'low', type: 'info',
                    title: 'Hardcoded charset in table schema',
                    message: `Found hardcoded "${match[0]}" instead of $wpdb->get_charset_collate()`,
                    file: rel, line: getLineNumber(content, match.index), code: 'hardcoded-charset',
                    fix: 'Replace with $wpdb->get_charset_collate() for compatibility across environments',
                });
            }
        }
    }
    return issues;
}
//# sourceMappingURL=db-checker.js.map
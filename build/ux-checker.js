/**
 * WP Plugin QA MCP Server - UX / Customer Experience Checker
 * Setting descriptions, error messages, empty states, onboarding.
 * Note: Pure static analysis, no shell commands used.
 */
import { readFileSync } from 'fs';
import { findPhpFiles, getLineNumber, relativePath, generateTestId } from './shared-utils.js';
export function checkUx(pluginPath) {
    const startTime = Date.now();
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    const fileContents = new Map();
    for (const file of phpFiles) {
        try {
            fileContents.set(file, readFileSync(file, 'utf-8'));
        }
        catch { /* skip */ }
    }
    issues.push(...checkSettingDescriptions(phpFiles, fileContents, pluginPath));
    issues.push(...checkErrorMessageQuality(phpFiles, fileContents, pluginPath));
    issues.push(...checkEmptyStates(phpFiles, fileContents, pluginPath));
    issues.push(...checkAdminNotices(phpFiles, fileContents, pluginPath));
    issues.push(...checkSuccessFeedback(phpFiles, fileContents, pluginPath));
    return {
        category: 'ux',
        issues,
        passed: Math.max(0, 5 - issues.filter(i => i.type === 'error').length),
        failed: issues.filter(i => i.type === 'error').length,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
function checkSettingDescriptions(phpFiles, contents, pluginPath) {
    const issues = [];
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        const settingsFieldPattern = /add_settings_field\s*\(/g;
        let match;
        while ((match = settingsFieldPattern.exec(content)) !== null) {
            const contextEnd = Math.min(match.index + 1000, content.length);
            const context = content.substring(match.index, contextEnd);
            if (!/description|desc|help|info/.test(context)) {
                issues.push({
                    id: generateTestId('ux'), category: 'ux', severity: 'medium', type: 'warning',
                    title: 'Setting field without description',
                    message: 'add_settings_field call appears to lack a description/help text parameter',
                    file: rel, line: getLineNumber(content, match.index), code: 'missing-setting-description',
                    fix: 'Add a description parameter to help users understand the setting',
                });
            }
        }
    }
    return issues;
}
function checkErrorMessageQuality(phpFiles, contents, pluginPath) {
    const issues = [];
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        // Raw exception messages exposed to users
        const rawExceptionPattern = /(?:wp_die|die)\s*\(\s*\$(?:e|error|exception)->getMessage\(\)/g;
        let match;
        while ((match = rawExceptionPattern.exec(content)) !== null) {
            issues.push({
                id: generateTestId('ux'), category: 'ux', severity: 'high', type: 'warning',
                title: 'Raw exception message exposed to users',
                message: 'Exception getMessage() passed directly to wp_die/die. Users see PHP jargon.',
                file: rel, line: getLineNumber(content, match.index), code: 'technical-error-message',
                fix: 'Use user-friendly language. Log technical details instead of displaying them.',
            });
        }
        // PHP jargon in error messages
        const jargonPattern = /(?:wp_die|die|echo|_e)\s*\(\s*['"](?:.*(?:Fatal|Exception|Stack trace|Undefined|NULL|Array to string).*)['"]/gi;
        while ((match = jargonPattern.exec(content)) !== null) {
            issues.push({
                id: generateTestId('ux'), category: 'ux', severity: 'high', type: 'warning',
                title: 'Technical jargon in user-facing message',
                message: 'Error message contains PHP/developer jargon visible to users',
                file: rel, line: getLineNumber(content, match.index), code: 'jargon-error-message',
                fix: 'Rewrite in user-friendly language. Log technical details separately.',
            });
        }
    }
    return issues;
}
function checkEmptyStates(phpFiles, contents, _pluginPath) {
    const issues = [];
    let hasListPages = false;
    let hasEmptyCheck = false;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        if (/WP_List_Table|wp_list_table|<table|foreach.*\$items|foreach.*\$posts/.test(content)) {
            hasListPages = true;
        }
        if (/empty\s*\(.*\$|count\s*\(.*\)\s*===?\s*0|no.*found|nothing.*found|no.*yet/i.test(content)) {
            hasEmptyCheck = true;
        }
    }
    if (hasListPages && !hasEmptyCheck) {
        issues.push({
            id: generateTestId('ux'), category: 'ux', severity: 'high', type: 'warning',
            title: 'No empty state handling detected',
            message: 'Plugin has list/table views but no empty state messages when there is no data',
            file: '', line: 0, code: 'missing-empty-state',
            fix: 'Show a helpful message with a CTA when there are no items to display',
        });
    }
    return issues;
}
function checkAdminNotices(phpFiles, contents, pluginPath) {
    const issues = [];
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        const noticePattern = /class\s*=\s*['"][^'"]*(?:notice-error|notice-warning|notice-success|notice-info)[^'"]*['"]/g;
        let match;
        while ((match = noticePattern.exec(content)) !== null) {
            const context = content.substring(Math.max(0, match.index - 100), match.index + match[0].length + 100);
            if (!context.includes('is-dismissible')) {
                issues.push({
                    id: generateTestId('ux'), category: 'ux', severity: 'low', type: 'info',
                    title: 'Admin notice may not be dismissible',
                    message: 'Admin notice found without "is-dismissible" class. Consider making it dismissible.',
                    file: rel, line: getLineNumber(content, match.index), code: 'non-dismissible-notice',
                });
                break;
            }
        }
    }
    return issues;
}
function checkSuccessFeedback(phpFiles, contents, _pluginPath) {
    const issues = [];
    let hasFormSubmission = false;
    let hasSuccessFeedback = false;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        if (/\$_POST|admin_post_|settings_updated|options\.php/.test(content))
            hasFormSubmission = true;
        if (/updated|success|saved|notice-success|settings_updated/.test(content))
            hasSuccessFeedback = true;
    }
    if (hasFormSubmission && !hasSuccessFeedback) {
        issues.push({
            id: generateTestId('ux'), category: 'ux', severity: 'medium', type: 'warning',
            title: 'No success feedback after form submission',
            message: 'Plugin processes form submissions but may not show success confirmation to users',
            file: '', line: 0, code: 'missing-success-feedback',
            fix: 'Add admin notices or redirect with updated=true after successful form submission',
        });
    }
    return issues;
}
//# sourceMappingURL=ux-checker.js.map
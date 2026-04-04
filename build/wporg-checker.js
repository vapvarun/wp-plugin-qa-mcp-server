/**
 * WP Plugin QA MCP Server - WordPress.org Submission Readiness Checker
 * Checks all common reasons plugins get rejected from the WordPress.org review queue.
 * Based on the Plugin Review Team's documented guidelines and 59,137 issues found in 2025.
 */
import { existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { generateTestId, findPhpFiles, relativePath, safeReadFile, detectPluginSlug } from './shared-utils.js';
// Libraries bundled with WordPress core that should NOT be included in plugins
const BUNDLED_CORE_LIBRARIES = [
    'jquery', 'jquery-ui', 'backbone', 'underscore', 'lodash',
    'moment', 'react', 'react-dom', 'wp-polyfill',
    'phpmailer', 'simplepie', 'requests', 'sodium_compat',
    'pclzip', 'phpass', 'snoopy', 'gettext', 'pomo',
];
// Dev files/dirs that should NOT be in the distributed plugin
const DEV_FILES_PATTERNS = [
    'node_modules', '.git', '.svn', '.hg', '.github', '.gitlab',
    'tests', 'test', 'spec', '.travis.yml', '.circleci',
    'Gruntfile.js', 'Gulpfile.js', 'webpack.config.js', 'rollup.config.js',
    'package-lock.json', 'yarn.lock', 'composer.lock',
    '.babelrc', '.eslintrc', '.prettierrc', '.stylelintrc',
    'phpunit.xml', 'phpunit.xml.dist', 'phpcs.xml', 'phpcs.xml.dist',
    '.env', '.env.local', '.env.example', '.editorconfig',
    'docker-compose.yml', 'Dockerfile', 'Makefile',
    'tsconfig.json', 'jest.config.js', 'vitest.config.ts',
    '.DS_Store', 'Thumbs.db',
];
export function checkWpOrgReady(pluginPath) {
    const startTime = Date.now();
    const issues = [];
    const slug = detectPluginSlug(pluginPath);
    const phpFiles = findPhpFiles(pluginPath);
    // 1. Check unique prefixing
    issues.push(...checkPrefixing(pluginPath, slug, phpFiles));
    // 2. Check ABSPATH guard on every PHP file
    issues.push(...checkAbspathGuards(pluginPath, phpFiles));
    // 3. Check readme.txt
    issues.push(...checkReadmeTxt(pluginPath, slug));
    // 4. Check for dev files
    issues.push(...checkDevFiles(pluginPath));
    // 5. Check for bundled core libraries
    issues.push(...checkBundledLibraries(pluginPath));
    // 6. Check license header
    issues.push(...checkLicense(pluginPath, phpFiles));
    // 7. Text domain consistency — handled by i18n-checker.ts (checkTextDomainConsistency)
    // 7. Check for external resource loading
    issues.push(...checkExternalResources(pluginPath, phpFiles));
    // 8. Check for custom update checkers
    issues.push(...checkCustomUpdateCheckers(pluginPath, phpFiles));
    // 9. Check plugin file matches slug
    issues.push(...checkPluginFileNaming(pluginPath, slug));
    // 10. Direct file access — merged into checkAbspathGuards above
    // 10. Check for obfuscated code
    issues.push(...checkObfuscatedCode(pluginPath, phpFiles));
    // Calculate confidence score
    const errors = issues.filter(i => i.type === 'error').length;
    const warnings = issues.filter(i => i.type === 'warning').length;
    const totalChecks = 10;
    const passedChecks = totalChecks - Math.min(totalChecks, errors);
    const deductions = errors * 10 + warnings * 3;
    const confidence = Math.max(0, Math.min(100, 100 - deductions));
    issues.push({
        id: generateTestId('wporg-ready'),
        category: 'wporg-ready',
        severity: confidence >= 80 ? 'low' : confidence >= 50 ? 'medium' : 'high',
        type: 'info',
        title: `WordPress.org Submission Confidence: ${confidence}%`,
        message: `Based on ${totalChecks} checks: ${errors} blocking issues, ${warnings} warnings. ${confidence >= 80 ? 'Likely to pass review.' : confidence >= 50 ? 'May need fixes before submission.' : 'Significant issues to fix before submission.'}`,
        file: '', line: 0, code: 'wporg-confidence-score',
    });
    return {
        category: 'wporg-ready',
        issues,
        passed: passedChecks,
        failed: errors,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
function checkPrefixing(pluginPath, slug, phpFiles) {
    const issues = [];
    const prefix = slug.replace(/-/g, '_');
    const prefixUpper = prefix.toUpperCase();
    const shortPrefix = prefix.split('_')[0];
    let unprefixedFunctions = 0;
    let unprefixedClasses = 0;
    let unprefixedConstants = 0;
    const samples = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Check function declarations
            const funcMatch = line.match(/^\s*function\s+([a-zA-Z_]\w*)\s*\(/);
            if (funcMatch) {
                const funcName = funcMatch[1];
                if (!funcName.startsWith(prefix) && !funcName.startsWith(shortPrefix) &&
                    !funcName.startsWith('__') && // PHP magic methods
                    !line.includes('class ') && // skip methods inside classes
                    !isInsideClass(content, content.indexOf(line))) {
                    unprefixedFunctions++;
                    if (samples.length < 5)
                        samples.push({ name: funcName, file: rel, line: i + 1 });
                }
            }
            // Check class declarations
            const classMatch = line.match(/^\s*(?:abstract\s+|final\s+)?class\s+([A-Z]\w*)/);
            if (classMatch) {
                const className = classMatch[1];
                const classLower = className.toLowerCase();
                if (!classLower.startsWith(prefix.replace(/_/g, '')) &&
                    !classLower.startsWith(shortPrefix) &&
                    !className.startsWith(prefixUpper.replace(/_/g, ''))) {
                    unprefixedClasses++;
                    if (samples.length < 5)
                        samples.push({ name: className, file: rel, line: i + 1 });
                }
            }
            // Check define() constants
            const defineMatch = line.match(/define\s*\(\s*['"]([A-Z_]+)['"]/);
            if (defineMatch) {
                const constName = defineMatch[1];
                if (!constName.startsWith(prefixUpper) && !constName.startsWith('ABSPATH') && !constName.startsWith('WP')) {
                    unprefixedConstants++;
                    if (samples.length < 5)
                        samples.push({ name: constName, file: rel, line: i + 1 });
                }
            }
        }
    }
    const total = unprefixedFunctions + unprefixedClasses + unprefixedConstants;
    if (total > 0) {
        let message = `Found ${total} unprefixed items: ${unprefixedFunctions} functions, ${unprefixedClasses} classes, ${unprefixedConstants} constants. Expected prefix: "${prefix}" or "${shortPrefix}".`;
        if (samples.length > 0) {
            message += ' Examples: ' + samples.map(s => `${s.name} (${s.file}:${s.line})`).join(', ');
        }
        issues.push({
            id: generateTestId('wporg-ready'),
            category: 'wporg-ready',
            severity: total > 10 ? 'critical' : 'high',
            type: 'error',
            title: `${total} unprefixed functions/classes/constants`,
            message,
            file: '', line: 0, code: 'missing-prefix',
            fix: `Prefix all functions with "${prefix}_", classes with "${prefix.charAt(0).toUpperCase() + prefix.slice(1)}_", constants with "${prefixUpper}_"`,
        });
    }
    return issues;
}
function isInsideClass(content, offset) {
    const before = content.substring(0, offset);
    const classCount = (before.match(/\bclass\s+\w/g) || []).length;
    const closingBraces = (before.match(/^}/gm) || []).length;
    return classCount > closingBraces;
}
function checkAbspathGuards(pluginPath, phpFiles) {
    const issues = [];
    let missingCount = 0;
    let inputProcessingCount = 0;
    const samples = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        // Skip uninstall.php (uses WP_UNINSTALL_PLUGIN instead)
        if (basename(file) === 'uninstall.php') {
            if (!content.includes('WP_UNINSTALL_PLUGIN')) {
                issues.push({
                    id: generateTestId('wporg-ready'),
                    category: 'wporg-ready',
                    severity: 'high', type: 'error',
                    title: 'uninstall.php missing WP_UNINSTALL_PLUGIN check',
                    message: 'uninstall.php should check defined("WP_UNINSTALL_PLUGIN") for security',
                    file: rel, line: 1, code: 'uninstall-no-guard',
                    fix: 'Add: if ( ! defined( "WP_UNINSTALL_PLUGIN" ) ) exit;',
                });
            }
            continue;
        }
        // Check for ABSPATH guard
        const hasAbspath = /defined\s*\(\s*['"]ABSPATH['"]\s*\)/.test(content) ||
            /defined\s*\(\s*['"]DOING_AJAX['"]\s*\)/.test(content) ||
            /ABSPATH/.test(content.split('\n').slice(0, 10).join('\n'));
        if (!hasAbspath) {
            missingCount++;
            // Escalate: files processing user input without guard are higher risk
            const processesInput = /\$_GET|\$_POST|\$_REQUEST|\$_FILES/.test(content);
            if (processesInput)
                inputProcessingCount++;
            if (samples.length < 5)
                samples.push(rel + (processesInput ? ' (processes input!)' : ''));
        }
    }
    if (missingCount > 0) {
        // Severity escalated if files process user input without guard
        const hasInputRisk = inputProcessingCount > 0;
        issues.push({
            id: generateTestId('wporg-ready'),
            category: 'wporg-ready',
            severity: hasInputRisk ? 'high' : (missingCount > 5 ? 'high' : 'medium'),
            type: hasInputRisk || missingCount > 5 ? 'error' : 'warning',
            title: `${missingCount} PHP files missing ABSPATH guard${inputProcessingCount > 0 ? ` (${inputProcessingCount} process user input)` : ''}`,
            message: `Files without "defined( 'ABSPATH' )" check: ${samples.join(', ')}${missingCount > 5 ? ` and ${missingCount - 5} more` : ''}`,
            file: '', line: 0, code: 'missing-abspath-guard',
            fix: 'Add to top of each PHP file: if ( ! defined( \'ABSPATH\' ) ) exit;',
        });
    }
    return issues;
}
function checkReadmeTxt(pluginPath, slug) {
    const issues = [];
    const readmePath = join(pluginPath, 'readme.txt');
    if (!existsSync(readmePath)) {
        issues.push({
            id: generateTestId('wporg-ready'),
            category: 'wporg-ready',
            severity: 'critical', type: 'error',
            title: 'Missing readme.txt',
            message: 'WordPress.org requires readme.txt in the plugin root. README.md alone is not sufficient.',
            file: '', line: 0, code: 'missing-readme-txt',
            fix: 'Create readme.txt following https://developer.wordpress.org/plugins/wordpress-org/how-your-readme-txt-works/',
        });
        return issues;
    }
    const content = safeReadFile(readmePath);
    // Check required headers
    const requiredHeaders = [
        { name: 'Contributors', pattern: /^=== .+ ===/m },
        { name: 'Tested up to', pattern: /Tested up to:\s*\S+/i },
        { name: 'Stable tag', pattern: /Stable tag:\s*\S+/i },
        { name: 'Requires at least', pattern: /Requires at least:\s*\S+/i },
        { name: 'License', pattern: /License:\s*\S+/i },
    ];
    for (const header of requiredHeaders) {
        if (!header.pattern.test(content)) {
            issues.push({
                id: generateTestId('wporg-ready'),
                category: 'wporg-ready',
                severity: 'high', type: 'error',
                title: `readme.txt missing "${header.name}" header`,
                message: `The "${header.name}" field is required in readme.txt`,
                file: 'readme.txt', line: 0, code: `readme-missing-${header.name.toLowerCase().replace(/\s/g, '-')}`,
            });
        }
    }
    // Check required sections
    const requiredSections = ['== Description ==', '== Changelog =='];
    for (const section of requiredSections) {
        if (!content.includes(section)) {
            issues.push({
                id: generateTestId('wporg-ready'),
                category: 'wporg-ready',
                severity: 'medium', type: 'warning',
                title: `readme.txt missing "${section}" section`,
                message: `Section "${section}" is recommended for WordPress.org`,
                file: 'readme.txt', line: 0, code: 'readme-missing-section',
            });
        }
    }
    // Check Tested up to version isn't outdated
    const testedMatch = content.match(/Tested up to:\s*(\d+\.\d+)/i);
    if (testedMatch) {
        const testedVersion = parseFloat(testedMatch[1]);
        if (testedVersion < 6.5) {
            issues.push({
                id: generateTestId('wporg-ready'),
                category: 'wporg-ready',
                severity: 'medium', type: 'warning',
                title: 'readme.txt "Tested up to" version is outdated',
                message: `Tested up to ${testedMatch[1]} — current WordPress is 6.8. Update to at least 6.7`,
                file: 'readme.txt', line: 0, code: 'readme-outdated-tested',
                fix: 'Update "Tested up to" to current WordPress version',
            });
        }
    }
    // Check Stable tag isn't "trunk"
    const stableMatch = content.match(/Stable tag:\s*(\S+)/i);
    if (stableMatch && stableMatch[1].toLowerCase() === 'trunk') {
        issues.push({
            id: generateTestId('wporg-ready'),
            category: 'wporg-ready',
            severity: 'high', type: 'error',
            title: 'readme.txt Stable tag is "trunk"',
            message: 'Stable tag should be a version number, not "trunk". WordPress.org no longer supports trunk deployments.',
            file: 'readme.txt', line: 0, code: 'readme-trunk-stable-tag',
            fix: 'Set Stable tag to your plugin version number',
        });
    }
    return issues;
}
function checkDevFiles(pluginPath) {
    const issues = [];
    const found = [];
    try {
        const items = readdirSync(pluginPath, { withFileTypes: true });
        for (const item of items) {
            if (DEV_FILES_PATTERNS.includes(item.name)) {
                found.push(item.name);
            }
        }
    }
    catch { /* skip */ }
    if (found.length > 0) {
        issues.push({
            id: generateTestId('wporg-ready'),
            category: 'wporg-ready',
            severity: found.includes('node_modules') || found.includes('.git') ? 'high' : 'medium',
            type: found.includes('node_modules') || found.includes('.env') ? 'error' : 'warning',
            title: `${found.length} dev files/directories found`,
            message: `Remove before submission: ${found.join(', ')}`,
            file: '', line: 0, code: 'dev-files-present',
            fix: 'Add a build/release script that strips dev files, or use .distignore',
        });
    }
    return issues;
}
function checkBundledLibraries(pluginPath) {
    const issues = [];
    const foundLibs = [];
    try {
        const items = readdirSync(pluginPath, { withFileTypes: true });
        for (const item of items) {
            if (item.isDirectory()) {
                const dirLower = item.name.toLowerCase();
                for (const lib of BUNDLED_CORE_LIBRARIES) {
                    if (dirLower === lib || dirLower === lib.replace(/-/g, '')) {
                        foundLibs.push(item.name);
                    }
                }
                // Check inside common vendor dirs
                if (['assets', 'lib', 'libs', 'includes', 'vendor'].includes(dirLower)) {
                    try {
                        const subItems = readdirSync(join(pluginPath, item.name));
                        for (const sub of subItems) {
                            const subLower = sub.toLowerCase();
                            for (const lib of BUNDLED_CORE_LIBRARIES) {
                                if (subLower === lib || subLower === `${lib}.js` || subLower === `${lib}.min.js`) {
                                    foundLibs.push(`${item.name}/${sub}`);
                                }
                            }
                        }
                    }
                    catch { /* skip */ }
                }
            }
        }
    }
    catch { /* skip */ }
    // Also check PHP files for PHPMailer, SimplePie, etc.
    const phpFiles = findPhpFiles(pluginPath);
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (/class\s+PHPMailer\b/.test(content) && !file.includes('vendor')) {
            foundLibs.push(relativePath(file, pluginPath) + ' (PHPMailer)');
        }
        if (/class\s+SimplePie\b/.test(content) && !file.includes('vendor')) {
            foundLibs.push(relativePath(file, pluginPath) + ' (SimplePie)');
        }
    }
    if (foundLibs.length > 0) {
        issues.push({
            id: generateTestId('wporg-ready'),
            category: 'wporg-ready',
            severity: 'high', type: 'error',
            title: `${foundLibs.length} bundled core libraries detected`,
            message: `WordPress bundles these — use wp_enqueue_script() instead: ${foundLibs.join(', ')}`,
            file: '', line: 0, code: 'bundled-core-library',
            fix: 'Remove bundled copies and use WordPress\' built-in versions via wp_enqueue_script()',
        });
    }
    return issues;
}
function checkLicense(pluginPath, phpFiles) {
    const issues = [];
    // Check for LICENSE file
    const licenseFiles = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license.txt'];
    const hasLicenseFile = licenseFiles.some(f => existsSync(join(pluginPath, f)));
    // Check main plugin file header for License
    let hasLicenseHeader = false;
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (/Plugin Name:/i.test(content)) {
            if (/License:\s*GPL/i.test(content) || /License URI:.*gnu\.org/i.test(content)) {
                hasLicenseHeader = true;
            }
            break;
        }
    }
    if (!hasLicenseFile && !hasLicenseHeader) {
        issues.push({
            id: generateTestId('wporg-ready'),
            category: 'wporg-ready',
            severity: 'high', type: 'error',
            title: 'No GPL-compatible license found',
            message: 'WordPress.org requires GPL-2.0-or-later. No LICENSE file and no License header in plugin file.',
            file: '', line: 0, code: 'missing-license',
            fix: 'Add "License: GPL-2.0-or-later" to plugin header and include a LICENSE file',
        });
    }
    return issues;
}
// REMOVED: checkTextDomainConsistency — now in i18n-checker.ts (avoids duplicate check)
function checkExternalResources(pluginPath, phpFiles) {
    const issues = [];
    const externalUrls = [];
    // Allowed domains (WordPress CDN, plugin's own domain, common CDNs with disclosure)
    const allowedDomains = ['wordpress.org', 'w.org', 's.w.org', 'gravatar.com'];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            // Match external URL loading
            const urlPattern = /(?:wp_enqueue_script|wp_enqueue_style|wp_register_script|wp_register_style)\s*\([^,]+,\s*['"](https?:\/\/[^'"]+)['"]/g;
            let match;
            while ((match = urlPattern.exec(lines[i])) !== null) {
                const url = match[1];
                const isAllowed = allowedDomains.some(d => url.includes(d));
                if (!isAllowed) {
                    externalUrls.push({ url, file: rel, line: i + 1 });
                }
            }
            // Check for Google Fonts, CDN scripts loaded externally
            if (/(?:fonts\.googleapis|cdn\.jsdelivr|cdnjs\.cloudflare|unpkg\.com|ajax\.googleapis)/i.test(lines[i])) {
                const cdnMatch = lines[i].match(/(https?:\/\/[^\s'"]+)/);
                if (cdnMatch) {
                    externalUrls.push({ url: cdnMatch[1], file: rel, line: i + 1 });
                }
            }
        }
    }
    if (externalUrls.length > 0) {
        issues.push({
            id: generateTestId('wporg-ready'),
            category: 'wporg-ready',
            severity: 'medium', type: 'warning',
            title: `${externalUrls.length} external resource loads detected`,
            message: `External resources must be disclosed. Found: ${externalUrls.slice(0, 3).map(u => u.url).join(', ')}${externalUrls.length > 3 ? ` and ${externalUrls.length - 3} more` : ''}`,
            file: externalUrls[0]?.file || '', line: externalUrls[0]?.line || 0,
            code: 'external-resource-loading',
            fix: 'Disclose all external services in readme.txt description, or bundle assets locally',
        });
    }
    return issues;
}
function checkCustomUpdateCheckers(pluginPath, phpFiles) {
    const issues = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            // Check for custom update mechanisms
            if (/(?:pre_set_site_transient_update_plugins|site_transient_update_plugins|plugins_api)/.test(lines[i]) &&
                /add_filter/.test(lines[i])) {
                issues.push({
                    id: generateTestId('wporg-ready'),
                    category: 'wporg-ready',
                    severity: 'critical', type: 'error',
                    title: 'Custom update checker detected',
                    message: 'WordPress.org plugins must NOT include custom update checkers — all updates must go through WordPress.org',
                    file: rel, line: i + 1, code: 'custom-update-checker',
                    fix: 'Remove custom update checker code. WordPress.org handles all plugin updates.',
                });
                break;
            }
            // Check for common third-party update libraries
            if (/plugin-update-checker|YahnisElsts|Jeremyclark13|wp-update-server/i.test(lines[i])) {
                issues.push({
                    id: generateTestId('wporg-ready'),
                    category: 'wporg-ready',
                    severity: 'critical', type: 'error',
                    title: 'Third-party update library detected',
                    message: `Found reference to third-party update library in ${rel}:${i + 1}`,
                    file: rel, line: i + 1, code: 'third-party-updater',
                    fix: 'Remove third-party update library. WordPress.org handles all updates.',
                });
                break;
            }
        }
    }
    return issues;
}
function checkPluginFileNaming(pluginPath, slug) {
    const issues = [];
    // Check main plugin file matches directory name
    const expectedFile = `${slug}.php`;
    if (!existsSync(join(pluginPath, expectedFile))) {
        // Look for any file with "Plugin Name:" header
        const phpFiles = findPhpFiles(pluginPath).filter(f => {
            const dir = f.substring(pluginPath.length + 1);
            return !dir.includes('/'); // Only root-level files
        });
        let mainFile = '';
        for (const file of phpFiles) {
            const content = safeReadFile(file);
            if (/Plugin Name:/i.test(content)) {
                mainFile = basename(file);
                break;
            }
        }
        if (mainFile && mainFile !== expectedFile) {
            issues.push({
                id: generateTestId('wporg-ready'),
                category: 'wporg-ready',
                severity: 'medium', type: 'warning',
                title: 'Main plugin file name doesn\'t match slug',
                message: `Directory is "${slug}" but main plugin file is "${mainFile}". WordPress.org expects "${expectedFile}"`,
                file: mainFile, line: 0, code: 'plugin-file-mismatch',
                fix: `Rename "${mainFile}" to "${expectedFile}" or rename the directory`,
            });
        }
    }
    return issues;
}
// REMOVED: checkDirectFileAccess — merged into checkAbspathGuards (severity escalated for input-processing files)
function checkObfuscatedCode(pluginPath, phpFiles) {
    const issues = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        // Check for common obfuscation patterns
        if (/eval\s*\(\s*(?:base64_decode|gzinflate|gzuncompress|str_rot13|gzdecode)\s*\(/.test(content)) {
            issues.push({
                id: generateTestId('wporg-ready'),
                category: 'wporg-ready',
                severity: 'critical', type: 'error',
                title: 'Obfuscated code detected',
                message: `Found eval() with encoding functions in ${rel}. WordPress.org prohibits obfuscated code.`,
                file: rel, line: 0, code: 'obfuscated-code',
                fix: 'Remove all obfuscated code. WordPress.org requires 100% human-readable code.',
            });
        }
        // Check for encoded strings
        if (/\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}/.test(content)) {
            issues.push({
                id: generateTestId('wporg-ready'),
                category: 'wporg-ready',
                severity: 'high', type: 'warning',
                title: 'Hex-encoded strings detected',
                message: `Found hex-encoded strings in ${rel}. This may be flagged during review.`,
                file: rel, line: 0, code: 'hex-encoded-strings',
            });
        }
    }
    return issues;
}
//# sourceMappingURL=wporg-checker.js.map
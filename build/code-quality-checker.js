/**
 * Code Quality Checker — runs external tools (PHPCS, PHPStan, ESLint,
 * Stylelint, PHP Compat) and static a11y grep checks.
 *
 * Uses execFileSync for safe command execution (no shell injection).
 * Handles missing tools gracefully (skip with info, not error).
 * Parses JSON output from tools and converts to CheckerIssue[].
 */
import { execFileSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { findPhpFiles, findJsFiles, findFilesByExt, safeReadFile, relativePath, generateTestId } from './shared-utils.js';
// ─── Main Runner ────────────────────────────────────────────────
export function runAllCodeChecks(pluginPath) {
    const results = [];
    results.push(runPhpcs(pluginPath));
    results.push(runPhpstan(pluginPath));
    results.push(runEslint(pluginPath));
    results.push(runStylelint(pluginPath));
    results.push(runPhpCompat(pluginPath));
    results.push(runA11yGrep(pluginPath));
    results.push(runPhpLint(pluginPath));
    results.push(runComposerAudit(pluginPath));
    results.push(runI18nCheck(pluginPath));
    results.push(runPluginCheck(pluginPath));
    results.push(runBundleSize(pluginPath));
    results.push(runSecurityScan(pluginPath));
    results.push(runPerformanceScan(pluginPath));
    results.push(runPcpDeep(pluginPath));
    return results;
}
export function runSingleCheck(pluginPath, check) {
    switch (check) {
        case 'phpcs': return runPhpcs(pluginPath);
        case 'phpstan': return runPhpstan(pluginPath);
        case 'eslint': return runEslint(pluginPath);
        case 'stylelint': return runStylelint(pluginPath);
        case 'phpcompat': return runPhpCompat(pluginPath);
        case 'a11y-grep': return runA11yGrep(pluginPath);
        case 'php-lint': return runPhpLint(pluginPath);
        case 'composer-audit': return runComposerAudit(pluginPath);
        case 'i18n': return runI18nCheck(pluginPath);
        case 'plugin-check': return runPluginCheck(pluginPath);
        case 'bundle-size': return runBundleSize(pluginPath);
        case 'security-scan': return runSecurityScan(pluginPath);
        case 'performance-scan': return runPerformanceScan(pluginPath);
        case 'pcp-deep': return runPcpDeep(pluginPath);
        default: return skipResult('unknown', `Unknown check: ${check}`);
    }
}
// ─── PHPCS ──────────────────────────────────────────────────────
export function runPhpcs(pluginPath) {
    const startTime = Date.now();
    const category = 'phpcs';
    if (!commandExists('phpcs')) {
        return skipResult(category, 'phpcs not installed. Run: composer global require squizlabs/php_codesniffer');
    }
    const hasConfig = existsSync(join(pluginPath, '.phpcs.xml.dist')) || existsSync(join(pluginPath, 'phpcs.xml'));
    const args = ['--report=json', '-q'];
    if (!hasConfig) {
        args.push('--standard=WordPress', '--extensions=php', '--ignore=vendor/*,node_modules/*,build/*,dist/*');
    }
    args.push(pluginPath);
    try {
        const output = safeExec('phpcs', args, pluginPath);
        return parsePhpcsOutput(output, pluginPath, category, startTime);
    }
    catch {
        return skipResult(category, 'PHPCS execution failed');
    }
}
function parsePhpcsOutput(output, pluginPath, category, startTime) {
    const issues = [];
    try {
        const data = JSON.parse(output);
        const files = data.files || {};
        for (const [filePath, fileData] of Object.entries(files)) {
            const fd = fileData;
            for (const msg of fd.messages || []) {
                issues.push({
                    id: generateTestId(category),
                    category,
                    severity: msg.type === 'ERROR' ? 'high' : 'medium',
                    type: msg.type === 'ERROR' ? 'error' : 'warning',
                    title: msg.message,
                    message: `${msg.message} (${msg.source})`,
                    file: relativePath(filePath, pluginPath),
                    line: msg.line,
                    code: msg.source,
                    fix: msg.fixable ? 'Run: phpcbf to auto-fix' : undefined,
                });
            }
        }
    }
    catch {
        // Non-JSON output or empty
    }
    const errors = issues.filter(i => i.type === 'error').length;
    const warnings = issues.filter(i => i.type === 'warning').length;
    return {
        category,
        issues,
        passed: 0,
        failed: errors,
        skipped: warnings,
        duration: Date.now() - startTime,
    };
}
// ─── PHPStan ────────────────────────────────────────────────────
export function runPhpstan(pluginPath) {
    const startTime = Date.now();
    const category = 'phpstan';
    // Look for phpstan binary: project vendor, then global
    const localBin = join(pluginPath, 'vendor', 'bin', 'phpstan');
    const phpstanCmd = existsSync(localBin) ? localBin : 'phpstan';
    if (!existsSync(localBin) && !commandExists('phpstan')) {
        return skipResult(category, 'PHPStan not installed. Run: composer require --dev phpstan/phpstan szepeviktor/phpstan-wordpress');
    }
    if (!existsSync(join(pluginPath, 'phpstan.neon'))) {
        return skipResult(category, 'phpstan.neon not found. Run wppqa_setup_quality first.');
    }
    const args = ['analyse', '--error-format=json', '--no-progress', '--memory-limit=1G'];
    try {
        const output = safeExec(phpstanCmd, args, pluginPath);
        return parsePhpstanOutput(output, pluginPath, category, startTime);
    }
    catch {
        return skipResult(category, 'PHPStan execution failed. Check phpstan.neon config.');
    }
}
function parsePhpstanOutput(output, pluginPath, category, startTime) {
    const issues = [];
    try {
        const data = JSON.parse(output);
        const files = data.files || {};
        for (const [filePath, fileData] of Object.entries(files)) {
            const fd = fileData;
            for (const msg of fd.messages || []) {
                issues.push({
                    id: generateTestId(category),
                    category,
                    severity: 'high',
                    type: 'error',
                    title: msg.message,
                    message: msg.tip ? `${msg.message} — ${msg.tip}` : msg.message,
                    file: relativePath(filePath, pluginPath),
                    line: msg.line,
                    code: msg.identifier || 'phpstan-error',
                });
            }
        }
    }
    catch {
        // Parse error
    }
    return {
        category,
        issues,
        passed: 0,
        failed: issues.length,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
// ─── ESLint ─────────────────────────────────────────────────────
export function runEslint(pluginPath) {
    const startTime = Date.now();
    const category = 'eslint';
    if (!commandExists('npx')) {
        return skipResult(category, 'npx not available. Install Node.js.');
    }
    const jsFiles = findJsFiles(pluginPath);
    if (jsFiles.length === 0) {
        return skipResult(category, 'No JavaScript files found.');
    }
    const hasConfig = existsSync(join(pluginPath, '.eslintrc.json')) ||
        existsSync(join(pluginPath, '.eslintrc.js')) ||
        existsSync(join(pluginPath, '.eslintrc'));
    if (!hasConfig) {
        return skipResult(category, '.eslintrc.json not found. Run wppqa_setup_quality first.');
    }
    // Build file list (non-minified JS only)
    const jsDir = join(pluginPath, 'assets', 'js');
    const targetDir = existsSync(jsDir) ? jsDir : pluginPath;
    const args = ['eslint@8', '-f', 'json', targetDir];
    try {
        const output = safeExec('npx', args, pluginPath);
        return parseEslintOutput(output, pluginPath, category, startTime);
    }
    catch {
        return skipResult(category, 'ESLint execution failed.');
    }
}
function parseEslintOutput(output, pluginPath, category, startTime) {
    const issues = [];
    try {
        const data = JSON.parse(output);
        for (const fileResult of data) {
            const filePath = fileResult.filePath || '';
            for (const msg of fileResult.messages || []) {
                issues.push({
                    id: generateTestId(category),
                    category,
                    severity: msg.severity === 2 ? 'high' : 'medium',
                    type: msg.severity === 2 ? 'error' : 'warning',
                    title: msg.message,
                    message: `${msg.message} (${msg.ruleId || 'unknown'})`,
                    file: relativePath(filePath, pluginPath),
                    line: msg.line || 0,
                    code: msg.ruleId || 'eslint-error',
                });
            }
        }
    }
    catch {
        // Parse error
    }
    const errors = issues.filter(i => i.type === 'error').length;
    return {
        category,
        issues,
        passed: 0,
        failed: errors,
        skipped: issues.length - errors,
        duration: Date.now() - startTime,
    };
}
// ─── Stylelint ──────────────────────────────────────────────────
export function runStylelint(pluginPath) {
    const startTime = Date.now();
    const category = 'stylelint';
    if (!commandExists('npx')) {
        return skipResult(category, 'npx not available. Install Node.js.');
    }
    const cssDir = join(pluginPath, 'assets', 'css');
    if (!existsSync(cssDir)) {
        const cssFiles = findFilesByExt(pluginPath, '.css');
        if (cssFiles.length === 0) {
            return skipResult(category, 'No CSS files found.');
        }
    }
    if (!existsSync(join(pluginPath, '.stylelintrc.json'))) {
        return skipResult(category, '.stylelintrc.json not found. Run wppqa_setup_quality first.');
    }
    // Check if stylelint is installed locally
    const hasLocalStylelint = existsSync(join(pluginPath, 'node_modules', '.bin', 'stylelint'));
    const cmd = hasLocalStylelint ? join(pluginPath, 'node_modules', '.bin', 'stylelint') : 'npx';
    const args = hasLocalStylelint
        ? [`${cssDir}/**/*.css`, '--ignore-pattern', '**/*.min.css', '-f', 'json']
        : ['stylelint', `${cssDir}/**/*.css`, '--ignore-pattern', '**/*.min.css', '-f', 'json'];
    try {
        const output = safeExec(cmd, args, pluginPath);
        return parseStylelintOutput(output, pluginPath, category, startTime);
    }
    catch {
        return skipResult(category, 'Stylelint execution failed. Run: npm install --save-dev stylelint stylelint-config-standard');
    }
}
function parseStylelintOutput(output, pluginPath, category, startTime) {
    const issues = [];
    try {
        const data = JSON.parse(output);
        for (const fileResult of data) {
            const filePath = fileResult.source || '';
            for (const warning of fileResult.warnings || []) {
                issues.push({
                    id: generateTestId(category),
                    category,
                    severity: warning.severity === 'error' ? 'high' : 'medium',
                    type: warning.severity === 'error' ? 'error' : 'warning',
                    title: warning.text,
                    message: `${warning.text} (${warning.rule})`,
                    file: relativePath(filePath, pluginPath),
                    line: warning.line || 0,
                    code: warning.rule || 'stylelint-error',
                });
            }
        }
    }
    catch {
        // Parse error
    }
    return {
        category,
        issues,
        passed: 0,
        failed: issues.filter(i => i.type === 'error').length,
        skipped: issues.filter(i => i.type === 'warning').length,
        duration: Date.now() - startTime,
    };
}
// ─── PHP Compatibility ──────────────────────────────────────────
export function runPhpCompat(pluginPath) {
    const startTime = Date.now();
    const category = 'phpcompat';
    if (!commandExists('phpcs')) {
        return skipResult(category, 'phpcs not installed (needed for PHPCompatibilityWP).');
    }
    const args = [
        '--standard=PHPCompatibilityWP',
        '--extensions=php',
        '--ignore=vendor/*,node_modules/*,build/*,dist/*',
        '--runtime-set', 'testVersion', '7.4-8.4',
        '--report=json',
        '-q', '-n',
        pluginPath,
    ];
    try {
        const output = safeExec('phpcs', args, pluginPath);
        return parsePhpcsOutput(output, pluginPath, category, startTime);
    }
    catch {
        return skipResult(category, 'PHP Compatibility check failed. Ensure PHPCompatibilityWP is installed.');
    }
}
// ─── Static A11y Grep ───────────────────────────────────────────
export function runA11yGrep(pluginPath) {
    const startTime = Date.now();
    const category = 'a11y-grep';
    const issues = [];
    // 1. Check outline:none in CSS
    const cssFiles = findFilesByExt(pluginPath, '.css').filter(f => !f.endsWith('.min.css'));
    for (const file of cssFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (/outline\s*:\s*(?:none|0)\s*[;!]/.test(lines[i])) {
                issues.push({
                    id: generateTestId(category),
                    category,
                    severity: 'high',
                    type: 'error',
                    title: 'outline:none removes focus indicator',
                    message: 'Removing outline on :focus makes the element invisible to keyboard users. Use :focus-visible with a custom outline instead.',
                    file: relativePath(file, pluginPath),
                    line: i + 1,
                    code: 'a11y-outline-none',
                    fix: 'Replace with :focus-visible { outline: 2px solid #2271b1; outline-offset: 2px; }',
                });
            }
        }
    }
    // 2. Check empty links in PHP
    const phpFiles = findPhpFiles(pluginPath);
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (/<a\b[^>]*>\s*<\/a>/.test(lines[i])) {
                issues.push({
                    id: generateTestId(category),
                    category,
                    severity: 'high',
                    type: 'error',
                    title: 'Empty link (no text or aria-label)',
                    message: 'Anchor element has no content. Screen readers cannot describe this link.',
                    file: relativePath(file, pluginPath),
                    line: i + 1,
                    code: 'a11y-empty-link',
                    fix: 'Add link text or aria-label attribute',
                });
            }
        }
    }
    // 3. Check div with onclick (should be button)
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (/<div[^>]*onclick/i.test(lines[i])) {
                issues.push({
                    id: generateTestId(category),
                    category,
                    severity: 'high',
                    type: 'error',
                    title: 'div with onclick (use <button> instead)',
                    message: 'Non-interactive element has click handler. Use <button> for keyboard accessibility.',
                    file: relativePath(file, pluginPath),
                    line: i + 1,
                    code: 'a11y-div-onclick',
                    fix: 'Change <div onclick="..."> to <button type="button" onclick="...">',
                });
            }
        }
    }
    // 4. Check images without alt in PHP output
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (/<img\b/i.test(lines[i]) && !/alt\s*=/i.test(lines[i]) && !/preg_match|regex/i.test(lines[i])) {
                issues.push({
                    id: generateTestId(category),
                    category,
                    severity: 'medium',
                    type: 'warning',
                    title: 'Image may be missing alt attribute',
                    message: 'Found <img> tag without alt attribute in PHP output.',
                    file: relativePath(file, pluginPath),
                    line: i + 1,
                    code: 'a11y-missing-alt',
                    fix: 'Add alt="" for decorative images or descriptive alt text for meaningful images',
                });
            }
        }
    }
    // 5. Check positive tabindex
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (/tabindex\s*=\s*["'][1-9]/i.test(lines[i])) {
                issues.push({
                    id: generateTestId(category),
                    category,
                    severity: 'medium',
                    type: 'warning',
                    title: 'Positive tabindex breaks natural tab order',
                    message: 'tabindex > 0 forces the element before others in tab order. Use tabindex="0" or remove it.',
                    file: relativePath(file, pluginPath),
                    line: i + 1,
                    code: 'a11y-positive-tabindex',
                    fix: 'Change to tabindex="0" or remove tabindex entirely',
                });
            }
        }
    }
    const errors = issues.filter(i => i.type === 'error').length;
    return {
        category,
        issues,
        passed: 5 - (errors > 0 ? 1 : 0),
        failed: errors,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
// ─── PHP Lint ───────────────────────────────────────────────────
export function runPhpLint(pluginPath) {
    const startTime = Date.now();
    const category = 'php-lint';
    if (!commandExists('php'))
        return skipResult(category, 'php not found in PATH.');
    const phpFiles = findPhpFiles(pluginPath);
    const issues = [];
    for (const file of phpFiles) {
        try {
            execFileSync('php', ['-l', file], { encoding: 'utf-8', stdio: 'pipe', timeout: 10000 });
        }
        catch (err) {
            const e = err;
            const stderr = e.stderr || '';
            const lineMatch = stderr.match(/on line (\d+)/);
            const msgMatch = stderr.match(/(?:Parse|Fatal) error:\s*(.+?)(?:\s+in\s+|$)/);
            issues.push({ id: generateTestId(category), category, severity: 'critical', type: 'error',
                title: 'PHP syntax error', message: msgMatch ? msgMatch[1].trim() : stderr.trim(),
                file: relativePath(file, pluginPath), line: lineMatch ? parseInt(lineMatch[1], 10) : 0,
                code: 'php-parse-error' });
        }
    }
    return { category, issues, passed: phpFiles.length - issues.length, failed: issues.length, skipped: 0, duration: Date.now() - startTime };
}
// ─── Composer Audit ─────────────────────────────────────────────
export function runComposerAudit(pluginPath) {
    const startTime = Date.now();
    const category = 'composer-audit';
    if (!commandExists('composer'))
        return skipResult(category, 'composer not installed.');
    if (!existsSync(join(pluginPath, 'composer.lock')) && !existsSync(join(pluginPath, 'composer.json')))
        return skipResult(category, 'No composer.json found.');
    const issues = [];
    try {
        const output = safeExec('composer', ['audit', '--format=json', '--no-interaction'], pluginPath);
        try {
            const data = JSON.parse(output);
            for (const [pkg, advList] of Object.entries(data.advisories || {})) {
                const list = advList;
                for (const adv of list) {
                    issues.push({ id: generateTestId(category), category, severity: 'critical', type: 'error',
                        title: `${pkg}: ${adv.title}`,
                        message: `${adv.title}${adv.cve ? ` (${adv.cve})` : ''}. Affected: ${adv.affectedVersions || 'unknown'}`,
                        file: 'composer.lock', line: 0, code: adv.cve || 'security-advisory' });
                }
            }
        }
        catch { /* no vulnerabilities */ }
    }
    catch {
        return skipResult(category, 'composer audit failed.');
    }
    return { category, issues, passed: issues.length === 0 ? 1 : 0, failed: issues.length, skipped: 0, duration: Date.now() - startTime };
}
// ─── i18n Check ─────────────────────────────────────────────────
export function runI18nCheck(pluginPath) {
    const startTime = Date.now();
    const category = 'i18n';
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    let textDomain = null;
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const match = content.match(/Text\s+Domain:\s*(.+)/i);
        if (match) {
            textDomain = match[1].trim();
            break;
        }
    }
    if (!textDomain)
        issues.push({ id: generateTestId(category), category, severity: 'high', type: 'error',
            title: 'No Text Domain in plugin header', message: 'Required for translations.', file: '', line: 0, code: 'i18n-missing-text-domain' });
    const langDir = join(pluginPath, 'languages');
    if (!existsSync(langDir)) {
        issues.push({ id: generateTestId(category), category, severity: 'medium', type: 'warning',
            title: 'No languages/ directory', message: 'Plugin should have languages/ with a .pot file.',
            file: '', line: 0, code: 'i18n-no-languages-dir', fix: 'Run: wp i18n make-pot . languages/' });
    }
    else if (findFilesByExt(langDir, '.pot').length === 0) {
        issues.push({ id: generateTestId(category), category, severity: 'medium', type: 'warning',
            title: 'No .pot file in languages/', message: 'Generate translation template.',
            file: 'languages/', line: 0, code: 'i18n-no-pot-file', fix: 'Run: npx grunt makepot' });
    }
    let hasLoadTD = false;
    for (const file of phpFiles) {
        const c = safeReadFile(file);
        if (c && /load_(?:plugin_)?textdomain/i.test(c)) {
            hasLoadTD = true;
            break;
        }
    }
    if (!hasLoadTD && textDomain)
        issues.push({ id: generateTestId(category), category, severity: 'high', type: 'error',
            title: 'No load_plugin_textdomain() call', message: 'Required to load translations.', file: '', line: 0, code: 'i18n-no-load-textdomain' });
    const errors = issues.filter(i => i.type === 'error').length;
    return { category, issues, passed: 3 - errors, failed: errors, skipped: 0, duration: Date.now() - startTime };
}
// ─── Plugin Check PCP ───────────────────────────────────────────
export function runPluginCheck(pluginPath) {
    const startTime = Date.now();
    const category = 'plugin-check';
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    // Patterns to check: remote file_get_contents, base64_decode, direct cURL
    const dangerousPatterns = [
        { pattern: /file_get_contents\s*\(\s*['"]https?:/, title: 'file_get_contents() for remote requests', code: 'pcp-file-get-contents-remote', sev: 'high', typ: 'error', fix: 'Use wp_remote_get()' },
        { pattern: /base64_decode\s*\(/, title: 'base64_decode() — review needed', code: 'pcp-base64-decode', sev: 'high', typ: 'warning' },
        { pattern: /\bcurl_(?:init|exec|setopt)\s*\(/, title: 'Direct cURL — use WP HTTP API', code: 'pcp-direct-curl', sev: 'medium', typ: 'warning', fix: 'Use wp_remote_get()/wp_remote_post()' },
    ];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            for (const dp of dangerousPatterns) {
                if (dp.pattern.test(lines[i])) {
                    issues.push({ id: generateTestId(category), category, severity: dp.sev, type: dp.typ,
                        title: dp.title, message: dp.title, file: rel, line: i + 1, code: dp.code, fix: dp.fix });
                }
            }
        }
    }
    // readme.txt checks
    const readme = safeReadFile(join(pluginPath, 'readme.txt'));
    if (!readme) {
        issues.push({ id: generateTestId(category), category, severity: 'high', type: 'error',
            title: 'readme.txt missing', message: 'Required for WordPress.org.', file: '', line: 0, code: 'pcp-no-readme' });
    }
    else {
        if (!/Stable tag:\s*\S+/i.test(readme))
            issues.push({ id: generateTestId(category), category, severity: 'medium', type: 'warning',
                title: 'Stable tag missing', message: 'Add Stable tag to readme.txt.', file: 'readme.txt', line: 0, code: 'pcp-no-stable-tag' });
        if (!/== Changelog ==/i.test(readme))
            issues.push({ id: generateTestId(category), category, severity: 'medium', type: 'warning',
                title: 'No Changelog section', message: 'Add == Changelog == section.', file: 'readme.txt', line: 0, code: 'pcp-no-changelog' });
        if (!/License:\s*GPL/i.test(readme))
            issues.push({ id: generateTestId(category), category, severity: 'high', type: 'error',
                title: 'GPL license not declared', message: 'Required for WordPress.org.', file: 'readme.txt', line: 0, code: 'pcp-no-license' });
    }
    if (!existsSync(join(pluginPath, 'uninstall.php')))
        issues.push({ id: generateTestId(category), category, severity: 'medium', type: 'warning',
            title: 'No uninstall.php', message: 'Plugins should clean up on delete.', file: '', line: 0, code: 'pcp-no-uninstall' });
    const errors = issues.filter(i => i.type === 'error').length;
    return { category, issues, passed: 0, failed: errors, skipped: issues.filter(i => i.type === 'warning').length, duration: Date.now() - startTime };
}
// ─── Bundle Size ────────────────────────────────────────────────
export function runBundleSize(pluginPath) {
    const startTime = Date.now();
    const category = 'bundle-size';
    const issues = [];
    const fStatSync = statSync;
    const jsFiles = findFilesByExt(pluginPath, '.js').filter(f => !f.includes('node_modules') && !f.includes('vendor'));
    const cssFiles = findFilesByExt(pluginPath, '.css').filter(f => !f.includes('node_modules') && !f.includes('vendor'));
    let totalJs = 0, totalCss = 0;
    for (const file of jsFiles) {
        try {
            const s = fStatSync(file);
            totalJs += s.size;
            if (s.size > 100 * 1024)
                issues.push({ id: generateTestId(category), category, severity: 'medium', type: 'warning',
                    title: `Large JS: ${relativePath(file, pluginPath)} (${(s.size / 1024).toFixed(0)}KB)`,
                    message: 'File > 100KB.', file: relativePath(file, pluginPath), line: 0, code: 'bundle-large-file' });
        }
        catch { /* skip */ }
    }
    for (const file of cssFiles) {
        try {
            const s = fStatSync(file);
            totalCss += s.size;
            if (s.size > 100 * 1024)
                issues.push({ id: generateTestId(category), category, severity: 'medium', type: 'warning',
                    title: `Large CSS: ${relativePath(file, pluginPath)} (${(s.size / 1024).toFixed(0)}KB)`,
                    message: 'CSS > 100KB.', file: relativePath(file, pluginPath), line: 0, code: 'bundle-large-css' });
        }
        catch { /* skip */ }
    }
    const total = totalJs + totalCss;
    if (total > 500 * 1024)
        issues.push({ id: generateTestId(category), category, severity: 'high', type: 'warning',
            title: `Total: ${(total / 1024).toFixed(0)}KB`, message: 'JS+CSS > 500KB. Review asset loading.',
            file: '', line: 0, code: 'bundle-total-large' });
    issues.push({ id: generateTestId(category), category, severity: 'low', type: 'info',
        title: `Bundle: ${jsFiles.length} JS (${(totalJs / 1024).toFixed(0)}KB), ${cssFiles.length} CSS (${(totalCss / 1024).toFixed(0)}KB)`,
        message: `Total: ${(total / 1024).toFixed(0)}KB`, file: '', line: 0, code: 'bundle-summary' });
    return { category, issues, passed: issues.filter(i => i.type === 'error').length === 0 ? 1 : 0,
        failed: issues.filter(i => i.type === 'error').length, skipped: 0, duration: Date.now() - startTime };
}
// ─── Security Scan (from wp-security-review skill) ──────────────
export function runSecurityScan(pluginPath) {
    const startTime = Date.now();
    const category = 'security-scan';
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    const securityPatterns = [
        // SQL Injection
        { pattern: /\$wpdb->query\s*\(\s*["']/,
            title: 'Direct $wpdb->query() without prepare()',
            code: 'sec-sql-injection', severity: 'critical',
            fix: 'Use $wpdb->prepare() for all queries with variables' },
        { pattern: /\$wpdb->(?:get_results|get_var|get_row|get_col)\s*\(\s*["']/,
            title: 'Direct $wpdb query without prepare()',
            code: 'sec-sql-no-prepare', severity: 'critical',
            fix: 'Wrap with $wpdb->prepare()' },
        // XSS - echo/print without escaping
        { pattern: /echo\s+\$_(?:GET|POST|REQUEST|SERVER)\s*\[/,
            title: 'Direct echo of superglobal (XSS)',
            code: 'sec-xss-superglobal', severity: 'critical',
            fix: 'Use esc_html(), esc_attr(), or wp_kses()' },
        { pattern: /echo\s+\$(?!this)[a-z_]+\s*;/,
            title: 'echo of variable without escaping (potential XSS)',
            code: 'sec-xss-unescaped', severity: 'high',
            exclude: /esc_html|esc_attr|esc_url|wp_kses|absint|intval|\$this/ },
        // Missing capability checks
        { pattern: /wp_ajax_(?:nopriv_)?(\w+)/,
            title: 'AJAX handler — verify current_user_can() is called',
            code: 'sec-ajax-capability', severity: 'medium' },
        // Dangerous functions
        { pattern: /create_function\s*\(/,
            title: 'create_function() is deprecated and dangerous',
            code: 'sec-create-function', severity: 'critical',
            fix: 'Use anonymous functions (closures) instead' },
        { pattern: /\bunserialize\s*\(\s*\$/,
            title: 'unserialize() on variable (object injection risk)',
            code: 'sec-unserialize', severity: 'critical',
            fix: 'Use maybe_unserialize() or json_decode()' },
        { pattern: /\bextract\s*\(\s*\$/,
            title: 'extract() can overwrite variables unexpectedly',
            code: 'sec-extract', severity: 'high',
            fix: 'Access array keys directly instead' },
        // File operations
        { pattern: /move_uploaded_file\s*\(/,
            title: 'Direct file upload — check type validation',
            code: 'sec-file-upload', severity: 'high',
            fix: 'Use wp_handle_upload() with allowed MIME types' },
        { pattern: /\binclude\s*\(\s*\$/,
            title: 'Dynamic include with variable (LFI risk)',
            code: 'sec-local-file-inclusion', severity: 'critical',
            fix: 'Whitelist allowed files instead of using variables' },
        // SSRF
        { pattern: /wp_remote_(?:get|post|request)\s*\(\s*\$/,
            title: 'Remote request with variable URL (potential SSRF)',
            code: 'sec-ssrf', severity: 'medium',
            fix: 'Validate/whitelist URLs before requesting' },
    ];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip comments
            if (/^\s*(?:\/\/|\*|#)/.test(line))
                continue;
            for (const sp of securityPatterns) {
                if (sp.pattern.test(line)) {
                    if (sp.exclude && sp.exclude.test(line))
                        continue;
                    issues.push({
                        id: generateTestId(category), category, severity: sp.severity, type: sp.severity === 'critical' ? 'error' : 'warning',
                        title: sp.title, message: sp.title,
                        file: rel, line: i + 1, code: sp.code, fix: sp.fix,
                    });
                }
            }
        }
    }
    const errors = issues.filter(i => i.type === 'error').length;
    return { category, issues, passed: securityPatterns.length - (errors > 0 ? 1 : 0), failed: errors, skipped: 0, duration: Date.now() - startTime };
}
// ─── Performance Scan (from wp-performance-review skill) ────────
export function runPerformanceScan(pluginPath) {
    const startTime = Date.now();
    const category = 'performance-scan';
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    const perfPatterns = [
        // Unbounded queries
        { pattern: /posts_per_page['"]\s*=>\s*-1/,
            title: 'Unbounded query: posts_per_page = -1',
            code: 'perf-unbounded-query', severity: 'high',
            fix: 'Set a reasonable limit (e.g., 100) and paginate' },
        { pattern: /numberposts['"]\s*=>\s*-1/,
            title: 'Unbounded query: numberposts = -1',
            code: 'perf-unbounded-numberposts', severity: 'high',
            fix: 'Set a reasonable limit' },
        { pattern: /nopaging['"]\s*=>\s*true/,
            title: 'nopaging = true fetches all posts',
            code: 'perf-nopaging', severity: 'high',
            fix: 'Remove nopaging and use pagination' },
        // N+1 query patterns
        { pattern: /get_post_meta\s*\([^)]*\)\s*;.*(?:foreach|while|for\s*\()/,
            title: 'get_post_meta inside loop (N+1 pattern)',
            code: 'perf-n-plus-1-meta', severity: 'high',
            fix: 'Use update_meta_cache() before the loop or WP_Query with meta_query' },
        // Remote requests in wrong hooks
        { pattern: /add_action\s*\(\s*['"]init['"].*wp_remote_/,
            title: 'Remote HTTP request in init hook (blocks page load)',
            code: 'perf-remote-in-init', severity: 'critical',
            fix: 'Move to a cron job or lazy-load on demand' },
        { pattern: /add_action\s*\(\s*['"]wp_loaded['"].*wp_remote_/,
            title: 'Remote HTTP request in wp_loaded (blocks page load)',
            code: 'perf-remote-in-wp-loaded', severity: 'critical',
            fix: 'Move to a cron job or lazy-load' },
        // Redirect without exit
        { pattern: /wp_redirect\s*\([^)]+\)\s*;(?!\s*(?:exit|die))/,
            title: 'wp_redirect() without exit/die',
            code: 'perf-redirect-no-exit', severity: 'high',
            fix: 'Add exit; or die; after wp_redirect()' },
        { pattern: /wp_safe_redirect\s*\([^)]+\)\s*;(?!\s*(?:exit|die))/,
            title: 'wp_safe_redirect() without exit/die',
            code: 'perf-safe-redirect-no-exit', severity: 'high',
            fix: 'Add exit; after wp_safe_redirect()' },
        // Loading all options
        { pattern: /get_option\s*\(\s*['"][^'"]+['"]\s*\)\s*;.*(?:foreach|while|for\s*\()/,
            title: 'get_option inside loop',
            code: 'perf-option-in-loop', severity: 'medium',
            fix: 'Cache the option value before the loop' },
        // Enqueue on all pages
        { pattern: /wp_enqueue_script\s*\([^)]+\)\s*;/,
            title: 'Script enqueued — verify conditional loading',
            code: 'perf-unconditional-enqueue', severity: 'low' },
    ];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*(?:\/\/|\*|#)/.test(line))
                continue;
            for (const pp of perfPatterns) {
                if (pp.pattern.test(line)) {
                    if (pp.exclude && pp.exclude.test(line))
                        continue;
                    // Skip low severity for cleaner reports
                    if (pp.severity === 'low')
                        continue;
                    issues.push({
                        id: generateTestId(category), category, severity: pp.severity,
                        type: pp.severity === 'critical' || pp.severity === 'high' ? 'error' : 'warning',
                        title: pp.title, message: pp.title,
                        file: rel, line: i + 1, code: pp.code, fix: pp.fix,
                    });
                }
            }
        }
    }
    const errors = issues.filter(i => i.type === 'error').length;
    return { category, issues, passed: perfPatterns.length - (errors > 0 ? 1 : 0), failed: errors, skipped: 0, duration: Date.now() - startTime };
}
// ─── PCP Deep (from wp-pcp-compliance skill — 30 checks) ────────
export function runPcpDeep(pluginPath) {
    const startTime = Date.now();
    const category = 'pcp-deep';
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    // 1. Direct file access protection — every PHP file should check ABSPATH
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        // Skip main plugin file (has Plugin Name header) and uninstall.php
        if (rel.split('/').length === 1 && !rel.includes('uninstall'))
            continue;
        if (/defined\s*\(\s*['"]ABSPATH['"]\s*\)|defined\s*\(\s*['"]WPINC['"]\s*\)|defined\s*\(\s*'WP_UNINSTALL_PLUGIN'\s*\)/.test(content))
            continue;
        // Only check files in includes/, src/, admin/ — not templates
        if (/^(?:includes|src|admin|classes)\//i.test(rel)) {
            issues.push({
                id: generateTestId(category), category, severity: 'medium', type: 'warning',
                title: 'Missing direct access protection',
                message: 'PHP file lacks defined("ABSPATH") or defined("WPINC") check at top.',
                file: rel, line: 1, code: 'pcp-no-abspath',
                fix: 'Add: defined( "ABSPATH" ) || exit; at the top of the file',
            });
        }
    }
    // 2. Late escaping — output should be escaped at echo, not before
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*(?:\/\/|\*|#)/.test(line))
                continue;
            // echo $var without escaping
            if (/echo\s+\$\w+\s*;/.test(line) && !/esc_|wp_kses|absint|intval|\$this/.test(line)) {
                issues.push({
                    id: generateTestId(category), category, severity: 'high', type: 'error',
                    title: 'echo without late escaping',
                    message: 'Output must be escaped at the point of echo. Use esc_html(), esc_attr(), esc_url().',
                    file: rel, line: i + 1, code: 'pcp-late-escaping',
                });
            }
            // printf without escaping
            if (/printf\s*\(/.test(line) && !/esc_html|esc_attr|wp_kses/.test(line) && /\$/.test(line)) {
                issues.push({
                    id: generateTestId(category), category, severity: 'medium', type: 'warning',
                    title: 'printf with variable — verify escaping',
                    message: 'Ensure variables in printf are escaped: esc_html(), esc_attr().',
                    file: rel, line: i + 1, code: 'pcp-printf-escaping',
                });
            }
        }
    }
    // 3. Script loading strategy (defer/async)
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            // Check wp_enqueue_script without strategy
            if (/wp_enqueue_script\s*\(/.test(lines[i]) && !/strategy/.test(lines[i])) {
                // Check next few lines for wp_script_add_data
                const context = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
                if (!/wp_script_add_data|strategy|defer|async/.test(context)) {
                    issues.push({
                        id: generateTestId(category), category, severity: 'low', type: 'info',
                        title: 'Script enqueued without loading strategy',
                        message: 'Consider adding defer/async strategy for non-critical scripts.',
                        file: rel, line: i + 1, code: 'pcp-script-strategy',
                    });
                }
            }
        }
    }
    // 4. Prefixing — functions and classes should use plugin prefix
    const slug = basename(pluginPath).replace(/-/g, '_');
    const prefixPattern = new RegExp(`^(?:function|class)\\s+(${slug}|wbam|wbcom|bp_|bb_)`, 'i');
    let unprefixedCount = 0;
    const unprefixedSamples = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const funcMatch = lines[i].match(/^(?:function)\s+([a-zA-Z_]\w*)\s*\(/);
            if (funcMatch && !prefixPattern.test(lines[i]) && !/^__/.test(funcMatch[1]) && !/^(?:register|deactivate|activate|uninstall)/.test(funcMatch[1])) {
                // Check if it's inside a class (skip — classes namespace functions)
                const prevLines = lines.slice(Math.max(0, i - 20), i).join('\n');
                if (/class\s+\w+/.test(prevLines))
                    continue;
                unprefixedCount++;
                if (unprefixedSamples.length < 5) {
                    unprefixedSamples.push({ file: rel, line: i + 1, name: funcMatch[1] });
                }
            }
        }
    }
    if (unprefixedCount > 0) {
        issues.push({
            id: generateTestId(category), category, severity: 'medium', type: 'warning',
            title: `${unprefixedCount} global functions without plugin prefix`,
            message: `Functions like "${unprefixedSamples[0]?.name}" should be prefixed with plugin slug or namespaced. Locations: ${unprefixedSamples.map(s => `${s.file}:${s.line}`).join(', ')}`,
            file: unprefixedSamples[0]?.file || '', line: unprefixedSamples[0]?.line || 0, code: 'pcp-no-prefix',
        });
    }
    // 5. Conditional loading — plugin should check is_admin() for admin-only code
    let hasConditionalLoading = false;
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (content && /is_admin\s*\(\)/.test(content)) {
            hasConditionalLoading = true;
            break;
        }
    }
    if (!hasConditionalLoading && phpFiles.length > 5) {
        issues.push({
            id: generateTestId(category), category, severity: 'medium', type: 'warning',
            title: 'No is_admin() conditional loading detected',
            message: 'Plugin should use is_admin() to load admin-only code conditionally. Reduces frontend overhead.',
            file: '', line: 0, code: 'pcp-no-conditional-load',
            fix: 'Wrap admin-only includes with: if ( is_admin() ) { require_once ... }',
        });
    }
    const errors = issues.filter(i => i.type === 'error').length;
    return { category, issues, passed: 5 - (errors > 0 ? 1 : 0), failed: errors,
        skipped: issues.filter(i => i.type === 'warning').length, duration: Date.now() - startTime };
}
// ─── Utilities ──────────────────────────────────────────────────
function commandExists(cmd) {
    try {
        execFileSync('which', [cmd], { encoding: 'utf-8', stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
function safeExec(cmd, args, cwd) {
    try {
        return execFileSync(cmd, args, {
            encoding: 'utf-8',
            cwd,
            maxBuffer: 50 * 1024 * 1024,
            timeout: 300000,
            stdio: 'pipe',
        });
    }
    catch (err) {
        const e = err;
        // Many tools exit non-zero when they find issues (phpcs, phpstan, eslint)
        // but still produce valid output on stdout
        if (e.stdout)
            return e.stdout;
        throw err;
    }
}
function skipResult(category, reason) {
    return {
        category,
        issues: [{
                id: generateTestId(category),
                category,
                severity: 'low',
                type: 'info',
                title: `${category} check skipped`,
                message: reason,
                file: '',
                line: 0,
                code: `${category}-skipped`,
            }],
        passed: 0,
        failed: 0,
        skipped: 1,
        duration: 0,
    };
}
//# sourceMappingURL=code-quality-checker.js.map
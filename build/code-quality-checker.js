/**
 * Code Quality Checker — runs external tools (PHPCS, PHPStan, ESLint,
 * Stylelint, PHP Compat) and static a11y grep checks.
 *
 * Uses execFileSync for safe command execution (no shell injection).
 * Handles missing tools gracefully (skip with info, not error).
 * Parses JSON output from tools and converts to CheckerIssue[].
 */
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
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
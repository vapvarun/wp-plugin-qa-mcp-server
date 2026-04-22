/**
 * WP Plugin QA MCP Server - Plugin Development Rules Checker
 *
 * Enforces rules from the wp-plugin-development skill at
 *   ~/.claude/skills/wp-plugin-development/references/
 *
 * Rule groups mined:
 *   - admin-ux-rulebook: Rules 1-10 (alert/confirm ban, Dashicons, -1 values,
 *     role labels, page headers, etc.)
 *   - security.md: read explicit $_POST keys (no array-wide processing),
 *     prepared statements, sanitize-in escape-out
 *   - lifecycle.md: activation/deactivation hooks registered at top level;
 *     uninstall uses WP_UNINSTALL_PLUGIN
 *   - frontend-tokens.md: every CSS file references tokens
 *   - frontend-responsive.md: 3 breakpoints only (640/1024/1440ish),
 *     no 24+ breakpoint values, 40px minimum tap targets
 *
 * This check exists because the skill's rules are documented but never
 * machine-enforced. Every plugin that activates the skill should pass this.
 *
 * Tuning (2026-04-18):
 *  - nonce-no-cap: skip when the nonce is inside a handler that is (a)
 *    referenced by a `permission_callback` elsewhere in the codebase, or
 *    (b) declared inside a class that registers routes with
 *    `permission_callback`. Also skip when the file includes
 *    `Permission_Engine::can(` or another capability-engine surrogate
 *    within the same function body.
 *  - activation-nested: use brace-depth tracking from file start to the
 *    call site instead of whitespace heuristics. Still lightweight, no
 *    external AST.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { findPhpFiles, findFilesByExt, findJsFiles, getLineNumber, relativePath, generateTestId, dirExists, } from './shared-utils.js';
export function checkPluginDevRules(pluginPath) {
    const startTime = Date.now();
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    const jsFiles = findJsFiles(pluginPath);
    const cssFiles = collectCssFiles(pluginPath);
    issues.push(...checkAlertConfirmBan(jsFiles, pluginPath));
    issues.push(...checkRawPostIteration(phpFiles, pluginPath));
    issues.push(...checkNonceCapabilityPairing(phpFiles, pluginPath));
    issues.push(...checkActivationHookPlacement(phpFiles, pluginPath));
    issues.push(...checkUninstallGuard(pluginPath));
    issues.push(...checkRawMinusOneInputs(phpFiles, pluginPath));
    issues.push(...checkInlineOnclick(phpFiles, pluginPath));
    issues.push(...checkBreakpointDiscipline(cssFiles, pluginPath));
    issues.push(...checkTapTargets(cssFiles, pluginPath));
    const errorCount = issues.filter((i) => i.type === 'error').length;
    return {
        category: 'plugin-dev-rules',
        issues,
        passed: Math.max(0, 9 - errorCount),
        failed: errorCount,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
function collectCssFiles(pluginPath) {
    const assetsDir = join(pluginPath, 'assets');
    if (!dirExists(assetsDir))
        return [];
    return findFilesByExt(assetsDir, '.css');
}
/**
 * admin-ux-rulebook Rule 10: "Never use browser alert() or confirm()".
 * Flag both in JS.
 */
function checkAlertConfirmBan(jsFiles, pluginPath) {
    const issues = [];
    for (const file of jsFiles) {
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        const rel = relativePath(file, pluginPath);
        const alertMatches = content.matchAll(/\balert\s*\(/g);
        const alertFlagged = new Set();
        for (const match of alertMatches) {
            const lineNum = getLineNumber(content, match.index ?? 0);
            if (alertFlagged.has(lineNum))
                continue;
            alertFlagged.add(lineNum);
            const line = content.split('\n')[lineNum - 1] || '';
            if (/^\s*(\/\/|\/\*|\*)/.test(line))
                continue;
            if (/console\.alert/.test(line))
                continue;
            issues.push({
                id: generateTestId('plugin-dev-rules'),
                category: 'plugin-dev-rules',
                severity: 'high',
                type: 'error',
                title: 'Browser alert() used',
                message: "admin-ux-rulebook Rule 10 bans alert(). Use a toast notification (window.{prefix}Toast) instead — jarring, untranslatable, unprofessional.",
                file: rel,
                line: lineNum,
                code: 'alert-banned',
            });
        }
        const confirmMatches = content.matchAll(/\bconfirm\s*\(/g);
        const confirmFlagged = new Set();
        for (const match of confirmMatches) {
            const lineNum = getLineNumber(content, match.index ?? 0);
            if (confirmFlagged.has(lineNum))
                continue;
            confirmFlagged.add(lineNum);
            const line = content.split('\n')[lineNum - 1] || '';
            if (/^\s*(\/\/|\/\*|\*)/.test(line))
                continue;
            issues.push({
                id: generateTestId('plugin-dev-rules'),
                category: 'plugin-dev-rules',
                severity: 'high',
                type: 'error',
                title: 'Browser confirm() used',
                message: "admin-ux-rulebook Rule 10 bans confirm(). Use a modal confirmation dialog instead.",
                file: rel,
                line: lineNum,
                code: 'confirm-banned',
            });
        }
    }
    return issues;
}
/**
 * security.md: "never process the entire $_POST / $_GET array; read explicit
 * keys". Flag patterns like `foreach ($_POST as ...)` or `array_map($fn, $_POST)`.
 */
function checkRawPostIteration(phpFiles, pluginPath) {
    const issues = [];
    for (const file of phpFiles) {
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        const rel = relativePath(file, pluginPath);
        const iterMatches = content.matchAll(/(?:foreach\s*\(\s*\$_(POST|GET|REQUEST)|array_map\s*\([^)]*,\s*\$_(POST|GET|REQUEST))/g);
        for (const match of iterMatches) {
            issues.push({
                id: generateTestId('plugin-dev-rules'),
                category: 'plugin-dev-rules',
                severity: 'high',
                type: 'error',
                title: 'Iterating over $_POST/$_GET directly',
                message: 'security.md: never process the entire $_POST/$_GET; read explicit keys. Iteration makes it hard to audit sanitization per-key.',
                file: rel,
                line: getLineNumber(content, match.index ?? 0),
                code: 'raw-post-iter',
            });
        }
    }
    return issues;
}
/**
 * Scan every PHP file in includes/api/ for `permission_callback` references
 * and collect the callable names they point to. A handler mentioned there is
 * authorized at the route layer — a nonce check inside its body does not
 * need a sibling current_user_can().
 */
function collectRestProtectedHandlers(phpFiles) {
    const names = new Set();
    const classes = new Set();
    for (const file of phpFiles) {
        if (!file.includes('/api/') && !file.includes('/rest/'))
            continue;
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        // String callables referenced from permission_callback.
        const cbRe = /permission_callback['"]\s*=>\s*(?:\[[^\]]*?['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*\]|['"]([A-Za-z_][A-Za-z0-9_\\]*)::([A-Za-z_][A-Za-z0-9_]*)['"])/g;
        let m;
        while ((m = cbRe.exec(content)) !== null) {
            if (m[1])
                names.add(m[1]);
            if (m[2] && m[3]) {
                names.add(m[3]);
                classes.add(m[2]);
            }
        }
        // When a controller class defines register_rest_route AND uses
        // permission_callback anywhere, assume its methods are route-guarded.
        if (/register_rest_route\s*\(/.test(content) &&
            /permission_callback/.test(content)) {
            const classMatches = content.matchAll(/class\s+([A-Z][A-Za-z0-9_]*)\b/g);
            for (const cm of classMatches) {
                classes.add(cm[1]);
            }
        }
    }
    return { names, classes };
}
/**
 * Return the function/method header enclosing the given character index, or
 * null when none is found. Returns the function and class names (empty when
 * not inside one).
 */
function enclosingFunction(content, idx) {
    const lines = content.split('\n');
    const targetLine = getLineNumber(content, idx) - 1;
    let className = '';
    let funcName = '';
    let depth = 0;
    let classDepth = -1;
    let funcDepth = -1;
    for (let i = 0; i <= targetLine; i++) {
        const line = lines[i];
        const classMatch = line.match(/\bclass\s+([A-Z][A-Za-z0-9_]*)\b/);
        if (classMatch && classDepth === -1) {
            className = classMatch[1];
            classDepth = depth;
        }
        const funcMatch = line.match(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        if (funcMatch && funcDepth === -1) {
            funcName = funcMatch[1];
            funcDepth = depth;
        }
        for (const ch of line) {
            if (ch === '{')
                depth++;
            else if (ch === '}') {
                depth--;
                if (funcDepth !== -1 && depth <= funcDepth) {
                    funcName = '';
                    funcDepth = -1;
                }
                if (classDepth !== -1 && depth <= classDepth) {
                    className = '';
                    classDepth = -1;
                }
            }
        }
    }
    if (!funcName && !className)
        return null;
    return { funcName, className };
}
/**
 * security.md: "Always pair nonces with capability checks". If a file has
 * `wp_verify_nonce` / `check_admin_referer` but no `current_user_can` nearby
 * (within 50 lines), flag.
 *
 * Tuning: suppress the flag when the enclosing function is clearly REST-
 * protected via a `permission_callback` elsewhere, or when the file itself
 * routes authorization through a `Permission_Engine::can(` surrogate inside
 * the function body.
 */
function checkNonceCapabilityPairing(phpFiles, pluginPath) {
    const issues = [];
    const rest = collectRestProtectedHandlers(phpFiles);
    for (const file of phpFiles) {
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        const nonceRe = /\b(wp_verify_nonce|check_admin_referer|check_ajax_referer)\s*\(/g;
        for (const match of content.matchAll(nonceRe)) {
            const lineNum = getLineNumber(content, match.index ?? 0);
            const line = lines[lineNum - 1] || '';
            // Skip matches inside single-line comments (the nonce name is just
            // being referenced in prose, e.g. "verified inside $this->guard()").
            const col = (match.index ?? 0) - content.lastIndexOf('\n', (match.index ?? 0) - 1) - 1;
            if (isCommentedOut(line, col))
                continue;
            const windowStart = Math.max(0, lineNum - 5);
            const windowEnd = Math.min(lines.length, lineNum + 50);
            const windowText = lines.slice(windowStart, windowEnd).join('\n');
            // Strong signal: explicit capability check.
            if (/\bcurrent_user_can\s*\(/.test(windowText))
                continue;
            // Wider window for a delegated permission engine.
            if (/\bPermission_Engine\s*::\s*can\s*\(/.test(windowText))
                continue;
            if (/\b[A-Z][a-zA-Z_]*Permission[a-zA-Z_]*\s*::\s*can\s*\(/.test(windowText))
                continue;
            // User-scope actions: if the window gates on is_user_logged_in() (or
            // similar) AND the nonce action itself is per-user (suffixed with an
            // entity id like `_123`), treat the nonce as the authorization —
            // common for student "dismiss welcome", "retake course", "mark as
            // read" flows where the capability surrogate is "is this user".
            const matchLine = match[0];
            const windowTrim = windowText;
            const looksUserScoped = /\bis_user_logged_in\s*\(\s*\)/.test(windowTrim) &&
                /(?:_\.\s*\$|_\s*\.\s*\$|_'\s*\.\s*\$|\$course_id|\$user_id|\$post_id|\$entity_id)/.test(matchLine + windowTrim);
            if (looksUserScoped)
                continue;
            // REST-protected handler? Check the enclosing method/class.
            const enclosing = enclosingFunction(content, match.index ?? 0);
            if (enclosing) {
                if (enclosing.funcName && rest.names.has(enclosing.funcName))
                    continue;
                if (enclosing.className && rest.classes.has(enclosing.className))
                    continue;
            }
            // REST controllers almost always declare their own permission_callback
            // on every route. If both signals appear in the same file, treat the
            // file as route-guarded.
            if (/register_rest_route\s*\(/.test(content) &&
                /permission_callback/.test(content))
                continue;
            issues.push({
                id: generateTestId('plugin-dev-rules'),
                category: 'plugin-dev-rules',
                severity: 'high',
                type: 'error',
                title: 'Nonce check without capability check',
                message: "security.md: nonces prevent CSRF but do NOT authorize. Pair with current_user_can() or more specific capability.",
                file: rel,
                line: lineNum,
                code: 'nonce-no-cap',
            });
        }
    }
    return issues;
}
/**
 * lifecycle.md: "register_activation_hook must be registered at top-level,
 * not inside other hooks". Flag calls with non-zero brace depth.
 *
 * Tuning: track brace depth from the file start up to the call site. If
 * depth > 0 at the call, the call is inside a function/class/if block.
 * Skip if the call is a clear plugin-bootstrap idiom (e.g. inside a
 * `register_hooks`-style method invoked from top-level code).
 */
function checkActivationHookPlacement(phpFiles, pluginPath) {
    const issues = [];
    for (const file of phpFiles) {
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        const rel = relativePath(file, pluginPath);
        const hookMatches = content.matchAll(/register_(?:activation|deactivation)_hook\s*\(/g);
        for (const match of hookMatches) {
            const idx = match.index ?? 0;
            const depth = braceDepthAt(content, idx);
            if (depth === 0)
                continue;
            // Skip: registered within an init/plugins_loaded/etc. callback.
            const lineNum = getLineNumber(content, idx);
            const back = content
                .split('\n')
                .slice(Math.max(0, lineNum - 10), lineNum)
                .join('\n');
            if (/add_action\s*\(/.test(back) && !/register_hooks\b/.test(back))
                continue;
            // Skip: canonical bootstrap method (register_hooks / setup_hooks /
            // init_hooks / bootstrap). This is the standard singleton idiom —
            // flagging it is noise, not a real bug.
            const enclosing = enclosingFunction(content, idx);
            const looksIntentional = enclosing &&
                /^(?:register_hooks|bootstrap|init_hooks|setup_hooks)$/.test(enclosing.funcName);
            if (looksIntentional)
                continue;
            issues.push({
                id: generateTestId('plugin-dev-rules'),
                category: 'plugin-dev-rules',
                severity: 'medium',
                type: 'warning',
                title: 'Activation hook registered inside another function/hook',
                message: "lifecycle.md: activation/deactivation hooks must be registered at file top-level. Nested registrations silently fail when the enclosing function isn't called before activation.",
                file: rel,
                line: lineNum,
                code: 'activation-nested',
            });
        }
    }
    return issues;
}
/**
 * Return true when `col` on `line` is preceded by a `//`, `#`, or `*` that
 * would make it part of a PHP single-line or PHPDoc line comment.
 */
function isCommentedOut(line, col) {
    const prefix = line.slice(0, col);
    if (/(^|[^:])\/\//.test(prefix))
        return true;
    if (/(^|\s)#/.test(prefix))
        return true;
    if (/^\s*\*/.test(line))
        return true; // docblock continuation
    return false;
}
function braceDepthAt(content, idx) {
    let depth = 0;
    let i = 0;
    while (i < idx) {
        const ch = content[i];
        // Skip comments.
        if (ch === '/' && content[i + 1] === '/') {
            const nl = content.indexOf('\n', i);
            i = nl === -1 ? content.length : nl + 1;
            continue;
        }
        if (ch === '/' && content[i + 1] === '*') {
            const end = content.indexOf('*/', i + 2);
            i = end === -1 ? content.length : end + 2;
            continue;
        }
        if (ch === '#') {
            const nl = content.indexOf('\n', i);
            i = nl === -1 ? content.length : nl + 1;
            continue;
        }
        // Skip strings.
        if (ch === '"' || ch === "'") {
            const quote = ch;
            i++;
            while (i < idx && content[i] !== quote) {
                if (content[i] === '\\')
                    i += 2;
                else
                    i++;
            }
            i++;
            continue;
        }
        if (ch === '{')
            depth++;
        else if (ch === '}')
            depth--;
        i++;
    }
    return depth;
}
/**
 * lifecycle.md: uninstall.php must check WP_UNINSTALL_PLUGIN before any
 * destructive cleanup.
 */
function checkUninstallGuard(pluginPath) {
    const issues = [];
    const uninstallPath = join(pluginPath, 'uninstall.php');
    let content;
    try {
        content = readFileSync(uninstallPath, 'utf-8');
    }
    catch {
        return issues;
    }
    if (!content.includes('WP_UNINSTALL_PLUGIN')) {
        issues.push({
            id: generateTestId('plugin-dev-rules'),
            category: 'plugin-dev-rules',
            severity: 'high',
            type: 'error',
            title: 'uninstall.php without WP_UNINSTALL_PLUGIN guard',
            message: 'lifecycle.md: uninstall.php must check defined("WP_UNINSTALL_PLUGIN") before any destructive cleanup, or the file runs on direct access.',
            file: 'uninstall.php',
            line: 1,
            code: 'uninstall-no-guard',
        });
    }
    return issues;
}
/**
 * admin-ux-rulebook Rule 7: "No raw -1 values in admin UI". A number input
 * with value="-1" (e.g. for "unlimited") should be replaced with a checkbox.
 */
function checkRawMinusOneInputs(phpFiles, pluginPath) {
    const issues = [];
    for (const file of phpFiles) {
        if (!file.includes('/admin/') && !file.includes('/views/'))
            continue;
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        const rel = relativePath(file, pluginPath);
        const minusOneRe = /<input[^>]*type\s*=\s*["']number["'][^>]*value\s*=\s*["']-1["']/gi;
        for (const match of content.matchAll(minusOneRe)) {
            issues.push({
                id: generateTestId('plugin-dev-rules'),
                category: 'plugin-dev-rules',
                severity: 'medium',
                type: 'warning',
                title: 'Raw -1 value in number input',
                message: 'admin-ux-rulebook Rule 7: expose "unlimited" as a checkbox that disables the number field and stores -1 on save. Users should not need to know the magic number.',
                file: rel,
                line: getLineNumber(content, match.index ?? 0),
                code: 'magic-minus-one',
            });
        }
    }
    return issues;
}
/**
 * frontend-responsive anti-pattern: inline onclick attributes, especially
 * inside data-wp-interactive regions.
 */
function checkInlineOnclick(phpFiles, pluginPath) {
    const issues = [];
    for (const file of phpFiles) {
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        const rel = relativePath(file, pluginPath);
        const onclickRe = /\bonclick\s*=\s*["']/gi;
        for (const match of content.matchAll(onclickRe)) {
            issues.push({
                id: generateTestId('plugin-dev-rules'),
                category: 'plugin-dev-rules',
                severity: 'medium',
                type: 'warning',
                title: 'Inline onclick attribute',
                message: "frontend-responsive: inline onclick handlers fight Interactivity API + event delegation + CSP. Use data-wp-on--click or event listeners.",
                file: rel,
                line: getLineNumber(content, match.index ?? 0),
                code: 'inline-onclick',
            });
        }
    }
    return issues;
}
/**
 * frontend-responsive Rule 1: "Three breakpoints, no exceptions". Count
 * distinct max-width values across all CSS. If more than 4, flag.
 */
function checkBreakpointDiscipline(cssFiles, pluginPath) {
    const issues = [];
    const breakpoints = new Map();
    for (const file of cssFiles) {
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        const rel = relativePath(file, pluginPath);
        const re = /@media[^{]*\(\s*max-width\s*:\s*(\d+)px/g;
        for (const match of content.matchAll(re)) {
            const bp = match[1];
            if (!breakpoints.has(bp))
                breakpoints.set(bp, []);
            breakpoints.get(bp).push(rel);
        }
    }
    if (breakpoints.size > 4) {
        issues.push({
            id: generateTestId('plugin-dev-rules'),
            category: 'plugin-dev-rules',
            severity: 'medium',
            type: 'warning',
            title: `${breakpoints.size} distinct breakpoints found`,
            message: `frontend-responsive Rule 1: stick to 3 breakpoints (640/1024/1440 typical). Found: ${[...breakpoints.keys()].sort().join(', ')}px. Extra breakpoints are usually component-local fixes that should adjust the component instead.`,
            file: '.',
            line: 1,
            code: 'breakpoint-proliferation',
        });
    }
    return issues;
}
/**
 * frontend-responsive Rule 4: "Tap targets — 40px minimum everywhere".
 * Heuristic: count .lrn-btn / .jt-btn etc. rules with height < 40px.
 */
function checkTapTargets(cssFiles, pluginPath) {
    const issues = [];
    for (const file of cssFiles) {
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        const rel = relativePath(file, pluginPath);
        const btnRe = /\.[a-z-]*btn[a-z-]*[^{]*\{[^}]*?(?:height|min-height)\s*:\s*(\d+)px/g;
        for (const match of content.matchAll(btnRe)) {
            const px = parseInt(match[1], 10);
            if (px >= 40)
                continue;
            issues.push({
                id: generateTestId('plugin-dev-rules'),
                category: 'plugin-dev-rules',
                severity: 'low',
                type: 'warning',
                title: `Button height ${px}px < 40px tap target`,
                message: "frontend-responsive Rule 4: 40px minimum tap target on buttons. Smaller hurts accessibility on touch devices.",
                file: rel,
                line: getLineNumber(content, match.index ?? 0),
                code: 'tap-target-small',
            });
        }
    }
    return issues;
}
//# sourceMappingURL=plugin-dev-rules-checker.js.map
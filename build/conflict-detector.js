/**
 * WP Plugin QA MCP Server - Plugin Conflict Detector
 * Identifies patterns that commonly cause conflicts with other WordPress plugins.
 * Covers: hook collisions, namespace pollution, CSS conflicts, JS globals, REST route clashes.
 *
 * NOTE: Pure static analysis — reads PHP/JS/CSS source files only. No shell commands used.
 */
import { generateTestId, findPhpFiles, findJsFiles, findFilesByExt, relativePath, safeReadFile, getLineNumber, detectPluginSlug } from './shared-utils.js';
export function checkConflicts(pluginPath) {
    const startTime = Date.now();
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    const jsFiles = findJsFiles(pluginPath);
    const cssFiles = findFilesByExt(pluginPath, '.css');
    const slug = detectPluginSlug(pluginPath);
    issues.push(...checkHookCollisions(pluginPath, slug, phpFiles));
    issues.push(...checkGlobalVariables(pluginPath, slug, phpFiles));
    issues.push(...checkCssConflicts(pluginPath, slug, cssFiles));
    issues.push(...checkJsGlobals(pluginPath, slug, jsFiles));
    issues.push(...checkRestNamespaces(pluginPath, slug, phpFiles));
    issues.push(...checkFunctionCollisions(pluginPath, slug, phpFiles));
    issues.push(...checkAggressivePriorities(pluginPath, phpFiles));
    const errors = issues.filter(i => i.type === 'error').length;
    return {
        category: 'conflicts',
        issues,
        passed: Math.max(0, 7 - errors),
        failed: errors,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
function checkHookCollisions(pluginPath, slug, phpFiles) {
    const issues = [];
    const prefix = slug.replace(/-/g, '_');
    const genericHooks = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const hookMatch = lines[i].match(/(?:do_action|apply_filters)\s*\(\s*['"]([^'"]+)['"]/);
            if (hookMatch) {
                const hookName = hookMatch[1];
                if (hookName.startsWith('wp_') || hookName.startsWith('admin_') ||
                    hookName.startsWith('the_') || hookName.startsWith('save_') ||
                    hookName.startsWith('pre_') || hookName === 'init' ||
                    hookName === 'plugins_loaded' || hookName.startsWith('template_')) {
                    continue;
                }
                if (!hookName.startsWith(prefix) && !hookName.startsWith(slug)) {
                    genericHooks.push({ hook: hookName, file: rel, line: i + 1 });
                }
            }
        }
    }
    if (genericHooks.length > 0) {
        const examples = genericHooks.slice(0, 5).map(h => `"${h.hook}" (${h.file}:${h.line})`);
        issues.push({
            id: generateTestId('conflicts'), category: 'conflicts',
            severity: genericHooks.length > 5 ? 'high' : 'medium', type: 'warning',
            title: `${genericHooks.length} unprefixed custom hooks`,
            message: `Custom hooks without plugin prefix may collide: ${examples.join(', ')}`,
            file: genericHooks[0].file, line: genericHooks[0].line, code: 'unprefixed-hooks',
            fix: `Prefix all custom hooks with "${prefix}_"`,
        });
    }
    return issues;
}
function checkGlobalVariables(pluginPath, slug, phpFiles) {
    const issues = [];
    const prefix = slug.replace(/-/g, '_');
    const genericGlobals = [];
    const wpGlobals = new Set([
        'wpdb', 'wp_version', 'wp_query', 'post', 'wp', 'wp_rewrite',
        'wp_the_query', 'wp_object_cache', 'wp_filter', 'wp_actions',
        'shortcode_tags', 'allowedtags', 'table_prefix', 'blog_id',
        'pagenow', 'current_screen', 'menu', 'submenu',
        'wp_roles', 'wp_taxonomies', 'wp_post_types',
    ]);
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const globalMatch = lines[i].match(/\bglobal\s+(\$\w+(?:\s*,\s*\$\w+)*)/);
            if (globalMatch) {
                const vars = globalMatch[1].split(',').map(v => v.trim().replace('$', ''));
                for (const varName of vars) {
                    if (!wpGlobals.has(varName) && !varName.startsWith(prefix) && !varName.startsWith(slug.replace(/-/g, ''))) {
                        genericGlobals.push({ name: '$' + varName, file: rel, line: i + 1 });
                    }
                }
            }
            const globalsMatch = lines[i].match(/\$GLOBALS\s*\[\s*['"]([^'"]+)['"]\s*\]/);
            if (globalsMatch) {
                const varName = globalsMatch[1];
                if (!wpGlobals.has(varName) && !varName.startsWith(prefix)) {
                    genericGlobals.push({ name: '$GLOBALS["' + varName + '"]', file: rel, line: i + 1 });
                }
            }
        }
    }
    if (genericGlobals.length > 0) {
        const examples = genericGlobals.slice(0, 5).map(g => `${g.name} (${g.file}:${g.line})`);
        issues.push({
            id: generateTestId('conflicts'), category: 'conflicts',
            severity: genericGlobals.length > 3 ? 'high' : 'medium', type: 'warning',
            title: `${genericGlobals.length} unprefixed global variables`,
            message: `Globals without plugin prefix may collide: ${examples.join(', ')}`,
            file: genericGlobals[0].file, line: genericGlobals[0].line, code: 'unprefixed-globals',
            fix: `Prefix globals with "${prefix}_" or use class properties instead`,
        });
    }
    return issues;
}
function checkCssConflicts(pluginPath, slug, cssFiles) {
    const issues = [];
    const prefix = slug.replace(/-/g, '-');
    const genericClasses = new Set([
        'container', 'wrapper', 'content', 'main', 'header', 'footer',
        'sidebar', 'title', 'subtitle', 'description', 'item', 'list',
        'card', 'button', 'btn', 'active', 'disabled', 'hidden', 'visible',
        'error', 'success', 'warning', 'info', 'alert', 'message',
        'modal', 'popup', 'overlay', 'dropdown', 'menu', 'nav',
        'table', 'row', 'col', 'column', 'grid', 'flex',
        'icon', 'image', 'link', 'text', 'label', 'form', 'input',
        'field', 'group', 'section', 'panel', 'tab', 'tabs',
        'pagination', 'loading', 'spinner',
    ]);
    let genericCount = 0;
    const samples = [];
    for (const file of cssFiles) {
        if (file.endsWith('.min.css'))
            continue;
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const classMatches = lines[i].match(/\.([a-zA-Z][\w-]*)\s*[{,:\s]/g);
            if (classMatches) {
                for (const cm of classMatches) {
                    const className = cm.match(/\.([a-zA-Z][\w-]*)/)?.[1];
                    if (className && genericClasses.has(className.toLowerCase()) && !className.startsWith(prefix)) {
                        genericCount++;
                        if (samples.length < 5)
                            samples.push({ className, file: rel, line: i + 1 });
                    }
                }
            }
        }
    }
    if (genericCount > 0) {
        issues.push({
            id: generateTestId('conflicts'), category: 'conflicts',
            severity: genericCount > 10 ? 'high' : 'medium',
            type: genericCount > 10 ? 'error' : 'warning',
            title: `${genericCount} generic CSS class names`,
            message: `Common class names will conflict with themes/plugins: ${samples.map(s => `.${s.className} (${s.file}:${s.line})`).join(', ')}`,
            file: samples[0]?.file || '', line: samples[0]?.line || 0, code: 'generic-css-classes',
            fix: `Prefix CSS classes with "${prefix}-"`,
        });
    }
    return issues;
}
function checkJsGlobals(pluginPath, slug, jsFiles) {
    const issues = [];
    const prefix = slug.replace(/-/g, '_');
    const genericJsGlobals = [];
    for (const file of jsFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        const isWrapped = /^\s*\(function\s*\(|^\s*\(\s*\(\)\s*=>|^\s*(?:import|export)\s/.test(content.trim());
        for (let i = 0; i < lines.length; i++) {
            if (!isWrapped) {
                const varMatch = lines[i].match(/^(?:var|let|const)\s+([a-zA-Z_$]\w*)/);
                if (varMatch) {
                    const name = varMatch[1];
                    if (!name.startsWith(prefix) && !name.startsWith('wp') && !name.startsWith('jQuery') &&
                        !name.startsWith('_') && name.length > 2) {
                        genericJsGlobals.push({ name, file: rel, line: i + 1 });
                    }
                }
            }
            const windowMatch = lines[i].match(/window\s*\.\s*([a-zA-Z_$]\w*)\s*=/);
            if (windowMatch) {
                const name = windowMatch[1];
                if (!name.startsWith(prefix) && !name.startsWith('wp') && name !== '__webpack_require__') {
                    genericJsGlobals.push({ name: `window.${name}`, file: rel, line: i + 1 });
                }
            }
        }
    }
    if (genericJsGlobals.length > 0) {
        const examples = genericJsGlobals.slice(0, 5).map(g => `${g.name} (${g.file}:${g.line})`);
        issues.push({
            id: generateTestId('conflicts'), category: 'conflicts',
            severity: genericJsGlobals.length > 5 ? 'high' : 'medium', type: 'warning',
            title: `${genericJsGlobals.length} unprefixed JS globals`,
            message: `JS globals without prefix may collide: ${examples.join(', ')}`,
            file: genericJsGlobals[0].file, line: genericJsGlobals[0].line, code: 'js-global-pollution',
            fix: `Wrap code in IIFE/module or prefix globals with "${prefix}_"`,
        });
    }
    let unwrappedScripts = 0;
    for (const file of jsFiles) {
        if (file.endsWith('.min.js'))
            continue;
        const content = safeReadFile(file);
        if (!content || content.length < 100)
            continue;
        const trimmed = content.trim();
        if (!/^\s*\(function|^\s*\(\s*\(\)\s*=>|^\s*(?:import|export)\s|^\s*"use strict"/.test(trimmed) &&
            !/jQuery\s*\(\s*(?:function|document)/.test(trimmed)) {
            unwrappedScripts++;
        }
    }
    if (unwrappedScripts > 0) {
        issues.push({
            id: generateTestId('conflicts'), category: 'conflicts',
            severity: 'medium', type: 'warning',
            title: `${unwrappedScripts} JS files not wrapped in IIFE/module`,
            message: 'JavaScript files without IIFE or ES module syntax pollute the global scope',
            file: '', line: 0, code: 'js-no-iife',
            fix: 'Wrap code in (function($){ ... })(jQuery); or use ES modules',
        });
    }
    return issues;
}
function checkRestNamespaces(pluginPath, slug, phpFiles) {
    const issues = [];
    const genericNamespaces = new Set(['api', 'v1', 'v2', 'rest', 'custom', 'plugin', 'app']);
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const nsPattern = /register_rest_route\s*\(\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = nsPattern.exec(content)) !== null) {
            const ns = match[1].split('/')[0];
            if (genericNamespaces.has(ns.toLowerCase())) {
                issues.push({
                    id: generateTestId('conflicts'), category: 'conflicts',
                    severity: 'high', type: 'error',
                    title: `Generic REST namespace "${ns}"`,
                    message: `REST namespace "${ns}" is too generic and will conflict with other plugins`,
                    file: rel, line: getLineNumber(content, match.index), code: 'generic-rest-namespace',
                    fix: `Use "${slug}/v1" as the REST namespace`,
                });
            }
        }
    }
    return issues;
}
function checkFunctionCollisions(pluginPath, slug, phpFiles) {
    const issues = [];
    const prefix = slug.replace(/-/g, '_');
    const dangerousNames = new Set([
        'init', 'setup', 'activate', 'deactivate', 'install', 'uninstall',
        'register', 'enqueue', 'enqueue_scripts', 'enqueue_styles',
        'load', 'render', 'display', 'output', 'get_options', 'save_options',
        'get_settings', 'save_settings', 'admin_menu', 'admin_init',
        'add_meta_box', 'save_meta', 'save_post', 'custom_columns',
        'register_widgets', 'register_shortcodes', 'get_template', 'load_template',
        'debug', 'log', 'helper', 'utils', 'format_date', 'sanitize',
    ]);
    let dangerousCount = 0;
    const samples = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const funcMatch = lines[i].match(/^\s*function\s+([a-zA-Z_]\w*)\s*\(/);
            if (funcMatch) {
                const funcName = funcMatch[1];
                if (dangerousNames.has(funcName) && !isInsideClass(content, i)) {
                    dangerousCount++;
                    if (samples.length < 5)
                        samples.push({ name: funcName, file: rel, line: i + 1 });
                }
            }
        }
    }
    if (dangerousCount > 0) {
        issues.push({
            id: generateTestId('conflicts'), category: 'conflicts',
            severity: 'critical', type: 'error',
            title: `${dangerousCount} high-risk function name collisions`,
            message: `Functions with very common names: ${samples.map(s => `${s.name}() (${s.file}:${s.line})`).join(', ')}`,
            file: samples[0]?.file || '', line: samples[0]?.line || 0, code: 'function-collision-risk',
            fix: `Prefix all standalone functions with "${prefix}_" or wrap in a class`,
        });
    }
    return issues;
}
function isInsideClass(content, lineIndex) {
    const lines = content.split('\n');
    let classDepth = 0;
    for (let i = 0; i <= lineIndex; i++) {
        if (/^\s*(?:abstract\s+|final\s+)?class\s+\w/.test(lines[i]))
            classDepth++;
        if (/^\s*}\s*$/.test(lines[i]) && classDepth > 0)
            classDepth--;
    }
    return classDepth > 0;
}
function checkAggressivePriorities(pluginPath, phpFiles) {
    const issues = [];
    const aggressiveHooks = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const hookMatch = lines[i].match(/(?:add_action|add_filter)\s*\(\s*['"]([^'"]+)['"][^,]*,[^,]*,\s*(-?\d+)/);
            if (hookMatch) {
                const priority = parseInt(hookMatch[2], 10);
                if (priority < 1 || priority > 100) {
                    aggressiveHooks.push({ hook: hookMatch[1], priority, file: rel, line: i + 1 });
                }
            }
        }
    }
    if (aggressiveHooks.length > 0) {
        issues.push({
            id: generateTestId('conflicts'), category: 'conflicts',
            severity: 'medium', type: 'info',
            title: `${aggressiveHooks.length} hooks with aggressive priorities`,
            message: `Hooks with very early/late priorities may override other plugins: ${aggressiveHooks.slice(0, 3).map(h => `${h.hook}@${h.priority} (${h.file}:${h.line})`).join(', ')}`,
            file: aggressiveHooks[0].file, line: aggressiveHooks[0].line, code: 'aggressive-hook-priority',
            fix: 'Use default priority (10) unless there is a specific reason to override',
        });
    }
    return issues;
}
//# sourceMappingURL=conflict-detector.js.map
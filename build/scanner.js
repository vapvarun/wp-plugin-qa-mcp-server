/**
 * WP Plugin QA MCP Server - Plugin Scanner
 * 21 regex scanners for comprehensive feature discovery
 * + cross-layer wiring analysis (HTML->JS->PHP)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { findPhpFiles, findJsFiles, findJsonFiles, findFilesByExt, getLineNumber, relativePath, safeReadFile, countLines, detectPluginSlug, } from './shared-utils.js';
/**
 * Scan a plugin directory and return a complete PluginManifest.
 */
export function scanPlugin(pluginPath) {
    const phpFiles = findPhpFiles(pluginPath);
    const jsFiles = findJsFiles(pluginPath);
    const cssFiles = findFilesByExt(pluginPath, '.css');
    // Read all file contents upfront for efficiency
    const phpContents = new Map();
    for (const file of phpFiles) {
        phpContents.set(file, safeReadFile(file));
    }
    const jsContents = new Map();
    for (const file of jsFiles) {
        jsContents.set(file, safeReadFile(file));
    }
    // Run all 21 scanners
    const header = scanPluginHeader(phpFiles, phpContents, pluginPath);
    const cpts = scanCPTs(phpFiles, phpContents, pluginPath);
    const taxonomies = scanTaxonomies(phpFiles, phpContents, pluginPath);
    const shortcodes = scanShortcodes(phpFiles, phpContents, pluginPath);
    const blocks = scanBlocks(pluginPath);
    const restRoutes = scanRestRoutes(phpFiles, phpContents, pluginPath);
    const ajaxHandlers = scanAjaxHandlers(phpFiles, phpContents, pluginPath);
    const adminPages = scanAdminPages(phpFiles, phpContents, pluginPath);
    const settings = scanSettings(phpFiles, phpContents, pluginPath);
    const widgets = scanWidgets(phpFiles, phpContents, pluginPath);
    const metaBoxes = scanMetaBoxes(phpFiles, phpContents, pluginPath);
    const cronJobs = scanCronJobs(phpFiles, phpContents, pluginPath);
    const cliCommands = scanCliCommands(phpFiles, phpContents, pluginPath);
    const dbTables = scanDbTables(phpFiles, phpContents, pluginPath);
    const templates = scanTemplates(pluginPath);
    const hooks = scanHooks(phpFiles, phpContents, pluginPath);
    const activationHooks = scanActivationHooks(phpFiles, phpContents, pluginPath);
    const customRoles = scanCustomRoles(phpFiles, phpContents, pluginPath);
    const imageSizes = scanImageSizes(phpFiles, phpContents, pluginPath);
    const blockPatterns = scanBlockPatterns(phpFiles, phpContents, pluginPath);
    const integrations = scanIntegrations(phpFiles, phpContents, pluginPath);
    // Cross-layer wiring analysis (5 checks)
    const jsAjaxCalls = scanJsAjaxCalls(jsFiles, jsContents, pluginPath);
    const jsEventHandlers = scanJsEventHandlers(jsFiles, jsContents, pluginPath);
    const localizeScripts = scanLocalizeScripts(phpFiles, phpContents, pluginPath);
    const templateSelectors = scanTemplateSelectors(phpFiles, phpContents, pluginPath);
    const wiringIssues = analyzeWiring(ajaxHandlers, jsAjaxCalls, jsEventHandlers, localizeScripts, templateSelectors);
    // Plugin-wide signals consumed by multiple checkers (consolidated here so
    // the consumers do not each re-scan the asset / PHP tree).
    const cssPrefix = detectCssPrefix(cssFiles, header.slug);
    const hasEnqueueCalls = phpContentsAnyMatch(phpContents, /wp_enqueue_(?:script|style)\s*\(/);
    const hasIntegrationConditionals = phpContentsAnyMatch(phpContents, /(?:class_exists|function_exists|defined)\s*\(\s*['"][A-Za-z_][A-Za-z0-9_\\]+['"]/);
    return {
        header,
        pluginPath,
        scannedAt: new Date().toISOString(),
        cssPrefix,
        hasEnqueueCalls,
        hasIntegrationConditionals,
        features: {
            cpts,
            taxonomies,
            shortcodes,
            blocks,
            restRoutes,
            ajaxHandlers,
            adminPages,
            settings,
            widgets,
            metaBoxes,
            cronJobs,
            cliCommands,
            dbTables,
            templates,
            hooks,
            activationHooks,
            customRoles,
            imageSizes,
            blockPatterns,
            integrations,
        },
        wiring: {
            jsAjaxCalls,
            jsEventHandlers,
            localizeScripts,
            issues: wiringIssues,
        },
        stats: {
            phpFiles: phpFiles.length,
            jsFiles: jsFiles.length,
            cssFiles: cssFiles.length,
            totalLines: countLines([...phpFiles, ...jsFiles]),
        },
    };
}
// --- Scanner 1: Plugin Header ---
function scanPluginHeader(phpFiles, contents, pluginPath) {
    const slug = detectPluginSlug(pluginPath);
    const header = {
        name: slug,
        slug,
        version: '',
        textDomain: slug,
        domainPath: '',
        requiresWP: '',
        requiresPHP: '',
        description: '',
        author: '',
        pluginURI: '',
        network: false,
    };
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const pluginNameMatch = content.match(/^\s*\*?\s*Plugin Name:\s*(.+)$/m);
        if (pluginNameMatch) {
            header.name = pluginNameMatch[1].trim();
            const extractField = (field) => {
                const m = content.match(new RegExp(`^\\s*\\*?\\s*${field}:\\s*(.+)$`, 'm'));
                return m ? m[1].trim() : '';
            };
            header.version = extractField('Version');
            header.textDomain = extractField('Text Domain') || slug;
            header.domainPath = extractField('Domain Path');
            header.requiresWP = extractField('Requires at least');
            header.requiresPHP = extractField('Requires PHP');
            header.description = extractField('Description');
            header.author = extractField('Author');
            header.pluginURI = extractField('Plugin URI');
            header.network = /^\s*\*?\s*Network:\s*true/mi.test(content);
            break;
        }
    }
    return header;
}
// --- Scanner 2: Custom Post Types ---
function scanCPTs(phpFiles, contents, pluginPath) {
    const cpts = [];
    const pattern = /register_post_type\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\[|array\s*\())?/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const postType = match[1];
            const line = getLineNumber(content, match.index);
            const contextEnd = Math.min(match.index + 2000, content.length);
            const context = content.substring(match.index, contextEnd);
            const supports = [];
            const supportsMatch = context.match(/['"]supports['"]\s*=>\s*(?:array\s*\(|\[)\s*([^)\]]+)/);
            if (supportsMatch) {
                const items = supportsMatch[1].match(/['"](\w+)['"]/g);
                if (items)
                    supports.push(...items.map(s => s.replace(/['"]/g, '')));
            }
            const hasRest = /['"]show_in_rest['"]\s*=>\s*true/.test(context);
            const taxonomies = [];
            const taxMatch = context.match(/['"]taxonomies['"]\s*=>\s*(?:array\s*\(|\[)\s*([^)\]]+)/);
            if (taxMatch) {
                const items = taxMatch[1].match(/['"]([^'"]+)['"]/g);
                if (items)
                    taxonomies.push(...items.map(s => s.replace(/['"]/g, '')));
            }
            cpts.push({ postType, label: postType, supports, hasRest, taxonomies, file: rel, line });
        }
    }
    return cpts;
}
// --- Scanner 3: Taxonomies ---
function scanTaxonomies(phpFiles, contents, pluginPath) {
    const taxonomies = [];
    const pattern = /register_taxonomy\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:['"]([^'"]+)['"]|(?:array\s*\(|\[)\s*([^)\]]+))/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const taxonomy = match[1];
            const line = getLineNumber(content, match.index);
            const postTypes = [];
            if (match[2]) {
                postTypes.push(match[2]);
            }
            else if (match[3]) {
                const items = match[3].match(/['"]([^'"]+)['"]/g);
                if (items)
                    postTypes.push(...items.map(s => s.replace(/['"]/g, '')));
            }
            const contextEnd = Math.min(match.index + 1500, content.length);
            const context = content.substring(match.index, contextEnd);
            const hierarchical = /['"]hierarchical['"]\s*=>\s*true/.test(context);
            taxonomies.push({ taxonomy, label: taxonomy, hierarchical, postTypes, file: rel, line });
        }
    }
    return taxonomies;
}
// --- Scanner 4: Shortcodes ---
function scanShortcodes(phpFiles, contents, pluginPath) {
    const shortcodes = [];
    // Match: string callback, array callback, or closure callback
    const pattern = /add_shortcode\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\]|function\s*\()/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            shortcodes.push({
                tag: match[1],
                callback: match[2] || match[3] || '[closure]',
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return shortcodes;
}
// --- Scanner 5: Blocks ---
function scanBlocks(pluginPath) {
    const blocks = [];
    const blockJsonFiles = findJsonFiles(pluginPath, 'block.json');
    for (const file of blockJsonFiles) {
        try {
            const content = readFileSync(file, 'utf-8');
            const blockJson = JSON.parse(content);
            const rel = relativePath(file, pluginPath);
            blocks.push({
                name: blockJson.name || '',
                title: blockJson.title || '',
                category: blockJson.category || '',
                attributes: blockJson.attributes ? Object.keys(blockJson.attributes) : [],
                file: rel,
                line: 1,
            });
        }
        catch {
            // Invalid JSON
        }
    }
    // Also check register_block_type calls
    const phpFiles = findPhpFiles(pluginPath);
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        const rel = relativePath(file, pluginPath);
        const pattern = /register_block_type\s*\(\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const blockName = match[1];
            if (blockName.includes('/') && !blockName.includes('__DIR__')) {
                const exists = blocks.some(b => b.name === blockName);
                if (!exists) {
                    blocks.push({
                        name: blockName,
                        title: blockName,
                        category: '',
                        attributes: [],
                        file: rel,
                        line: getLineNumber(content, match.index),
                    });
                }
            }
        }
    }
    return blocks;
}
// --- Scanner 6: REST Routes ---
function scanRestRoutes(phpFiles, contents, pluginPath) {
    const routes = [];
    const pattern = /register_rest_route\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const contextEnd = Math.min(match.index + 1500, content.length);
            const context = content.substring(match.index, contextEnd);
            const methods = [];
            const methodMatch = context.match(/['"]methods['"]\s*=>\s*(?:['"](\w+)['"]|WP_REST_Server::(\w+))/);
            if (methodMatch) {
                const method = methodMatch[1] || methodMatch[2];
                methods.push(method.toUpperCase());
            }
            let permCallback = 'unknown';
            if (context.includes('__return_true')) {
                permCallback = '__return_true';
            }
            else if (/permission_callback/.test(context)) {
                const pcMatch = context.match(/permission_callback['"]\s*=>\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])/);
                if (pcMatch)
                    permCallback = pcMatch[1] || pcMatch[2] || 'closure';
                else
                    permCallback = 'closure';
            }
            routes.push({
                namespace: match[1],
                route: match[2],
                methods: methods.length > 0 ? methods : ['GET'],
                permissionCallback: permCallback,
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    // Also detect REST controllers that extend WP_REST_Controller
    const controllerPattern = /class\s+(\w+)\s+extends\s+WP_REST_Controller/g;
    const namespacePattern = /(?:protected|private|public)?\s*(?:\$namespace|\$rest_base)\s*=\s*['"]([^'"]+)['"]/g;
    const registerPattern = /register_rest_route\s*\(/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        // Skip if we already found routes via string literals in this file
        if (routes.some(r => r.file === rel))
            continue;
        const hasController = controllerPattern.test(content);
        controllerPattern.lastIndex = 0;
        if (!hasController)
            continue;
        // Find namespace and rest_base from class properties
        let ns = '';
        let base = '';
        let nsMatch;
        while ((nsMatch = namespacePattern.exec(content)) !== null) {
            const before = content.substring(Math.max(0, nsMatch.index - 50), nsMatch.index);
            if (/namespace/i.test(before))
                ns = nsMatch[1];
            if (/rest_base/i.test(before))
                base = nsMatch[1];
        }
        namespacePattern.lastIndex = 0;
        // Count register_rest_route calls
        let routeCount = 0;
        while (registerPattern.exec(content) !== null)
            routeCount++;
        registerPattern.lastIndex = 0;
        if (routeCount > 0 && (ns || base)) {
            // Extract each register_rest_route block
            const routeBlockPattern = /register_rest_route\s*\(\s*(?:\$this->namespace|\$[\w]+)\s*,\s*['"]([^'"]*)['"]\s*(?:\.\s*['"]([^'"]*)['"]\s*)?/g;
            let rbMatch;
            while ((rbMatch = routeBlockPattern.exec(content)) !== null) {
                const routePath = (rbMatch[1] || '') + (rbMatch[2] || '');
                const contextEnd = Math.min(rbMatch.index + 1500, content.length);
                const context = content.substring(rbMatch.index, contextEnd);
                const methods = [];
                const methodMatch = context.match(/['"]methods['"]\s*=>\s*(?:['"](\w+)['"]|WP_REST_Server::(\w+))/);
                if (methodMatch) {
                    methods.push((methodMatch[1] || methodMatch[2]).toUpperCase());
                }
                let permCallback = 'unknown';
                if (context.includes('__return_true'))
                    permCallback = '__return_true';
                else if (/permission_callback/.test(context))
                    permCallback = 'closure';
                routes.push({
                    namespace: ns || 'unknown',
                    route: routePath || base || 'unknown',
                    methods: methods.length > 0 ? methods : ['GET'],
                    permissionCallback: permCallback,
                    file: rel,
                    line: getLineNumber(content, rbMatch.index),
                });
            }
            // If no individual routes found but we know it's a controller
            if (!routes.some(r => r.file === rel) && routeCount > 0) {
                routes.push({
                    namespace: ns || 'unknown',
                    route: '/' + (base || 'unknown'),
                    methods: ['GET'],
                    permissionCallback: 'unknown',
                    file: rel,
                    line: getLineNumber(content, 0),
                });
            }
        }
    }
    return routes;
}
// --- Scanner 7: AJAX Handlers ---
function scanAjaxHandlers(phpFiles, contents, pluginPath) {
    const handlers = [];
    // Match: string callback, array callback, or closure callback
    const pattern = /add_action\s*\(\s*['"]wp_ajax_(nopriv_)?([^'"]+)['"]\s*,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\]|function\s*\()/g;
    const actionMap = new Map();
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const isNopriv = !!match[1];
            const action = match[2];
            const callback = match[3] || match[4] || '[closure]';
            const isClosure = !match[3] && !match[4];
            const line = getLineNumber(content, match.index);
            const existing = actionMap.get(action);
            if (existing) {
                if (isNopriv)
                    existing.loggedOut = true;
                else
                    existing.loggedIn = true;
            }
            else {
                actionMap.set(action, {
                    loggedIn: !isNopriv,
                    loggedOut: isNopriv,
                    callback,
                    file: rel,
                    line,
                    isClosure,
                    closureIndex: match.index,
                });
            }
        }
    }
    for (const [action, info] of actionMap) {
        let hasNonceCheck = false;
        if (info.isClosure) {
            // For closures, check the 2000 chars after the add_action call
            for (const file of phpFiles) {
                const content = contents.get(file) || '';
                const rel = relativePath(file, pluginPath);
                if (rel !== info.file)
                    continue;
                const closureEnd = Math.min(info.closureIndex + 2000, content.length);
                const closureBody = content.substring(info.closureIndex, closureEnd);
                if (/check_ajax_referer|check_admin_referer|wp_verify_nonce/.test(closureBody)) {
                    hasNonceCheck = true;
                }
            }
        }
        else {
            // Named callback — find the function definition
            for (const file of phpFiles) {
                const content = contents.get(file) || '';
                if (content.includes(info.callback)) {
                    const funcPattern = new RegExp(`function\\s+${info.callback}\\s*\\([^)]*\\)\\s*\\{`, 'g');
                    const funcMatch = funcPattern.exec(content);
                    if (funcMatch) {
                        const funcEnd = Math.min(funcMatch.index + 2000, content.length);
                        const funcBody = content.substring(funcMatch.index, funcEnd);
                        if (/check_ajax_referer|check_admin_referer|wp_verify_nonce/.test(funcBody)) {
                            hasNonceCheck = true;
                        }
                    }
                }
            }
        }
        handlers.push({
            action,
            callback: info.callback,
            loggedIn: info.loggedIn,
            loggedOut: info.loggedOut,
            hasNonceCheck,
            file: info.file,
            line: info.line,
        });
    }
    return handlers;
}
// --- Scanner 8: Admin Pages ---
function scanAdminPages(phpFiles, contents, pluginPath) {
    const pages = [];
    const menuPattern = /add_menu_page\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])?/g;
    const submenuPattern = /add_submenu_page\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])?/g;
    const optionsPattern = /add_options_page\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])?/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        // Normalize i18n wrappers so regex can match string arguments
        const normalized = content.replace(/(?:__|esc_html__|esc_attr__)\s*\(\s*(['"][^'"]*['"])\s*,\s*['"][^'"]*['"]\s*\)/g, '$1');
        while ((match = menuPattern.exec(normalized)) !== null) {
            pages.push({
                slug: match[4],
                title: match[1],
                capability: match[3],
                callback: match[5] || match[6] || '',
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
        while ((match = submenuPattern.exec(normalized)) !== null) {
            pages.push({
                slug: match[5],
                title: match[2],
                capability: match[4],
                callback: match[6] || match[7] || '',
                parentSlug: match[1],
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
        while ((match = optionsPattern.exec(normalized)) !== null) {
            pages.push({
                slug: match[4],
                title: match[1],
                capability: match[3],
                callback: match[5] || match[6] || '',
                parentSlug: 'options-general.php',
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return pages;
}
// --- Scanner 9: Settings ---
function scanSettings(phpFiles, contents, pluginPath) {
    const settings = [];
    const pattern = /register_setting\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"](?:\s*,\s*(?:array\s*\(|\[|['"](\w+)['"]))?/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            let sanitizeCallback = '';
            if (match[3]) {
                sanitizeCallback = match[3];
            }
            else {
                const contextEnd = Math.min(match.index + 500, content.length);
                const context = content.substring(match.index, contextEnd);
                const scMatch = context.match(/['"]sanitize_callback['"]\s*=>\s*['"](\w+)['"]/);
                if (scMatch)
                    sanitizeCallback = scMatch[1];
            }
            settings.push({
                optionName: match[2],
                group: match[1],
                sanitizeCallback,
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return settings;
}
// --- Scanner 10: Widgets ---
function scanWidgets(phpFiles, contents, pluginPath) {
    const widgets = [];
    const pattern = /class\s+(\w+)\s+extends\s+WP_Widget/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const className = match[1];
            let idBase = className.toLowerCase().replace(/_/g, '-');
            const idMatch = content.match(new RegExp(`parent::__construct\\s*\\(\\s*['"]([^'"]+)['"]`));
            if (idMatch)
                idBase = idMatch[1];
            widgets.push({
                className,
                idBase,
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return widgets;
}
// --- Scanner 11: Meta Boxes ---
function scanMetaBoxes(phpFiles, contents, pluginPath) {
    const metaBoxes = [];
    const pattern = /add_meta_box\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])\s*,\s*['"]([^'"]+)['"]/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            metaBoxes.push({
                id: match[1],
                title: match[2],
                callback: match[3] || match[4],
                postType: match[5],
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return metaBoxes;
}
// --- Scanner 12: Cron Jobs ---
function scanCronJobs(phpFiles, contents, pluginPath) {
    const cronJobs = [];
    const pattern = /wp_schedule_event\s*\([^,]+,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
    const singlePattern = /wp_schedule_single_event\s*\([^,]+,\s*['"]([^'"]+)['"]/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            cronJobs.push({
                hook: match[2],
                recurrence: match[1],
                callback: match[2],
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
        while ((match = singlePattern.exec(content)) !== null) {
            cronJobs.push({
                hook: match[1],
                recurrence: 'single',
                callback: match[1],
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return cronJobs;
}
// --- Scanner 13: CLI Commands ---
function scanCliCommands(phpFiles, contents, pluginPath) {
    const commands = [];
    const pattern = /WP_CLI::add_command\s*\(\s*['"]([^'"]+)['"]/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            commands.push({
                command: match[1],
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return commands;
}
// --- Scanner 14: DB Tables ---
function scanDbTables(phpFiles, contents, pluginPath) {
    const tables = [];
    const prefixPattern = /\$wpdb->prefix\s*\.\s*['"](\w+)['"]/g;
    const seen = new Set();
    const wpCoreTables = new Set([
        'posts', 'postmeta', 'options', 'users', 'usermeta',
        'terms', 'term_taxonomy', 'term_relationships', 'termmeta',
        'comments', 'commentmeta', 'links',
    ]);
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        // Check CREATE TABLE statements
        const createPattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`'"]*\{?\$?(?:wpdb->prefix|table_prefix|prefix)\}?[`'"]*(\w+)/gi;
        while ((match = createPattern.exec(content)) !== null) {
            const suffix = match[1];
            if (!seen.has(suffix)) {
                seen.add(suffix);
                tables.push({ tableSuffix: suffix, file: rel, line: getLineNumber(content, match.index) });
            }
        }
        // Also scan for table names in dbDelta schema strings (CREATE TABLE {$prefix}tablename)
        const dbDeltaPattern = /CREATE\s+TABLE\s+\{?\$\w+\}?(\w+)\s*\(/gi;
        while ((match = dbDeltaPattern.exec(content)) !== null) {
            const suffix = match[1];
            if (!seen.has(suffix) && !wpCoreTables.has(suffix)) {
                seen.add(suffix);
                tables.push({ tableSuffix: suffix, file: rel, line: getLineNumber(content, match.index) });
            }
        }
        while ((match = prefixPattern.exec(content)) !== null) {
            const suffix = match[1];
            if (!seen.has(suffix) && !wpCoreTables.has(suffix)) {
                seen.add(suffix);
                tables.push({ tableSuffix: suffix, file: rel, line: getLineNumber(content, match.index) });
            }
        }
    }
    return tables;
}
// --- Scanner 15: Templates ---
function scanTemplates(pluginPath) {
    const templates = [];
    const templateDirs = ['templates', 'partials', 'views', 'public/partials', 'includes/templates'];
    for (const dir of templateDirs) {
        const fullDir = join(pluginPath, dir);
        const phpFiles = findPhpFiles(fullDir);
        for (const file of phpFiles) {
            const rel = relativePath(file, pluginPath);
            const content = safeReadFile(file);
            const hooks = [];
            const hookPattern = /(?:do_action|apply_filters)\s*\(\s*['"]([^'"]+)['"]/g;
            let match;
            while ((match = hookPattern.exec(content)) !== null) {
                hooks.push(match[1]);
            }
            const slug = detectPluginSlug(pluginPath);
            const overridePath = `theme/${slug}/${rel.replace(/^(?:templates|partials|views)\//, '')}`;
            templates.push({ file: rel, overridePath, hooksInTemplate: hooks });
        }
    }
    return templates;
}
// --- Scanner 16: Hooks (Provided & Consumed) ---
function scanHooks(phpFiles, contents, pluginPath) {
    const provided = [];
    const consumed = [];
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        // Provided hooks (do_action, apply_filters)
        const providePattern = /(?:do_action|apply_filters)\s*\(\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = providePattern.exec(content)) !== null) {
            const type = content.substring(match.index, match.index + 10).includes('do_action') ? 'action' : 'filter';
            provided.push({ type, hookName: match[1], file: rel, line: getLineNumber(content, match.index) });
        }
        // Consumed hooks (add_action, add_filter)
        const consumePattern = /(?:add_action|add_filter)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\]|(?:\$this\s*,\s*)?['"](\w+)['"])\s*(?:,\s*(\d+))?\s*(?:,\s*(\d+))?/g;
        while ((match = consumePattern.exec(content)) !== null) {
            const type = content.substring(match.index, match.index + 10).includes('add_action') ? 'action' : 'filter';
            consumed.push({
                type,
                hookName: match[1],
                callback: match[2] || match[3] || match[4],
                file: rel,
                line: getLineNumber(content, match.index),
                priority: match[5] ? parseInt(match[5], 10) : 10,
                acceptedArgs: match[6] ? parseInt(match[6], 10) : 1,
            });
        }
    }
    return { provided, consumed };
}
// --- Scanner 17: Activation/Deactivation/Uninstall Hooks ---
function scanActivationHooks(phpFiles, contents, pluginPath) {
    const hooks = [];
    const patterns = [
        { regex: /register_activation_hook\s*\(\s*[^,]+,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])/g, type: 'activation' },
        { regex: /register_deactivation_hook\s*\(\s*[^,]+,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])/g, type: 'deactivation' },
        { regex: /register_uninstall_hook\s*\(\s*[^,]+,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])/g, type: 'uninstall' },
    ];
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        for (const { regex, type } of patterns) {
            let match;
            while ((match = regex.exec(content)) !== null) {
                hooks.push({
                    type,
                    callback: match[1] || match[2],
                    file: rel,
                    line: getLineNumber(content, match.index),
                });
            }
        }
    }
    return hooks;
}
// --- Scanner 18: Custom Roles ---
function scanCustomRoles(phpFiles, contents, pluginPath) {
    const roles = [];
    const pattern = /add_role\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            roles.push({
                role: match[1],
                displayName: match[2],
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
        // Also detect add_role with class constants
        const constRolePattern = /add_role\s*\(\s*(self|static)::\w+\s*,\s*(?:__\s*\(\s*)?['"]([^'"]+)['"]/g;
        while ((match = constRolePattern.exec(content)) !== null) {
            // Try to resolve the constant value
            const constMatch = content.match(/const\s+\w+\s*=\s*['"]([^'"]+)['"]/);
            const roleName = constMatch ? constMatch[1] : 'custom_role';
            roles.push({
                role: roleName,
                displayName: match[2],
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return roles;
}
// --- Scanner 19: Custom Image Sizes ---
function scanImageSizes(phpFiles, contents, pluginPath) {
    const sizes = [];
    const pattern = /add_image_size\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(true|false))?\s*\)/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            sizes.push({
                name: match[1],
                width: parseInt(match[2], 10),
                height: parseInt(match[3], 10),
                crop: match[4] === 'true',
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return sizes;
}
// --- Scanner 20: Block Patterns ---
function scanBlockPatterns(phpFiles, contents, pluginPath) {
    const patterns = [];
    const pattern = /register_block_pattern\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:array\s*\(|\[)/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const contextEnd = Math.min(match.index + 500, content.length);
            const context = content.substring(match.index, contextEnd);
            const titleMatch = context.match(/['"]title['"]\s*=>\s*(?:__\s*\(\s*)?['"]([^'"]+)['"]/);
            patterns.push({
                name: match[1],
                title: titleMatch ? titleMatch[1] : match[1],
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return patterns;
}
// --- Scanner 21: Third-Party Integrations ---
function scanIntegrations(phpFiles, contents, pluginPath) {
    const integrations = [];
    const integrationPatterns = [
        {
            type: 'woocommerce',
            hookPatterns: [
                /add_(?:action|filter)\s*\(\s*['"]woocommerce_([^'"]+)['"]/g,
                /class\s+\w+\s+extends\s+WC_/g,
            ],
        },
        {
            type: 'buddypress',
            hookPatterns: [
                /add_(?:action|filter)\s*\(\s*['"]bp_([^'"]+)['"]/g,
                /class\s+\w+\s+extends\s+BP_Component/g,
            ],
        },
        {
            type: 'elementor',
            hookPatterns: [
                /add_(?:action|filter)\s*\(\s*['"]elementor\/([^'"]+)['"]/g,
                /class\s+\w+\s+extends\s+\\?Elementor\\(?:Widget_Base|Skin_Base)/g,
            ],
        },
        {
            type: 'bbpress',
            hookPatterns: [
                /add_(?:action|filter)\s*\(\s*['"]bbp_([^'"]+)['"]/g,
            ],
        },
        {
            type: 'learndash',
            hookPatterns: [
                /add_(?:action|filter)\s*\(\s*['"]learndash_([^'"]+)['"]/g,
                /add_(?:action|filter)\s*\(\s*['"]ld_([^'"]+)['"]/g,
            ],
        },
    ];
    for (const integ of integrationPatterns) {
        const hooksFound = [];
        let firstFile = '';
        let firstLine = 0;
        for (const file of phpFiles) {
            const content = contents.get(file) || '';
            const rel = relativePath(file, pluginPath);
            for (const hookPattern of integ.hookPatterns) {
                let match;
                while ((match = hookPattern.exec(content)) !== null) {
                    hooksFound.push(match[0]);
                    if (!firstFile) {
                        firstFile = rel;
                        firstLine = getLineNumber(content, match.index);
                    }
                }
            }
        }
        if (hooksFound.length > 0) {
            integrations.push({
                type: integ.type,
                hooks: hooksFound.slice(0, 20), // Cap at 20 for readability
                file: firstFile,
                line: firstLine,
            });
        }
    }
    return integrations;
}
// --- Cross-Layer: JS AJAX Calls ---
function scanJsAjaxCalls(jsFiles, contents, pluginPath) {
    const calls = [];
    const actionPattern = /action\s*:\s*['"]([a-zA-Z_]+)['"]/g;
    const formDataPattern = /(?:FormData|append)\s*\(\s*['"]action['"]\s*,\s*['"]([a-zA-Z_]+)['"]/g;
    for (const file of jsFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = actionPattern.exec(content)) !== null) {
            const contextStart = Math.max(0, match.index - 500);
            const contextEnd = Math.min(match.index + 500, content.length);
            const context = content.substring(contextStart, contextEnd);
            const nonceMatch = context.match(/(?:nonce|security|_wpnonce)\s*:\s*(\w+\.?\w*)/);
            calls.push({
                action: match[1],
                nonceKey: nonceMatch ? nonceMatch[1] : '',
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
        while ((match = formDataPattern.exec(content)) !== null) {
            calls.push({
                action: match[1],
                nonceKey: '',
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return calls;
}
// --- Cross-Layer: JS Event Handlers ---
function scanJsEventHandlers(jsFiles, contents, pluginPath) {
    const handlers = [];
    const patterns = [
        /\$\([^)]+\)\.on\s*\(\s*['"](\w+)['"]\s*,\s*['"]([^'"]+)['"]/g,
        /\$\(document\)\.on\s*\(\s*['"](\w+)['"]\s*,\s*['"]([^'"]+)['"]/g,
        /addEventListener\s*\(\s*['"](\w+)['"]/g,
    ];
    for (const file of jsFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                handlers.push({
                    selector: match[2] || 'document',
                    event: match[1],
                    file: rel,
                    line: getLineNumber(content, match.index),
                });
            }
        }
    }
    return handlers;
}
// --- Cross-Layer: Localize Scripts ---
function scanLocalizeScripts(phpFiles, contents, pluginPath) {
    const scripts = [];
    const pattern = /wp_localize_script\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const contextEnd = Math.min(match.index + 1000, content.length);
            const context = content.substring(match.index, contextEnd);
            const data = {};
            const dataPattern = /['"](\w+)['"]\s*=>\s*(?:wp_create_nonce\s*\(\s*['"]([^'"]+)['"]|admin_url\s*\(\s*['"]([^'"]+)['"]|['"]([^'"]+)['"])/g;
            let dataMatch;
            while ((dataMatch = dataPattern.exec(context)) !== null) {
                data[dataMatch[1]] = dataMatch[2] || dataMatch[3] || dataMatch[4] || '';
            }
            scripts.push({
                handle: match[1],
                objectName: match[2],
                data,
                file: rel,
                line: getLineNumber(content, match.index),
            });
        }
    }
    return scripts;
}
// --- Cross-Layer: Template Selectors (interactive HTML) ---
function scanTemplateSelectors(phpFiles, contents, pluginPath) {
    const selectors = [];
    const classPattern = /class\s*=\s*["']([^"']*(?:btn|button|action|delete|submit|toggle|trigger|dismiss|close|confirm|cancel)[^"']*)["']/gi;
    const dataActionPattern = /data-action\s*=\s*["']([^"']+)["']/gi;
    for (const file of phpFiles) {
        const content = contents.get(file) || '';
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // data-action attributes (explicit JS triggers)
            dataActionPattern.lastIndex = 0;
            let match;
            while ((match = dataActionPattern.exec(line)) !== null) {
                const contextLines = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 10)).join('\n');
                const nonceMatch = contextLines.match(/wp_(?:create_)?nonce(?:_field)?\s*\(\s*['"]([^'"]+)['"]/);
                selectors.push({
                    selector: `[data-action="${match[1]}"]`,
                    element: 'data-action',
                    hasDataAction: true,
                    dataAction: match[1],
                    nonceField: nonceMatch ? nonceMatch[1] : undefined,
                    file: rel, line: i + 1,
                });
            }
            // Classes with action-like names on interactive elements
            classPattern.lastIndex = 0;
            while ((match = classPattern.exec(line)) !== null) {
                const actionClasses = match[1].split(/\s+/).filter(c => /btn|button|action|delete|submit|toggle|trigger|dismiss|close|confirm|cancel/i.test(c));
                if (actionClasses.length === 0)
                    continue;
                const contextLines = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 10)).join('\n');
                const nonceMatch = contextLines.match(/wp_(?:create_)?nonce(?:_field)?\s*\(\s*['"]([^'"]+)['"]/);
                selectors.push({
                    selector: '.' + actionClasses.join('.'),
                    element: 'class',
                    hasDataAction: false,
                    nonceField: nonceMatch ? nonceMatch[1] : undefined,
                    file: rel, line: i + 1,
                });
            }
        }
    }
    return selectors;
}
// --- Cross-Layer: Wiring Analysis (5 checks) ---
function analyzeWiring(ajaxHandlers, jsAjaxCalls, jsEventHandlers, localizeScripts, templateSelectors) {
    const issues = [];
    const registeredActions = new Set(ajaxHandlers.map(h => h.action));
    const calledActions = new Set(jsAjaxCalls.map(c => c.action));
    const jsSelectors = new Set(jsEventHandlers.map(h => h.selector));
    // Check 1: JS calls action but no PHP handler (broken AJAX)
    for (const call of jsAjaxCalls) {
        if (!registeredActions.has(call.action)) {
            issues.push({
                type: 'broken-ajax', severity: 'critical',
                source: `${call.file}:${call.line}`, target: `wp_ajax_${call.action}`,
                details: `JS calls action "${call.action}" but no wp_ajax_${call.action} handler exists`,
                file: call.file, line: call.line,
            });
        }
    }
    // Check 2: PHP handler registered but never called from JS (dead code)
    for (const handler of ajaxHandlers) {
        if (!calledActions.has(handler.action)) {
            if (['heartbeat'].some(p => handler.action.startsWith(p)))
                continue;
            issues.push({
                type: 'dead-handler', severity: 'medium',
                source: `${handler.file}:${handler.line}`, target: handler.action,
                details: `PHP handler "${handler.action}" registered but never called from JS`,
                file: handler.file, line: handler.line,
            });
        }
    }
    // Check 3: AJAX handler missing nonce verification (CSRF risk)
    for (const handler of ajaxHandlers) {
        if (!handler.hasNonceCheck) {
            issues.push({
                type: 'nonce-mismatch', severity: 'critical',
                source: `${handler.file}:${handler.line}`, target: handler.action,
                details: `AJAX handler "${handler.action}" has no nonce verification (CSRF risk)`,
                file: handler.file, line: handler.line,
            });
        }
    }
    // Check 4: Template selectors with no matching JS handler (button does nothing)
    if (templateSelectors) {
        for (const tpl of templateSelectors) {
            if (!tpl.hasDataAction)
                continue; // Only check explicit data-action elements
            const hasHandler = jsEventHandlers.some(h => {
                const hSel = h.selector.toLowerCase();
                const tSel = (tpl.dataAction || '').toLowerCase();
                return hSel.includes(tSel) || hSel.includes(tpl.selector.replace(/[\[\]"=]/g, ''));
            });
            // Also check if any JS file references this data-action value
            if (!hasHandler) {
                issues.push({
                    type: 'orphaned-selector', severity: 'high',
                    source: `${tpl.file}:${tpl.line}`, target: tpl.selector,
                    details: `Template has data-action="${tpl.dataAction}" but no JS handler listens for it`,
                    file: tpl.file, line: tpl.line,
                });
            }
        }
    }
    // Check 5: Nonce consistency — PHP creates nonces but JS doesn't send them
    const phpNonces = new Set();
    for (const script of localizeScripts) {
        for (const [key, value] of Object.entries(script.data)) {
            if (/nonce|security|_wpnonce/i.test(key) && value)
                phpNonces.add(value);
        }
    }
    if (templateSelectors) {
        for (const tpl of templateSelectors) {
            if (tpl.nonceField)
                phpNonces.add(tpl.nonceField);
        }
    }
    const jsNonces = new Set(jsAjaxCalls.filter(c => c.nonceKey).map(c => c.nonceKey));
    if (phpNonces.size > 0 && jsNonces.size === 0 && jsAjaxCalls.length > 0) {
        issues.push({
            type: 'nonce-inconsistency', severity: 'high',
            source: 'PHP templates/localize', target: 'JS AJAX calls',
            details: `PHP creates nonces (${Array.from(phpNonces).join(', ')}) but no JS AJAX call sends a nonce — requests will fail verification`,
            file: '', line: 0,
        });
    }
    return issues;
}
/* ─── Plugin-wide signals (consumed by multiple checkers) ───────── */
/**
 * Detect the plugin's CSS prefix by frequency-counting `--<token>-*`
 * custom-property prefixes in the asset CSS files. Falls back to the
 * first hyphen-delimited segment of the plugin slug when no CSS files
 * exist or no custom properties are defined (e.g. a plugin that ships
 * without front-end assets).
 *
 * Replaces three independent implementations in:
 *   - ux-guidelines-checker.ts (was returning hard-coded 'lrn')
 *   - visual-regression-checker.ts (same)
 *   - editor-layout-bias-checker.ts (PHP-class-token variant)
 *
 * Result is plugin-agnostic: the fallback is derived from the plugin
 * slug rather than the previous Learnomy default.
 */
function detectCssPrefix(cssFiles, slug) {
    const fallback = (slug || 'plugin').split('-')[0] || 'plugin';
    if (cssFiles.length === 0) {
        return fallback;
    }
    const counts = new Map();
    const tokenRe = /--([a-z][a-z0-9]*)-/gi;
    for (const file of cssFiles) {
        const text = safeReadFile(file);
        if (!text)
            continue;
        for (const m of text.matchAll(tokenRe)) {
            const token = m[1].toLowerCase();
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
    }
    if (counts.size === 0) {
        return fallback;
    }
    let best = fallback;
    let bestCount = 0;
    for (const [token, count] of counts) {
        if (count > bestCount) {
            best = token;
            bestCount = count;
        }
    }
    return best;
}
/** Tiny helper - does any phpContents value match the regex? */
function phpContentsAnyMatch(phpContents, pattern) {
    for (const text of phpContents.values()) {
        if (pattern.test(text)) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=scanner.js.map
/**
 * WP Plugin QA MCP Server - Plugin Scanner
 * 21 regex scanners for comprehensive feature discovery
 * + cross-layer wiring analysis (HTML->JS->PHP)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  PluginManifest, PluginHeader, CptInfo, TaxonomyInfo, ShortcodeInfo,
  BlockInfo, RestRouteInfo, AjaxHandlerInfo, AdminPageInfo, SettingInfo,
  WidgetInfo, MetaBoxInfo, CronJobInfo, CliCommandInfo, DbTableInfo,
  TemplateFileInfo, HookInfo, ProvidedHook, JsAjaxCall, JsEventHandler,
  LocalizeScriptInfo, WiringIssue, TemplateSelector,
  ActivationHookInfo, CustomRoleInfo, ImageSizeInfo, BlockPatternInfo, IntegrationInfo,
  OptionWiringInfo, OptionSite,
  HookListenerInfo, FeatureGroupInfo, FrontendJsInfo,
} from './types.js';
import {
  findPhpFiles, findJsFiles, findJsonFiles, findFilesByExt,
  getLineNumber, relativePath, safeReadFile, countLines, detectPluginSlug,
} from './shared-utils.js';

/**
 * Scan a plugin directory and return a complete PluginManifest.
 */
export function scanPlugin(pluginPath: string): PluginManifest {
  const phpFiles = findPhpFiles(pluginPath);
  const jsFiles = findJsFiles(pluginPath);
  const cssFiles = findFilesByExt(pluginPath, '.css');

  // Read all file contents upfront for efficiency
  const phpContents = new Map<string, string>();
  for (const file of phpFiles) {
    phpContents.set(file, safeReadFile(file));
  }

  const jsContents = new Map<string, string>();
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
  const optionsWiring = scanOptionsWiring(phpFiles, phpContents, pluginPath);
  const widgets = scanWidgets(phpFiles, phpContents, pluginPath);
  const metaBoxes = scanMetaBoxes(phpFiles, phpContents, pluginPath);
  const cronJobs = scanCronJobs(phpFiles, phpContents, pluginPath);
  const cliCommands = scanCliCommands(phpFiles, phpContents, pluginPath);
  const dbTables = scanDbTables(phpFiles, phpContents, pluginPath);
  const templates = scanTemplates(pluginPath, phpContents);
  const hooks = scanHooks(phpFiles, phpContents, pluginPath);
  const hookListeners = scanHookListeners(phpFiles, phpContents, pluginPath);
  const frontendJs = scanFrontendJs(pluginPath);
  const featureGroups = scanFeatureGroups(optionsWiring, restRoutes, templates, adminPages, phpContents);
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
  const hasEnqueueCalls = phpContentsAnyMatch(
    phpContents,
    /wp_enqueue_(?:script|style)\s*\(/,
  );
  const hasIntegrationConditionals = phpContentsAnyMatch(
    phpContents,
    /(?:class_exists|function_exists|defined)\s*\(\s*['"][A-Za-z_][A-Za-z0-9_\\]+['"]/,
  );

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
      optionsWiring,
      hookListeners,
      featureGroups,
      frontendJs,
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

function scanPluginHeader(phpFiles: string[], contents: Map<string, string>, pluginPath: string): PluginHeader {
  const slug = detectPluginSlug(pluginPath);
  const header: PluginHeader = {
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

      const extractField = (field: string): string => {
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

function scanCPTs(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CptInfo[] {
  const cpts: CptInfo[] = [];
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

      const supports: string[] = [];
      const supportsMatch = context.match(/['"]supports['"]\s*=>\s*(?:array\s*\(|\[)\s*([^)\]]+)/);
      if (supportsMatch) {
        const items = supportsMatch[1].match(/['"](\w+)['"]/g);
        if (items) supports.push(...items.map(s => s.replace(/['"]/g, '')));
      }

      const hasRest = /['"]show_in_rest['"]\s*=>\s*true/.test(context);

      const taxonomies: string[] = [];
      const taxMatch = context.match(/['"]taxonomies['"]\s*=>\s*(?:array\s*\(|\[)\s*([^)\]]+)/);
      if (taxMatch) {
        const items = taxMatch[1].match(/['"]([^'"]+)['"]/g);
        if (items) taxonomies.push(...items.map(s => s.replace(/['"]/g, '')));
      }

      cpts.push({ postType, label: postType, supports, hasRest, taxonomies, file: rel, line });
    }
  }

  return cpts;
}

// --- Scanner 3: Taxonomies ---

function scanTaxonomies(phpFiles: string[], contents: Map<string, string>, pluginPath: string): TaxonomyInfo[] {
  const taxonomies: TaxonomyInfo[] = [];
  const pattern = /register_taxonomy\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:['"]([^'"]+)['"]|(?:array\s*\(|\[)\s*([^)\]]+))/g;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const taxonomy = match[1];
      const line = getLineNumber(content, match.index);

      const postTypes: string[] = [];
      if (match[2]) {
        postTypes.push(match[2]);
      } else if (match[3]) {
        const items = match[3].match(/['"]([^'"]+)['"]/g);
        if (items) postTypes.push(...items.map(s => s.replace(/['"]/g, '')));
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

export function scanShortcodes(phpFiles: string[], contents: Map<string, string>, pluginPath: string): ShortcodeInfo[] {
  const shortcodes: ShortcodeInfo[] = [];
  // The tag is resolved rather than required to be a literal: a tag registered as
  // self::SHORTCODE used to vanish entirely (BuddyNext Pro's buddynext_members_only
  // is the documented case — 3 reported against 4 real).
  const pattern = /add_shortcode\s*\(/g;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let match;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(content)) !== null) {
      if (isCommentedOut(content, match.index)) continue;

      const args = callArgs(content, match.index);
      if (!args || args.length === 0) continue;

      const tag = resolveScalarArg(args[0], content, contents);
      if (!tag) continue;

      const rawCb = args[1] || '';
      const cbMatch = rawCb.match(/['"](\w+)['"]\s*\)?\s*$/);
      shortcodes.push({
        tag,
        callback: /^function\s*\(|^fn\s*\(|^static\s+f/.test(rawCb)
          ? '[closure]'
          : cbMatch
            ? cbMatch[1]
            : rawCb.replace(/\s+/g, ' ').trim() || '[closure]',
        file: rel,
        line: getLineNumber(content, match.index),
      });
    }
  }

  return shortcodes;
}

// --- Scanner 5: Blocks ---

function scanBlocks(pluginPath: string): BlockInfo[] {
  const blocks: BlockInfo[] = [];
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
    } catch {
      // Invalid JSON
    }
  }

  // Also check register_block_type calls
  const phpFiles = findPhpFiles(pluginPath);

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    const rel = relativePath(file, pluginPath);
    const pattern = /register_block_type\s*\(\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

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

// Resolve the namespace argument of a register_rest_route() call. Handles a
// string literal ('ns/v1'), a property ($this->namespace) or a local alias
// ($ns = $this->namespace) by searching the same file for the namespace
// assignment. Returns '' when it can't be resolved in-file (e.g. the property
// is set by a base controller in another file) — the route is still counted.
function resolveRestNamespace(arg1: string, content: string, allContents?: Map<string, string>): string {
  const t = arg1.trim();
  const lit = t.match(/^['"]([^'"]+)['"]$/);
  if (lit) return lit[1];
  // self::NS / static::NS / Foo::NS — the shape that made six controllers
  // vanish from the manifest entirely.
  const constVal = resolveClassConstant(t, content, allContents);
  if (constVal !== null) return constVal;
  const propAssign = content.match(/(?:\$this->)?namespace\s*=\s*['"]([^'"]+)['"]/);
  if (propAssign) return propAssign[1];
  const anyNs = content.match(/['"]([a-z0-9_-]+\/v\d+)['"]/i);
  return anyNs ? anyNs[1] : '';
}

// Resolve a PHP class constant reference (self::BASE, static::NS, Foo::ROUTE)
// to its literal value by finding `const NAME = '...'` — same file first, then
// any other file in the plugin, which covers a constant inherited from a base
// controller. Returns null when the expression is not a constant reference or
// no definition is found, so callers can fall back rather than invent a value.
function resolveClassConstant(expr: string, content: string, allContents?: Map<string, string>): string | null {
  const ref = expr.trim().match(/^(?:self|static|parent|[A-Za-z_\\][\w\\]*)::([A-Z_][A-Z0-9_]*)$/);
  if (!ref) return null;
  const name = ref[1];
  const defPattern = new RegExp(`\\bconst\\s+${name}\\s*=\\s*['"]([^'"]*)['"]`);

  const here = content.match(defPattern);
  if (here) return here[1];

  if (allContents) {
    for (const other of allContents.values()) {
      const m = other.match(defPattern);
      if (m) return m[1];
    }
  }
  return null;
}

// Resolve a register_rest_route() route-path argument, which is a literal, a
// class constant, or a concatenation of both (self::BASE . '/(?P<id>[\d]+)').
// Returns '' when nothing resolves, so the caller can still record the route.
function resolveRoutePath(arg2: string, content: string, allContents?: Map<string, string>): string {
  const parts = arg2.trim().split('.');
  let out = '';
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const lit = p.match(/^['"]([\s\S]*)['"]$/);
    if (lit) {
      out += lit[1];
      continue;
    }
    const c = resolveClassConstant(p, content, allContents);
    if (c !== null) {
      out += c;
      continue;
    }
    // An unresolvable fragment (a variable) — keep what we have rather than
    // dropping the whole route.
    return out;
  }
  return out;
}

// Split a PHP argument list at TOP-LEVEL commas only, so a nested call or array
// (esc_html__( 'x', 'domain' ), array( $this, 'render' )) counts as one argument
// rather than being sliced in half. Quotes are tracked so a comma inside a string
// never splits.
function splitTopLevelArgs(argsText: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i];

    if (quote) {
      current += ch;
      if (ch === '\\') {
        if (i + 1 < argsText.length) current += argsText[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    // Comments are dropped, not carried into the argument. A trailing comment is
    // ordinary in a multi-line WordPress call — add_submenu_page() with
    // `'', // No label, hides from submenu.` — and its comma would otherwise
    // split one argument into two and shift every argument after it.
    const rest = commentSkip(argsText, i);
    if (rest !== -1) {
      i = rest;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// When a comment starts at `i`, return the index of its last character so the
// caller can skip it; otherwise -1. Handles //, #, and block comments.
// Comments are skipped rather than parsed because their contents are prose: an
// apostrophe in "don't" would otherwise open a string that never closes, and a
// comma would split an argument.
function commentSkip(text: string, i: number): number {
  const two = text.substr(i, 2);
  if (two === '//' || text[i] === '#') {
    const nl = text.indexOf('\n', i);
    return nl === -1 ? text.length : nl - 1;
  }
  if (two === '/*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 1;
  }
  return -1;
}

// Return the raw argument expressions of the call whose name match starts at
// `callIndex`. Walks from the opening paren to its true match, so multi-line
// calls and nested parens are handled. Returns null when the call is unbalanced
// (truncated file), so callers skip rather than record a half-parsed row.
function callArgs(content: string, callIndex: number): string[] | null {
  const open = content.indexOf('(', callIndex);
  if (open === -1) return null;

  let depth = 0;
  let quote: string | null = null;

  for (let i = open; i < content.length; i++) {
    const ch = content[i];

    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }

    // Skip comments before anything else: an apostrophe inside one ("don't")
    // would open a string that never closes, and the walk would then run to the
    // end of the file and return null for a perfectly well-formed call.
    const rest = commentSkip(content, i);
    if (rest !== -1) {
      i = rest;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return splitTopLevelArgs(content.substring(open + 1, i));
    }
  }
  return null;
}

// True when a match sits inside a comment. With literal-only requirements gone,
// a docblock that merely NAMES a function can otherwise satisfy the pattern and
// record a phantom row.
function isCommentedOut(content: string, index: number): boolean {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  const prefix = content.substring(lineStart, index).trim();
  return prefix.startsWith('*') || prefix.startsWith('//') || prefix.startsWith('#');
}

// Unwrap a translation call so the underlying literal is visible. Handles the
// __/esc_html__/esc_attr__/_x/esc_html_x family; for _x the first argument is
// still the text. Anything else is returned unchanged.
function unwrapI18n(expr: string): string {
  const m = expr.trim().match(/^(?:__|_e|_x|esc_html__|esc_html_e|esc_attr__|esc_attr_e|esc_html_x|esc_attr_x)\s*\(/);
  if (!m) return expr;
  const inner = callArgs(expr, expr.indexOf('('));
  return inner && inner.length > 0 ? inner[0] : expr;
}

// Resolve a PHP scalar argument to its runtime string: a quoted literal, a class
// constant, a translation wrapper, or a concatenation of those. Returns '' when
// nothing resolves (a plain variable), so a caller can still record the call and
// report an honest empty rather than dropping the row entirely.
//
// This is the general form of the fix df1960a applied to REST routes only. The
// same blind spot was still costing adminPages, shortcodes and cron: measured on
// BuddyNext Pro, all 19 admin pages resolved to ZERO rows because argument 5 is
// self::PAGE_SLUG, and BuddyNext Free's top-level menu vanished on $bn_label +
// self::TOP_SLUG. A manifest that reports "adminPages: 0" for a plugin with 19 of
// them answers the manifest-first question in the one direction that makes a team
// rebuild what it already ships.
function resolveScalarArg(expr: string, content: string, allContents?: Map<string, string>): string {
  const unwrapped = unwrapI18n(expr).trim();

  // Fast path: a whole-string literal. Taken BEFORE any concatenation handling
  // because resolveRoutePath() splits on '.', which would shred a title that
  // legitimately contains a period ("Analytics. Beta" -> two unresolvable halves).
  const lit = unwrapped.match(/^'([^']*)'$|^"([^"]*)"$/);
  if (lit) return lit[1] !== undefined ? lit[1] : lit[2];

  const konst = resolveClassConstant(unwrapped, content, allContents);
  if (konst !== null) return konst;

  return resolveRoutePath(unwrapped, content, allContents);
}

// Collect EVERY method declared in a register_rest_route() args block. A merged
// array registers several methods on one path; recording only the first made
// entire endpoints invisible (a GET merged into a POST array was simply absent
// from the manifest, which reads as "this route does not exist yet").
function collectRouteMethods(context: string): string[] {
  // WP_REST_Server constants are what the code says; HTTP verbs are what a
  // reader asking "is there a GET for this?" means. Expand them.
  const CONSTANTS: Record<string, string[]> = {
    READABLE: ['GET'],
    CREATABLE: ['POST'],
    EDITABLE: ['POST', 'PUT', 'PATCH'],
    DELETABLE: ['DELETE'],
    ALLMETHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  };

  const methods = new Set<string>();
  const pattern = /['"]methods['"]\s*=>\s*(?:['"]([\w,\s]+)['"]|WP_REST_Server::(\w+)|([\w:]+\s*(?:\|\s*[\w:]+)+))/g;
  let m;
  while ((m = pattern.exec(context)) !== null) {
    const raw = m[1] || m[2] || m[3] || '';
    for (const piece of raw.split(/[,|]/)) {
      const cleaned = piece.replace(/WP_REST_Server::/g, '').trim().toUpperCase();
      if (!cleaned) continue;
      for (const verb of CONSTANTS[cleaned] || [cleaned]) methods.add(verb);
    }
  }
  return [...methods];
}

export function scanRestRoutes(phpFiles: string[], contents: Map<string, string>, pluginPath: string): RestRouteInfo[] {
  const routes: RestRouteInfo[] = [];
  // arg1 (namespace) may be a literal, a $variable, or $this->namespace — match
  // any non-comma expression so wrapper-registered routes (controllers that
  // extend a custom base, not WP_REST_Controller) are captured, not just the
  // literal-namespace ones.
  //
  // arg2 (the route path) may ALSO be a class constant or a concatenation
  // (self::BASE . '/(?P<id>[\d]+)'), not just a quoted literal. Requiring a
  // literal there silently dropped every such call — six BuddyNext Pro
  // controllers, 11 routes, absent from the manifest entirely rather than
  // flagged, which reads as "this route does not exist yet". Both arguments are
  // now captured as raw expressions, terminated by the args array that always
  // follows them, and resolved below.
  const pattern = /register_rest_route\s*\(\s*([^,]+?)\s*,\s*([\s\S]+?)\s*,\s*(?:array\s*\(|\[)/g;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let match;

    while ((match = pattern.exec(content)) !== null) {
      // Skip a mention inside a comment. Now that the path no longer has to be
      // a quoted literal, a docblock that merely NAMES register_rest_route()
      // can satisfy the pattern and record a phantom route with no path.
      //
      // `continue` alone is NOT enough, and that was silent data loss. The route
      // group is lazy but still runs to the next `, array(`, which for a comment
      // mention is typically INSIDE the next genuine registration - so the
      // phantom match consumes a real route, and skipping without rewinding
      // discards it. It cost BuddyNext three routes: /feed/home, where a
      // docblock explaining validate_callback swallowed the registration 36
      // lines below it, and two in ModerationController, where comments about
      // how WordPress merges duplicate registrations ate the very registrations
      // they described. Each was absent from the manifest rather than flagged,
      // which under the manifest-first rule reads as "not built yet".
      //
      // Rewinding to just past the phantom start lets the genuine registration
      // inside the consumed span be found on the next pass.
      const lineStart = content.lastIndexOf('\n', match.index) + 1;
      const linePrefix = content.substring(lineStart, match.index).trim();
      if (linePrefix.startsWith('*') || linePrefix.startsWith('//') || linePrefix.startsWith('#')) {
        pattern.lastIndex = match.index + 1;
        continue;
      }

      const contextEnd = Math.min(match.index + 1500, content.length);
      const context = content.substring(match.index, contextEnd);

      const methods = collectRouteMethods(context);

      let permCallback = 'unknown';
      if (context.includes('__return_true')) {
        permCallback = '__return_true';
      } else if (/permission_callback/.test(context)) {
        const pcMatch = context.match(/permission_callback['"]\s*=>\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])/);
        if (pcMatch) permCallback = pcMatch[1] || pcMatch[2] || 'closure';
        else permCallback = 'closure';
      }

      routes.push({
        namespace: resolveRestNamespace(match[1], content, contents),
        route: resolveRoutePath(match[2], content, contents),
        methods: methods.length > 0 ? methods : ['GET'],
        permissionCallback: permCallback,
        file: rel,
        line: getLineNumber(content, match.index),
        requestArgs: parseRequestArgs(context),
        gatedBy: findGatedByOption(content),
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
    if (routes.some(r => r.file === rel)) continue;

    const hasController = controllerPattern.test(content);
    controllerPattern.lastIndex = 0;

    if (!hasController) continue;

    // Find namespace and rest_base from class properties
    let ns = '';
    let base = '';
    let nsMatch;
    while ((nsMatch = namespacePattern.exec(content)) !== null) {
      const before = content.substring(Math.max(0, nsMatch.index - 50), nsMatch.index);
      if (/namespace/i.test(before)) ns = nsMatch[1];
      if (/rest_base/i.test(before)) base = nsMatch[1];
    }
    namespacePattern.lastIndex = 0;

    // Count register_rest_route calls
    let routeCount = 0;
    while (registerPattern.exec(content) !== null) routeCount++;
    registerPattern.lastIndex = 0;

    if (routeCount > 0 && (ns || base)) {
      // Extract each register_rest_route block
      const routeBlockPattern = /register_rest_route\s*\(\s*(?:\$this->namespace|\$[\w]+)\s*,\s*['"]([^'"]*)['"]\s*(?:\.\s*['"]([^'"]*)['"]\s*)?/g;
      let rbMatch;
      while ((rbMatch = routeBlockPattern.exec(content)) !== null) {
        const routePath = (rbMatch[1] || '') + (rbMatch[2] || '');
        const contextEnd = Math.min(rbMatch.index + 1500, content.length);
        const context = content.substring(rbMatch.index, contextEnd);

        const methods: string[] = [];
        const methodMatch = context.match(/['"]methods['"]\s*=>\s*(?:['"](\w+)['"]|WP_REST_Server::(\w+))/);
        if (methodMatch) {
          methods.push((methodMatch[1] || methodMatch[2]).toUpperCase());
        }

        let permCallback = 'unknown';
        if (context.includes('__return_true')) permCallback = '__return_true';
        else if (/permission_callback/.test(context)) permCallback = 'closure';

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

  // Backfill empty namespaces with the plugin's dominant REST namespace. Routes
  // registered through a base controller carry the namespace on $this->namespace
  // set in the base file, so the per-file resolver returns '' for them.
  const named = routes.map((r) => r.namespace).filter((n): n is string => !!n && n !== 'unknown');
  let dominant = '';
  if (named.length) {
    const counts = new Map<string, number>();
    for (const n of named) counts.set(n, (counts.get(n) || 0) + 1);
    dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  } else {
    for (const c of contents.values()) {
      const m = c.match(/(?:\$this->)?namespace\s*=\s*['"]([a-z0-9_-]+\/v\d+)['"]/i);
      if (m) { dominant = m[1]; break; }
    }
  }
  if (dominant) {
    for (const r of routes) {
      if (!r.namespace || r.namespace === 'unknown') r.namespace = dominant;
    }
  }

  return routes;
}

// --- Scanner 7: AJAX Handlers ---

function scanAjaxHandlers(phpFiles: string[], contents: Map<string, string>, pluginPath: string): AjaxHandlerInfo[] {
  const handlers: AjaxHandlerInfo[] = [];
  // Match: string callback, short-array [$this,'m'], long-array array($this,'m'), or closure
  const pattern = /add_action\s*\(\s*['"]wp_ajax_(nopriv_)?([^'"]+)['"]\s*,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\]|array\s*\(\s*(?:[^,]+,\s*)?['"](\w+)['"]\s*\)|function\s*\()/g;

  const actionMap = new Map<string, { loggedIn: boolean; loggedOut: boolean; callback: string; file: string; line: number; isClosure: boolean; closureIndex: number }>();

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const isNopriv = !!match[1];
      const action = match[2];
      const callback = match[3] || match[4] || match[5] || '[closure]';
      const isClosure = !match[3] && !match[4] && !match[5];
      const line = getLineNumber(content, match.index);

      const existing = actionMap.get(action);
      if (existing) {
        if (isNopriv) existing.loggedOut = true;
        else existing.loggedIn = true;
      } else {
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
        if (rel !== info.file) continue;
        const closureEnd = Math.min(info.closureIndex + 2000, content.length);
        const closureBody = content.substring(info.closureIndex, closureEnd);
        if (/check_ajax_referer|check_admin_referer|wp_verify_nonce/.test(closureBody)) {
          hasNonceCheck = true;
        }
      }
    } else {
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

export function scanAdminPages(phpFiles: string[], contents: Map<string, string>, pluginPath: string): AdminPageInfo[] {
  const pages: AdminPageInfo[] = [];

  // Argument positions differ per function; index into the resolved arg list.
  //   add_menu_page   ( page_title, menu_title, capability, slug, callback, … )
  //   add_submenu_page( parent,     page_title, menu_title,  capability, slug, callback )
  //   add_options_page( page_title, menu_title, capability, slug, callback )
  const FORMS = [
    { fn: 'add_menu_page', title: 0, cap: 2, slug: 3, cb: 4, parent: -1, fixedParent: '' },
    { fn: 'add_submenu_page', title: 1, cap: 3, slug: 4, cb: 5, parent: 0, fixedParent: '' },
    { fn: 'add_options_page', title: 0, cap: 2, slug: 3, cb: 4, parent: -1, fixedParent: 'options-general.php' },
  ];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    for (const form of FORMS) {
      const pattern = new RegExp(`\\b${form.fn}\\s*\\(`, 'g');
      let match;

      while ((match = pattern.exec(content)) !== null) {
        if (isCommentedOut(content, match.index)) continue;

        const args = callArgs(content, match.index);
        // The slug is the identity of the page; without it there is no row worth
        // recording. Everything else degrades to an empty string.
        if (!args || args.length <= form.slug) continue;

        const slug = resolveScalarArg(args[form.slug], content, contents);
        if (!slug) continue;

        const rawCb = args[form.cb] || '';
        const cbMatch = rawCb.match(/['"](\w+)['"]\s*\)?\s*$/);

        pages.push({
          slug,
          title: resolveScalarArg(args[form.title] || '', content, contents),
          capability: resolveScalarArg(args[form.cap] || '', content, contents),
          callback: cbMatch ? cbMatch[1] : '',
          ...(form.parent >= 0
            ? { parentSlug: resolveScalarArg(args[form.parent] || '', content, contents) }
            : form.fixedParent
              ? { parentSlug: form.fixedParent }
              : {}),
          file: rel,
          line: getLineNumber(content, match.index),
        });
      }
    }
  }

  return pages;
}

// --- Scanner 9: Settings ---

function scanSettings(phpFiles: string[], contents: Map<string, string>, pluginPath: string): SettingInfo[] {
  const settings: SettingInfo[] = [];
  const pattern = /register_setting\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"](?:\s*,\s*(?:array\s*\(|\[|['"](\w+)['"]))?/g;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let match;

    while ((match = pattern.exec(content)) !== null) {
      let sanitizeCallback = '';
      if (match[3]) {
        sanitizeCallback = match[3];
      } else {
        const contextEnd = Math.min(match.index + 500, content.length);
        const context = content.substring(match.index, contextEnd);
        const scMatch = context.match(/['"]sanitize_callback['"]\s*=>\s*['"](\w+)['"]/);
        if (scMatch) sanitizeCallback = scMatch[1];
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

// --- Scanner: Options wiring (manifest v2) ---
// Finds every get_option/update_option/add_option/delete_option call, groups by
// option name, and marks a read as an ENFORCEMENT when it sits inside a conditional
// or guards an early return/WP_Error within ~200 chars after the call.
export function scanOptionsWiring(
  phpFiles: string[],
  contents: Map<string, string>,
  pluginPath: string,
): OptionWiringInfo[] {
  const byName = new Map<string, OptionWiringInfo>();
  // The option name is RESOLVED, not required to be a quoted literal. Requiring a
  // literal hid every constant-keyed option: measured on BuddyNext, 97 Free and 85
  // Pro call sites were invisible, among them buddynext_pro_page_membership — the
  // option that gates the membership onboarding step. An option that gates a
  // feature but is absent from the manifest reads as "this is not wired yet".
  const re = /\b(get_option|update_option|add_option|delete_option)\s*\(/g;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      if (isCommentedOut(content, m.index)) continue;

      const fn = m[1];
      const args = callArgs(content, m.index);
      if (!args || args.length === 0) continue;

      const name = resolveScalarArg(args[0], content, contents);
      // A name built from a runtime variable ("bn_cache_{$id}") cannot be a
      // manifest row; skip rather than invent one.
      if (!name || !/^[A-Za-z0-9_]+$/.test(name)) continue;

      const rawDefault = (args[1] || '').trim();
      const line = getLineNumber(content, m.index);
      let row = byName.get(name);
      if (!row) {
        row = { optionName: name, defaultValue: '', writtenAt: [], readAt: [], enforcedAt: [] };
        byName.set(name, row);
      }
      if (fn === 'get_option') {
        if (!row.defaultValue && rawDefault) row.defaultValue = rawDefault;
        const enforces = isEnforcementSite(content, m.index);
        const site: OptionSite = { file: rel, line, kind: 'read', enforces };
        row.readAt.push(site);
        if (enforces) row.enforcedAt.push(site);
      } else if (fn === 'delete_option') {
        row.writtenAt.push({ file: rel, line, kind: 'delete', enforces: false });
      } else {
        row.writtenAt.push({ file: rel, line, kind: 'write', enforces: false });
      }
    }
  }
  return [...byName.values()];
}

// A read is an enforcement when the call is the subject of a conditional (the line
// starts an `if (`, or `! get_option`), or a return/WP_Error appears within 200 chars.
function isEnforcementSite(content: string, idx: number): boolean {
  const lineStart = content.lastIndexOf('\n', idx) + 1;
  const before = content.slice(lineStart, idx);
  if (/\bif\s*\(\s*!?\s*\(?\s*(?:\(bool\)\s*)?$/.test(before) || /!\s*\(?\s*(?:\(bool\)\s*)?$/.test(before)) {
    return true;
  }
  const after = content.slice(idx, idx + 200);
  return /\breturn\b|WP_Error/.test(after) && /\bif\b/.test(before + after.slice(0, 40));
}

// Parse the `args` map of a register_rest_route context into {name,type,required}.
function parseRequestArgs(context: string): Array<{ name: string; type: string; required: boolean }> {
  const out: Array<{ name: string; type: string; required: boolean }> = [];
  const argsIdx = context.search(/['"]args['"]\s*=>/);
  if (argsIdx === -1) return out;
  const slice = context.slice(argsIdx, argsIdx + 1200);
  // Each "<name>" => array( ... ) entry.
  const entryRe = /['"]([A-Za-z0-9_]+)['"]\s*=>\s*(?:array\s*\(|\[)([^\)\]]{0,200})/g;
  let e: RegExpExecArray | null;
  while ((e = entryRe.exec(slice)) !== null) {
    const name = e[1];
    if (name === 'args' || name === 'methods' || name === 'callback' || name === 'permission_callback') continue;
    const body = e[2];
    const typeM = body.match(/['"]type['"]\s*=>\s*['"](\w+)['"]/);
    const reqM = body.match(/['"]required['"]\s*=>\s*(true|false)/);
    out.push({ name, type: typeM ? typeM[1] : 'string', required: reqM ? reqM[1] === 'true' : false });
  }
  return out;
}

// Best-effort: the first option whose get_option() is used as a guard in this file.
function findGatedByOption(content: string): string | undefined {
  const m = content.match(/if\s*\(\s*!?\s*\(?\s*(?:\(bool\)\s*)?get_option\s*\(\s*['"]([A-Za-z0-9_]+)['"]/);
  return m ? m[1] : undefined;
}

// --- Scanner: Hooks -> listeners (manifest v2) ---
// For every do_action/apply_filters fired, list the add_action/add_filter callbacks bound to it.
export function scanHookListeners(
  phpFiles: string[],
  contents: Map<string, string>,
  pluginPath: string,
): HookListenerInfo[] {
  const fired = new Set<string>();
  const listeners = new Map<string, Array<{ callback: string; file: string; line: number }>>();
  const fireRe = /\b(?:do_action|apply_filters)\s*\(\s*['"]([^'"]+)['"]/g;
  const bindRe = /\b(?:add_action|add_filter)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^,)\n]+)/g;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let m: RegExpExecArray | null;
    while ((m = fireRe.exec(content)) !== null) fired.add(m[1]);
    while ((m = bindRe.exec(content)) !== null) {
      const hook = m[1];
      const cb = m[2].trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!listeners.has(hook)) listeners.set(hook, []);
      listeners.get(hook)!.push({ callback: cb, file: rel, line: getLineNumber(content, m.index) });
    }
  }
  // Report every fired hook with its listeners (empty array = fired-but-nobody-listening smell).
  const out: HookListenerInfo[] = [];
  for (const hook of fired) out.push({ hook, listeners: listeners.get(hook) || [] });
  return out;
}

// --- Scanner: Feature groups (manifest v2) ---
// Detect feature flags (FeatureRegistry catalog entries, else slug-token clusters) and
// group the routes/templates/options/admin pages each controls, flagging missing layers.
export function scanFeatureGroups(
  optionsWiring: OptionWiringInfo[],
  restRoutes: RestRouteInfo[],
  templates: TemplateFileInfo[],
  adminPages: AdminPageInfo[],
  phpContents: Map<string, string>,
): FeatureGroupInfo[] {
  // Source flags from a FeatureRegistry-style catalog: 'slug' => array( 'tier' => self::TIER_* ).
  const flags = new Map<string, string>();
  for (const content of phpContents.values()) {
    const re = /['"]([a-z0-9_]+)['"]\s*=>\s*array\s*\(\s*['"]slug['"]\s*=>\s*['"]\1['"][^)]*['"]tier['"]\s*=>\s*self::TIER_(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) flags.set(m[1], m[2].toLowerCase());
  }
  const out: FeatureGroupInfo[] = [];
  for (const [slug, tier] of flags) {
    const token = slug.replace(/s$/, ''); // crude singular for matching
    const routes = restRoutes.filter((r) => r.route.includes(slug) || r.route.includes(token) || r.gatedBy?.includes(slug)).map((r) => r.route);
    const tpls = templates.filter((t) => t.file.includes(slug) || t.file.includes(token)).map((t) => t.file);
    const opts = optionsWiring.filter((o) => o.optionName.includes(slug) || o.optionName.includes(token)).map((o) => o.optionName);
    const admins = adminPages.filter((a) => (a.slug || '').includes(slug) || (a.title || '').toLowerCase().includes(token)).map((a) => a.slug || a.title);
    // High-signal only: flag the "built the backend, forgot the UX" case — a feature
    // with a real API surface AND a backend control (option/admin) but NO frontend
    // template. Features the name-matcher can't resolve (0 surfaces) produce nothing,
    // and backend-only features (no template by design) are not flagged unless they
    // ALSO expose an API + a setting, which is the genuine missing-UX smell.
    const missing: string[] = [];
    if (routes.length > 0 && ( opts.length > 0 || admins.length > 0 ) && tpls.length === 0) {
      missing.push('frontend');
    }
    out.push({ slug, tier, routes, templates: tpls, options: opts, adminPages: admins, missingLayers: missing });
  }
  return out;
}

// --- Scanner: Frontend JS REST consumption (manifest v2) ---
// For each JS asset, the REST routes it fetches and (best-effort) the response keys it reads.
export function scanFrontendJs(pluginPath: string): FrontendJsInfo[] {
  const out: FrontendJsInfo[] = [];
  const jsDirs = ['assets/js', 'js', 'build', 'src/js', 'public/js'];
  for (const dir of jsDirs) {
    const full = join(pluginPath, dir);
    for (const file of findJsFiles(full)) {
      const content = safeReadFile(file);
      if (!content) continue;
      const rel = relativePath(file, pluginPath);
      const callsRest = new Set<string>();
      const callRe = /(?:apiFetch|fetch)\s*\(\s*\{?[^)]*?['"`]([^'"`]*\/[a-z0-9-]+\/v\d[^'"`]*)['"`]|['"`](\/wp-json\/[^'"`]+)['"`]/g;
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(content)) !== null) callsRest.add(m[1] || m[2]);
      // reads_keys: destructured keys from a response — low confidence.
      const readsKeys = new Set<string>();
      const destrRe = /const\s*\{\s*([a-zA-Z0-9_,\s]+)\}\s*=\s*(?:await\s+)?(?:res|response|data|json)\b/g;
      while ((m = destrRe.exec(content)) !== null) {
        for (const k of m[1].split(',')) { const t = k.trim(); if (t) readsKeys.add(t); }
      }
      if (callsRest.size > 0 || readsKeys.size > 0) {
        out.push({ module: rel, callsRest: [...callsRest], readsKeys: [...readsKeys], keysConfidence: readsKeys.size > 0 ? 'low' : 'high' });
      }
    }
  }
  return out;
}

// --- Scanner 10: Widgets ---

function scanWidgets(phpFiles: string[], contents: Map<string, string>, pluginPath: string): WidgetInfo[] {
  const widgets: WidgetInfo[] = [];
  const pattern = /class\s+(\w+)\s+extends\s+WP_Widget/g;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const className = match[1];
      let idBase = className.toLowerCase().replace(/_/g, '-');
      const idMatch = content.match(new RegExp(`parent::__construct\\s*\\(\\s*['"]([^'"]+)['"]`));
      if (idMatch) idBase = idMatch[1];

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

function scanMetaBoxes(phpFiles: string[], contents: Map<string, string>, pluginPath: string): MetaBoxInfo[] {
  const metaBoxes: MetaBoxInfo[] = [];
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

export function scanCronJobs(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CronJobInfo[] {
  const cronJobs: CronJobInfo[] = [];

  // Two schedulers, not one. Reporting only WP-Cron understated every plugin
  // built on Action Scheduler — on BuddyNext that is 45 Free + 28 Pro jobs
  // reported as zero, while the plugin's own docs name Action Scheduler as its
  // async engine. Hook names are resolved, not required to be literals, because
  // job registries reference them by class constant.
  //
  //   wp_schedule_event        ( timestamp, recurrence, hook )
  //   wp_schedule_single_event ( timestamp, hook )
  //   as_schedule_recurring_action( timestamp, interval, hook )
  //   as_schedule_single_action   ( timestamp, hook )
  //   as_enqueue_async_action     ( hook )
  const FORMS: Array<{
    fn: string;
    hook: number;
    recurrence: number;
    engine: 'wp-cron' | 'action-scheduler';
  }> = [
    { fn: 'wp_schedule_event', hook: 2, recurrence: 1, engine: 'wp-cron' },
    { fn: 'wp_schedule_single_event', hook: 1, recurrence: -1, engine: 'wp-cron' },
    { fn: 'as_schedule_recurring_action', hook: 2, recurrence: 1, engine: 'action-scheduler' },
    { fn: 'as_schedule_single_action', hook: 1, recurrence: -1, engine: 'action-scheduler' },
    { fn: 'as_enqueue_async_action', hook: 0, recurrence: -1, engine: 'action-scheduler' },
  ];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    for (const form of FORMS) {
      const pattern = new RegExp(`\\b${form.fn}\\s*\\(`, 'g');
      let match;

      while ((match = pattern.exec(content)) !== null) {
        if (isCommentedOut(content, match.index)) continue;

        const args = callArgs(content, match.index);
        if (!args || args.length <= form.hook) continue;

        const hook = resolveScalarArg(args[form.hook], content, contents);
        if (!hook) continue;

        const recurrence =
          form.recurrence >= 0 && args[form.recurrence]
            ? resolveScalarArg(args[form.recurrence], content, contents) || 'interval'
            : 'single';

        cronJobs.push({
          hook,
          recurrence,
          callback: hook,
          engine: form.engine,
          file: rel,
          line: getLineNumber(content, match.index),
        });
      }
    }
  }

  return cronJobs;
}

// --- Scanner 13: CLI Commands ---

function scanCliCommands(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CliCommandInfo[] {
  const commands: CliCommandInfo[] = [];
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

function scanDbTables(phpFiles: string[], contents: Map<string, string>, pluginPath: string): DbTableInfo[] {
  const tables: DbTableInfo[] = [];
  const prefixPattern = /\$wpdb->prefix\s*\.\s*['"](\w+)['"]/g;

  // Detect the plugin's OWN table prefix from a base table() helper, e.g.
  // `return $wpdb->prefix . 'lrn_pro_' . $name;`. When present, tables not
  // sharing this prefix are referenced (cross-plugin reads), not owned, and
  // are excluded from the owned-tables list. When absent, no filtering applies.
  let ownPrefix = '';
  for (const c of contents.values()) {
    // Match a base helper that concatenates a variable name onto a literal
    // prefix: `$wpdb->prefix . 'lrn_pro_' . $name`. The trailing `. $` anchor
    // distinguishes a prefix from a full table-name literal, and the inner
    // class allows underscores so the WHOLE prefix (lrn_pro_) is captured, not
    // just the first segment (lrn_).
    const m = c.match(/\$wpdb->prefix\s*\.\s*['"]([a-z0-9_]+_)['"]\s*\.\s*\$\w/i);
    if (m) { ownPrefix = m[1]; break; }
  }

  const seen = new Set<string>();
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

  // Strongest ownership signal available: the plugin's own CREATE TABLE
  // statements. A table this plugin creates is definitively its own, whatever
  // its name looks like.
  //
  // This has to outrank the prefix heuristic below, because the prefix test
  // cannot separate a Free/Pro pair that follows the usual convention: Free
  // owns `jt_`, Pro owns `jt_pro_`, and `'jt_pro_reactions'.startsWith('jt_')`
  // is true. So every Pro table read anywhere in Free — a demo seeder writing
  // sample reactions, say — was being attributed to Free. (Jetonomy
  // 2026-09-08: nine `jt_pro_*` tables landed in Free's inventory this way,
  // inflating 22 owned tables to 31.) The reverse direction the prefix test
  // was written for still works, since `jt_foo` does not start with `jt_pro_`.
  //
  // Matches `CREATE TABLE {$p}name`, `{$wpdb->prefix}name`, and the
  // backtick-quoted variants.
  // Only trust this signal when the schema was actually READABLE. A plugin
  // that writes `CREATE TABLE {$conv}` names its tables through a variable, so
  // no literal is there to capture; treating a partial read as the whole truth
  // would drop every table we failed to parse. So count the CREATE TABLE sites
  // as well as the names recovered, and use the set exclusively only when the
  // two agree — i.e. every statement yielded a name.
  const created = new Set<string>();
  let createSites = 0;
  for (const [cfile, c] of contents) {
    // Schema evidence comes from the plugin's own runtime source only. A test
    // fixture or a bundled library that creates a scratch table is not this
    // plugin's schema, and counting those sites drags the ratio below the
    // trust line for a plugin whose schema we actually read perfectly.
    if (/(^|\/)(tests?|libs?|vendor|node_modules|build|dist)\//.test(relativePath(cfile, pluginPath))) continue;
    createSites += (c.match(/CREATE\s+TABLE\s/gi) || []).length;
    // The prefix must be a CLOSED interpolation `{$p}` / `{$wpdb->prefix}` or a
    // quoted concatenation `$p . 'name'`. Leaving the brace optional let the
    // engine backtrack into the variable itself — `CREATE TABLE $table_name`
    // matched `$table_nam` + captured `e` as a table called "e".
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(?:\{\$\w+(?:->\w+)?\}|\$\w+(?:->\w+)?\s*\.\s*['"])([a-z0-9_]{2,})/gi;
    let cm: RegExpExecArray | null;
    while ((cm = re.exec(c)) !== null) created.add(cm[1]);
  }
  // Tolerance, not equality: the site count also catches the phrase in comments
  // and log strings ("Build CREATE TABLE SQL for all 22 tables"), so demanding a
  // perfect match would reject a schema that was in fact read completely. A
  // plugin naming its tables through variables lands far below this line.
  const schemaFullyRead = createSites > 0 && created.size >= createSites * 0.8;

  // Drop concatenation fragments (a bare prefix like `lrn_` / `lrn_pro_` from
  // `$wpdb->prefix . 'lrn_pro_' . $name`) and, when the plugin's own prefix is
  // known, drop referenced-but-not-owned tables (e.g. a Pro plugin reading a
  // Free `lrn_*` table through a model).
  return tables.filter((t) => {
    const s = t.tableSuffix;
    if (!s || s === ownPrefix || /_$/.test(s)) return false; // bare-prefix fragment
    // A plugin whose schema we fully parsed is trusted about what it owns.
    // Otherwise fall through to the prefix heuristic rather than dropping the
    // tables we simply could not read.
    if (schemaFullyRead) return created.has(s);
    if (ownPrefix && !s.startsWith(ownPrefix)) return false;  // referenced, not owned
    return true;
  });
}

// --- Scanner 15: Templates ---

function scanTemplates(pluginPath: string, allPhp?: Map<string, string>): TemplateFileInfo[] {
  const templates: TemplateFileInfo[] = [];
  const templateDirs = ['templates', 'partials', 'views', 'public/partials', 'includes/templates'];
  // Concatenate all PHP once so loaderArgs can find the load call for each template.
  const allPhpJoined = allPhp ? [...allPhp.values()].join('\n') : '';

  for (const dir of templateDirs) {
    const fullDir = join(pluginPath, dir);
    const phpFiles = findPhpFiles(fullDir);

    for (const file of phpFiles) {
      const rel = relativePath(file, pluginPath);
      const content = safeReadFile(file);

      const hooks: string[] = [];
      const hookPattern = /(?:do_action|apply_filters)\s*\(\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = hookPattern.exec(content)) !== null) {
        hooks.push(match[1]);
      }

      // varsUsed: $names the template references (high confidence). Exclude superglobals + chrome.
      const skip = new Set(['this', 'args', '_GET', '_POST', '_REQUEST', '_SERVER', '_SESSION', 'wpdb', 'post', 'wp_query']);
      const varsUsed = new Set<string>();
      const varRe = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
      let vm: RegExpExecArray | null;
      while ((vm = varRe.exec(content)) !== null) { if (!skip.has(vm[1])) varsUsed.add(vm[1]); }

      // loaderArgs: find a load call referencing this template's slug + grab the array keys (low confidence).
      const base = rel.replace(/\.php$/, '').split('/').pop() || '';
      const loaderArgs = new Set<string>();
      let confidence: 'high' | 'low' = 'low';
      if (allPhpJoined && base) {
        const loadRe = new RegExp(`(?:get_template|load_template|get_part)[^;]{0,120}['"][^'"]*${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^'"]*['"][^;]{0,300}?(?:array\\s*\\(|\\[)([^\\)\\]]{0,400})`, 'g');
        let lm: RegExpExecArray | null;
        while ((lm = loadRe.exec(allPhpJoined)) !== null) {
          const keyRe = /['"]([A-Za-z0-9_]+)['"]\s*=>/g;
          let km: RegExpExecArray | null;
          while ((km = keyRe.exec(lm[1])) !== null) { loaderArgs.add(km[1]); confidence = 'high'; }
        }
      }

      const slug = detectPluginSlug(pluginPath);
      const overridePath = `theme/${slug}/${rel.replace(/^(?:templates|partials|views)\//, '')}`;

      templates.push({
        file: rel,
        overridePath,
        hooksInTemplate: hooks,
        varsUsed: [...varsUsed],
        loaderArgs: [...loaderArgs],
        argsConfidence: confidence,
      });
    }
  }

  return templates;
}

// --- Scanner 16: Hooks (Provided & Consumed) ---

function scanHooks(phpFiles: string[], contents: Map<string, string>, pluginPath: string): { provided: ProvidedHook[]; consumed: HookInfo[] } {
  const provided: ProvidedHook[] = [];
  const consumed: HookInfo[] = [];

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

function scanActivationHooks(phpFiles: string[], contents: Map<string, string>, pluginPath: string): ActivationHookInfo[] {
  const hooks: ActivationHookInfo[] = [];

  const patterns: Array<{ regex: RegExp; type: 'activation' | 'deactivation' | 'uninstall' }> = [
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

function scanCustomRoles(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CustomRoleInfo[] {
  const roles: CustomRoleInfo[] = [];
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

function scanImageSizes(phpFiles: string[], contents: Map<string, string>, pluginPath: string): ImageSizeInfo[] {
  const sizes: ImageSizeInfo[] = [];
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

function scanBlockPatterns(phpFiles: string[], contents: Map<string, string>, pluginPath: string): BlockPatternInfo[] {
  const patterns: BlockPatternInfo[] = [];
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

function scanIntegrations(phpFiles: string[], contents: Map<string, string>, pluginPath: string): IntegrationInfo[] {
  const integrations: IntegrationInfo[] = [];

  const integrationPatterns: Array<{
    type: 'woocommerce' | 'buddypress' | 'elementor' | 'bbpress' | 'learndash';
    hookPatterns: RegExp[];
  }> = [
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
    const hooksFound: string[] = [];
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

function scanJsAjaxCalls(jsFiles: string[], contents: Map<string, string>, pluginPath: string): JsAjaxCall[] {
  const calls: JsAjaxCall[] = [];
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

function scanJsEventHandlers(jsFiles: string[], contents: Map<string, string>, pluginPath: string): JsEventHandler[] {
  const handlers: JsEventHandler[] = [];
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

function scanLocalizeScripts(phpFiles: string[], contents: Map<string, string>, pluginPath: string): LocalizeScriptInfo[] {
  const scripts: LocalizeScriptInfo[] = [];
  const pattern = /wp_localize_script\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const contextEnd = Math.min(match.index + 1000, content.length);
      const context = content.substring(match.index, contextEnd);

      const data: Record<string, string> = {};
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

function scanTemplateSelectors(phpFiles: string[], contents: Map<string, string>, pluginPath: string): TemplateSelector[] {
  const selectors: TemplateSelector[] = [];
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
        const actionClasses = match[1].split(/\s+/).filter(c =>
          /btn|button|action|delete|submit|toggle|trigger|dismiss|close|confirm|cancel/i.test(c)
        );
        if (actionClasses.length === 0) continue;
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

function analyzeWiring(
  ajaxHandlers: AjaxHandlerInfo[],
  jsAjaxCalls: JsAjaxCall[],
  jsEventHandlers: JsEventHandler[],
  localizeScripts: LocalizeScriptInfo[],
  templateSelectors?: TemplateSelector[],
): WiringIssue[] {
  const issues: WiringIssue[] = [];
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
      if (['heartbeat'].some(p => handler.action.startsWith(p))) continue;
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
      if (!tpl.hasDataAction) continue; // Only check explicit data-action elements
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
  const phpNonces = new Set<string>();
  for (const script of localizeScripts) {
    for (const [key, value] of Object.entries(script.data)) {
      if (/nonce|security|_wpnonce/i.test(key) && value) phpNonces.add(value);
    }
  }
  if (templateSelectors) {
    for (const tpl of templateSelectors) {
      if (tpl.nonceField) phpNonces.add(tpl.nonceField);
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
function detectCssPrefix(cssFiles: string[], slug: string): string {
  const fallback = (slug || 'plugin').split('-')[0] || 'plugin';
  if (cssFiles.length === 0) {
    return fallback;
  }
  const counts = new Map<string, number>();
  const tokenRe = /--([a-z][a-z0-9]*)-/gi;
  for (const file of cssFiles) {
    const text = safeReadFile(file);
    if (!text) continue;
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
function phpContentsAnyMatch(
  phpContents: Map<string, string>,
  pattern: RegExp,
): boolean {
  for (const text of phpContents.values()) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

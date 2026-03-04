/**
 * WP Plugin QA MCP Server - Static Code Checker
 * Dead code, duplicates, undefined functions, naming consistency, debug statements, secrets, SSRF.
 * Security-specific checks (dangerous functions, SQL injection, object injection, ABSPATH guards)
 * are handled by security-checker.ts, wporg-checker.ts, and perf-checker.ts respectively.
 * Note: This is a standalone MCP server - no external exec dependencies.
 */

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import type { CheckerResult, CheckerIssue } from './types.js';
import { findPhpFiles, getLineNumber, relativePath, generateTestId } from './shared-utils.js';

export function checkStatic(pluginPath: string, siteUrl?: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(pluginPath);

  const fileContents = new Map<string, string>();
  for (const file of phpFiles) {
    try {
      fileContents.set(file, readFileSync(file, 'utf-8'));
    } catch { /* skip */ }
  }

  // Core static analysis (unique to this checker)
  issues.push(...checkDeadCode(phpFiles, fileContents, pluginPath));
  issues.push(...checkDuplicateFunctions(phpFiles, fileContents, pluginPath));
  issues.push(...checkNamingConsistency(phpFiles, fileContents, pluginPath));
  issues.push(...checkUndefinedFunctions(phpFiles, fileContents, pluginPath, siteUrl));
  const debugIssues = checkDebugStatements(phpFiles, fileContents, pluginPath);
  const secretIssues = checkHardcodedSecrets(phpFiles, fileContents, pluginPath);
  const lfiIssues = checkLocalFileInclusion(phpFiles, fileContents, pluginPath);
  const ssrfIssues = checkSsrfPatterns(phpFiles, fileContents, pluginPath);

  issues.push(
    ...debugIssues, ...secretIssues, ...lfiIssues, ...ssrfIssues,
  );

  // Checks moved to specialized checkers:
  // - Security patterns (XSS, unsanitized input) → security-checker.ts (checkTaintedOutput)
  // - admin_post nonce verification → security-checker.ts (checkAdminPostAccessControl)
  // - ABSPATH guard → wporg-checker.ts (checkAbspathGuards)
  // - Dangerous functions (eval, exec, etc.) → security-checker.ts (checkDangerousFunctions)
  // - SQL injection patterns → security-checker.ts (checkSqlInjection)
  // - Object injection (unserialize) → security-checker.ts (checkObjectInjection)
  // - N+1 / DB query in loop → perf-checker.ts (checkN1Queries)

  // Count check areas that found errors/warnings (not info), to get meaningful pass/fail
  const checkAreas = [
    { name: 'dead-code', issues: issues.filter(i => i.code === 'dead-code') },
    { name: 'duplicates', issues: issues.filter(i => i.code === 'duplicate-function') },
    { name: 'naming', issues: issues.filter(i => i.code === 'naming-inconsistency') },
    { name: 'undefined', issues: issues.filter(i => i.code === 'undefined-function') },
    { name: 'debug', issues: debugIssues },
    { name: 'secrets', issues: secretIssues },
    { name: 'lfi', issues: lfiIssues },
    { name: 'ssrf', issues: ssrfIssues },
  ];

  const failedAreas = checkAreas.filter(a => a.issues.some(i => i.type === 'error' || (i.type === 'warning' && i.severity !== 'low'))).length;
  const passed = checkAreas.length - failedAreas;

  return {
    category: 'code-quality',
    issues,
    passed,
    failed: failedAreas,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function checkDeadCode(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const definedFunctions = new Map<string, { file: string; line: number }>();
  const calledFunctions = new Set<string>();
  const hookCallbacks = new Set<string>();

  const skipPrefixes = /^(get_|set_|is_|has_|can_|init_|register_|handle_|process_|render_|display_|admin_|ajax_|rest_|activate|deactivate|uninstall|__construct|__destruct|__call|__get|__set|__isset|__unset|__toString|__invoke|__clone|__sleep|__wakeup|__serialize|__unserialize|__debugInfo|setUp|tearDown|test_)/;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const funcPattern = /^\s*(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)\s*\(/gm;
    let match;
    while ((match = funcPattern.exec(content)) !== null) {
      if (!definedFunctions.has(match[1])) {
        definedFunctions.set(match[1], { file: rel, line: getLineNumber(content, match.index) });
      }
    }

    // Match direct function calls: funcName(
    const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
    while ((match = callPattern.exec(content)) !== null) {
      calledFunctions.add(match[1]);
    }

    // Match method calls: ->methodName( and ::methodName(
    const methodCallPattern = /(?:->|::)\s*([a-zA-Z_]\w*)\s*\(/g;
    while ((match = methodCallPattern.exec(content)) !== null) {
      calledFunctions.add(match[1]);
    }

    // Match hook callbacks (string and array syntax)
    const hookPattern = /(?:add_action|add_filter)\s*\([^,]+,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])/g;
    while ((match = hookPattern.exec(content)) !== null) {
      hookCallbacks.add(match[1] || match[2]);
    }

    // Match shortcode callbacks
    const shortcodePattern = /add_shortcode\s*\([^,]+,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])/g;
    while ((match = shortcodePattern.exec(content)) !== null) {
      hookCallbacks.add(match[1] || match[2]);
    }
  }

  for (const [funcName, info] of definedFunctions) {
    if (calledFunctions.has(funcName)) continue;
    if (hookCallbacks.has(funcName)) continue;
    if (skipPrefixes.test(funcName)) continue;
    if (funcName.startsWith('_')) continue;
    // Skip class methods defined with visibility keywords (likely called via $this->)
    // We already track ->method() calls above, but some may be called from parent/child classes

    issues.push({
      id: generateTestId('code-quality'),
      category: 'code-quality',
      severity: 'medium',
      type: 'warning',
      title: `Dead code: "${funcName}" never called`,
      message: `Function "${funcName}" is defined but never called or registered as hook callback`,
      file: info.file,
      line: info.line,
      code: 'dead-code',
    });
  }

  return issues;
}

function checkDuplicateFunctions(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const funcBodies = new Map<string, { name: string; file: string; line: number }>();

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const funcPattern = /function\s+(\w+)\s*\([^)]*\)\s*\{/g;
    let match;

    while ((match = funcPattern.exec(content)) !== null) {
      const bodyStart = match.index + match[0].length;
      const bodyEnd = Math.min(bodyStart + 500, content.length);
      const body = content.substring(bodyStart, bodyEnd).trim();

      const hash = createHash('md5').update(body.replace(/\s+/g, ' ')).digest('hex');

      const existing = funcBodies.get(hash);
      if (existing && existing.name !== match[1]) {
        issues.push({
          id: generateTestId('code-quality'),
          category: 'code-quality',
          severity: 'medium',
          type: 'warning',
          title: `Near-duplicate: "${match[1]}" ~ "${existing.name}"`,
          message: `Function "${match[1]}" in ${rel} has a very similar body to "${existing.name}" in ${existing.file}`,
          file: rel,
          line: getLineNumber(content, match.index),
          code: 'duplicate-function',
        });
      } else {
        funcBodies.set(hash, { name: match[1], file: rel, line: getLineNumber(content, match.index) });
      }
    }
  }

  return issues;
}

function checkNamingConsistency(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const prefixes = new Map<string, number>();

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const funcPattern = /^\s*function\s+(\w+)\s*\(/gm;
    let match;
    while ((match = funcPattern.exec(content)) !== null) {
      const parts = match[1].split('_');
      if (parts.length >= 2) {
        prefixes.set(parts[0], (prefixes.get(parts[0]) || 0) + 1);
      }
    }
  }

  // Remove WP core prefixes from consideration
  const wpCorePrefixes = new Set(['wp', 'WP', 'admin', 'the', 'get', 'is', 'has', 'do', 'add', 'update', 'delete', 'check', 'load', 'set', 'remove']);

  let dominantPrefix = '';
  let dominantCount = 0;
  for (const [prefix, count] of prefixes) {
    if (count > dominantCount && prefix.length >= 2 && !wpCorePrefixes.has(prefix)) {
      dominantPrefix = prefix;
      dominantCount = count;
    }
  }

  if (dominantPrefix && dominantCount >= 3) {
    for (const file of phpFiles) {
      const content = contents.get(file) || '';
      const rel = relativePath(file, pluginPath);

      const funcPattern = /^\s*function\s+(\w+)\s*\(/gm;
      let match;
      while ((match = funcPattern.exec(content)) !== null) {
        const name = match[1];
        if (!name.startsWith(dominantPrefix + '_') && !name.startsWith('__') && name.split('_').length >= 2) {
          const firstPart = name.split('_')[0];
          if (firstPart !== dominantPrefix && (prefixes.get(firstPart) || 0) <= 2) {
            issues.push({
              id: generateTestId('code-quality'),
              category: 'code-quality',
              severity: 'low',
              type: 'info',
              title: `Inconsistent prefix: "${name}" (expected "${dominantPrefix}_")`,
              message: `Function "${name}" doesn't use the dominant prefix "${dominantPrefix}_"`,
              file: rel,
              line: getLineNumber(content, match.index),
              code: 'naming-inconsistency',
            });
          }
        }
      }
    }
  }

  return issues;
}

// REMOVED: checkSecurityPatterns — now in security-checker.ts (checkTaintedOutput covers XSS/unsanitized input)

/**
 * Discover all defined functions from a running WordPress install via WP-CLI.
 * Uses execFileSync (no shell — safe from injection). Returns null if WP-CLI is unavailable.
 */
let _wpCliFunctionsCache: Set<string> | null | undefined;

function discoverWpCliFunctions(siteUrl?: string): Set<string> | null {
  if (_wpCliFunctionsCache !== undefined) return _wpCliFunctionsCache;

  try {
    const phpCode = 'echo implode("\\n", get_defined_functions()["user"]);';
    const wpCliArgs = ['eval', phpCode];
    if (siteUrl) {
      wpCliArgs.push(`--url=${siteUrl}`);
    }
    const output = execFileSync('wp', wpCliArgs, {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
    });
    const funcs = new Set<string>();
    for (const line of output.split('\n')) {
      const name = line.trim();
      if (name) funcs.add(name);
    }
    _wpCliFunctionsCache = funcs.size > 0 ? funcs : null;
    return _wpCliFunctionsCache;
  } catch {
    _wpCliFunctionsCache = null;
    return null;
  }
}

/** Reset WP-CLI cache between separate tool invocations */
export function resetWpCliCache(): void {
  _wpCliFunctionsCache = undefined;
}

function checkUndefinedFunctions(phpFiles: string[], contents: Map<string, string>, pluginPath: string, siteUrl?: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const definedFunctions = new Set<string>();
  const calledFunctions = new Map<string, { file: string; line: number; count: number }>();

  // Try WP-CLI first — authoritative list of all functions in this WordPress install
  const wpCliFunctions = discoverWpCliFunctions(siteUrl);

  // Expanded static whitelist — fallback when WP-CLI is unavailable
  const wpCore = new Set([
    // i18n
    '__', '_e', '_n', '_x', '_nx', '_n_noop', '_nx_noop',
    'esc_html__', 'esc_html_e', 'esc_attr__', 'esc_attr_e',
    // escaping / sanitization
    'esc_html', 'esc_attr', 'esc_url', 'esc_url_raw', 'esc_js', 'esc_textarea', 'esc_sql',
    'wp_kses', 'wp_kses_post', 'wp_kses_allowed_html', 'wp_kses_data',
    'sanitize_text_field', 'sanitize_textarea_field', 'sanitize_email', 'sanitize_file_name',
    'sanitize_title', 'sanitize_title_with_dashes', 'sanitize_user', 'sanitize_key',
    'sanitize_mime_type', 'sanitize_option', 'sanitize_html_class', 'sanitize_url',
    'absint', 'intval', 'floatval', 'wp_unslash', 'stripslashes_deep',
    // hooks
    'add_action', 'add_filter', 'do_action', 'apply_filters', 'do_action_ref_array', 'apply_filters_ref_array',
    'has_action', 'has_filter', 'did_action', 'doing_action', 'doing_filter', 'current_filter',
    'remove_action', 'remove_filter', 'remove_all_actions', 'remove_all_filters',
    // options
    'get_option', 'update_option', 'delete_option', 'add_option',
    'get_site_option', 'update_site_option', 'delete_site_option',
    // posts
    'get_post', 'get_posts', 'wp_insert_post', 'wp_update_post', 'wp_delete_post', 'wp_trash_post',
    'get_post_meta', 'update_post_meta', 'delete_post_meta', 'add_post_meta', 'metadata_exists',
    'get_post_type', 'get_post_types', 'get_post_status', 'get_post_statuses',
    'get_post_field', 'get_post_mime_type',
    'post_type_exists', 'is_post_type_archive', 'is_post_type_hierarchical',
    'get_post_type_object', 'get_post_type_labels',
    // users
    'get_user_by', 'get_current_user_id', 'wp_get_current_user', 'get_userdata', 'get_user_meta',
    'update_user_meta', 'delete_user_meta', 'add_user_meta', 'get_users',
    'is_user_logged_in', 'current_user_can', 'user_can',
    // ajax / json
    'wp_send_json', 'wp_send_json_success', 'wp_send_json_error',
    'wp_doing_ajax', 'check_ajax_referer',
    // security
    'wp_die', 'wp_verify_nonce', 'wp_create_nonce', 'wp_nonce_url',
    'wp_nonce_field', 'check_admin_referer',
    // cpt / taxonomy
    'register_post_type', 'register_taxonomy', 'register_taxonomy_for_object_type',
    'taxonomy_exists', 'get_taxonomies', 'get_taxonomy', 'is_taxonomy_hierarchical',
    'register_rest_route', 'register_rest_field',
    // scripts / styles
    'wp_enqueue_script', 'wp_enqueue_style', 'wp_localize_script', 'wp_add_inline_script',
    'wp_add_inline_style', 'wp_register_script', 'wp_register_style',
    'wp_deregister_script', 'wp_deregister_style', 'wp_dequeue_script', 'wp_dequeue_style',
    'wp_script_is', 'wp_style_is', 'wp_set_script_translations',
    // admin menus
    'add_menu_page', 'add_submenu_page', 'add_options_page', 'add_management_page',
    'add_theme_page', 'add_plugins_page', 'add_users_page', 'add_dashboard_page',
    'add_meta_box', 'remove_meta_box', 'register_setting', 'unregister_setting',
    'add_settings_section', 'add_settings_field', 'settings_fields', 'do_settings_sections',
    'do_settings_fields', 'submit_button', 'settings_errors', 'add_settings_error',
    // redirects / HTTP
    'wp_redirect', 'wp_safe_redirect',
    'wp_remote_get', 'wp_remote_post', 'wp_remote_request', 'wp_remote_head',
    'wp_remote_retrieve_body', 'wp_remote_retrieve_response_code', 'wp_remote_retrieve_headers',
    'wp_remote_retrieve_header', 'wp_remote_retrieve_response_message',
    'is_wp_error', 'wp_http_validate_url',
    // transients / cache
    'get_transient', 'set_transient', 'delete_transient',
    'get_site_transient', 'set_site_transient', 'delete_site_transient',
    'wp_cache_get', 'wp_cache_set', 'wp_cache_delete', 'wp_cache_add', 'wp_cache_flush',
    'wp_upload_dir', 'wp_mkdir_p',
    // terms / taxonomies
    'get_term', 'get_terms', 'get_term_by', 'get_term_meta', 'update_term_meta',
    'wp_get_post_terms', 'wp_set_post_terms', 'wp_get_object_terms', 'wp_set_object_terms',
    'wp_insert_term', 'wp_update_term', 'wp_delete_term',
    'term_exists', 'get_term_link',
    // REST
    'rest_ensure_response', 'rest_url', 'rest_get_server',
    // plugin / theme utilities
    'load_plugin_textdomain', 'plugin_dir_path', 'plugin_dir_url', 'plugins_url', 'plugin_basename',
    'is_plugin_active', 'activate_plugin', 'deactivate_plugins',
    'get_plugin_data', 'register_activation_hook', 'register_deactivation_hook', 'register_uninstall_hook',
    'load_theme_textdomain', 'get_template_directory', 'get_template_directory_uri',
    'get_stylesheet_directory', 'get_stylesheet_directory_uri',
    // shortcodes
    'add_shortcode', 'remove_shortcode', 'shortcode_atts', 'do_shortcode', 'has_shortcode',
    // cron
    'wp_schedule_event', 'wp_schedule_single_event', 'wp_next_scheduled',
    'wp_unschedule_event', 'wp_clear_scheduled_hook', 'wp_get_schedules',
    // template / query
    'get_the_ID', 'get_the_title', 'get_the_content', 'get_the_excerpt', 'get_the_date',
    'get_the_author', 'get_the_author_meta', 'get_the_category', 'get_the_tags',
    'get_permalink', 'get_the_permalink', 'the_permalink',
    'the_post', 'have_posts', 'wp_reset_postdata', 'wp_reset_query', 'rewind_posts',
    'the_title', 'the_content', 'the_excerpt', 'the_date', 'the_author',
    'get_header', 'get_footer', 'get_sidebar', 'get_template_part', 'get_search_form',
    'register_widget', 'unregister_widget', 'register_sidebar', 'dynamic_sidebar',
    'is_active_sidebar', 'the_widget',
    // conditional tags
    'is_admin', 'is_network_admin', 'is_blog_admin',
    'is_page', 'is_single', 'is_singular', 'is_archive', 'is_category', 'is_tag', 'is_tax',
    'is_home', 'is_front_page', 'is_search', 'is_404', 'is_attachment',
    'is_author', 'is_date', 'is_year', 'is_month', 'is_day', 'is_time',
    'is_feed', 'is_trackback', 'is_preview', 'is_paged', 'is_customize_preview',
    'is_multisite', 'is_main_site', 'is_ssl', 'is_rtl',
    'in_the_loop', 'is_main_query',
    // urls
    'home_url', 'admin_url', 'site_url', 'network_admin_url', 'content_url',
    'includes_url', 'wp_login_url', 'wp_logout_url', 'wp_registration_url',
    'get_bloginfo', 'get_site_url', 'get_home_url',
    // formatting
    'wp_parse_args', 'wp_list_pluck', 'wp_array_slice_assoc',
    'wp_json_encode', 'wp_slash', 'wp_strip_all_tags', 'wp_trim_words',
    'wpautop', 'wptexturize', 'make_clickable', 'force_balance_tags',
    'ent2ncr', 'capital_P_dangit', 'balanceTags', 'convert_chars',
    'wp_specialchars_decode', 'zeroise', 'backslashit', 'trailingslashit', 'untrailingslashit',
    'rawurlencode_deep', 'urlencode_deep', 'urldecode_deep',
    // media / attachments
    'wp_get_attachment_url', 'wp_get_attachment_image', 'wp_get_attachment_image_src',
    'wp_get_attachment_image_url', 'wp_get_attachment_metadata',
    'wp_handle_upload', 'wp_insert_attachment', 'wp_update_attachment_metadata',
    'get_attached_file', 'wp_get_image_editor',
    'wp_generate_attachment_metadata', 'wp_delete_attachment',
    'set_post_thumbnail', 'get_post_thumbnail_id', 'has_post_thumbnail', 'the_post_thumbnail',
    'get_the_post_thumbnail', 'get_the_post_thumbnail_url',
    'wp_get_attachment_image_sizes', 'wp_calculate_image_sizes',
    // database
    'dbDelta', 'maybe_serialize', 'maybe_unserialize', 'is_serialized', 'is_serialized_string',
    // misc WP core
    'is_wp_error', 'wp_parse_url', 'wp_allowed_protocols', 'wp_validate_redirect',
    'wp_generate_password', 'wp_hash_password', 'wp_check_password', 'wp_hash',
    'wp_mail', 'wp_set_auth_cookie', 'wp_clear_auth_cookie', 'wp_set_current_user',
    'wp_signon', 'wp_authenticate', 'wp_logout',
    'wp_get_nav_menu_items', 'wp_nav_menu', 'register_nav_menus', 'register_nav_menu', 'has_nav_menu',
    'wp_page_menu', 'wp_list_pages', 'wp_list_categories',
    'checked', 'selected', 'disabled', 'wp_dropdown_pages', 'wp_dropdown_categories',
    'get_avatar', 'get_avatar_url',
    'flush_rewrite_rules', 'add_rewrite_rule', 'add_rewrite_tag', 'add_rewrite_endpoint',
    'get_query_var', 'set_query_var', 'add_query_arg', 'remove_query_arg',
    'wp_parse_str', 'build_query', 'add_magic_quotes',
    'wp_ob_end_flush_all', 'wp_suspend_cache_addition', 'wp_suspend_cache_invalidation',
    'wp_using_themes', 'wp_doing_cron', 'wp_is_json_request', 'wp_is_rest_endpoint',
    'wp_timezone', 'wp_date', 'current_time', 'mysql2date', 'human_time_diff',
    'get_locale', 'get_user_locale', 'switch_to_locale', 'restore_previous_locale',
    'is_textdomain_loaded', 'get_translations_for_domain',
    'number_format_i18n', 'date_i18n', 'size_format', 'wp_convert_hr_to_bytes',
    'wp_max_upload_size', 'wp_get_upload_dir',
    'map_deep', 'wp_list_filter', 'wp_list_sort',
    'wp_is_mobile', 'wp_get_environment_type',
    'wp_add_dashboard_widget', 'wp_dashboard_setup',
    'get_current_screen', 'add_screen_option', 'get_current_blog_id',
    'switch_to_blog', 'restore_current_blog', 'get_blog_details',
    'get_sites', 'get_site', 'get_network',
    'wp_get_theme', 'wp_get_themes',
    'wp_get_sidebars_widgets', 'wp_set_sidebars_widgets',
    'wp_count_posts', 'wp_count_terms',
    'wp_cron', 'spawn_cron',
    'wp_unique_filename', 'wp_tempnam',
    'wp_get_referer', 'wp_get_raw_referer',
    'wp_text_diff', 'wp_generate_uuid4',

    // ---- PHP built-in functions ----
    // array functions
    'array_map', 'array_filter', 'array_merge', 'array_keys', 'array_values',
    'array_unique', 'array_reverse', 'array_flip', 'array_pop', 'array_push',
    'array_shift', 'array_unshift', 'array_slice', 'array_splice', 'array_search',
    'array_combine', 'array_chunk', 'array_pad', 'array_rand', 'array_walk',
    'array_walk_recursive', 'array_column', 'array_diff', 'array_diff_key',
    'array_diff_assoc', 'array_intersect', 'array_intersect_key', 'array_intersect_assoc',
    'array_key_exists', 'array_key_first', 'array_key_last', 'array_count_values',
    'array_fill', 'array_fill_keys', 'array_product', 'array_sum', 'array_replace',
    'array_replace_recursive', 'array_merge_recursive', 'array_multisort',
    'in_array', 'sort', 'asort', 'arsort', 'ksort', 'krsort', 'usort', 'uasort', 'uksort',
    'rsort', 'shuffle', 'range', 'each', 'current', 'next', 'prev', 'reset', 'end', 'key',
    // string functions
    'count', 'strlen', 'substr', 'strpos', 'strrpos', 'stripos', 'strripos',
    'str_replace', 'str_ireplace', 'str_pad', 'str_repeat', 'str_word_count',
    'str_contains', 'str_starts_with', 'str_ends_with',
    'substr_count', 'substr_replace', 'str_split', 'str_getcsv',
    'preg_match', 'preg_match_all', 'preg_replace', 'preg_replace_callback', 'preg_split', 'preg_quote',
    'explode', 'implode', 'join', 'trim', 'ltrim', 'rtrim',
    'strtolower', 'strtoupper', 'ucfirst', 'ucwords', 'lcfirst',
    'nl2br', 'wordwrap', 'chunk_split',
    'sprintf', 'printf', 'fprintf', 'vprintf', 'vsprintf', 'sscanf',
    'number_format',
    'htmlspecialchars', 'htmlentities', 'htmlspecialchars_decode', 'html_entity_decode',
    'strip_tags', 'addslashes', 'stripslashes', 'addcslashes', 'stripcslashes',
    'quotemeta', 'ord', 'chr', 'hex2bin', 'bin2hex',
    'crc32', 'crypt', 'str_rot13', 'convert_uuencode', 'convert_uudecode',
    // hash / crypto
    'md5', 'sha1', 'hash', 'hash_hmac', 'hash_equals', 'hash_algos', 'hash_file',
    'password_hash', 'password_verify', 'password_needs_rehash',
    'base64_encode', 'base64_decode', 'rawurlencode', 'rawurldecode',
    'urlencode', 'urldecode', 'http_build_query', 'parse_url', 'parse_str',
    // json
    'json_encode', 'json_decode', 'json_last_error', 'json_last_error_msg',
    // file / filesystem
    'file_exists', 'file_get_contents', 'file_put_contents', 'file',
    'fopen', 'fclose', 'fread', 'fwrite', 'fgets', 'fgetc', 'feof', 'fseek', 'ftell', 'rewind',
    'flock', 'ftruncate', 'fflush', 'fputcsv', 'fgetcsv',
    'glob', 'scandir', 'readdir', 'opendir', 'closedir',
    'is_file', 'is_dir', 'is_readable', 'is_writable', 'is_writeable', 'is_link',
    'mkdir', 'rmdir', 'rename', 'copy', 'unlink', 'tempnam', 'sys_get_temp_dir',
    'realpath', 'dirname', 'basename', 'pathinfo',
    'filesize', 'filetype', 'filemtime', 'fileatime', 'filectime', 'fileperms', 'fileowner',
    'stat', 'lstat', 'touch', 'chmod', 'chown', 'chgrp',
    // type checking
    'is_array', 'is_string', 'is_int', 'is_integer', 'is_long', 'is_float', 'is_double',
    'is_bool', 'is_null', 'is_object', 'is_callable', 'is_resource', 'is_numeric',
    'is_finite', 'is_infinite', 'is_nan',
    'gettype', 'settype', 'get_class', 'get_parent_class', 'is_a',
    'property_exists', 'method_exists',
    // type casting
    'boolval', 'strval', 'intval', 'floatval',
    // class / object
    'defined', 'define', 'constant',
    'class_exists', 'interface_exists', 'trait_exists', 'function_exists',
    'get_object_vars', 'get_class_methods', 'get_class_vars',
    // math
    'abs', 'ceil', 'floor', 'round', 'max', 'min', 'pow', 'sqrt', 'log', 'log2', 'log10',
    'rand', 'mt_rand', 'random_int', 'random_bytes',
    'fmod', 'intdiv', 'pi', 'deg2rad', 'rad2deg',
    // date / time
    'date', 'time', 'mktime', 'strtotime', 'microtime', 'gettimeofday',
    'gmdate', 'getdate', 'localtime', 'checkdate', 'idate',
    'date_create', 'date_format', 'date_diff', 'date_modify', 'date_interval_create_from_date_string',
    // output buffering
    'ob_start', 'ob_get_clean', 'ob_end_clean', 'ob_get_contents', 'ob_flush', 'ob_end_flush',
    'ob_get_length', 'ob_get_level', 'ob_implicit_flush',
    // misc PHP
    'compact', 'extract', 'var_dump', 'print_r', 'var_export', 'debug_zval_dump',
    'error_log', 'trigger_error', 'set_error_handler', 'restore_error_handler',
    'set_exception_handler', 'restore_exception_handler',
    'header', 'headers_sent', 'header_remove', 'http_response_code',
    'setcookie', 'session_start', 'session_destroy', 'session_id',
    'sleep', 'usleep', 'time_nanosleep',
    'uniqid', 'spl_autoload_register', 'spl_autoload_unregister',
    'version_compare', 'phpversion', 'php_uname', 'php_sapi_name',
    'ini_get', 'ini_set', 'get_cfg_var',
    'getenv', 'putenv',
    'call_user_func', 'call_user_func_array', 'forward_static_call', 'forward_static_call_array',
    'func_get_args', 'func_get_arg', 'func_num_args',
    'debug_backtrace', 'debug_print_backtrace',
    'register_shutdown_function', 'ignore_user_abort', 'connection_aborted',
    'memory_get_usage', 'memory_get_peak_usage',
    'gc_collect_cycles', 'gc_enabled',
    'class_alias', 'class_implements', 'class_parents', 'class_uses',
    'iterator_to_array', 'iterator_count',

    // ---- BuddyPress / BuddyBoss ----
    'bp_is_active', 'bp_core_get_user_domain', 'bp_core_get_userlink',
    'bp_loggedin_user_id', 'bp_displayed_user_id', 'bp_get_member_type',
    'bp_activity_add', 'bp_activity_get', 'bp_has_activities',
    'bp_get_activity_content_body', 'bp_get_activity_user_id',
    'groups_get_group', 'groups_is_user_member', 'groups_get_groups',
    'bp_core_new_nav_item', 'bp_core_new_subnav_item',
    'bp_core_add_message', 'bp_core_redirect',
    'bp_is_group', 'bp_is_user', 'bp_is_directory', 'bp_is_my_profile',
    'bp_get_option', 'bp_update_option',
    'bp_core_get_user_displayname', 'bp_core_fetch_avatar',
    'bp_is_user_spammer', 'bp_is_user_deleted',
    'bp_get_groups_slug', 'bp_get_activity_slug', 'bp_get_members_slug',
    'bp_core_number_format', 'bp_core_time_since',
    'bp_has_groups', 'bp_has_members',

    // ---- WooCommerce ----
    'wc_get_product', 'wc_get_order', 'wc_get_orders',
    'wc_price', 'wc_format_decimal', 'wc_get_cart_url', 'wc_get_checkout_url',
    'WC', 'wc_get_page_id', 'wc_get_template', 'wc_get_template_part',
    'wc_add_notice', 'wc_get_notices', 'wc_print_notices',
    'is_shop', 'is_product', 'is_product_category', 'is_cart', 'is_checkout', 'is_account_page',
  ]);

  const keywords = new Set([
    'if', 'else', 'elseif', 'while', 'for', 'foreach', 'switch', 'catch',
    'function', 'class', 'new', 'return', 'echo', 'print', 'array', 'list',
    'isset', 'empty', 'unset', 'die', 'exit', 'include', 'require',
    'include_once', 'require_once', 'use', 'namespace', 'throw', 'try', 'match',
    'static', 'self', 'parent', 'abstract', 'final', 'interface', 'trait', 'enum',
    'null', 'true', 'false', 'void', 'never', 'mixed',
  ]);

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const defPattern = /(?:function|static\s+function|public\s+function|private\s+function|protected\s+function)\s+(\w+)\s*\(/g;
    let match;
    while ((match = defPattern.exec(content)) !== null) {
      definedFunctions.add(match[1]);
    }

    const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
    while ((match = callPattern.exec(content)) !== null) {
      const name = match[1];
      if (keywords.has(name.toLowerCase())) continue;
      if (wpCore.has(name)) continue;
      // If WP-CLI gave us a live function list, check against it
      if (wpCliFunctions && wpCliFunctions.has(name)) continue;

      const existing = calledFunctions.get(name);
      if (existing) {
        existing.count++;
      } else {
        calledFunctions.set(name, { file: rel, line: getLineNumber(content, match.index), count: 1 });
      }
    }
  }

  for (const [name, info] of calledFunctions) {
    if (!definedFunctions.has(name) && info.count >= 3) {
      // Skip class constructors / class names (PascalCase)
      if (name[0] === name[0].toUpperCase() && name !== name.toUpperCase()) continue;

      issues.push({
        id: generateTestId('code-quality'),
        category: 'code-quality',
        severity: 'high',
        type: 'warning',
        title: `Undefined function: "${name}" called ${info.count} times`,
        message: `Function "${name}" is called ${info.count} times but not defined in the plugin`,
        file: info.file,
        line: info.line,
        code: 'undefined-function',
      });
    }
  }

  return issues;
}

// REMOVED: checkAbspathGuard — now in wporg-checker.ts (checkAbspathGuards)

function checkDebugStatements(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  const debugPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\bvar_dump\s*\(/g, name: 'var_dump()' },
    { pattern: /\bprint_r\s*\(\s*\$(?![\s\S]*,\s*true)/gm, name: 'print_r() (output)' },
    { pattern: /\bvar_export\s*\(\s*\$(?![\s\S]*,\s*true)/gm, name: 'var_export() (output)' },
    { pattern: /\berror_log\s*\(/g, name: 'error_log()' },
    { pattern: /\bdebug_print_backtrace\s*\(/g, name: 'debug_print_backtrace()' },
    { pattern: /\bdebug_zval_dump\s*\(/g, name: 'debug_zval_dump()' },
  ];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    for (const { pattern, name } of debugPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = getLineNumber(content, match.index);
        const lineContent = (content.split('\n')[lineNum - 1] || '').trim();
        // Skip if commented out
        if (/^\s*(?:\/\/|\*|#)/.test(lineContent)) continue;

        issues.push({
          id: generateTestId('code-quality'), category: 'code-quality', severity: 'high', type: 'warning',
          title: `Debug statement: ${name}`,
          message: `${name} left in production code`,
          file: rel, line: lineNum, code: 'debug-statement',
          fix: 'Remove debug statement before release',
        });
      }
    }
  }

  return issues;
}

// REMOVED: checkDangerousFunctions — now in security-checker.ts (checkDangerousFunctions)

function checkHardcodedSecrets(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  const secretPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /['"](?:sk_live|pk_live|sk_test|pk_test)_[a-zA-Z0-9]{20,}['"]/g, name: 'Stripe API key' },
    { pattern: /['"]AIza[0-9A-Za-z_-]{35}['"]/g, name: 'Google API key' },
    { pattern: /['"]AKIA[0-9A-Z]{16}['"]/g, name: 'AWS access key' },
    { pattern: /['"][a-f0-9]{32}['"]\s*;\s*\/\/\s*(?:api|secret|key|token)/gi, name: 'Hardcoded API key/secret' },
    { pattern: /(?:password|passwd|secret|api_key|apikey|access_token)\s*=\s*['"][^'"]{8,}['"]/gi, name: 'Hardcoded credential' },
  ];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // Skip config templates and example files
    if (rel.includes('example') || rel.includes('sample') || rel.includes('-config')) continue;

    for (const { pattern, name } of secretPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = getLineNumber(content, match.index);
        const lineContent = (content.split('\n')[lineNum - 1] || '').trim();
        if (/^\s*(?:\/\/|\*|#)/.test(lineContent)) continue;
        // Skip default/placeholder values
        if (/your[_-]|example|placeholder|CHANGE_ME|xxx/i.test(match[0])) continue;

        issues.push({
          id: generateTestId('code-quality'), category: 'code-quality', severity: 'critical', type: 'error',
          title: `Hardcoded secret: ${name}`,
          message: `Possible ${name} hardcoded in source code`,
          file: rel, line: lineNum, code: 'hardcoded-secret',
          fix: 'Store secrets in wp-config.php constants or environment variables',
        });
      }
    }
  }

  return issues;
}

function checkLocalFileInclusion(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // include/require with user input — LFI vulnerability
    const includePattern = /(?:include|require)(?:_once)?\s*\(\s*\$_(POST|GET|REQUEST)/g;
    let match;
    while ((match = includePattern.exec(content)) !== null) {
      issues.push({
        id: generateTestId('code-quality'), category: 'code-quality', severity: 'critical', type: 'error',
        title: 'Local File Inclusion (LFI)',
        message: 'include/require with user-controlled path — LFI vulnerability',
        file: rel, line: getLineNumber(content, match.index), code: 'lfi-risk',
        fix: 'Never include files based on user input. Use a whitelist of allowed files.',
      });
    }
  }

  return issues;
}

// REMOVED: checkUnsafeSqlQueries — now in security-checker.ts (checkSqlInjection)
// REMOVED: checkUnserializeOnDbData — now in security-checker.ts (checkObjectInjection)

// REMOVED: checkAdminPostHandlers — moved to security-checker.ts (checkAdminPostAccessControl)

function checkSsrfPatterns(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // wp_remote_get/post/request with user-controlled URL
    const pattern = /wp_remote_(?:get|post|request|head)\s*\(\s*\$_(POST|GET|REQUEST)\s*\[/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      issues.push({
        id: generateTestId('code-quality'), category: 'code-quality', severity: 'critical', type: 'error',
        title: 'SSRF: wp_remote_* with user-controlled URL',
        message: `wp_remote_*() called with $_{${match[1]}} URL — Server-Side Request Forgery risk`,
        file: rel, line: getLineNumber(content, match.index), code: 'ssrf-risk',
        fix: 'Validate and sanitize URLs. Use wp_http_validate_url() and restrict to allowed hosts/protocols',
      });
    }

    // Also check for indirect SSRF: variable from user input passed to wp_remote_*
    const indirectPattern = /wp_remote_(?:get|post|request|head)\s*\(\s*\$(?!this|wp)/g;
    while ((match = indirectPattern.exec(content)) !== null) {
      const lineNum = getLineNumber(content, match.index);
      const lineContent = (content.split('\n')[lineNum - 1] || '').trim();
      // Only flag if the variable is likely from user input
      if (/\$url|\$link|\$endpoint|\$remote|\$target|\$redirect/.test(lineContent)) {
        const contextStart = Math.max(0, match.index - 500);
        const context = content.substring(contextStart, match.index);
        if (/\$_(POST|GET|REQUEST)/.test(context)) {
          issues.push({
            id: generateTestId('code-quality'), category: 'code-quality', severity: 'high', type: 'warning',
            title: 'Potential SSRF: wp_remote_* with user-derived URL',
            message: 'URL variable passed to wp_remote_*() may originate from user input',
            file: rel, line: lineNum, code: 'ssrf-risk-indirect',
            fix: 'Validate URLs with wp_http_validate_url() before making remote requests',
          });
        }
      }
    }
  }

  return issues;
}

// REMOVED: checkDbQueryInLoop — now in perf-checker.ts (checkN1Queries)

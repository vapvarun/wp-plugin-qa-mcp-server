/**
 * WP Plugin QA MCP Server - Static Code Checker
 * Dead code, duplicates, undefined functions, naming consistency, security patterns.
 * Note: This is a standalone MCP server - no external exec dependencies.
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import type { CheckerResult, CheckerIssue, Severity } from './types.js';
import { findPhpFiles, getLineNumber, relativePath, generateTestId } from './shared-utils.js';

export function checkStatic(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(pluginPath);

  const fileContents = new Map<string, string>();
  for (const file of phpFiles) {
    try {
      fileContents.set(file, readFileSync(file, 'utf-8'));
    } catch { /* skip */ }
  }

  issues.push(...checkDeadCode(phpFiles, fileContents, pluginPath));
  issues.push(...checkDuplicateFunctions(phpFiles, fileContents, pluginPath));
  issues.push(...checkNamingConsistency(phpFiles, fileContents, pluginPath));
  issues.push(...checkSecurityPatterns(phpFiles, fileContents, pluginPath));
  issues.push(...checkUndefinedFunctions(phpFiles, fileContents, pluginPath));
  issues.push(...checkAbspathGuard(phpFiles, fileContents, pluginPath));
  issues.push(...checkDebugStatements(phpFiles, fileContents, pluginPath));
  issues.push(...checkDangerousFunctions(phpFiles, fileContents, pluginPath));
  issues.push(...checkHardcodedSecrets(phpFiles, fileContents, pluginPath));
  issues.push(...checkDirectFileInclusion(phpFiles, fileContents, pluginPath));
  issues.push(...checkUnsafeSqlQueries(phpFiles, fileContents, pluginPath));

  const failed = issues.length;
  const passed = Math.max(0, 11 - failed);

  return {
    category: 'code-quality',
    issues,
    passed,
    failed,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function checkDeadCode(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const definedFunctions = new Map<string, { file: string; line: number }>();
  const calledFunctions = new Set<string>();
  const hookCallbacks = new Set<string>();

  const skipPrefixes = /^(get_|set_|is_|has_|can_|init_|register_|handle_|process_|render_|display_|admin_|ajax_|rest_|activate|deactivate|uninstall|__construct|__destruct)/;

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

    const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
    while ((match = callPattern.exec(content)) !== null) {
      calledFunctions.add(match[1]);
    }

    const hookPattern = /(?:add_action|add_filter)\s*\([^,]+,\s*(?:['"](\w+)['"]|\[(?:[^,]+,\s*)?['"](\w+)['"]\])/g;
    while ((match = hookPattern.exec(content)) !== null) {
      hookCallbacks.add(match[1] || match[2]);
    }
  }

  for (const [funcName, info] of definedFunctions) {
    if (calledFunctions.has(funcName)) continue;
    if (hookCallbacks.has(funcName)) continue;
    if (skipPrefixes.test(funcName)) continue;
    if (funcName.startsWith('_')) continue;

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

  let dominantPrefix = '';
  let dominantCount = 0;
  for (const [prefix, count] of prefixes) {
    if (count > dominantCount && prefix.length >= 2) {
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

function checkSecurityPatterns(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    // Direct superglobal usage without sanitization
    const unsafeInput = /\$_(POST|GET|REQUEST)\s*\[\s*['"][^'"]+['"]\s*\]/g;
    let match;
    while ((match = unsafeInput.exec(content)) !== null) {
      const lineNum = getLineNumber(content, match.index);
      const lineContent = lines[lineNum - 1] || '';
      if (!/sanitize_|absint|intval|wp_unslash|esc_|wp_kses|array_map/.test(lineContent)) {
        issues.push({
          id: generateTestId('code-quality'),
          category: 'code-quality',
          severity: 'high',
          type: 'error',
          title: `Unsanitized ${match[1]} input`,
          message: `Direct $_{${match[1]}} usage without sanitization`,
          file: rel,
          line: lineNum,
          code: 'unsanitized-input',
          fix: 'Wrap with sanitize_text_field() or appropriate sanitization function',
        });
      }
    }

    // Unescaped echo of variables
    const unsafeEcho = /echo\s+\$(?!this)/g;
    while ((match = unsafeEcho.exec(content)) !== null) {
      const lineNum = getLineNumber(content, match.index);
      const lineContent = lines[lineNum - 1] || '';
      if (!/esc_html|esc_attr|esc_url|wp_kses|intval|absint|number_format/.test(lineContent)) {
        issues.push({
          id: generateTestId('code-quality'),
          category: 'code-quality',
          severity: 'high',
          type: 'warning',
          title: 'Unescaped output',
          message: 'Variable echoed without escaping function',
          file: rel,
          line: lineNum,
          code: 'xss-risk',
          fix: 'Use esc_html(), esc_attr(), or esc_url() before output',
        });
      }
    }
  }

  return issues;
}

function checkUndefinedFunctions(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const definedFunctions = new Set<string>();
  const calledFunctions = new Map<string, { file: string; line: number; count: number }>();

  const wpCore = new Set([
    '__', '_e', '_n', '_x', 'esc_html__', 'esc_html_e', 'esc_attr__', 'esc_attr_e',
    'esc_html', 'esc_attr', 'esc_url', 'esc_js', 'esc_textarea', 'esc_sql',
    'wp_kses', 'wp_kses_post', 'sanitize_text_field', 'sanitize_email', 'absint',
    'add_action', 'add_filter', 'do_action', 'apply_filters',
    'get_option', 'update_option', 'delete_option', 'add_option',
    'get_post', 'get_posts', 'wp_insert_post', 'wp_update_post', 'wp_delete_post',
    'get_post_meta', 'update_post_meta', 'delete_post_meta', 'add_post_meta',
    'get_user_by', 'get_current_user_id', 'wp_get_current_user',
    'is_user_logged_in', 'current_user_can', 'wp_send_json', 'wp_send_json_success', 'wp_send_json_error',
    'wp_die', 'wp_verify_nonce', 'wp_create_nonce', 'check_ajax_referer',
    'register_post_type', 'register_taxonomy', 'register_rest_route',
    'wp_enqueue_script', 'wp_enqueue_style', 'wp_localize_script',
    'add_menu_page', 'add_submenu_page', 'add_meta_box', 'register_setting',
    'wp_redirect', 'wp_safe_redirect', 'wp_remote_get', 'wp_remote_post', 'is_wp_error',
    'wp_nonce_field', 'submit_button', 'settings_fields', 'do_settings_sections',
    'array_map', 'array_filter', 'array_merge', 'array_keys', 'array_values',
    'count', 'strlen', 'substr', 'strpos', 'str_replace', 'preg_match',
    'explode', 'implode', 'trim', 'strtolower', 'sprintf', 'printf',
    'json_encode', 'json_decode', 'file_exists', 'is_array', 'is_string',
    'defined', 'class_exists', 'function_exists', 'intval', 'floatval', 'is_numeric',
    'wp_upload_dir', 'wp_mkdir_p', 'get_transient', 'set_transient', 'delete_transient',
    'rest_ensure_response', 'get_term', 'get_terms', 'wp_get_post_terms',
    'load_plugin_textdomain', 'plugin_dir_path', 'plugin_dir_url', 'plugins_url',
    'add_shortcode', 'shortcode_atts', 'wp_schedule_event', 'wp_next_scheduled',
    'has_action', 'has_filter', 'did_action', 'add_settings_section', 'add_settings_field',
    'add_options_page', 'flush_rewrite_rules', 'wp_register_script', 'wp_register_style',
    'register_widget', 'get_the_ID', 'get_the_title', 'get_permalink',
    'the_post', 'have_posts', 'wp_reset_postdata', 'remove_action', 'remove_filter',
    'compact', 'var_dump', 'print_r', 'date', 'time', 'strtotime',
    'ob_start', 'ob_get_clean', 'wp_parse_args', 'wp_list_pluck',
    'get_bloginfo', 'home_url', 'admin_url', 'site_url', 'wp_json_encode',
  ]);

  const keywords = new Set([
    'if', 'else', 'elseif', 'while', 'for', 'foreach', 'switch', 'catch',
    'function', 'class', 'new', 'return', 'echo', 'print', 'array', 'list',
    'isset', 'empty', 'unset', 'die', 'exit', 'include', 'require',
    'include_once', 'require_once', 'use', 'namespace', 'throw', 'try', 'match',
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
      if (!keywords.has(name.toLowerCase()) && !wpCore.has(name)) {
        const existing = calledFunctions.get(name);
        if (existing) {
          existing.count++;
        } else {
          calledFunctions.set(name, { file: rel, line: getLineNumber(content, match.index), count: 1 });
        }
      }
    }
  }

  for (const [name, info] of calledFunctions) {
    if (!definedFunctions.has(name) && info.count >= 3) {
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

function checkAbspathGuard(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // Skip files that aren't directly loadable (inside classes/ includes/ etc.)
    if (rel.includes('vendor/') || rel.includes('node_modules/')) continue;

    // Check if the file has a PHP opening tag and executable code
    if (/^<\?php/m.test(content) && !rel.includes('index.php')) {
      const hasAbspathCheck = /defined\s*\(\s*['"]ABSPATH['"]\s*\)|defined\s*\(\s*'WPINC'\s*\)/.test(content);
      // Only flag main PHP files, not template-like files
      if (!hasAbspathCheck && /(?:class\s+\w|function\s+\w)/.test(content)) {
        issues.push({
          id: generateTestId('code-quality'), category: 'code-quality', severity: 'medium', type: 'warning',
          title: 'Missing ABSPATH guard',
          message: 'PHP file lacks direct access protection: defined(\'ABSPATH\') || exit;',
          file: rel, line: 1, code: 'no-abspath-guard',
          fix: 'Add: defined(\'ABSPATH\') || exit; after the opening PHP tag',
        });
      }
    }
  }

  return issues;
}

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

function checkDangerousFunctions(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  const dangerousPatterns: Array<{ pattern: RegExp; name: string; severity: Severity; message: string; fix: string }> = [
    {
      pattern: /\bunserialize\s*\(\s*\$_(POST|GET|REQUEST|COOKIE)/g,
      name: 'unserialize() on user input', severity: 'critical',
      message: 'unserialize() on user input allows object injection attacks',
      fix: 'Use json_decode() or wp_unslash() + sanitize instead of unserialize()',
    },
    {
      pattern: /\bextract\s*\(\s*\$_(POST|GET|REQUEST)/g,
      name: 'extract() on user input', severity: 'critical',
      message: 'extract() on user input allows variable injection',
      fix: 'Access superglobal values individually with sanitization',
    },
    {
      pattern: /\beval\s*\(/g,
      name: 'eval()', severity: 'critical',
      message: 'eval() executes arbitrary PHP code — severe security risk',
      fix: 'Refactor to avoid eval(). Use callbacks, switch/match, or dynamic function calls',
    },
    {
      pattern: /\bexec\s*\(\s*\$|system\s*\(\s*\$|passthru\s*\(\s*\$|shell_exec\s*\(\s*\$|popen\s*\(\s*\$/g,
      name: 'Shell execution with variable', severity: 'critical',
      message: 'Shell command execution with variable input — command injection risk',
      fix: 'Avoid shell commands. If necessary, use escapeshellarg() and escapeshellcmd()',
    },
    {
      pattern: /\bfile_get_contents\s*\(\s*\$_(POST|GET|REQUEST)/g,
      name: 'file_get_contents() on user input', severity: 'critical',
      message: 'Reading files from user-controlled paths — SSRF/LFI risk',
      fix: 'Validate and sanitize file paths. Use wp_remote_get() for URLs',
    },
    {
      pattern: /\bwp_redirect\s*\(\s*\$_(POST|GET|REQUEST)/g,
      name: 'Open redirect', severity: 'high',
      message: 'wp_redirect() with user-controlled URL — open redirect vulnerability',
      fix: 'Use wp_safe_redirect() which validates against allowed hosts',
    },
    {
      pattern: /move_uploaded_file\s*\(/g,
      name: 'Direct file upload', severity: 'high',
      message: 'Direct file upload handling instead of using WP upload API',
      fix: 'Use wp_handle_upload() which validates file types and paths',
    },
  ];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    for (const { pattern, name, severity, message, fix } of dangerousPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = getLineNumber(content, match.index);
        const lineContent = (content.split('\n')[lineNum - 1] || '').trim();
        if (/^\s*(?:\/\/|\*|#)/.test(lineContent)) continue;

        issues.push({
          id: generateTestId('code-quality'), category: 'code-quality', severity, type: 'error',
          title: `Dangerous: ${name}`,
          message, file: rel, line: lineNum, code: 'dangerous-function', fix,
        });
      }
    }
  }

  return issues;
}

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

function checkDirectFileInclusion(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // include/require with user input
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

    // Direct $wpdb->query without prepare
    const rawQueryPattern = /\$wpdb\s*->\s*query\s*\(\s*["']/g;
    while ((match = rawQueryPattern.exec(content)) !== null) {
      const contextStart = Math.max(0, match.index - 100);
      const context = content.substring(contextStart, match.index + match[0].length + 200);
      if (!/prepare/.test(context) && /\$/.test(context.substring(match[0].length))) {
        issues.push({
          id: generateTestId('code-quality'), category: 'code-quality', severity: 'high', type: 'error',
          title: 'SQL injection risk: $wpdb->query() without prepare()',
          message: 'Direct $wpdb->query() with string interpolation instead of $wpdb->prepare()',
          file: rel, line: getLineNumber(content, match.index), code: 'sql-injection',
          fix: 'Use $wpdb->prepare() for all queries with variable data',
        });
      }
    }
  }

  return issues;
}

function checkUnsafeSqlQueries(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // $wpdb->get_results/get_row/get_var with string concatenation (not prepare)
    const queryMethods = /\$wpdb\s*->\s*(?:get_results|get_row|get_var|get_col)\s*\(\s*["'][^"']*\$/g;
    let match;
    while ((match = queryMethods.exec(content)) !== null) {
      const contextBefore = content.substring(Math.max(0, match.index - 100), match.index);
      if (!/prepare/.test(contextBefore)) {
        issues.push({
          id: generateTestId('code-quality'), category: 'code-quality', severity: 'high', type: 'error',
          title: 'SQL injection risk: query with variable interpolation',
          message: 'Database query method uses string interpolation without $wpdb->prepare()',
          file: rel, line: getLineNumber(content, match.index), code: 'sql-injection-interpolation',
          fix: 'Wrap query with $wpdb->prepare() to safely handle variable data',
        });
      }
    }
  }

  return issues;
}

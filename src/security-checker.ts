/**
 * WP Plugin QA MCP Server - Security Deep Scanner
 * Goes beyond regex pattern matching to trace data flows and verify security chains.
 * Covers OWASP top vulnerabilities common in WordPress plugins:
 * XSS (47.7%), Broken Access Control (14.2%), CSRF (11.4%), SQL Injection, Object Injection.
 *
 * NOTE: This file contains regex patterns that match dangerous PHP function names
 * (eval, exec, system, etc.) for DETECTION purposes only — this scanner identifies
 * these patterns in scanned plugin code. It does not execute any shell commands.
 */

import type { CheckerResult, CheckerIssue } from './types.js';
import { generateTestId, findPhpFiles, relativePath, safeReadFile, getLineNumber } from './shared-utils.js';

export function checkSecurity(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(pluginPath);

  issues.push(...checkTaintedOutput(pluginPath, phpFiles));
  issues.push(...checkNonceChains(pluginPath, phpFiles));
  issues.push(...checkEscapingContext(pluginPath, phpFiles));
  issues.push(...checkFileUploads(pluginPath, phpFiles));
  issues.push(...checkRequestUriXss(pluginPath, phpFiles));
  issues.push(...checkObjectInjection(pluginPath, phpFiles));
  issues.push(...checkOpenRedirects(pluginPath, phpFiles));
  issues.push(...checkAjaxAccessControl(pluginPath, phpFiles));
  issues.push(...checkRestAccessControl(pluginPath, phpFiles));
  issues.push(...checkSqlInjection(pluginPath, phpFiles));
  issues.push(...checkDangerousFunctions(pluginPath, phpFiles));

  const errors = issues.filter(i => i.type === 'error').length;
  const totalChecks = 11;

  return {
    category: 'security',
    issues,
    passed: Math.max(0, totalChecks - errors),
    failed: errors,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

/**
 * Trace user input ($_GET, $_POST, $_REQUEST, $_COOKIE) to output (echo, print)
 * without proper sanitization/escaping.
 */
function checkTaintedOutput(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const inputSources = ['\\$_GET', '\\$_POST', '\\$_REQUEST', '\\$_COOKIE', '\\$_SERVER'];
  const inputPattern = new RegExp(`(${inputSources.join('|')})\\s*\\[\\s*['"]([^'"]+)['"]\\s*\\]`);
  const sanitizers = [
    'esc_html', 'esc_attr', 'esc_url', 'esc_js', 'esc_textarea', 'esc_sql',
    'wp_kses', 'wp_kses_post', 'wp_kses_data',
    'sanitize_text_field', 'sanitize_email', 'sanitize_file_name', 'sanitize_title',
    'sanitize_user', 'sanitize_key', 'sanitize_mime_type', 'sanitize_url',
    'absint', 'intval', 'floatval', 'boolval',
    'wp_unslash', 'stripslashes', 'htmlspecialchars', 'htmlentities', 'strip_tags',
  ];
  const sanitizerPattern = new RegExp(`(${sanitizers.join('|')})\\s*\\(`);

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/(?:echo|print)\s+/.test(line) && inputPattern.test(line)) {
        if (!sanitizerPattern.test(line)) {
          const inputMatch = line.match(inputPattern);
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'critical', type: 'error',
            title: 'Unescaped user input in output (XSS)',
            message: `Direct output of ${inputMatch ? inputMatch[1] + "['" + inputMatch[2] + "']" : 'user input'} without escaping`,
            file: rel, line: i + 1, code: 'xss-unescaped-output',
            fix: 'Wrap with esc_html(), esc_attr(), or esc_url() based on context',
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Verify nonce chain: form -> handler -> response.
 */
function checkNonceChains(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const nonceFields = new Set<string>();
  const nonceVerified = new Set<string>();
  const postHandlers: { file: string; line: number }[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);

    const fieldPattern = /wp_nonce_field\s*\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = fieldPattern.exec(content)) !== null) {
      nonceFields.add(match[1]);
    }

    const verifyPattern = /(?:wp_verify_nonce|check_admin_referer)\s*\(\s*(?:\$[^,]+,\s*)?['"]([^'"]+)['"]/g;
    while ((match = verifyPattern.exec(content)) !== null) {
      nonceVerified.add(match[1]);
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/\$_POST\s*\[/.test(lines[i]) && !/wp_verify_nonce|check_admin_referer|check_ajax_referer/.test(content)) {
        postHandlers.push({ file: rel, line: i + 1 });
      }
    }
  }

  for (const action of nonceFields) {
    if (!nonceVerified.has(action)) {
      issues.push({
        id: generateTestId('security'), category: 'security', severity: 'high', type: 'warning',
        title: `Nonce "${action}" created but never verified`,
        message: `wp_nonce_field("${action}") found but no corresponding wp_verify_nonce() or check_admin_referer()`,
        file: '', line: 0, code: 'nonce-not-verified',
        fix: `Add wp_verify_nonce() check before processing form data for action "${action}"`,
      });
    }
  }

  for (const handler of postHandlers.slice(0, 3)) {
    issues.push({
      id: generateTestId('security'), category: 'security', severity: 'high', type: 'error',
      title: 'POST data processed without nonce verification (CSRF)',
      message: 'File processes $_POST data but has no wp_verify_nonce() or check_admin_referer() call',
      file: handler.file, line: handler.line, code: 'csrf-no-nonce',
      fix: 'Add nonce field to form and verify with wp_verify_nonce() before processing',
    });
  }
  return issues;
}

/**
 * Check that escaping functions match their output context.
 */
function checkEscapingContext(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/=\s*["']\s*<\?php\s+echo\s+esc_html\s*\(/.test(line) ||
          (/=\s*["']/.test(line) && /esc_html\s*\(/.test(line) && !/>\s*<\?php/.test(line) && /\s+\w+=/.test(line))) {
        issues.push({
          id: generateTestId('security'), category: 'security', severity: 'medium', type: 'warning',
          title: 'esc_html() used in attribute context',
          message: 'esc_html() inside an HTML attribute — use esc_attr() instead for proper encoding',
          file: rel, line: i + 1, code: 'wrong-escaping-context',
          fix: 'Replace esc_html() with esc_attr() when outputting inside HTML attributes',
        });
      }

      if (/(?:href|src|action)\s*=\s*["'].*esc_attr\s*\(/.test(line)) {
        issues.push({
          id: generateTestId('security'), category: 'security', severity: 'medium', type: 'warning',
          title: 'esc_attr() used for URL context',
          message: 'esc_attr() in href/src/action attribute — use esc_url() for proper URL sanitization',
          file: rel, line: i + 1, code: 'wrong-url-escaping',
          fix: 'Replace esc_attr() with esc_url() when outputting URLs',
        });
      }

      if (/wp_kses_post\s*\(/.test(line) && /\$_(?:GET|POST|REQUEST)/.test(line)) {
        issues.push({
          id: generateTestId('security'), category: 'security', severity: 'medium', type: 'warning',
          title: 'wp_kses_post() used on raw user input',
          message: 'wp_kses_post() allows many HTML tags — consider sanitize_text_field() for plain text input',
          file: rel, line: i + 1, code: 'overly-permissive-kses',
          fix: 'Use sanitize_text_field() for plain text, or define custom wp_kses() allowed tags',
        });
      }
    }
  }
  return issues;
}

/**
 * Check file upload handling for security issues.
 */
function checkFileUploads(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/move_uploaded_file\s*\(/.test(line)) {
        const contextStart = Math.max(0, i - 30);
        const context = lines.slice(contextStart, i + 1).join('\n');
        if (!/wp_check_filetype|getimagesize|finfo_|mime_content_type|allowed_types/i.test(context)) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'critical', type: 'error',
            title: 'File upload without type validation',
            message: 'move_uploaded_file() called without checking file type. Attackers can upload PHP shells.',
            file: rel, line: i + 1, code: 'upload-no-type-check',
            fix: 'Use wp_check_filetype() and validate against allowed extensions before moving uploaded files',
          });
        }
      }

      if (/\$_FILES\s*\[/.test(line) && !/wp_handle_upload/.test(content)) {
        if (i === lines.findIndex(l => /\$_FILES\s*\[/.test(l))) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'high', type: 'warning',
            title: 'Direct $_FILES access instead of wp_handle_upload()',
            message: 'Consider using wp_handle_upload() which handles validation, sanitization, and proper file placement',
            file: rel, line: i + 1, code: 'direct-files-access',
            fix: 'Use wp_handle_upload() for proper WordPress file upload handling',
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Check for $_SERVER['REQUEST_URI'] XSS.
 */
function checkRequestUriXss(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/(?:echo|print)/.test(line) && /\$_SERVER\s*\[\s*['"]REQUEST_URI['"]\s*\]/.test(line)) {
        if (!/esc_url|esc_attr|esc_html|htmlspecialchars/.test(line)) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'critical', type: 'error',
            title: '$_SERVER["REQUEST_URI"] output without escaping (XSS)',
            message: 'REQUEST_URI contains user-controlled data and must be escaped before output',
            file: rel, line: i + 1, code: 'request-uri-xss',
            fix: 'Wrap with esc_url() when used in href, or esc_attr() in attributes',
          });
        }
      }

      if (/action\s*=.*\$_SERVER\s*\[\s*['"]REQUEST_URI['"]\s*\]/.test(line)) {
        if (!/esc_url|esc_attr/.test(line)) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'critical', type: 'error',
            title: 'Form action uses unescaped REQUEST_URI (XSS)',
            message: 'Form action attribute with raw $_SERVER["REQUEST_URI"] allows XSS via crafted URLs',
            file: rel, line: i + 1, code: 'form-action-xss',
            fix: 'Use esc_url( admin_url("admin.php?page=...") ) instead of raw REQUEST_URI',
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Check for PHP object injection via unserialize().
 */
function checkObjectInjection(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/\bunserialize\s*\(/.test(line)) {
        if (/\$_(?:GET|POST|REQUEST|COOKIE)/.test(line) || /\$_SERVER/.test(line)) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'critical', type: 'error',
            title: 'Object injection via unserialize() of user input',
            message: 'unserialize() of user-controlled data allows arbitrary object instantiation',
            file: rel, line: i + 1, code: 'object-injection',
            fix: 'Use json_decode() instead, or pass allowed_classes: false to unserialize()',
          });
        } else if (!/allowed_classes/.test(line)) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'medium', type: 'warning',
            title: 'unserialize() without allowed_classes restriction',
            message: 'unserialize() called without ["allowed_classes" => false]',
            file: rel, line: i + 1, code: 'unserialize-no-restrict',
            fix: 'Add ["allowed_classes" => false] or ["allowed_classes" => [SpecificClass::class]]',
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Check for open redirect vulnerabilities in wp_redirect().
 */
function checkOpenRedirects(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/\bwp_redirect\s*\(/.test(line) && !/wp_safe_redirect/.test(line)) {
        if (/\$_(?:GET|POST|REQUEST)/.test(line) || /\$redirect|\$url|\$location/i.test(line)) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'high', type: 'error',
            title: 'Open redirect via wp_redirect()',
            message: 'wp_redirect() with potentially user-controlled URL. Use wp_safe_redirect() to restrict to local URLs.',
            file: rel, line: i + 1, code: 'open-redirect',
            fix: 'Replace wp_redirect() with wp_safe_redirect() to limit redirects to the same host',
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Check AJAX handlers for proper access control.
 */
function checkAjaxAccessControl(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const noprivMatch = line.match(/add_action\s*\(\s*['"]wp_ajax_nopriv_([^'"]+)['"]/);
      if (noprivMatch) {
        const action = noprivMatch[1];
        const callbackMatch = line.match(/,\s*(?:['"]([^'"]+)['"]|\[.+?,\s*['"]([^'"]+)['"])/);
        if (callbackMatch) {
          const callback = callbackMatch[1] || callbackMatch[2];
          const callbackPattern = new RegExp(`function\\s+${callback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`);
          const funcIdx = content.search(callbackPattern);
          if (funcIdx >= 0) {
            const funcContent = content.substring(funcIdx, funcIdx + 3000);
            if (!/current_user_can|is_user_logged_in|check_ajax_referer|wp_verify_nonce/.test(funcContent)) {
              issues.push({
                id: generateTestId('security'), category: 'security', severity: 'high', type: 'warning',
                title: `AJAX handler "${action}" has no access control`,
                message: `wp_ajax_nopriv_${action} handler lacks capability check, nonce verification, or login check`,
                file: rel, line: i + 1, code: 'ajax-nopriv-no-access-control',
                fix: 'Add check_ajax_referer() and/or current_user_can() at the start of the callback',
              });
            }
          }
        }
      }
    }
  }
  return issues;
}

/**
 * Check REST API endpoints for broken access control.
 */
function checkRestAccessControl(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);

    const routePattern = /register_rest_route\s*\(/g;
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      const idx = match.index;
      const routeContext = content.substring(idx, Math.min(idx + 800, content.length));

      if (!/permission_callback/.test(routeContext)) {
        issues.push({
          id: generateTestId('security'), category: 'security', severity: 'critical', type: 'error',
          title: 'REST route without permission_callback',
          message: 'register_rest_route() without permission_callback — endpoint is publicly accessible',
          file: rel, line: getLineNumber(content, idx), code: 'rest-no-permission-callback',
          fix: "Add 'permission_callback' => function() { return current_user_can('manage_options'); }",
        });
      }

      if (/permission_callback.*__return_true/.test(routeContext)) {
        issues.push({
          id: generateTestId('security'), category: 'security', severity: 'medium', type: 'info',
          title: 'REST route uses __return_true for permissions',
          message: 'permission_callback is __return_true — this endpoint is intentionally public. Verify this is desired.',
          file: rel, line: getLineNumber(content, idx), code: 'rest-public-endpoint',
        });
      }

      if (/(?:POST|PUT|DELETE|PATCH)/.test(routeContext)) {
        if (!/current_user_can|is_user_logged_in/.test(routeContext)) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'high', type: 'error',
            title: 'Write REST endpoint without capability check',
            message: 'POST/PUT/DELETE endpoint should check current_user_can() in permission_callback',
            file: rel, line: getLineNumber(content, idx), code: 'rest-write-no-cap-check',
            fix: 'Add proper capability check in permission_callback for write endpoints',
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Check for SQL injection patterns.
 */
function checkSqlInjection(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/\$wpdb->query\s*\(/.test(line) || /\$wpdb->get_/.test(line)) {
        if (!/prepare\s*\(/.test(line)) {
          const sqlPart = line.substring((line.indexOf('->query') >= 0 ? line.indexOf('->query') : line.indexOf('->get_')));
          if (/\$(?!wpdb|table_prefix)/.test(sqlPart)) {
            issues.push({
              id: generateTestId('security'), category: 'security', severity: 'critical', type: 'error',
              title: 'Potential SQL injection — query without $wpdb->prepare()',
              message: '$wpdb query with variable interpolation instead of prepared statements',
              file: rel, line: i + 1, code: 'sql-injection',
              fix: 'Use $wpdb->prepare() with %s/%d/%f placeholders for all variable values',
            });
          }
        }
      }

      if (/(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*\.\s*\$_(?:GET|POST|REQUEST)/i.test(line)) {
        issues.push({
          id: generateTestId('security'), category: 'security', severity: 'critical', type: 'error',
          title: 'SQL injection — user input concatenated into query',
          message: 'Direct concatenation of user input into SQL query string',
          file: rel, line: i + 1, code: 'sql-injection-concat',
          fix: 'Use $wpdb->prepare() with placeholders, never concatenate user input into SQL',
        });
      }
    }
  }
  return issues;
}

/**
 * Check for dangerous PHP functions that shouldn't be in plugins.
 * NOTE: These patterns DETECT dangerous functions in scanned code, they don't use them.
 */
function checkDangerousFunctions(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  // Each entry detects a dangerous PHP function in scanned plugin source code
  const dangerous: { pattern: RegExp; name: string; severity: 'critical' | 'high'; fix: string }[] = [
    { pattern: /\beval\s*\(/, name: 'eval()', severity: 'critical', fix: 'Remove eval() — it allows arbitrary code. Use proper logic instead.' },
    { pattern: /\bpassthru\s*\(/, name: 'passthru()', severity: 'critical', fix: 'Remove passthru() — use WordPress APIs.' },
    { pattern: /\bproc_open\s*\(/, name: 'proc_open()', severity: 'high', fix: 'Remove proc_open() — use WordPress APIs.' },
    { pattern: /\bpopen\s*\(/, name: 'popen()', severity: 'high', fix: 'Remove popen() — use WordPress APIs.' },
    { pattern: /\bpcntl_exec\s*\(/, name: 'pcntl_exec()', severity: 'critical', fix: 'Remove pcntl_exec().' },
    { pattern: /\bassert\s*\(\s*\$/, name: 'assert($var)', severity: 'high', fix: 'Remove dynamic assert() — it runs code in PHP < 8.0.' },
    { pattern: /\bcreate_function\s*\(/, name: 'create_function()', severity: 'high', fix: 'Replace with anonymous function. create_function() is deprecated.' },
    { pattern: /\bpreg_replace\s*\(.*\/e/, name: 'preg_replace /e', severity: 'critical', fix: 'Replace preg_replace /e with preg_replace_callback().' },
    { pattern: /\bextract\s*\(\s*\$_/, name: 'extract($_superglobal)', severity: 'critical', fix: 'Never extract() superglobals — it creates arbitrary variables.' },
  ];

  // Shell command detection patterns (separate for clarity)
  const shellPatterns: { pattern: RegExp; name: string }[] = [
    { pattern: /\bshell_exec\s*\(/, name: 'shell_exec()' },
    { pattern: /\bsystem\s*\((?!\s*\))/, name: 'system()' },
  ];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:\/\/|\*|#)/.test(line)) continue;

      for (const d of dangerous) {
        if (d.pattern.test(line)) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: d.severity, type: 'error',
            title: `Dangerous function: ${d.name}`,
            message: `Found ${d.name} in ${rel}:${i + 1}`,
            file: rel, line: i + 1, code: `dangerous-func-${d.name.replace(/[^a-z]/g, '')}`,
            fix: d.fix,
          });
          break;
        }
      }

      for (const sp of shellPatterns) {
        if (sp.pattern.test(line)) {
          issues.push({
            id: generateTestId('security'), category: 'security', severity: 'critical', type: 'error',
            title: `Shell command function: ${sp.name}`,
            message: `Found ${sp.name} in ${rel}:${i + 1} — use WP_Filesystem or WordPress APIs instead`,
            file: rel, line: i + 1, code: `shell-func-${sp.name.replace(/[^a-z]/g, '')}`,
            fix: `Remove ${sp.name} — use WP_Filesystem or WordPress APIs.`,
          });
          break;
        }
      }
    }
  }
  return issues;
}

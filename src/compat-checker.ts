/**
 * WP Plugin QA MCP Server - Compatibility Checker
 * PHP/WP deprecated functions, version compat, plugin conflicts.
 * Note: Pure static analysis, no shell commands used.
 */

import { readFileSync } from 'fs';
import type { CheckerResult, CheckerIssue } from './types.js';
import { findPhpFiles, getLineNumber, relativePath, generateTestId } from './shared-utils.js';

const PHP_DEPRECATED: Record<string, { replacement: string; since: string }> = {
  'create_function': { replacement: 'anonymous functions', since: '7.2' },
  'each': { replacement: 'foreach', since: '7.2' },
  'money_format': { replacement: 'NumberFormatter', since: '7.4' },
  'utf8_encode': { replacement: 'mb_convert_encoding', since: '8.2' },
  'utf8_decode': { replacement: 'mb_convert_encoding', since: '8.2' },
  // mysql_* functions (removed in PHP 7.0)
  'mysql_connect': { replacement: 'mysqli_connect() or $wpdb', since: '5.5 (removed 7.0)' },
  'mysql_query': { replacement: 'mysqli_query() or $wpdb->query()', since: '5.5 (removed 7.0)' },
  'mysql_fetch_array': { replacement: 'mysqli_fetch_array()', since: '5.5 (removed 7.0)' },
  'mysql_fetch_assoc': { replacement: 'mysqli_fetch_assoc()', since: '5.5 (removed 7.0)' },
  'mysql_fetch_row': { replacement: 'mysqli_fetch_row()', since: '5.5 (removed 7.0)' },
  'mysql_num_rows': { replacement: 'mysqli_num_rows()', since: '5.5 (removed 7.0)' },
  'mysql_real_escape_string': { replacement: '$wpdb->prepare()', since: '5.5 (removed 7.0)' },
  'mysql_close': { replacement: 'mysqli_close()', since: '5.5 (removed 7.0)' },
  'mysql_select_db': { replacement: 'mysqli_select_db()', since: '5.5 (removed 7.0)' },
  // ereg* functions (removed in PHP 7.0)
  'ereg': { replacement: 'preg_match()', since: '5.3 (removed 7.0)' },
  'eregi': { replacement: 'preg_match() with i flag', since: '5.3 (removed 7.0)' },
  'ereg_replace': { replacement: 'preg_replace()', since: '5.3 (removed 7.0)' },
  'eregi_replace': { replacement: 'preg_replace() with i flag', since: '5.3 (removed 7.0)' },
  'split': { replacement: 'explode() or preg_split()', since: '5.3 (removed 7.0)' },
  'spliti': { replacement: 'preg_split() with i flag', since: '5.3 (removed 7.0)' },
  // mcrypt (removed in PHP 7.2)
  'mcrypt_encrypt': { replacement: 'openssl_encrypt()', since: '7.1 (removed 7.2)' },
  'mcrypt_decrypt': { replacement: 'openssl_decrypt()', since: '7.1 (removed 7.2)' },
  'mcrypt_create_iv': { replacement: 'random_bytes()', since: '7.1 (removed 7.2)' },
  // Other deprecated
  '__autoload': { replacement: 'spl_autoload_register()', since: '7.2' },
  'get_magic_quotes_gpc': { replacement: 'always returns false (removed 8.0)', since: '7.4 (removed 8.0)' },
  'get_magic_quotes_runtime': { replacement: 'always returns false (removed 8.0)', since: '7.4 (removed 8.0)' },
  // PHP 7.4 deprecated
  'hebrevc': { replacement: 'removed', since: '7.4 (removed 8.0)' },
  'convert_cyr_string': { replacement: 'mb_convert_encoding() or iconv()', since: '7.4 (removed 8.0)' },
  'restore_include_path': { replacement: 'ini_restore("include_path")', since: '7.4 (removed 8.0)' },
  // PHP 8.1 deprecated
  'strftime': { replacement: 'IntlDateFormatter::format() or date()', since: '8.1' },
  'gmstrftime': { replacement: 'IntlDateFormatter::format() or gmdate()', since: '8.1' },
  'date_sunrise': { replacement: 'date_sun_info()', since: '8.1' },
  'date_sunset': { replacement: 'date_sun_info()', since: '8.1' },
  'mhash': { replacement: 'hash()', since: '8.1' },
  'mhash_keygen_s2k': { replacement: 'hash_pbkdf2()', since: '8.1' },
  'mhash_count': { replacement: 'hash_algos()', since: '8.1' },
  'mhash_get_block_size': { replacement: 'removed', since: '8.1' },
  'mhash_get_hash_name': { replacement: 'hash_algos()', since: '8.1' },
  // PHP 8.3 deprecated — get_class/get_parent_class without args
  // (handled separately in checkPhpSyntaxCompat as they need context check)
  // PHP 8.4 deprecated
  'session_register': { replacement: '$_SESSION directly', since: '5.3 (removed 8.4)' },
};

const WP_DEPRECATED: Record<string, { replacement: string; since: string }> = {
  'get_currentuserinfo': { replacement: 'wp_get_current_user()', since: '4.5' },
  'wp_setcookie': { replacement: 'wp_set_auth_cookie()', since: '2.5' },
  'wp_get_single_post': { replacement: 'get_post()', since: '3.5' },
  'clean_url': { replacement: 'esc_url()', since: '3.0' },
  'attribute_escape': { replacement: 'esc_attr()', since: '2.8' },
  'js_escape': { replacement: 'esc_js()', since: '2.8' },
  'wp_specialchars': { replacement: 'esc_html()', since: '2.8' },
  'get_settings': { replacement: 'get_option()', since: '2.1' },
  'update_usermeta': { replacement: 'update_user_meta()', since: '3.0' },
  'get_usermeta': { replacement: 'get_user_meta()', since: '3.0' },
  'delete_usermeta': { replacement: 'delete_user_meta()', since: '3.0' },
  'user_pass_ok': { replacement: 'wp_authenticate()', since: '3.5' },
  'screen_icon': { replacement: 'removed (not needed)', since: '3.8' },
  'like_escape': { replacement: '$wpdb->esc_like()', since: '4.0' },
  'is_comments_popup': { replacement: 'removed', since: '4.5' },
  // More modern deprecated functions
  'query_posts': { replacement: 'WP_Query or get_posts()', since: '3.1 (strongly discouraged)' },
  'get_page_by_title': { replacement: 'WP_Query with title parameter', since: '6.2' },
  'wp_reset_query': { replacement: 'wp_reset_postdata()', since: '3.0 (discouraged)' },
  'is_site_admin': { replacement: 'is_super_admin()', since: '3.0' },
  'get_all_category_ids': { replacement: 'get_terms()', since: '4.0' },
  'wp_embed_register_handler': { replacement: 'wp_embed_register_handler() with priority', since: '4.9' },
  'the_meta': { replacement: 'get_post_meta() with custom display', since: '6.0' },
  'wp_make_link_relative': { replacement: 'wp_make_link_relative() (use with caution)', since: '4.1' },
  'get_the_author_aim': { replacement: 'removed (contact methods)', since: '3.5' },
  'get_the_author_yim': { replacement: 'removed (contact methods)', since: '3.5' },
  'get_the_author_icq': { replacement: 'removed (contact methods)', since: '3.5' },
  'get_the_author_jabber': { replacement: 'removed (contact methods)', since: '3.5' },
  'register_sidebar_widget': { replacement: 'register_widget()', since: '2.8' },
  'register_widget_control': { replacement: 'register_widget()', since: '2.8' },
  'wp_get_sites': { replacement: 'get_sites()', since: '4.6' },
  'get_blog_details': { replacement: 'get_site()', since: '4.7' },
};

export function checkCompat(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(pluginPath);

  const fileContents = new Map<string, string>();
  for (const file of phpFiles) {
    try { fileContents.set(file, readFileSync(file, 'utf-8')); } catch { /* skip */ }
  }

  issues.push(...checkPhpDeprecated(phpFiles, fileContents, pluginPath));
  issues.push(...checkWpDeprecated(phpFiles, fileContents, pluginPath));
  issues.push(...checkScriptDependencies(phpFiles, fileContents, pluginPath));
  issues.push(...checkPhpSyntaxCompat(phpFiles, fileContents, pluginPath));

  return {
    category: 'compatibility',
    issues,
    passed: Math.max(0, 4 - issues.filter(i => i.type === 'error').length),
    failed: issues.filter(i => i.type === 'error').length,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function checkPhpDeprecated(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    for (const [func, info] of Object.entries(PHP_DEPRECATED)) {
      const pattern = new RegExp(`\\b${func}\\s*\\(`, 'g');
      let match;
      while ((match = pattern.exec(content)) !== null) {
        issues.push({
          id: generateTestId('compatibility'), category: 'compatibility', severity: 'medium', type: 'warning',
          title: `PHP deprecated: ${func}() since PHP ${info.since}`,
          message: `${func}() is deprecated since PHP ${info.since}`,
          file: rel, line: getLineNumber(content, match.index), code: 'php-deprecated',
          fix: `Use ${info.replacement} instead`,
        });
      }
    }
  }

  return issues;
}

function checkWpDeprecated(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    for (const [func, info] of Object.entries(WP_DEPRECATED)) {
      const pattern = new RegExp(`\\b${func}\\s*\\(`, 'g');
      let match;
      while ((match = pattern.exec(content)) !== null) {
        // Skip method calls ($this->get_settings, Class::get_settings)
        const before = content.substring(Math.max(0, match.index - 5), match.index);
        if (/->$|::$/.test(before.trim())) continue;

        issues.push({
          id: generateTestId('compatibility'), category: 'compatibility', severity: 'medium', type: 'warning',
          title: `WP deprecated: ${func}() since WP ${info.since}`,
          message: `${func}() is deprecated since WordPress ${info.since}`,
          file: rel, line: getLineNumber(content, match.index), code: 'wp-deprecated',
          fix: `Use ${info.replacement} instead`,
        });
      }
    }
  }

  return issues;
}

function checkScriptDependencies(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const enqueuePattern = /wp_enqueue_script\s*\(\s*['"][^'"]+['"]\s*,\s*[^,]+,\s*(?:array\s*\(\s*\)|\[\s*\])/g;
    let match;
    while ((match = enqueuePattern.exec(content)) !== null) {
      const context = content.substring(Math.max(0, match.index - 200), match.index + match[0].length + 200);
      if (/jquery|jQuery|\$\(/.test(context)) {
        issues.push({
          id: generateTestId('compatibility'), category: 'compatibility', severity: 'medium', type: 'warning',
          title: 'Script missing jQuery dependency',
          message: 'Script appears to use jQuery but is enqueued without "jquery" dependency',
          file: rel, line: getLineNumber(content, match.index), code: 'missing-script-dependency',
          fix: "Add 'jquery' to the dependency array",
        });
      }
    }
  }

  return issues;
}

/**
 * Comprehensive PHP 7.4 → 8.4 feature & deprecation detection.
 * Since we can't predict the client's PHP version, flag every version-specific
 * feature so plugin devs know the minimum PHP version their code requires.
 */
function checkPhpSyntaxCompat(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  // Version-specific feature patterns: regex → { version, title, message, code }
  const featureChecks: Array<{
    pattern: RegExp;
    version: string;
    title: string;
    message: string;
    code: string;
    severity?: 'low' | 'medium';
    isDeprecated?: boolean;
    fix?: string;
  }> = [

    // ════════════════════════════════════════════════════
    // PHP 7.4+ FEATURES
    // ════════════════════════════════════════════════════

    {
      pattern: /(?:public|private|protected)\s+(?:static\s+)?(?:\??\s*(?:int|float|string|bool|array|object|iterable|self|parent|callable|(?:[A-Z]\w+)))\s+\$/g,
      version: '7.4', title: 'Typed properties require PHP 7.4+',
      message: 'Typed class properties (public int $x) require PHP 7.4+',
      code: 'php74-typed-properties',
    },
    {
      pattern: /\bfn\s*\(/g,
      version: '7.4', title: 'Arrow functions require PHP 7.4+',
      message: 'Arrow function syntax fn() => requires PHP 7.4+',
      code: 'php74-arrow-function',
    },
    {
      pattern: /\?\?=/g,
      version: '7.4', title: 'Null coalescing assignment requires PHP 7.4+',
      message: 'Null coalescing assignment operator (??=) requires PHP 7.4+',
      code: 'php74-null-coalesce-assign',
    },
    {
      pattern: /\[\s*\.\.\.\$/g,
      version: '7.4', title: 'Spread operator in arrays requires PHP 7.4+',
      message: 'Spread operator in array expressions ([...$arr]) requires PHP 7.4+',
      code: 'php74-array-spread',
    },
    {
      pattern: /\b\d[\d_]*_\d/g,
      version: '7.4', title: 'Numeric literal separator requires PHP 7.4+',
      message: 'Underscore separator in numeric literals (1_000) requires PHP 7.4+',
      code: 'php74-numeric-separator',
    },

    // ════════════════════════════════════════════════════
    // PHP 8.0+ FEATURES
    // ════════════════════════════════════════════════════

    {
      pattern: /\bmatch\s*\(\s*\$/g,
      version: '8.0', title: 'match expression requires PHP 8.0+',
      message: 'match expression is only available in PHP 8.0+',
      code: 'php80-match',
    },
    {
      pattern: /\?->/g,
      version: '8.0', title: 'Nullsafe operator requires PHP 8.0+',
      message: 'Nullsafe operator (?->) requires PHP 8.0+',
      code: 'php80-nullsafe',
    },
    {
      pattern: /(?:public|private|protected)\s+(?:readonly\s+)?(?:\??\s*(?:int|float|string|bool|array|mixed|(?:[A-Z]\w+))\s*\|)+(?:\??\s*(?:int|float|string|bool|array|null|mixed|(?:[A-Z]\w+)))\s+\$/g,
      version: '8.0', title: 'Union types require PHP 8.0+',
      message: 'Union type declarations (int|string) require PHP 8.0+',
      code: 'php80-union-types',
    },
    {
      pattern: /function\s+__construct\s*\(\s*(?:(?:public|private|protected)\s+(?:readonly\s+)?(?:\??\s*\w+\s+)?\$\w+)/g,
      version: '8.0', title: 'Constructor promotion requires PHP 8.0+',
      message: 'Constructor property promotion (public $x in constructor) requires PHP 8.0+',
      code: 'php80-constructor-promotion', severity: 'medium',
    },
    {
      pattern: /#\[\w+/g,
      version: '8.0', title: 'PHP Attributes require PHP 8.0+',
      message: 'PHP attribute syntax (#[Attribute]) requires PHP 8.0+',
      code: 'php80-attributes', severity: 'medium',
    },
    {
      pattern: /\bstr_contains\s*\(/g,
      version: '8.0', title: 'str_contains() requires PHP 8.0+',
      message: 'str_contains() is only available in PHP 8.0+',
      code: 'php80-str-contains',
    },
    {
      pattern: /\bstr_starts_with\s*\(/g,
      version: '8.0', title: 'str_starts_with() requires PHP 8.0+',
      message: 'str_starts_with() is only available in PHP 8.0+',
      code: 'php80-str-starts-with',
    },
    {
      pattern: /\bstr_ends_with\s*\(/g,
      version: '8.0', title: 'str_ends_with() requires PHP 8.0+',
      message: 'str_ends_with() is only available in PHP 8.0+',
      code: 'php80-str-ends-with',
    },
    {
      pattern: /\bfdiv\s*\(/g,
      version: '8.0', title: 'fdiv() requires PHP 8.0+',
      message: 'fdiv() is only available in PHP 8.0+',
      code: 'php80-fdiv',
    },
    {
      pattern: /\?\?\s*throw\s+new\s+/g,
      version: '8.0', title: 'throw expression requires PHP 8.0+',
      message: 'throw as expression ($x ?? throw ...) requires PHP 8.0+',
      code: 'php80-throw-expression',
    },
    {
      pattern: /:\s*mixed\b/g,
      version: '8.0', title: 'mixed type requires PHP 8.0+',
      message: 'mixed type declaration requires PHP 8.0+',
      code: 'php80-mixed-type',
    },

    // ════════════════════════════════════════════════════
    // PHP 8.1+ FEATURES
    // ════════════════════════════════════════════════════

    {
      pattern: /^\s*enum\s+\w+/gm,
      version: '8.1', title: 'enum requires PHP 8.1+',
      message: 'PHP enum declaration requires PHP 8.1+',
      code: 'php81-enum', severity: 'medium',
    },
    {
      pattern: /\breadonly\s+(?:public|private|protected|string|int|float|bool|array)/g,
      version: '8.1', title: 'readonly properties require PHP 8.1+',
      message: 'readonly properties are only available in PHP 8.1+',
      code: 'php81-readonly',
    },
    {
      pattern: /:\s*never\b/g,
      version: '8.1', title: 'never return type requires PHP 8.1+',
      message: 'never return type requires PHP 8.1+',
      code: 'php81-never',
    },
    {
      pattern: /new\s+Fiber\s*\(/g,
      version: '8.1', title: 'Fibers require PHP 8.1+',
      message: 'Fiber class requires PHP 8.1+',
      code: 'php81-fiber',
    },
    {
      pattern: /\w+\(\.\.\.\)/g,
      version: '8.1', title: 'First-class callable syntax requires PHP 8.1+',
      message: 'First-class callable syntax (strlen(...)) requires PHP 8.1+',
      code: 'php81-callable-syntax',
    },
    {
      pattern: /\benum_exists\s*\(/g,
      version: '8.1', title: 'enum_exists() requires PHP 8.1+',
      message: 'enum_exists() is only available in PHP 8.1+',
      code: 'php81-enum-exists',
    },
    {
      pattern: /\barray_is_list\s*\(/g,
      version: '8.1', title: 'array_is_list() requires PHP 8.1+',
      message: 'array_is_list() is only available in PHP 8.1+',
      code: 'php81-array-is-list',
    },

    // PHP 8.1 DEPRECATED
    {
      pattern: /FILTER_SANITIZE_STRING/g,
      version: '8.1', title: 'FILTER_SANITIZE_STRING deprecated since PHP 8.1',
      message: 'FILTER_SANITIZE_STRING emits deprecation warning in PHP 8.1+',
      code: 'php81-filter-string', isDeprecated: true,
      fix: 'Use htmlspecialchars() or sanitize_text_field() instead',
    },
    {
      pattern: /FILTER_SANITIZE_MAGIC_QUOTES/g,
      version: '8.1', title: 'FILTER_SANITIZE_MAGIC_QUOTES deprecated since PHP 8.1',
      message: 'FILTER_SANITIZE_MAGIC_QUOTES is deprecated in PHP 8.1+',
      code: 'php81-filter-magic-quotes', isDeprecated: true,
      fix: 'Use addslashes() if needed',
    },

    // ════════════════════════════════════════════════════
    // PHP 8.2+ FEATURES
    // ════════════════════════════════════════════════════

    {
      pattern: /^\s*readonly\s+class\s+/gm,
      version: '8.2', title: 'readonly class requires PHP 8.2+',
      message: 'readonly classes are only available in PHP 8.2+',
      code: 'php82-readonly-class', severity: 'medium',
    },
    {
      pattern: /\(\s*\w+\s*&\s*\w+\s*\)\s*\|/g,
      version: '8.2', title: 'DNF types require PHP 8.2+',
      message: 'Disjunctive Normal Form types (A&B)|C require PHP 8.2+',
      code: 'php82-dnf-types',
    },

    // ════════════════════════════════════════════════════
    // PHP 8.3+ FEATURES
    // ════════════════════════════════════════════════════

    {
      pattern: /const\s+(?:int|float|string|bool|array)\s+\w+\s*=/g,
      version: '8.3', title: 'Typed class constants require PHP 8.3+',
      message: 'Typed class constants (const int X = 1) require PHP 8.3+',
      code: 'php83-typed-constants', severity: 'medium',
    },
    {
      pattern: /\bjson_validate\s*\(/g,
      version: '8.3', title: 'json_validate() requires PHP 8.3+',
      message: 'json_validate() is only available in PHP 8.3+',
      code: 'php83-json-validate',
    },
    {
      pattern: /#\[\\?Override\]/g,
      version: '8.3', title: '#[\\Override] attribute requires PHP 8.3+',
      message: '#[\\Override] attribute requires PHP 8.3+',
      code: 'php83-override-attr', severity: 'medium',
    },
    {
      pattern: /\$\w+::\{\$/g,
      version: '8.3', title: 'Dynamic class constant fetch requires PHP 8.3+',
      message: 'Dynamic class constant fetch ($class::{$const}) requires PHP 8.3+',
      code: 'php83-dynamic-const-fetch',
    },
    {
      pattern: /\bmb_str_pad\s*\(/g,
      version: '8.3', title: 'mb_str_pad() requires PHP 8.3+',
      message: 'mb_str_pad() is only available in PHP 8.3+',
      code: 'php83-mb-str-pad',
    },

    // PHP 8.3 DEPRECATED
    {
      pattern: /\bget_class\s*\(\s*\)/g,
      version: '8.3', title: 'get_class() without args deprecated since PHP 8.3',
      message: 'Calling get_class() without arguments is deprecated in PHP 8.3',
      code: 'php83-get-class-no-args', isDeprecated: true,
      fix: 'Use static::class or $this::class instead',
    },
    {
      pattern: /\bget_parent_class\s*\(\s*\)/g,
      version: '8.3', title: 'get_parent_class() without args deprecated since PHP 8.3',
      message: 'Calling get_parent_class() without arguments is deprecated in PHP 8.3',
      code: 'php83-get-parent-no-args', isDeprecated: true,
      fix: 'Use parent::class instead',
    },

    // ════════════════════════════════════════════════════
    // PHP 8.4+ FEATURES
    // ════════════════════════════════════════════════════

    {
      pattern: /(?:public|private|protected)\s*\(\s*set\s*\)/g,
      version: '8.4', title: 'Asymmetric visibility requires PHP 8.4+',
      message: 'Asymmetric visibility (public private(set)) requires PHP 8.4+',
      code: 'php84-asymmetric-visibility', severity: 'medium',
    },
    {
      pattern: /\barray_find\s*\(/g,
      version: '8.4', title: 'array_find() requires PHP 8.4+',
      message: 'array_find() is only available in PHP 8.4+',
      code: 'php84-array-find',
    },
    {
      pattern: /\barray_find_key\s*\(/g,
      version: '8.4', title: 'array_find_key() requires PHP 8.4+',
      message: 'array_find_key() is only available in PHP 8.4+',
      code: 'php84-array-find-key',
    },
    {
      pattern: /\barray_any\s*\(/g,
      version: '8.4', title: 'array_any() requires PHP 8.4+',
      message: 'array_any() is only available in PHP 8.4+',
      code: 'php84-array-any',
    },
    {
      pattern: /\barray_all\s*\(/g,
      version: '8.4', title: 'array_all() requires PHP 8.4+',
      message: 'array_all() is only available in PHP 8.4+',
      code: 'php84-array-all',
    },
    {
      pattern: /#\[\\?Deprecated\b/g,
      version: '8.4', title: '#[\\Deprecated] attribute requires PHP 8.4+',
      message: '#[\\Deprecated] attribute requires PHP 8.4+',
      code: 'php84-deprecated-attr', severity: 'medium',
    },
    {
      pattern: /\bnew\s+\w+(?:::\w+)?\s*(?:->|\?\->)\w+/g,
      version: '8.4', title: 'new without parentheses requires PHP 8.4+',
      message: 'new ClassName->method() without parentheses requires PHP 8.4+',
      code: 'php84-new-without-parens',
    },
    {
      pattern: /\bRequest::createFromGlobals\s*\(/g,
      version: '8.4', title: 'Lazy objects API requires PHP 8.4+',
      message: 'Lazy objects/ghost objects require PHP 8.4+',
      code: 'php84-lazy-objects',
    },
    {
      pattern: /\bReflectionClass::newLazyGhost\s*\(|ReflectionClass::newLazyProxy\s*\(/g,
      version: '8.4', title: 'Lazy objects require PHP 8.4+',
      message: 'ReflectionClass lazy object methods require PHP 8.4+',
      code: 'php84-lazy-objects-reflection', severity: 'medium',
    },
    {
      pattern: /\bbcceil\s*\(|\bbcfloor\s*\(|\bbcround\s*\(/g,
      version: '8.4', title: 'BC math rounding functions require PHP 8.4+',
      message: 'bcceil(), bcfloor(), bcround() require PHP 8.4+',
      code: 'php84-bcmath-round',
    },

    // PHP 8.4 DEPRECATED
    {
      pattern: /\bE_STRICT\b/g,
      version: '8.4', title: 'E_STRICT constant deprecated since PHP 8.4',
      message: 'E_STRICT constant is deprecated in PHP 8.4',
      code: 'php84-e-strict', isDeprecated: true,
      fix: 'E_STRICT no longer produces any warnings in PHP 8.4+, remove from error_reporting',
    },
    {
      pattern: /\bstrtolower\s*\(\s*get_class\s*\(/g,
      version: '8.4', title: 'strtolower(get_class()) pattern deprecated since PHP 8.4',
      message: 'Use ::class which already returns lowercase in PHP 8.4',
      code: 'php84-get-class-lowercase', isDeprecated: true,
      fix: 'Use ClassName::class instead',
    },
  ];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    for (const check of featureChecks) {
      let match;
      while ((match = check.pattern.exec(content)) !== null) {
        const lineNum = getLineNumber(content, match.index);
        const lineContent = (content.split('\n')[lineNum - 1] || '').trim();
        // Skip commented-out code
        if (/^\s*(?:\/\/|\*|#(?!\[))/.test(lineContent)) continue;

        issues.push({
          id: generateTestId('compatibility'),
          category: 'compatibility',
          severity: check.severity || 'low',
          type: check.isDeprecated ? 'warning' : 'info',
          title: check.title,
          message: check.message,
          file: rel,
          line: lineNum,
          code: check.code,
          ...(check.fix ? { fix: check.fix } : {}),
        });
      }
    }

    // Special check: standalone true/false/null as return types (PHP 8.2+)
    // Must verify it's a function return type, not a ternary expression
    const funcReturnPattern = /function\s+\w+\s*\([^)]*\)\s*:\s*(true|false|null)\s*(?:\{|;)/g;
    let standaloneMatch;
    while ((standaloneMatch = funcReturnPattern.exec(content)) !== null) {
      issues.push({
        id: generateTestId('compatibility'), category: 'compatibility', severity: 'low', type: 'info',
        title: `Standalone ${standaloneMatch[1]} return type requires PHP 8.2+`,
        message: `Using ${standaloneMatch[1]} as standalone return type requires PHP 8.2+`,
        file: rel, line: getLineNumber(content, standaloneMatch.index), code: 'php82-standalone-types',
      });
    }

    // Special check: ${var} string interpolation (deprecated in PHP 8.2)
    const dollarBracePattern = /"\$\{(?!this->)/g;
    let match;
    while ((match = dollarBracePattern.exec(content)) !== null) {
      const lineNum = getLineNumber(content, match.index);
      const lineContent = (content.split('\n')[lineNum - 1] || '').trim();
      if (/^\s*(?:\/\/|\*|#)/.test(lineContent)) continue;
      issues.push({
        id: generateTestId('compatibility'), category: 'compatibility', severity: 'medium', type: 'warning',
        title: '${var} string interpolation deprecated since PHP 8.2',
        message: '${var} interpolation in double-quoted strings is deprecated in PHP 8.2',
        file: rel, line: lineNum, code: 'php82-dollar-brace-deprecated',
        fix: 'Use {$var} instead of ${var} in double-quoted strings',
      });
    }

    // Special check: Property hooks (PHP 8.4) — get/set inside property declarations
    const propHookPattern = /(?:public|private|protected)\s+\w+\s+\$\w+\s*\{[^}]*\b(?:get|set)\b/g;
    while ((match = propHookPattern.exec(content)) !== null) {
      issues.push({
        id: generateTestId('compatibility'), category: 'compatibility', severity: 'medium', type: 'info',
        title: 'Property hooks require PHP 8.4+',
        message: 'Property get/set hooks are only available in PHP 8.4+',
        file: rel, line: getLineNumber(content, match.index), code: 'php84-property-hooks',
      });
    }

    // Special check: Implicitly nullable parameter (deprecated PHP 8.4)
    // function foo(Type $x = null) — should be function foo(?Type $x = null)
    const implicitNullPattern = /function\s+\w+\s*\([^)]*(?:(?:int|float|string|bool|array|object|callable|iterable|self|parent|[A-Z]\w+)\s+\$\w+\s*=\s*null)/g;
    while ((match = implicitNullPattern.exec(content)) !== null) {
      // Make sure it's not already ?Type
      const matchStr = match[0];
      if (!/\?\s*(?:int|float|string|bool|array|object|callable|iterable|self|parent|[A-Z]\w+)\s+\$/.test(matchStr)) {
        issues.push({
          id: generateTestId('compatibility'), category: 'compatibility', severity: 'medium', type: 'warning',
          title: 'Implicitly nullable parameter deprecated since PHP 8.4',
          message: 'Using Type $param = null without ? is deprecated in PHP 8.4',
          file: rel, line: getLineNumber(content, match.index), code: 'php84-implicit-nullable',
          fix: 'Use ?Type $param = null (explicitly nullable) instead',
        });
      }
    }
  }

  return issues;
}

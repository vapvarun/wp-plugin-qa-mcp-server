/**
 * WP Plugin QA MCP Server - Performance Checker
 * DB query patterns, asset loading, autoload, N+1, caching.
 * Note: Pure static analysis of PHP files, no shell commands used.
 */

import { readFileSync } from 'fs';
import type { CheckerResult, CheckerIssue } from './types.js';
import { findPhpFiles, findFilesByExt, getLineNumber, relativePath, generateTestId } from './shared-utils.js';

export function checkPerformance(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(pluginPath);

  const fileContents = new Map<string, string>();
  for (const file of phpFiles) {
    try { fileContents.set(file, readFileSync(file, 'utf-8')); } catch { /* skip */ }
  }

  issues.push(...checkN1Queries(phpFiles, fileContents, pluginPath));
  issues.push(...checkGlobalAssets(phpFiles, fileContents, pluginPath));
  issues.push(...checkBlockingScripts(phpFiles, fileContents, pluginPath));
  issues.push(...checkAssetCount(pluginPath));
  issues.push(...checkCachingUsage(phpFiles, fileContents, pluginPath));
  issues.push(...checkUnboundedQueries(phpFiles, fileContents, pluginPath));
  issues.push(...checkRemoteRequestTimeouts(phpFiles, fileContents, pluginPath));
  issues.push(...checkQueryOptimizations(phpFiles, fileContents, pluginPath));
  issues.push(...checkInlineScripts(phpFiles, fileContents, pluginPath));
  issues.push(...checkAutoloadOptions(phpFiles, fileContents, pluginPath));

  return {
    category: 'performance',
    issues,
    passed: Math.max(0, 10 - issues.filter(i => i.type === 'error').length),
    failed: issues.filter(i => i.type === 'error').length,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function checkN1Queries(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const loopPattern = /(?:foreach|while|for)\s*\([^)]*\)\s*\{/g;
    let loopMatch;
    while ((loopMatch = loopPattern.exec(content)) !== null) {
      let braceCount = 1;
      let pos = loopMatch.index + loopMatch[0].length;
      while (pos < content.length && braceCount > 0) {
        if (content[pos] === '{') braceCount++;
        if (content[pos] === '}') braceCount--;
        pos++;
      }
      const loopBody = content.substring(loopMatch.index, pos);

      if (/\$wpdb\s*->\s*(?:get_results|get_row|get_var|query|prepare)\s*\(/.test(loopBody)) {
        issues.push({
          id: generateTestId('performance'), category: 'performance', severity: 'high', type: 'warning',
          title: 'Potential N+1 query pattern',
          message: 'Database query inside a loop. Consider batch query outside the loop.',
          file: rel, line: getLineNumber(content, loopMatch.index), code: 'n-plus-1-query',
          fix: 'Move the query outside the loop and use IN() clause or batch retrieval',
        });
      }

      if (/get_post_meta\s*\(/.test(loopBody) && !/update_post_meta_cache/.test(content)) {
        issues.push({
          id: generateTestId('performance'), category: 'performance', severity: 'medium', type: 'info',
          title: 'get_post_meta inside loop',
          message: 'get_post_meta called inside a loop without prior cache priming',
          file: rel, line: getLineNumber(content, loopMatch.index), code: 'meta-in-loop',
          fix: 'Use update_post_meta_cache() before the loop or wp_cache_get/set',
        });
      }
    }
  }

  return issues;
}

function checkGlobalAssets(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const enqueuePattern = /wp_enqueue_(?:script|style)\s*\(/g;
    let match;
    while ((match = enqueuePattern.exec(content)) !== null) {
      const contextStart = Math.max(0, match.index - 500);
      const before = content.substring(contextStart, match.index);

      const hasPageCheck = /(?:is_admin|get_current_screen|hook_suffix|\$pagenow|\$page|is_singular|is_page|is_single|is_archive)/.test(before);
      const insideCallback = /function\s+\w+.*\{[^}]*$/s.test(before.slice(-200));
      const insideHook = /add_action\s*\(\s*['"](?:admin_enqueue_scripts|wp_enqueue_scripts)['"]/.test(before);

      if (!hasPageCheck && (insideHook || insideCallback)) {
        const funcName = content.substring(match.index, match.index + 50).match(/wp_enqueue_(?:script|style)\s*\(\s*['"]([^'"]+)['"]/);
        if (funcName) {
          issues.push({
            id: generateTestId('performance'), category: 'performance', severity: 'medium', type: 'warning',
            title: `Asset "${funcName[1]}" enqueued globally`,
            message: 'Script/style enqueued without page-specific check, loads on every admin/frontend page',
            file: rel, line: getLineNumber(content, match.index), code: 'global-asset-loading',
            fix: 'Add a screen/page check to only load on pages where needed',
          });
        }
      }
    }
  }

  return issues;
}

function checkBlockingScripts(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const scriptPattern = /wp_enqueue_script\s*\(\s*['"]([^'"]+)['"]\s*,\s*[^,]+(?:,\s*(?:array\s*\([^)]*\)|\[[^\]]*\]))?(?:\s*,\s*['"][^'"]*['"])?\s*\)/g;
    let match;
    while ((match = scriptPattern.exec(content)) !== null) {
      const full = match[0];
      if (!/,\s*(?:true|1)\s*\)$/.test(full) && !/in_footer/.test(full)) {
        const contextBefore = content.substring(Math.max(0, match.index - 200), match.index);
        if (/wp_enqueue_scripts/.test(contextBefore) && !/admin_enqueue_scripts/.test(contextBefore)) {
          issues.push({
            id: generateTestId('performance'), category: 'performance', severity: 'low', type: 'info',
            title: `Script "${match[1]}" may block rendering`,
            message: 'Frontend script enqueued without in_footer=true, may block page rendering',
            file: rel, line: getLineNumber(content, match.index), code: 'blocking-script',
            fix: 'Set the $in_footer parameter to true in wp_enqueue_script()',
          });
        }
      }
    }
  }

  return issues;
}

function checkAssetCount(pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  const cssFiles = findFilesByExt(pluginPath, '.css').filter(f => !f.includes('node_modules') && !f.includes('vendor'));
  const jsFiles = findFilesByExt(pluginPath, '.js').filter(f => !f.includes('node_modules') && !f.includes('vendor') && !f.endsWith('.min.js'));

  if (cssFiles.length > 10) {
    issues.push({
      id: generateTestId('performance'), category: 'performance', severity: 'medium', type: 'info',
      title: `High CSS file count: ${cssFiles.length} files`,
      message: `Plugin has ${cssFiles.length} CSS files. Consider bundling to reduce HTTP requests.`,
      file: '', line: 0, code: 'high-css-count',
    });
  }

  if (jsFiles.length > 10) {
    issues.push({
      id: generateTestId('performance'), category: 'performance', severity: 'medium', type: 'info',
      title: `High JS file count: ${jsFiles.length} files`,
      message: `Plugin has ${jsFiles.length} JS files. Consider bundling to reduce HTTP requests.`,
      file: '', line: 0, code: 'high-js-count',
    });
  }

  return issues;
}

function checkCachingUsage(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  let hasExpensiveQueries = false;
  let hasTransientUsage = false;
  let hasObjectCache = false;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';

    if (/\$wpdb\s*->\s*get_results\s*\(/.test(content)) hasExpensiveQueries = true;
    if (/(?:get|set|delete)_transient\s*\(/.test(content)) hasTransientUsage = true;
    if (/wp_cache_(?:get|set|delete)\s*\(/.test(content)) hasObjectCache = true;
  }

  if (hasExpensiveQueries && !hasTransientUsage && !hasObjectCache) {
    issues.push({
      id: generateTestId('performance'), category: 'performance', severity: 'medium', type: 'warning',
      title: 'No caching for database queries',
      message: 'Plugin uses $wpdb->get_results() but has no transient or object cache usage',
      file: '', line: 0, code: 'no-query-caching',
      fix: 'Use set_transient() or wp_cache_set() for expensive/repeated queries',
    });
  }

  return issues;
}

function checkUnboundedQueries(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const wpQueryPattern = /new\s+WP_Query\s*\(\s*(?:array\s*\(|\[)([^)}\]]*)/g;
    let match;
    while ((match = wpQueryPattern.exec(content)) !== null) {
      const args = match[1];
      if (!/posts_per_page|numberposts/.test(args) && !/nopaging/.test(args)) {
        issues.push({
          id: generateTestId('performance'), category: 'performance', severity: 'high', type: 'warning',
          title: 'WP_Query without posts_per_page',
          message: 'WP_Query without posts_per_page limit may return all posts',
          file: rel, line: getLineNumber(content, match.index), code: 'unbounded-query',
          fix: 'Add posts_per_page parameter to limit query results',
        });
      }
    }
  }

  return issues;
}

function checkRemoteRequestTimeouts(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // wp_remote_get/post without timeout
    const remotePattern = /wp_remote_(?:get|post|head|request)\s*\(\s*[^,]+(?:,\s*(?:array\s*\(|\[)([^)}\]]*))?\)/g;
    let match;
    while ((match = remotePattern.exec(content)) !== null) {
      const args = match[1] || '';
      if (!args.includes('timeout')) {
        issues.push({
          id: generateTestId('performance'), category: 'performance', severity: 'medium', type: 'warning',
          title: 'HTTP request without timeout',
          message: 'wp_remote_get/post without explicit timeout (default is 5s, may be too long for cron)',
          file: rel, line: getLineNumber(content, match.index), code: 'no-http-timeout',
          fix: "Add 'timeout' => 15 (or appropriate value) to the args array",
        });
      }
    }
  }

  return issues;
}

function checkQueryOptimizations(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // WP_Query without no_found_rows when pagination not needed
    const wpQueryPattern = /new\s+WP_Query\s*\(\s*(?:array\s*\(|\[)([^)}\]]*)/g;
    let match;
    while ((match = wpQueryPattern.exec(content)) !== null) {
      const args = match[1];

      // Only flag if posts_per_page is set (intentional limit) but no_found_rows is missing
      if (/posts_per_page/.test(args) && !/no_found_rows/.test(args)) {
        // Check if pagination is used nearby
        const contextAfter = content.substring(match.index, Math.min(match.index + 2000, content.length));
        if (!/paginate_links|next_posts_link|previous_posts_link|max_num_pages/.test(contextAfter)) {
          issues.push({
            id: generateTestId('performance'), category: 'performance', severity: 'low', type: 'info',
            title: 'WP_Query without no_found_rows',
            message: 'WP_Query without no_found_rows=true runs an extra COUNT query. Set to true if pagination is not needed.',
            file: rel, line: getLineNumber(content, match.index), code: 'missing-no-found-rows',
            fix: "Add 'no_found_rows' => true to skip the pagination count query",
          });
        }
      }

      // WP_Query fetching IDs only — should use fields=ids
      if (/posts_per_page/.test(args) && !/fields/.test(args)) {
        const contextAfter = content.substring(match.index, Math.min(match.index + 1500, content.length));
        if (/->ID\b/.test(contextAfter) && !/->post_title|->post_content|->post_excerpt/.test(contextAfter)) {
          issues.push({
            id: generateTestId('performance'), category: 'performance', severity: 'low', type: 'info',
            title: 'WP_Query may benefit from fields=ids',
            message: 'Query results only access ->ID. Using fields=ids would be more efficient.',
            file: rel, line: getLineNumber(content, match.index), code: 'missing-fields-ids',
            fix: "Add 'fields' => 'ids' to only fetch post IDs instead of full objects",
          });
        }
      }
    }

    // get_posts without suppress_filters
    const getPostsPattern = /get_posts\s*\(\s*(?:array\s*\(|\[)([^)}\]]*)/g;
    while ((match = getPostsPattern.exec(content)) !== null) {
      const args = match[1];
      if (!/suppress_filters/.test(args)) {
        issues.push({
          id: generateTestId('performance'), category: 'performance', severity: 'low', type: 'info',
          title: 'get_posts() without suppress_filters',
          message: 'get_posts() defaults suppress_filters=true but being explicit improves clarity',
          file: rel, line: getLineNumber(content, match.index), code: 'get-posts-filters',
        });
      }
    }
  }

  return issues;
}

function checkInlineScripts(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // echo <script> instead of wp_add_inline_script
    const echoScriptPattern = /echo\s+['"]<script/g;
    let match;
    while ((match = echoScriptPattern.exec(content)) !== null) {
      issues.push({
        id: generateTestId('performance'), category: 'performance', severity: 'medium', type: 'warning',
        title: 'Inline script via echo instead of wp_add_inline_script()',
        message: 'Echoing <script> tags directly bypasses WP dependency system',
        file: rel, line: getLineNumber(content, match.index), code: 'echo-script-tag',
        fix: 'Use wp_add_inline_script() to properly enqueue inline scripts',
      });
    }

    // echo <style> instead of wp_add_inline_style
    const echoStylePattern = /echo\s+['"]<style/g;
    while ((match = echoStylePattern.exec(content)) !== null) {
      issues.push({
        id: generateTestId('performance'), category: 'performance', severity: 'low', type: 'info',
        title: 'Inline style via echo instead of wp_add_inline_style()',
        message: 'Echoing <style> tags directly bypasses WP dependency system',
        file: rel, line: getLineNumber(content, match.index), code: 'echo-style-tag',
        fix: 'Use wp_add_inline_style() to properly enqueue inline styles',
      });
    }
  }

  return issues;
}

function checkAutoloadOptions(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    // update_option with autoload defaulting to yes (large data)
    const updateOptionPattern = /update_option\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\$\w+)/g;
    let match;
    while ((match = updateOptionPattern.exec(content)) !== null) {
      const optionName = match[1];
      const contextAfter = content.substring(match.index, Math.min(match.index + 200, content.length));

      // If storing what looks like large data (arrays, objects, json) without explicit autoload=no
      if (!/,\s*['"](?:no|false)['"]/.test(contextAfter) && !/autoload/.test(contextAfter)) {
        // Check if the value appears to be large data
        const valueBefore = content.substring(Math.max(0, match.index - 500), match.index);
        if (/json_encode|serialize|array\s*\(|wp_json_encode/.test(valueBefore) ||
            /log|cache|data|history|queue/.test(optionName)) {
          issues.push({
            id: generateTestId('performance'), category: 'performance', severity: 'medium', type: 'warning',
            title: `Option "${optionName}" may autoload large data`,
            message: 'update_option() defaults to autoload=yes. Large data should set autoload to "no".',
            file: rel, line: getLineNumber(content, match.index), code: 'autoload-large-option',
            fix: "Pass 'no' as third argument: update_option('name', $value, 'no')",
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Quality Scaffolder — creates config files for code quality tools.
 * Given a plugin_path, generates .phpcs.xml.dist, phpstan.neon,
 * .eslintrc.json, .eslintignore, .stylelintrc.json, .editorconfig, .pa11yci.
 *
 * Smart features:
 * - Reads plugin header for text domain and WP version
 * - Greps wp_localize_script calls to find JS globals for ESLint
 * - Checks if files already exist (skips with message)
 * - Adds phpstan dev dependencies to composer.json if missing
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { findPhpFiles, safeReadFile, detectPluginSlug } from './shared-utils.js';
import { scanPlugin } from './scanner.js';

/**
 * Derive a Composer-safe vendor string from the plugin's `Author` header.
 * Lowercases, replaces non-alphanumerics with hyphens, and trims edges.
 * Returns the slug itself when the author cannot be determined or
 * normalised - producing `slug/slug` as a sensible self-vendored fallback
 * (still valid Composer format, signals "no upstream vendor identified").
 */
function deriveComposerVendor(pluginPath: string, slug: string): string {
  try {
    const author = scanPlugin(pluginPath).header.author || '';
    const vendor = author
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (vendor && /^[a-z][a-z0-9-]*$/.test(vendor)) {
      return vendor;
    }
  } catch {
    // fall through to slug-as-vendor
  }
  return slug;
}

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
  updated: string[];
  errors: string[];
}

// ─── Main Scaffolder ────────────────────────────────────────────

export function scaffoldQualityConfigs(pluginPath: string, siteUrl?: string): ScaffoldResult {
  const result: ScaffoldResult = { created: [], skipped: [], updated: [], errors: [] };

  const slug = detectPluginSlug(pluginPath);
  const textDomain = detectTextDomain(pluginPath) || slug;
  const minWpVersion = detectMinWpVersion(pluginPath) || '5.8';
  const jsGlobals = detectJsGlobals(pluginPath);

  // 1. .phpcs.xml.dist
  writeIfMissing(join(pluginPath, '.phpcs.xml.dist'), generatePhpcsConfig(textDomain, minWpVersion), result);

  // 2. phpstan.neon
  writeIfMissing(join(pluginPath, 'phpstan.neon'), generatePhpstanConfig(pluginPath, slug), result);

  // 3. .eslintrc.json
  writeIfMissing(join(pluginPath, '.eslintrc.json'), generateEslintConfig(jsGlobals), result);

  // 4. .eslintignore
  writeIfMissing(join(pluginPath, '.eslintignore'), generateEslintIgnore(), result);

  // 5. .stylelintrc.json
  writeIfMissing(join(pluginPath, '.stylelintrc.json'), generateStylelintConfig(), result);

  // 6. .editorconfig
  writeIfMissing(join(pluginPath, '.editorconfig'), generateEditorConfig(), result);

  // 7. .pa11yci (only if site_url provided)
  if (siteUrl) {
    writeIfMissing(join(pluginPath, '.pa11yci'), generatePa11yConfig(siteUrl), result);
  }

  // 8. Update composer.json with phpstan if missing
  updateComposerForPhpstan(pluginPath, result);

  // 9. GitHub Actions workflow — create or update
  const workflowDir = join(pluginPath, '.github', 'workflows');
  if (!existsSync(workflowDir)) {
    try { mkdirSync(workflowDir, { recursive: true }); } catch { /* ignore */ }
  }
  const workflowPath = join(workflowDir, 'quality.yml');
  const newWorkflow = generateGitHubWorkflow(slug, textDomain);
  updateOrCreateFile(workflowPath, newWorkflow, result);

  // 10. Branch protection guide — create or update
  const bpPath = join(pluginPath, '.github', 'BRANCH_PROTECTION.md');
  updateOrCreateFile(bpPath, generateBranchProtectionGuide(slug), result);

  return result;
}

// ─── File Writer ────────────────────────────────────────────────

function writeIfMissing(filePath: string, content: string, result: ScaffoldResult): void {
  const fileName = basename(filePath);
  if (existsSync(filePath)) {
    result.skipped.push(fileName);
    return;
  }
  try {
    writeFileSync(filePath, content, 'utf-8');
    result.created.push(fileName);
  } catch (err) {
    const e = err as { message?: string };
    result.errors.push(`${fileName}: ${e.message || 'write failed'}`);
  }
}

function updateOrCreateFile(filePath: string, content: string, result: ScaffoldResult): void {
  const fileName = filePath.includes('.github/') ? '.github/' + filePath.split('.github/')[1] : basename(filePath);

  if (!existsSync(filePath)) {
    try {
      writeFileSync(filePath, content, 'utf-8');
      result.created.push(fileName);
    } catch (err) {
      const e = err as { message?: string };
      result.errors.push(`${fileName}: ${e.message || 'write failed'}`);
    }
    return;
  }

  // File exists — check if it needs updating
  const existing = readFileSync(filePath, 'utf-8');
  if (existing.trim() === content.trim()) {
    result.skipped.push(`${fileName} (up to date)`);
    return;
  }

  // Check what's missing in existing workflow
  const missingJobs: string[] = [];
  const requiredJobs = ['wpcs', 'phpstan', 'php-lint', 'plugin-check'];
  for (const job of requiredJobs) {
    if (!existing.includes(job)) {
      missingJobs.push(job);
    }
  }

  if (missingJobs.length > 0) {
    // Update the file with the new version
    try {
      writeFileSync(filePath, content, 'utf-8');
      result.updated.push(`${fileName} (added: ${missingJobs.join(', ')})`);
    } catch (err) {
      const e = err as { message?: string };
      result.errors.push(`${fileName}: ${e.message || 'update failed'}`);
    }
  } else {
    result.skipped.push(`${fileName} (all jobs present)`);
  }
}

// ─── Detectors ──────────────────────────────────────────────────

function detectTextDomain(pluginPath: string): string | null {
  const slug = detectPluginSlug(pluginPath);
  const mainFile = join(pluginPath, `${slug}.php`);
  const content = safeReadFile(mainFile);
  if (!content) return null;
  const match = content.match(/Text\s+Domain:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

function detectMinWpVersion(pluginPath: string): string | null {
  const slug = detectPluginSlug(pluginPath);
  const mainFile = join(pluginPath, `${slug}.php`);
  let content = safeReadFile(mainFile);
  if (!content) {
    content = safeReadFile(join(pluginPath, 'readme.txt'));
    if (!content) return null;
  }
  const match = content.match(/Requires\s+at\s+least:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

export function detectJsGlobals(pluginPath: string): string[] {
  const globals = new Set<string>(['wp', 'ajaxurl', 'jQuery']);
  const phpFiles = findPhpFiles(pluginPath);

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;

    const pattern = /wp_localize_script\s*\([^,]+,\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      globals.add(match[1]);
    }

    const inlinePattern = /wp_add_inline_script\s*\([^,]+,\s*['"]var\s+(\w+)/g;
    while ((match = inlinePattern.exec(content)) !== null) {
      globals.add(match[1]);
    }
  }

  return Array.from(globals).sort();
}

// ─── Config Generators ──────────────────────────────────────────

function generatePhpcsConfig(textDomain: string, minWpVersion: string): string {
  // Derive prefix from text-domain: "jetonomy-pro" → "jetonomy_pro", "wpmediaverse" → "wpmediaverse"
  const prefix = textDomain.replace(/-/g, '_');
  const prefixShort = prefix.split('_')[0]; // e.g. "jetonomy" from "jetonomy_pro"
  const prefixUpper = prefix.toUpperCase();

  return `<?xml version="1.0"?>
<ruleset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="${textDomain}" xsi:noNamespaceSchemaLocation="vendor/squizlabs/php_codesniffer/phpcs.xsd">

\t<description>WPCS ruleset for ${textDomain}</description>

\t<file>includes/</file>

\t<arg name="extensions" value="php"/>
\t<arg name="colors"/>
\t<arg value="sp"/>

\t<rule ref="WordPress">
\t\t<!-- Short array/ternary syntax is standard in modern PHP 8.1+ plugins. -->
\t\t<exclude name="Universal.Arrays.DisallowShortArraySyntax"/>
\t\t<exclude name="Universal.Operators.DisallowShortTernary"/>

\t\t<!-- Custom tables — direct DB queries are intentional and necessary. -->
\t\t<exclude name="WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound"/>
\t\t<exclude name="WordPress.WP.GlobalVariablesOverride.Prohibited"/>
\t\t<exclude name="WordPress.DB.DirectDatabaseQuery.DirectQuery"/>
\t\t<exclude name="WordPress.DB.DirectDatabaseQuery.NoCaching"/>
\t\t<exclude name="WordPress.DB.DirectDatabaseQuery.SchemaChange"/>
\t\t<exclude name="WordPress.DB.PreparedSQL.InterpolatedNotPrepared"/>
\t\t<exclude name="WordPress.DB.PreparedSQL.NotPrepared"/>
\t\t<exclude name="WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber"/>
\t\t<exclude name="WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare"/>
\t\t<exclude name="WordPress.DB.SlowDBQuery.slow_db_query_meta_key"/>
\t\t<exclude name="WordPress.DB.SlowDBQuery.slow_db_query_meta_value"/>

\t\t<!-- Commenting rules — too noisy, enforced via code review instead. -->
\t\t<exclude name="Squiz.Commenting.FunctionComment.Missing"/>
\t\t<exclude name="Squiz.Commenting.FunctionComment.MissingParamTag"/>
\t\t<exclude name="Squiz.Commenting.FunctionComment.MissingParamComment"/>
\t\t<exclude name="Squiz.Commenting.FunctionComment.WrongStyle"/>
\t\t<exclude name="Squiz.Commenting.FunctionComment.ParamCommentFullStop"/>
\t\t<exclude name="Squiz.Commenting.ClassComment.Missing"/>
\t\t<exclude name="Squiz.Commenting.InlineComment.InvalidEndChar"/>
\t\t<exclude name="Squiz.Commenting.VariableComment.Missing"/>
\t\t<exclude name="Squiz.Commenting.BlockComment.CloserSameLine"/>
\t\t<exclude name="Squiz.Commenting.FileComment.Missing"/>
\t\t<exclude name="Squiz.Commenting.FileComment.MissingPackageTag"/>
\t\t<exclude name="Squiz.Commenting.FileComment.SpacingAfterComment"/>
\t\t<exclude name="Generic.Commenting.DocComment.MissingShort"/>
\t\t<exclude name="Generic.Commenting.DocComment.ShortNotCapital"/>

\t\t<!-- i18n translators comments — not shipping to wp.org. -->
\t\t<exclude name="WordPress.WP.I18n.MissingTranslatorsComment"/>

\t\t<!-- PSR-style class filenames used throughout. -->
\t\t<exclude name="WordPress.Files.FileName.InvalidClassFileName"/>
\t\t<exclude name="WordPress.Files.FileName.NotHyphenatedLowercase"/>

\t\t<!-- Unused params in hooks/filters are expected. -->
\t\t<exclude name="Generic.CodeAnalysis.UnusedFunctionParameter.Found"/>
\t\t<exclude name="Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed"/>
\t\t<exclude name="Generic.CodeAnalysis.UnusedFunctionParameter.FoundInExtendedClassAfterLastUsed"/>

\t\t<!-- Style preferences. -->
\t\t<exclude name="WordPress.PHP.YodaConditions.NotYoda"/>
\t\t<exclude name="WordPress.PHP.NoSilencedErrors.Discouraged"/>
\t\t<exclude name="Generic.Strings.UnnecessaryStringConcat.Found"/>
\t\t<exclude name="Squiz.PHP.CommentedOutCode.Found"/>
\t\t<exclude name="Universal.ControlStructures.DisallowLonelyIf.Found"/>
\t\t<exclude name="Universal.NamingConventions.NoReservedKeywordParameterNames"/>
\t</rule>

\t<rule ref="WordPress.NamingConventions.PrefixAllGlobals">
\t\t<properties>
\t\t\t<property name="prefixes" type="array">
\t\t\t\t<element value="${prefixShort}"/>
\t\t\t\t<element value="${prefix}"/>
\t\t\t\t<element value="${prefixUpper}"/>
\t\t\t</property>
\t\t</properties>
\t</rule>

\t<rule ref="WordPress.NamingConventions.PrefixAllGlobals.ShortPrefixPassed">
\t\t<severity>0</severity>
\t</rule>

\t<rule ref="WordPress.WP.I18n">
\t\t<properties>
\t\t\t<property name="text_domain" type="array">
\t\t\t\t<element value="${textDomain}"/>
\t\t\t</property>
\t\t</properties>
\t</rule>

\t<exclude-pattern>vendor/*</exclude-pattern>
\t<exclude-pattern>node_modules/*</exclude-pattern>
\t<exclude-pattern>assets/*</exclude-pattern>
\t<exclude-pattern>build/*</exclude-pattern>
\t<exclude-pattern>src/*</exclude-pattern>
\t<exclude-pattern>dist/*</exclude-pattern>

</ruleset>
`;
}

function generatePhpstanConfig(pluginPath: string, slug: string): string {
  const mainFile = `${slug}.php`;
  const hasIncludes = existsSync(join(pluginPath, 'includes'));
  const hasSrc = existsSync(join(pluginPath, 'src'));
  const hasComposerAutoload = existsSync(join(pluginPath, 'vendor', 'autoload.php'));

  const paths: string[] = [];
  if (hasIncludes) paths.push('        - includes');
  if (hasSrc) paths.push('        - src');
  paths.push(`        - ${mainFile}`);

  let config = `includes:
    - vendor/szepeviktor/phpstan-wordpress/extension.neon

parameters:
    level: 5
    paths:
${paths.join('\n')}
    scanDirectories:
        - ../../..
    excludePaths:
        - vendor
        - node_modules
`;

  if (hasComposerAutoload) {
    config += `    bootstrapFiles:
        - vendor/autoload.php
`;
  }

  return config;
}

function generateEslintConfig(globals: string[]): string {
  const globalsObj: Record<string, string> = {};
  for (const g of globals) {
    globalsObj[g] = 'readonly';
  }

  const config = {
    env: { browser: true, jquery: true },
    globals: globalsObj,
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
      'eqeqeq': 'warn',
      'no-console': 'warn',
      'no-redeclare': 'error',
    },
  };

  return JSON.stringify(config, null, '\t') + '\n';
}

function generateEslintIgnore(): string {
  return `**/*.min.js\nvendor/\nnode_modules/\nbuild/\ndist/\n`;
}

function generateStylelintConfig(): string {
  const config = {
    extends: 'stylelint-config-standard',
    rules: { 'no-descending-specificity': null, 'selector-class-pattern': null, 'selector-id-pattern': null },
    ignoreFiles: ['assets/css/*.min.css', 'vendor/**', 'node_modules/**'],
  };
  return JSON.stringify(config, null, '\t') + '\n';
}

function generateEditorConfig(): string {
  return `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = tab
indent_size = 4

[*.{yml,yaml,json}]
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
`;
}

function generatePa11yConfig(siteUrl: string): string {
  const baseUrl = siteUrl.replace(/\/$/, '');
  const config = {
    defaults: { standard: 'WCAG2AA', timeout: 30000, wait: 1000 },
    urls: [
      `${baseUrl}/?autologin=1`,
      `${baseUrl}/wp-admin/plugins.php?autologin=1`,
    ],
  };
  return JSON.stringify(config, null, '\t') + '\n';
}

// ─── GitHub Actions Workflow ─────────────────────────────────────

function generateGitHubWorkflow(slug: string, textDomain: string): string {
  return `name: CI

on:
  push:
    branches: [main, master, develop, 'v*']
  pull_request:
    branches: [main, master, develop]

jobs:
  php-lint:
    name: PHP Lint
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: ['8.1', '8.2', '8.3', '8.4']
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: \${{ matrix.php }}
      - name: Check syntax
        run: find includes/ -name '*.php' -exec php -l {} + 2>&1 | grep -v 'No syntax errors' | head -50; test \${PIPESTATUS[0]} -eq 0

  wpcs:
    name: WPCS
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
      - name: Install Composer dependencies
        run: composer install --no-progress --prefer-dist
      - name: Run WPCS
        run: |
          vendor/bin/phpcs --standard=.phpcs.xml.dist --report=summary || true
          ERRORS=\$(vendor/bin/phpcs --standard=.phpcs.xml.dist --report=json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('totals',{}).get('errors',0))" 2>/dev/null || echo "0")
          echo "WPCS errors: \$ERRORS"
          if [ "\$ERRORS" -gt 0 ]; then
            echo "::error::WPCS found \$ERRORS error(s)"
            exit 1
          fi

  phpstan:
    name: PHPStan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          extensions: mysqli, mbstring
      - name: Install Composer dependencies
        run: composer install --no-progress --prefer-dist
      - name: Run PHPStan
        run: vendor/bin/phpstan analyse --memory-limit=2G --no-progress

  plugin-check:
    name: Plugin Check (PCP)
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: wp_pcp
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3
    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          extensions: mysqli, mbstring

      - name: Install WordPress
        run: |
          mkdir -p /tmp/wp
          curl -sL https://wordpress.org/latest.tar.gz | tar xz -C /tmp/wp --strip-components=1
          cp /tmp/wp/wp-config-sample.php /tmp/wp/wp-config.php
          sed -i "s/database_name_here/wp_pcp/" /tmp/wp/wp-config.php
          sed -i "s/username_here/root/" /tmp/wp/wp-config.php
          sed -i "s/password_here/root/" /tmp/wp/wp-config.php
          sed -i "s/localhost/127.0.0.1/" /tmp/wp/wp-config.php

      - name: Setup WP-CLI
        run: |
          curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
          chmod +x wp-cli.phar
          sudo mv wp-cli.phar /usr/local/bin/wp

      - name: Install WordPress
        run: wp core install --path=/tmp/wp --url=http://localhost --title=Test --admin_user=admin --admin_password=admin --admin_email=admin@test.com --skip-email

      - name: Install plugin and Plugin Check
        run: |
          ln -s "\$GITHUB_WORKSPACE" /tmp/wp/wp-content/plugins/${slug}
          wp plugin activate ${slug} --path=/tmp/wp || true
          wp plugin install plugin-check --activate --path=/tmp/wp

      - name: Clean non-dist files for PCP
        run: |
          cd /tmp/wp/wp-content/plugins/${slug}
          rm -rf node_modules vendor dist .git .github tests bin

      - name: Run Plugin Check
        run: |
          RESULT=\$(wp plugin check ${slug} --path=/tmp/wp --format=csv 2>&1)
          NOISE='compressed_files|hidden_files|application_detected|missing_direct_file_access_protection|outdated_tested_upto_header|stable_tag_mismatch|plugin_updater_detected|DirectDB.UnescapedDBParameter|PreparedSQL.NotPrepared|MissingTranslatorsComment|Heredoc.NotAllowed|EscapeOutput'
          CODE_ERRORS=\$(echo "\$RESULT" | awk -F',' -v noise="\$NOISE" '
            /^FILE:/ { file=\$0; gsub(/^FILE: /, "", file); next }
            \$3 == "ERROR" {
              if (file ~ /^tests\\//) next
              if (file ~ /^bin\\//) next
              if (file ~ /^dist\\//) next
              if (file ~ /^vendor\\//) next
              if (file ~ /^node_modules\\//) next
              match_noise = 0
              split(noise, n, "|")
              for (k in n) { if (\$4 ~ n[k]) { match_noise = 1; break } }
              if (match_noise) next
              count++
              print "  " file ":" \$1 " " \$4
            }
            END { print "\\nActionable errors: " count+0 }
          ')
          echo "\$CODE_ERRORS"
          FINAL_COUNT=\$(echo "\$CODE_ERRORS" | tail -1 | grep -o '[0-9]*\$')
          if [ "\${FINAL_COUNT:-0}" -gt 0 ]; then
            echo "::error::Plugin Check found \$FINAL_COUNT actionable error(s)"
            exit 1
          fi
`;
}

// ─── Branch Protection Guide ────────────────────────────────────

function generateBranchProtectionGuide(slug: string): string {
  return `# Branch Protection Setup for ${slug}

## How to Protect main/master Branch

Go to: **GitHub repo → Settings → Branches → Add branch protection rule**

### Settings to Enable

| Setting | Value |
|---------|-------|
| **Branch name pattern** | \`main\` (or \`master\`) |
| **Require a pull request before merging** | Yes |
| **Require approvals** | 1 (minimum) |
| **Require status checks to pass** | Yes |
| **Status checks that are required:** | \`WPCS\`, \`PHPStan\`, \`PHP Lint\`, \`Plugin Check (PCP)\` |
| **Require branches to be up to date** | Yes |
| **Do not allow bypassing** | Yes (even admins) |

### Required Status Checks

These come from \`.github/workflows/quality.yml\`:
- \`wpcs\` — WordPress Coding Standards (errors block, warnings pass)
- \`phpstan\` — Static type analysis (level 5, 2G memory)
- \`php-lint\` — Syntax check across PHP 8.1-8.4
- \`plugin-check\` — WordPress Plugin Check with noise filtering

### Workflow

1. Developer creates feature branch from \`develop\`
2. Makes changes, commits, pushes branch
3. Opens PR to \`develop\` (or \`main\`)
4. CI runs all quality checks automatically
5. If any check fails → PR cannot be merged
6. Developer fixes issues, pushes again
7. All checks pass → PR ready for review
8. Reviewer approves → merge

### Quick Setup via GitHub CLI

\`\`\`bash
gh api repos/{owner}/${slug}/branches/main/protection \\
  --method PUT \\
  --field required_status_checks='{"strict":true,"contexts":["phpcs","phpstan","php-lint (8.2)","php-compatibility","security"]}' \\
  --field enforce_admins=true \\
  --field required_pull_request_reviews='{"required_approving_review_count":1}'
\`\`\`
`;
}

// ─── Composer.json Updater ──────────────────────────────────────

function updateComposerForPhpstan(pluginPath: string, result: ScaffoldResult): void {
  const composerPath = join(pluginPath, 'composer.json');

  if (!existsSync(composerPath)) {
    const slug = detectPluginSlug(pluginPath);
    const vendor = deriveComposerVendor(pluginPath, slug);
    const composer = {
      name: `${vendor}/${slug}`,
      type: 'wordpress-plugin',
      license: 'GPL-2.0-or-later',
      require: { php: '>=7.4' },
      'require-dev': {
        'phpstan/phpstan': '^2.1',
        'szepeviktor/phpstan-wordpress': '^2.0',
      },
    };
    try {
      writeFileSync(composerPath, JSON.stringify(composer, null, '\t') + '\n', 'utf-8');
      result.created.push('composer.json');
    } catch (err) {
      const e = err as { message?: string };
      result.errors.push(`composer.json: ${e.message || 'write failed'}`);
    }
    return;
  }

  try {
    const content = readFileSync(composerPath, 'utf-8');
    const composer = JSON.parse(content);
    const requireDev = composer['require-dev'] || {};
    let updated = false;

    if (!requireDev['phpstan/phpstan']) { requireDev['phpstan/phpstan'] = '^2.1'; updated = true; }
    if (!requireDev['szepeviktor/phpstan-wordpress']) { requireDev['szepeviktor/phpstan-wordpress'] = '^2.0'; updated = true; }

    if (updated) {
      composer['require-dev'] = requireDev;
      writeFileSync(composerPath, JSON.stringify(composer, null, '\t') + '\n', 'utf-8');
      result.updated.push('composer.json (added phpstan dev deps)');
    } else {
      result.skipped.push('composer.json (phpstan already present)');
    }
  } catch (err) {
    const e = err as { message?: string };
    result.errors.push(`composer.json: ${e.message || 'parse/update failed'}`);
  }
}

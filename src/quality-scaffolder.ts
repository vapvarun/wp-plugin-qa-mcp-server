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
  const requiredJobs = ['phpcs', 'phpstan', 'php-lint', 'php-compatibility', 'security', 'eslint'];
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
  return `<?xml version="1.0"?>
<ruleset name="Plugin Coding Standards">
\t<description>PHPCS ruleset for ${textDomain}</description>

\t<!-- What to scan -->
\t<file>.</file>

\t<!-- Exclude -->
\t<exclude-pattern>/vendor/*</exclude-pattern>
\t<exclude-pattern>/node_modules/*</exclude-pattern>
\t<exclude-pattern>/build/*</exclude-pattern>
\t<exclude-pattern>/dist/*</exclude-pattern>
\t<exclude-pattern>/assets/js/*.min.js</exclude-pattern>
\t<exclude-pattern>/assets/css/*.min.css</exclude-pattern>

\t<arg name="extensions" value="php"/>
\t<arg value="sp"/>
\t<arg name="colors"/>

\t<rule ref="WordPress"/>

\t<rule ref="WordPress.WP.I18n">
\t\t<properties>
\t\t\t<property name="text_domain" type="array">
\t\t\t\t<element value="${textDomain}"/>
\t\t\t</property>
\t\t</properties>
\t</rule>

\t<config name="minimum_supported_wp_version" value="${minWpVersion}"/>
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
  return `name: Quality Checks

on:
  pull_request:
    branches: [main, master, develop]
  push:
    branches: [main, master, develop]

jobs:
  phpcs:
    name: PHPCS (WordPress Standards)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          tools: composer, cs2pr
      - run: composer global require squizlabs/php_codesniffer wp-coding-standards/wpcs phpcsstandards/phpcsutils
      - run: phpcs --config-set installed_paths \$(composer global config home)/vendor/wp-coding-standards/wpcs
      - run: phpcs --report=checkstyle | cs2pr

  phpstan:
    name: PHPStan (Static Analysis)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
      - run: composer install --no-interaction
      - run: ./vendor/bin/phpstan analyse --error-format=github --memory-limit=1G

  php-lint:
    name: PHP Syntax Check
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php-version: ['8.1', '8.2', '8.3', '8.4']
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: \${{ matrix.php-version }}
      - run: find . -name "*.php" -not -path "./vendor/*" -not -path "./node_modules/*" | xargs -n1 php -l

  eslint:
    name: ESLint (JavaScript)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx eslint@8 assets/js/ || true

  php-compatibility:
    name: PHP Compatibility (7.4-8.4)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          tools: composer
      - run: composer global require phpcompatibility/phpcompatibility-wp phpcsstandards/phpcsutils squizlabs/php_codesniffer wp-coding-standards/wpcs
      - run: phpcs --config-set installed_paths \$(composer global config home)/vendor/phpcompatibility/php-compatibility,\$(composer global config home)/vendor/phpcompatibility/phpcompatibility-wp,\$(composer global config home)/vendor/wp-coding-standards/wpcs
      - run: phpcs --standard=PHPCompatibilityWP --extensions=php --ignore=vendor,node_modules --runtime-set testVersion 7.4-8.4 -n .

  security:
    name: Composer Security Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
      - run: composer install --no-interaction --no-dev 2>/dev/null || true
      - run: composer audit --no-interaction || true
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
| **Status checks that are required:** | \`PHPCS\`, \`PHPStan\`, \`PHP Syntax Check\`, \`PHP Compatibility\` |
| **Require branches to be up to date** | Yes |
| **Do not allow bypassing** | Yes (even admins) |

### Required Status Checks

These come from \`.github/workflows/quality.yml\`:
- \`phpcs\` — WordPress Coding Standards
- \`phpstan\` — Static type analysis
- \`php-lint\` — Syntax check across PHP 8.1-8.4
- \`php-compatibility\` — PHP version compatibility
- \`security\` — Composer dependency vulnerabilities

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
    const composer = {
      name: `wbcom/${slug}`,
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

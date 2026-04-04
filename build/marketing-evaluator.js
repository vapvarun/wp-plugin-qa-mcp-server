/**
 * WP Plugin QA MCP Server - Marketing Fitness Evaluator (v2.0.0)
 * Evaluates marketability as a product marketer would.
 * Note: Pure static/filesystem analysis, no shell commands used.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { findPhpFiles, generateTestId, fileExists, dirExists, safeReadFile } from './shared-utils.js';
export function evaluateMarketing(manifest, pluginPath) {
    const startTime = Date.now();
    const issues = [];
    issues.push(...checkReadmeContent(manifest, pluginPath));
    issues.push(...checkFeatureMessaging(manifest, pluginPath));
    issues.push(...checkOnboardingFlow(manifest, pluginPath));
    issues.push(...checkUpsellPresence(pluginPath));
    issues.push(...checkDocumentationSignals(pluginPath));
    issues.push(...checkExtensibility(manifest));
    issues.push(...checkWpOrgProfileAssets(pluginPath));
    issues.push(...checkReadmeMessaging(pluginPath));
    issues.push(...checkUpgradeFlowQuality(pluginPath));
    issues.push(...checkCancelChurnFlow(pluginPath));
    issues.push(...checkTrustAuthority(pluginPath));
    const errors = issues.filter(i => i.type === 'error').length;
    const checks = 11;
    return {
        category: 'marketing',
        issues,
        passed: Math.max(0, checks - errors),
        failed: errors,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
function checkReadmeContent(manifest, pluginPath) {
    const issues = [];
    const readmePath = join(pluginPath, 'readme.txt');
    const readmeMdPath = join(pluginPath, 'README.md');
    const readmeContent = fileExists(readmePath) ? safeReadFile(readmePath)
        : fileExists(readmeMdPath) ? safeReadFile(readmeMdPath) : '';
    if (!readmeContent) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'critical', type: 'error',
            title: 'No readme.txt or README.md',
            message: 'No readme file found. This is required for WordPress.org and essential for marketing the plugin.',
            file: '', line: 0, code: 'no-readme',
            fix: 'Create a readme.txt following WordPress.org format with compelling description, FAQ, and screenshots',
        });
        return issues;
    }
    const descSection = extractSection(readmeContent, 'Description', 'description');
    if (descSection) {
        const wordCount = descSection.split(/\s+/).length;
        if (wordCount < 30) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'high', type: 'error',
                title: 'Readme description too short',
                message: `Description is only ${wordCount} words. WordPress.org reviewers and users need a compelling, detailed description (100+ words recommended).`,
                file: 'readme.txt', line: 0, code: 'short-description',
                fix: 'Write a detailed description explaining what the plugin does, who it\'s for, and key benefits',
            });
        }
        if (!/^\s*[\*\-]\s/m.test(descSection)) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
                title: 'No feature bullet list in description',
                message: 'Description lacks a bulleted feature list. Users scan for features — walls of text get skipped.',
                file: 'readme.txt', line: 0, code: 'no-feature-bullets',
                fix: 'Add a clear bullet list of key features in the description',
            });
        }
        if (!/https?:\/\/|pro version|premium|upgrade|documentation|docs/i.test(descSection)) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
                title: 'No links or CTA in readme description',
                message: 'Description has no links to documentation, demos, or premium versions. Missing conversion opportunities.',
                file: 'readme.txt', line: 0, code: 'no-desc-cta',
            });
        }
    }
    const faqSection = extractSection(readmeContent, 'FAQ', 'Frequently Asked Questions');
    if (!faqSection || faqSection.trim().length < 20) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'Missing or empty FAQ section',
            message: 'FAQ section is missing or too short. A good FAQ reduces support tickets and builds trust.',
            file: 'readme.txt', line: 0, code: 'missing-faq',
            fix: 'Add 3-5 common questions with helpful answers',
        });
    }
    const screenshotSection = extractSection(readmeContent, 'Screenshots', 'screenshots');
    if (!screenshotSection || screenshotSection.trim().length < 10) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'high', type: 'error',
            title: 'No screenshots described in readme',
            message: 'Screenshots section is missing. Visual previews are the #1 factor in install decisions on WordPress.org.',
            file: 'readme.txt', line: 0, code: 'no-screenshots-desc',
            fix: 'Add numbered screenshot descriptions (1. Admin settings page, 2. Frontend output, etc.)',
        });
    }
    const changelogSection = extractSection(readmeContent, 'Changelog', 'changelog');
    if (!changelogSection || changelogSection.trim().length < 10) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'No changelog in readme',
            message: 'Changelog section is missing. Users check changelog to verify the plugin is actively maintained.',
            file: 'readme.txt', line: 0, code: 'no-changelog',
            fix: 'Add a changelog with version numbers and changes',
        });
    }
    return issues;
}
function checkFeatureMessaging(manifest, pluginPath) {
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    let adminPagesWithIntro = 0;
    for (const page of manifest.features.adminPages) {
        for (const file of phpFiles) {
            try {
                const content = readFileSync(file, 'utf-8');
                if (content.includes(page.callback)) {
                    if (/description|intro|welcome|overview|getting.started/i.test(content)) {
                        adminPagesWithIntro++;
                    }
                    break;
                }
            }
            catch { /* skip */ }
        }
    }
    if (manifest.features.adminPages.length > 0 && adminPagesWithIntro === 0) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'Admin pages lack introductory text',
            message: 'No admin pages have introductory or descriptive text. Users don\'t understand the purpose of each page.',
            file: '', line: 0, code: 'no-admin-intro',
            fix: 'Add a brief description/intro at the top of each admin page explaining what it does',
        });
    }
    return issues;
}
function checkOnboardingFlow(manifest, pluginPath) {
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    let hasSetupWizard = false;
    let hasWelcomePage = false;
    let hasFirstRunNotice = false;
    for (const file of phpFiles) {
        try {
            const content = readFileSync(file, 'utf-8');
            if (/setup.wizard|setup_wizard|SetupWizard|onboarding/i.test(content))
                hasSetupWizard = true;
            if (/welcome.page|welcome_page|WelcomePage|getting.started/i.test(content))
                hasWelcomePage = true;
            if (/first.run|first_run|activation.redirect|activated.*redirect/i.test(content))
                hasFirstRunNotice = true;
        }
        catch { /* skip */ }
    }
    if (!hasSetupWizard && !hasWelcomePage && !hasFirstRunNotice) {
        if (manifest.features.settings.length > 3 || manifest.features.adminPages.length > 1) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
                title: 'No onboarding/first-run experience',
                message: 'No setup wizard, welcome page, or activation redirect detected. Users activate the plugin and don\'t know what to do next.',
                file: '', line: 0, code: 'no-onboarding',
                fix: 'Add a welcome/getting-started page or setup wizard that shows on first activation',
            });
        }
    }
    return issues;
}
function checkUpsellPresence(pluginPath) {
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    let hasProMention = false;
    let hasUpgradeLink = false;
    for (const file of phpFiles) {
        try {
            const content = readFileSync(file, 'utf-8');
            if (/pro\s*version|premium|upgrade|pro\s*features/i.test(content))
                hasProMention = true;
            if (/upgrade.url|pro.url|pricing|buy.now|purchase/i.test(content))
                hasUpgradeLink = true;
        }
        catch { /* skip */ }
    }
    if (hasProMention && !hasUpgradeLink) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
            title: 'Pro features mentioned but no upgrade link',
            message: 'Code mentions "pro" or "premium" but no clear upgrade URL. Users can\'t find how to upgrade.',
            file: '', line: 0, code: 'pro-no-link',
            fix: 'Add a clear upgrade link/button in the admin UI pointing to your pricing page',
        });
    }
    if (!hasProMention) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
            title: 'No free/pro model detected',
            message: 'No pro version or premium upsell found. Consider a freemium model for monetization.',
            file: '', line: 0, code: 'no-freemium',
        });
    }
    return issues;
}
function checkDocumentationSignals(pluginPath) {
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    let hasDocsLink = false;
    let hasSupportLink = false;
    for (const file of phpFiles) {
        try {
            const content = readFileSync(file, 'utf-8');
            if (/documentation|docs\..*\.com|wiki|knowledge.base/i.test(content))
                hasDocsLink = true;
            if (/support|help.desk|contact.us|forum/i.test(content))
                hasSupportLink = true;
        }
        catch { /* skip */ }
    }
    const readmeContent = safeReadFile(join(pluginPath, 'readme.txt')) || safeReadFile(join(pluginPath, 'README.md'));
    if (readmeContent) {
        if (/documentation|docs\./i.test(readmeContent))
            hasDocsLink = true;
        if (/support|help/i.test(readmeContent))
            hasSupportLink = true;
    }
    if (!hasDocsLink) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'No documentation link found',
            message: 'No link to documentation in code or readme. Users need docs for setup and troubleshooting.',
            file: '', line: 0, code: 'no-docs-link',
            fix: 'Add a documentation link in the admin interface and readme.txt',
        });
    }
    if (!hasSupportLink) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'No support link found',
            message: 'No support link in code or readme. Users need a way to get help.',
            file: '', line: 0, code: 'no-support-link',
            fix: 'Add a support link in the admin interface and readme.txt',
        });
    }
    return issues;
}
function checkExtensibility(manifest) {
    const issues = [];
    const hooksProvided = manifest.features.hooks.provided.length;
    const totalFeatures = manifest.features.cpts.length + manifest.features.shortcodes.length
        + manifest.features.blocks.length + manifest.features.adminPages.length;
    if (totalFeatures > 3 && hooksProvided < 3) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: `Low extensibility: ${hooksProvided} hooks for ${totalFeatures} features`,
            message: 'Few do_action/apply_filters hooks. Other developers can\'t build on or customize this plugin. Reduces ecosystem value.',
            file: '', line: 0, code: 'low-extensibility',
            fix: 'Add do_action/apply_filters hooks at key integration points (before/after output, data processing, settings)',
        });
    }
    if (totalFeatures > 5 && manifest.features.restRoutes.length === 0) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
            title: 'No REST API endpoints',
            message: 'No REST routes found. A REST API enables headless/decoupled usage, mobile apps, and third-party integrations.',
            file: '', line: 0, code: 'no-rest-api',
        });
    }
    return issues;
}
function checkWpOrgProfileAssets(pluginPath) {
    const issues = [];
    const assetsDir = join(pluginPath, '.wordpress-org');
    const altAssetsDir = join(pluginPath, 'assets');
    let hasBanner = false;
    let hasIcon = false;
    let hasScreenshots = false;
    const checkDir = (dir) => {
        if (!dirExists(dir))
            return;
        try {
            const files = readdirSync(dir);
            for (const f of files) {
                if (/^banner-\d+x\d+\.(png|jpg|jpeg)$/i.test(f))
                    hasBanner = true;
                if (/^icon-\d+x\d+\.(png|jpg|jpeg)$/i.test(f))
                    hasIcon = true;
                if (/^screenshot-\d+\.(png|jpg|jpeg)$/i.test(f))
                    hasScreenshots = true;
            }
        }
        catch { /* skip */ }
    };
    checkDir(assetsDir);
    checkDir(altAssetsDir);
    try {
        const rootFiles = readdirSync(pluginPath);
        for (const f of rootFiles) {
            if (/^screenshot-\d+\.(png|jpg|jpeg)$/i.test(f))
                hasScreenshots = true;
        }
    }
    catch { /* skip */ }
    if (!hasBanner) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'high', type: 'error',
            title: 'No WordPress.org banner image',
            message: 'No banner-772x250 or banner-1544x500 image found. The banner is the first thing users see on WordPress.org.',
            file: '', line: 0, code: 'no-banner',
            fix: 'Create banner-772x250.png and banner-1544x500.png in .wordpress-org/ directory',
        });
    }
    if (!hasIcon) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'high', type: 'error',
            title: 'No WordPress.org icon',
            message: 'No icon-128x128 or icon-256x256 image found. The icon appears in search results and the plugin directory.',
            file: '', line: 0, code: 'no-icon',
            fix: 'Create icon-128x128.png and icon-256x256.png in .wordpress-org/ directory',
        });
    }
    if (!hasScreenshots) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'high', type: 'error',
            title: 'No screenshot images',
            message: 'No screenshot-N.png files found. Screenshots are the #1 factor in install decisions.',
            file: '', line: 0, code: 'no-screenshot-images',
            fix: 'Create screenshot-1.png, screenshot-2.png, etc. showing key features and admin interface',
        });
    }
    return issues;
}
function checkReadmeMessaging(pluginPath) {
    const issues = [];
    const readmePath = join(pluginPath, 'readme.txt');
    const readmeMdPath = join(pluginPath, 'README.md');
    const readmeContent = fileExists(readmePath) ? safeReadFile(readmePath)
        : fileExists(readmeMdPath) ? safeReadFile(readmeMdPath) : '';
    if (!readmeContent)
        return issues;
    const descSection = extractSection(readmeContent, 'Description', 'description');
    if (descSection) {
        const firstSentence = descSection.split(/[.!?\n]/)[0] || '';
        const painPointPattern = /struggle|difficult|time-consuming|manual|error-prone|frustrated|tired of|hard to/i;
        if (!painPointPattern.test(firstSentence)) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
                title: 'Description leads with solution, not problem',
                message: 'The description opens with what the plugin does, not the pain point it solves. Users connect with problems before solutions.',
                file: 'readme.txt', line: 0, code: 'no-pain-point-lead',
                fix: 'Start the description with the problem/frustration your target audience faces, then introduce the plugin as the solution',
            });
        }
        const audiencePattern = /for developers|for agencies|for stores|for bloggers|designed for|built for|perfect for/i;
        if (!audiencePattern.test(descSection)) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
                title: 'No target audience mentioned in description',
                message: 'Description does not specify who the plugin is for. Naming the audience ("built for agencies", "designed for stores") increases relevance.',
                file: 'readme.txt', line: 0, code: 'no-target-audience',
                fix: 'Add a sentence identifying the target user (e.g., "Built for WooCommerce store owners who...")',
            });
        }
        const diffPattern = /unlike|compared to|alternative to|better than|instead of|first plugin to/i;
        if (!diffPattern.test(descSection)) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
                title: 'No competitive differentiation in description',
                message: 'Description does not position the plugin against alternatives. Users need to know why this plugin over others.',
                file: 'readme.txt', line: 0, code: 'no-differentiation',
                fix: 'Add a line explaining what makes this plugin unique compared to alternatives',
            });
        }
        const proofPattern = /\d{1,3}(,\d{3})*\+|5-star|rated|trusted by|used by|active installs/i;
        if (!proofPattern.test(descSection)) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
                title: 'No social proof in description',
                message: 'Description lacks proof points like install counts, ratings, or trust signals. Numbers build credibility.',
                file: 'readme.txt', line: 0, code: 'no-social-proof',
                fix: 'Add proof points such as "Trusted by 10,000+ sites" or "Rated 5 stars" if applicable',
            });
        }
    }
    // Check "Tested up to" being outdated (< 6.4 as of 2026)
    const testedUpToMatch = /Tested up to:\s*(\d+\.\d+)/i.exec(readmeContent);
    if (testedUpToMatch) {
        const testedVersion = parseFloat(testedUpToMatch[1]);
        if (testedVersion < 6.4) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'high', type: 'error',
                title: `"Tested up to" is outdated (${testedUpToMatch[1]})`,
                message: `Readme declares "Tested up to: ${testedUpToMatch[1]}" which is outdated. Users and WordPress.org flag plugins that appear abandoned.`,
                file: 'readme.txt', line: 0, code: 'outdated-tested-up-to',
                fix: 'Update "Tested up to" to the latest WordPress version (6.7+)',
            });
        }
    }
    // Check version mismatch: readme "Stable tag" vs plugin header "Version"
    const stableTagMatch = /Stable tag:\s*(\S+)/i.exec(readmeContent);
    if (stableTagMatch) {
        // Read main plugin file to get header version
        const phpFiles = findPhpFiles(pluginPath);
        for (const file of phpFiles) {
            try {
                const content = readFileSync(file, 'utf-8');
                const headerVersionMatch = /^\s*\*?\s*Version:\s*(\S+)/mi.exec(content);
                if (headerVersionMatch) {
                    const stableTag = stableTagMatch[1].trim();
                    const headerVersion = headerVersionMatch[1].trim();
                    if (stableTag !== 'trunk' && stableTag !== headerVersion) {
                        issues.push({
                            id: generateTestId('marketing'), category: 'marketing', severity: 'critical', type: 'error',
                            title: `Version mismatch: readme "${stableTag}" vs header "${headerVersion}"`,
                            message: `Readme "Stable tag: ${stableTag}" does not match plugin header "Version: ${headerVersion}". This causes WordPress.org to serve the wrong version.`,
                            file: 'readme.txt', line: 0, code: 'version-mismatch',
                            fix: 'Ensure "Stable tag" in readme.txt matches "Version" in the main plugin file header',
                        });
                    }
                    break;
                }
            }
            catch { /* skip */ }
        }
    }
    return issues;
}
function checkUpgradeFlowQuality(pluginPath) {
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    let hasProFeatures = false;
    let showsValueBeforeAsk = false;
    let hasDismissCooldown = false;
    let hasEscapeHatch = false;
    let hasManipulativeDecline = false;
    for (const file of phpFiles) {
        try {
            const content = readFileSync(file, 'utf-8');
            if (/pro.features|premium.features|upgrade|pro.version/i.test(content)) {
                hasProFeatures = true;
            }
            // Value shown before ask: lock icon, disabled UI, or feature preview before upgrade CTA
            if (/lock|dashicons-lock|🔒|disabled.*pro|pro.*disabled|feature-preview|preview.*pro/i.test(content)) {
                showsValueBeforeAsk = true;
            }
            // Dismiss cooldown: transient or user meta near pro/upgrade notices
            if (/set_transient|update_user_meta|update_option/.test(content) &&
                /dismiss|notice.*dismiss|dismissed.*upgrade|upgrade.*dismiss/i.test(content)) {
                hasDismissCooldown = true;
            }
            // Escape hatch: user can continue with free version (skip/close/later/no-thanks)
            if (/skip|maybe.later|no.thanks|close|dismiss|continue.free|free.version/i.test(content) &&
                /pro|premium|upgrade/i.test(content)) {
                hasEscapeHatch = true;
            }
            // Manipulative decline copy: "No, I don't want..." pattern
            if (/no,?\s*i\s*don'?t\s*want|no,?\s*i'?ll?\s*pass|no,?\s*i\s*prefer\s*not/i.test(content)) {
                hasManipulativeDecline = true;
            }
        }
        catch { /* skip */ }
    }
    if (!hasProFeatures)
        return issues;
    if (!showsValueBeforeAsk) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'Pro features hidden rather than previewed',
            message: 'Pro features are not shown with lock icons or disabled previews. Users should see what they are missing (value) before being asked to pay.',
            file: '', line: 0, code: 'no-value-before-ask',
            fix: 'Show pro features in a disabled/locked state so users see the value before the upgrade prompt',
        });
    }
    if (!hasDismissCooldown) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'Upgrade notices lack dismiss cooldown',
            message: 'No transient or user meta used to remember dismissed upgrade notices. Users get nagged on every page load.',
            file: '', line: 0, code: 'no-dismiss-cooldown',
            fix: 'Use set_transient or update_user_meta to remember when a user dismisses the upgrade notice and suppress it for a period',
        });
    }
    if (!hasEscapeHatch) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'No clear way to skip upgrade prompts',
            message: 'Upgrade flow has no "skip", "maybe later", or "continue with free" option. Users feel forced and leave negative reviews.',
            file: '', line: 0, code: 'no-escape-hatch',
            fix: 'Add a clear "Skip" or "Maybe later" option to upgrade prompts so users can continue with the free version',
        });
    }
    if (hasManipulativeDecline) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'high', type: 'error',
            title: 'Manipulative decline copy detected',
            message: 'Found "No, I don\'t want..." style decline text. This dark pattern guilts users and violates WordPress.org guidelines.',
            file: '', line: 0, code: 'manipulative-decline-copy',
            fix: 'Replace manipulative decline copy with neutral options like "No thanks" or "Maybe later"',
        });
    }
    return issues;
}
function checkCancelChurnFlow(pluginPath) {
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    let hasDeactivationFeedback = false;
    let hasUninstallHook = false;
    let hasFeedbackSurvey = false;
    let hasPauseDowngrade = false;
    for (const file of phpFiles) {
        try {
            const content = readFileSync(file, 'utf-8');
            // Deactivation hook with feedback capture
            if (/register_deactivation_hook|deactivation_hook/i.test(content)) {
                hasUninstallHook = true;
                if (/feedback|survey|reason|deactivation.*reason|reason.*deactivat/i.test(content)) {
                    hasDeactivationFeedback = true;
                }
            }
            // Standalone feedback/survey modal on deactivation
            if (/deactivat.*feedback|deactivat.*survey|deactivat.*reason|feedback.*deactivat|survey.*deactivat/i.test(content)) {
                hasFeedbackSurvey = true;
                hasDeactivationFeedback = true;
            }
            // Pause or downgrade alternatives
            if (/pause.*subscription|downgrade|switch.*plan|free.*plan|basic.*plan/i.test(content)) {
                hasPauseDowngrade = true;
            }
        }
        catch { /* skip */ }
    }
    if (hasUninstallHook && !hasDeactivationFeedback && !hasFeedbackSurvey) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'No deactivation feedback capture',
            message: 'Plugin has a deactivation hook but does not capture user feedback or reason. Deactivation feedback is critical for reducing churn.',
            file: '', line: 0, code: 'no-deactivation-feedback',
            fix: 'Add a deactivation feedback modal that asks why the user is deactivating (e.g., found alternative, too complex, temporary)',
        });
    }
    if (!hasUninstallHook) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
            title: 'No deactivation hook registered',
            message: 'No register_deactivation_hook found. Consider adding one to clean up and optionally capture feedback.',
            file: '', line: 0, code: 'no-deactivation-hook',
            fix: 'Add register_deactivation_hook to handle cleanup and capture deactivation reasons',
        });
    }
    // Only relevant if pro/subscription patterns exist
    let hasSubscription = false;
    for (const file of phpFiles) {
        try {
            const content = readFileSync(file, 'utf-8');
            if (/subscription|recurring|license.key|license_key|annual|yearly|monthly/i.test(content)) {
                hasSubscription = true;
                break;
            }
        }
        catch { /* skip */ }
    }
    if (hasSubscription && !hasPauseDowngrade) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
            title: 'No pause/downgrade alternative to cancellation',
            message: 'Subscription model detected but no pause or downgrade option found. Offering alternatives to full cancellation reduces churn.',
            file: '', line: 0, code: 'no-pause-downgrade',
            fix: 'Offer "pause subscription" or "downgrade to free plan" options before allowing full cancellation',
        });
    }
    return issues;
}
function checkTrustAuthority(pluginPath) {
    const issues = [];
    const readmePath = join(pluginPath, 'readme.txt');
    const readmeMdPath = join(pluginPath, 'README.md');
    const readmeContent = fileExists(readmePath) ? safeReadFile(readmePath)
        : fileExists(readmeMdPath) ? safeReadFile(readmeMdPath) : '';
    if (!readmeContent)
        return issues;
    // Check for author credibility signals
    const hasAuthorURI = /Author URI:/i.test(readmeContent) || /Plugin URI:/i.test(readmeContent);
    const hasCompanyMention = /built by|developed by|created by|maintained by|team|company|agency/i.test(readmeContent);
    if (!hasAuthorURI && !hasCompanyMention) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
            title: 'No author/company credibility signals',
            message: 'Readme lacks author URI, company name, or "built by" attribution. Users trust plugins backed by identifiable teams.',
            file: 'readme.txt', line: 0, code: 'no-author-credibility',
            fix: 'Add Author URI in the header and mention the team or company behind the plugin in the description',
        });
    }
    // Check for security/compliance mentions
    const securityPattern = /secure|encryption|encrypted|GDPR|privacy|audit|compliant|compliance|sanitiz|escap|nonce/i;
    if (!securityPattern.test(readmeContent)) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
            title: 'No security or compliance mentions in readme',
            message: 'Readme does not mention security practices, GDPR compliance, or data handling. Security-conscious users look for these signals.',
            file: 'readme.txt', line: 0, code: 'no-security-mentions',
            fix: 'Add a section or mention about security practices (e.g., "All data is sanitized and escaped", "GDPR compatible")',
        });
    }
    // Check update frequency via changelog entries
    const changelogSection = extractSection(readmeContent, 'Changelog', 'changelog');
    if (changelogSection) {
        const versionEntries = changelogSection.match(/^=\s*\d+\.\d+|^##\s*\d+\.\d+|^###\s*\d+\.\d+|^\*\*\d+\.\d+/gm);
        const entryCount = versionEntries ? versionEntries.length : 0;
        if (entryCount > 0 && entryCount < 3) {
            issues.push({
                id: generateTestId('marketing'), category: 'marketing', severity: 'medium', type: 'warning',
                title: `Only ${entryCount} changelog entries — signals low update frequency`,
                message: `Changelog has only ${entryCount} version entries. Users perceive plugins with few updates as potentially abandoned.`,
                file: 'readme.txt', line: 0, code: 'low-changelog-frequency',
                fix: 'Maintain a detailed changelog with entries for each release to show active development',
            });
        }
    }
    // Check for "Contributors" field in readme header
    const hasContributors = /Contributors:/i.test(readmeContent);
    if (!hasContributors) {
        issues.push({
            id: generateTestId('marketing'), category: 'marketing', severity: 'low', type: 'info',
            title: 'No Contributors field in readme header',
            message: 'Readme is missing the "Contributors:" header field. This field links to WordPress.org profiles and builds team credibility.',
            file: 'readme.txt', line: 0, code: 'no-contributors-field',
            fix: 'Add "Contributors: your-wp-org-username" to the readme.txt header section',
        });
    }
    return issues;
}
function extractSection(content, ...sectionNames) {
    for (const name of sectionNames) {
        const wpPattern = new RegExp(`==\\s*${escapeRegex(name)}\\s*==\\n([\\s\\S]*?)(?=\\n==\\s|$)`, 'i');
        const wpMatch = wpPattern.exec(content);
        if (wpMatch)
            return wpMatch[1].trim();
        const mdPattern = new RegExp(`##\\s*${escapeRegex(name)}\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
        const mdMatch = mdPattern.exec(content);
        if (mdMatch)
            return mdMatch[1].trim();
    }
    return null;
}
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=marketing-evaluator.js.map
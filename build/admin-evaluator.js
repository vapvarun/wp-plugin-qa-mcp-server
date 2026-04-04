/**
 * WP Plugin QA MCP Server - Admin Options Evaluator (v2.0.0)
 * Evaluates admin pages and settings as a product reviewer would.
 * Note: Pure static analysis, no shell commands used.
 */
import { readFileSync } from 'fs';
import { findPhpFiles, getLineNumber, relativePath, generateTestId } from './shared-utils.js';
export function evaluateAdmin(manifest, pluginPath) {
    const startTime = Date.now();
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    const fileContents = new Map();
    for (const file of phpFiles) {
        try {
            fileContents.set(file, readFileSync(file, 'utf-8'));
        }
        catch { /* skip */ }
    }
    issues.push(...checkSettingsOrganization(manifest, fileContents, pluginPath));
    issues.push(...checkSettingJustification(manifest, fileContents, pluginPath));
    issues.push(...checkLabelsAndDescriptions(fileContents, pluginPath));
    issues.push(...checkDefaultValues(manifest, fileContents, pluginPath));
    issues.push(...checkAdminPageCount(manifest));
    issues.push(...checkCapabilityGates(manifest, pluginPath));
    issues.push(...checkSettingsApiUsage(fileContents, pluginPath));
    issues.push(...checkOnboardingQuality(manifest, fileContents, pluginPath));
    issues.push(...checkFormValidation(fileContents, pluginPath));
    issues.push(...checkAdminNoticeQuality(fileContents, pluginPath));
    const errors = issues.filter(i => i.type === 'error').length;
    const checks = 10;
    return {
        category: 'admin-eval',
        issues,
        passed: Math.max(0, checks - errors),
        failed: errors,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
function checkSettingsOrganization(manifest, contents, pluginPath) {
    const issues = [];
    const settingsCount = manifest.features.settings.length;
    const adminPages = manifest.features.adminPages;
    if (settingsCount > 15 && adminPages.length <= 1) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
            title: 'Too many settings on a single page',
            message: `${settingsCount} settings registered but only ${adminPages.length} admin page(s). Consider tabbed sections or multiple pages.`,
            file: '', line: 0, code: 'settings-crowded',
            fix: 'Organize settings into logical tabs or separate pages for better usability',
        });
    }
    let hasTabs = false;
    for (const [, content] of contents) {
        if (/nav-tab-wrapper|wp-tab-bar|tab-content|settings-tab|class=['"].*tabs/i.test(content)) {
            hasTabs = true;
            break;
        }
    }
    if (settingsCount > 8 && !hasTabs) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
            title: 'No tabbed settings interface detected',
            message: `${settingsCount} settings without tabs. Tabbed interfaces improve discoverability.`,
            file: '', line: 0, code: 'no-settings-tabs',
        });
    }
    let hasSections = false;
    for (const [, content] of contents) {
        if (/add_settings_section\s*\(/.test(content)) {
            hasSections = true;
            break;
        }
    }
    if (settingsCount > 5 && !hasSections) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
            title: 'Settings not grouped into sections',
            message: `${settingsCount} settings without add_settings_section() grouping. Grouped settings are easier to scan.`,
            file: '', line: 0, code: 'no-settings-sections',
            fix: 'Use add_settings_section() to group related settings logically',
        });
    }
    return issues;
}
function checkSettingJustification(manifest, contents, pluginPath) {
    const issues = [];
    for (const setting of manifest.features.settings) {
        const optionName = setting.optionName;
        if (/^(enable|disable|option|setting|config|flag|toggle)_?\d*$/i.test(optionName)) {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
                title: `Vague setting name: ${optionName}`,
                message: `Option name "${optionName}" is too generic. Users and developers can't tell what it does.`,
                file: relativePath(setting.file, pluginPath), line: setting.line, code: 'vague-setting-name',
                fix: 'Use descriptive option names that explain the setting purpose',
            });
        }
    }
    const names = manifest.features.settings.map(s => s.optionName.toLowerCase());
    for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
            if (names[i] === names[j]) {
                issues.push({
                    id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
                    title: 'Duplicate option registration',
                    message: `Option "${manifest.features.settings[i].optionName}" registered more than once.`,
                    file: relativePath(manifest.features.settings[i].file, pluginPath),
                    line: manifest.features.settings[i].line, code: 'duplicate-option',
                    fix: 'Remove the duplicate registration to avoid confusion',
                });
            }
        }
    }
    return issues;
}
function checkLabelsAndDescriptions(contents, pluginPath) {
    const issues = [];
    for (const [file, content] of contents) {
        const rel = relativePath(file, pluginPath);
        const fieldPattern = /add_settings_field\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]*)\3/g;
        let match;
        while ((match = fieldPattern.exec(content)) !== null) {
            const label = match[4];
            if (!label || label.trim().length < 3) {
                issues.push({
                    id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
                    title: 'Setting field with empty/short label',
                    message: `add_settings_field "${match[2]}" has an insufficient label: "${label}"`,
                    file: rel, line: getLineNumber(content, match.index), code: 'empty-field-label',
                    fix: 'Provide a clear, descriptive label for the setting',
                });
            }
        }
        const submitPattern = /submit_button\s*\(\s*\)/g;
        while ((match = submitPattern.exec(content)) !== null) {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
                title: 'Submit button without custom label',
                message: 'submit_button() called without a custom label. Consider a contextual label like "Save Email Settings".',
                file: rel, line: getLineNumber(content, match.index), code: 'generic-submit-button',
            });
        }
    }
    return issues;
}
function checkDefaultValues(manifest, contents, pluginPath) {
    const issues = [];
    for (const [file, content] of contents) {
        const rel = relativePath(file, pluginPath);
        const getOptionPattern = /get_option\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
        let match;
        while ((match = getOptionPattern.exec(content)) !== null) {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
                title: `get_option without default: ${match[2]}`,
                message: `get_option('${match[2]}') called without a default value. Plugin may not work out-of-box.`,
                file: rel, line: getLineNumber(content, match.index), code: 'no-default-value',
                fix: 'Provide a sensible default value as the second argument',
            });
        }
    }
    const hasDefaultSetup = manifest.features.activationHooks.some(h => h.type === 'activation');
    if (manifest.features.settings.length > 0 && !hasDefaultSetup) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
            title: 'No activation hook to set defaults',
            message: `${manifest.features.settings.length} settings but no activation hook to initialize defaults. Plugin may not work until settings are manually saved.`,
            file: '', line: 0, code: 'no-default-setup',
            fix: 'Add a register_activation_hook callback that sets default option values',
        });
    }
    return issues;
}
function checkAdminPageCount(manifest) {
    const issues = [];
    const pages = manifest.features.adminPages;
    const topLevel = pages.filter(p => !p.parentSlug);
    if (topLevel.length > 2) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'high', type: 'error',
            title: 'Too many top-level admin menus',
            message: `${topLevel.length} top-level menu items. WordPress best practice is 1 (max 2). Others should be subpages.`,
            file: '', line: 0, code: 'too-many-menus',
            fix: 'Use a single top-level menu with subpages, or add under an existing WordPress menu (Settings, Tools, etc.)',
        });
    }
    if (pages.length === 0 && manifest.features.settings.length > 0) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
            title: 'Settings registered without admin page',
            message: `${manifest.features.settings.length} settings registered but no admin page to manage them.`,
            file: '', line: 0, code: 'orphaned-settings',
            fix: 'Create an admin page where users can manage these settings',
        });
    }
    const parents = new Set(pages.filter(p => p.parentSlug).map(p => p.parentSlug));
    if (parents.size > 3) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
            title: 'Admin pages scattered across menus',
            message: `Plugin pages are under ${parents.size} different parent menus: ${[...parents].join(', ')}. Consolidate for discoverability.`,
            file: '', line: 0, code: 'scattered-menus',
            fix: 'Group related pages under a single parent menu',
        });
    }
    return issues;
}
function checkCapabilityGates(manifest, pluginPath) {
    const issues = [];
    for (const page of manifest.features.adminPages) {
        if (page.capability === 'read' || page.capability === 'exist') {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'high', type: 'error',
                title: `Admin page "${page.slug}" uses weak capability: ${page.capability}`,
                message: `The "${page.capability}" capability allows all logged-in users access. Admin pages should use "manage_options" or a custom capability.`,
                file: relativePath(page.file, pluginPath), line: page.line, code: 'weak-capability',
                fix: 'Use "manage_options" or a more restrictive custom capability',
            });
        }
    }
    return issues;
}
function checkSettingsApiUsage(contents, pluginPath) {
    const issues = [];
    for (const [file, content] of contents) {
        const rel = relativePath(file, pluginPath);
        const directSavePattern = /\$_POST\s*\[.*\].*update_option|update_option.*\$_POST/g;
        let match;
        while ((match = directSavePattern.exec(content)) !== null) {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'high', type: 'error',
                title: 'Direct $_POST to update_option (bypasses Settings API)',
                message: 'Saving settings directly from $_POST bypasses WordPress sanitization and nonce verification built into the Settings API.',
                file: rel, line: getLineNumber(content, match.index), code: 'bypass-settings-api',
                fix: 'Use register_setting() with sanitize_callback and settings_fields() for proper form handling',
            });
        }
    }
    return issues;
}
function checkOnboardingQuality(manifest, contents, pluginPath) {
    const issues = [];
    const settingsCount = manifest.features.settings.length;
    const onboardingPattern = /setup_wizard|setup-wizard|SetupWizard|onboarding|getting.started|welcome_page|first_run|activation_redirect/;
    let hasOnboarding = false;
    const onboardingFiles = [];
    for (const [file, content] of contents) {
        if (onboardingPattern.test(content)) {
            hasOnboarding = true;
            onboardingFiles.push({ file, content });
        }
    }
    if (settingsCount > 3 && !hasOnboarding) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
            title: 'No onboarding or setup wizard detected',
            message: `Plugin has ${settingsCount} settings but no setup wizard or onboarding flow. First-time users may feel lost.`,
            file: '', line: 0, code: 'no-onboarding',
            fix: 'Add a setup wizard or welcome page that guides users through initial configuration',
        });
    }
    if (hasOnboarding) {
        let hasProgressIndicator = false;
        let hasDismissSkip = false;
        let hasCompletionCelebration = false;
        for (const { content } of onboardingFiles) {
            if (/step\s*\d+\s*(of|\/)\s*\d+|progress|stepper|wizard-step|current-step/i.test(content)) {
                hasProgressIndicator = true;
            }
            if (/dismiss|skip|skip.setup|skip.wizard|maybe.later|not.now|close.wizard/i.test(content)) {
                hasDismissSkip = true;
            }
            if (/complet|congrat|all.set|all.done|you.?re.set|setup.complete|finish|success/i.test(content)) {
                hasCompletionCelebration = true;
            }
        }
        if (!hasProgressIndicator) {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
                title: 'Onboarding lacks progress indicator',
                message: 'Setup wizard found but no step progress indicator (e.g., "Step 2 of 4"). Users don\'t know how long setup takes.',
                file: relativePath(onboardingFiles[0].file, pluginPath), line: 0, code: 'onboarding-no-progress',
                fix: 'Add a step counter or progress bar to the onboarding wizard',
            });
        }
        if (!hasDismissSkip) {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
                title: 'Onboarding has no skip/dismiss option',
                message: 'Setup wizard found but no skip or dismiss button. Users should be able to skip onboarding and configure later.',
                file: relativePath(onboardingFiles[0].file, pluginPath), line: 0, code: 'onboarding-no-skip',
                fix: 'Add a "Skip Setup" or "I\'ll do this later" link to the onboarding wizard',
            });
        }
        if (!hasCompletionCelebration) {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
                title: 'Onboarding has no completion state',
                message: 'Setup wizard found but no completion/success message. A brief "You\'re all set!" confirmation improves UX.',
                file: relativePath(onboardingFiles[0].file, pluginPath), line: 0, code: 'onboarding-no-completion',
                fix: 'Add a completion screen with a summary or "All set!" confirmation',
            });
        }
    }
    // Check for blank/empty state handling
    const emptyStatePattern = /empty.state|no.items|no.results|get.started|nothing.here|no.data|empty.list|no.entries/i;
    let hasEmptyState = false;
    for (const [, content] of contents) {
        if (emptyStatePattern.test(content)) {
            hasEmptyState = true;
            break;
        }
    }
    if (!hasEmptyState && (manifest.features.cpts.length > 0 || manifest.features.dbTables.length > 0)) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
            title: 'No empty state handling detected',
            message: 'Plugin manages data but no empty/blank state messaging found. New users see empty screens without guidance.',
            file: '', line: 0, code: 'no-empty-state',
            fix: 'Add helpful empty state messages with a call-to-action (e.g., "No items yet. Create your first one!")',
        });
    }
    return issues;
}
function checkFormValidation(contents, pluginPath) {
    const issues = [];
    for (const [file, content] of contents) {
        const rel = relativePath(file, pluginPath);
        // Find form tags and check for nonce fields nearby
        const formPattern = /<form[\s>]/gi;
        let match;
        while ((match = formPattern.exec(content)) !== null) {
            const formStart = match.index;
            // Look ahead up to 3000 chars for closing </form> or next form
            const formChunk = content.substring(formStart, formStart + 3000);
            const hasNonce = /wp_nonce_field|settings_fields|_wpnonce/.test(formChunk);
            if (!hasNonce && /method\s*=\s*['"]post['"]/i.test(formChunk)) {
                issues.push({
                    id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'high', type: 'error',
                    title: 'POST form without nonce verification',
                    message: 'A form using method="POST" was found without wp_nonce_field() or settings_fields(). This is a CSRF vulnerability.',
                    file: rel, line: getLineNumber(content, formStart), code: 'form-no-nonce',
                    fix: 'Add wp_nonce_field() inside the form and verify with wp_verify_nonce() or check_admin_referer() on submission',
                });
            }
            // Check for required attributes on input fields
            const hasRequired = /required[\s=]|aria-required\s*=\s*['"]true['"]/i.test(formChunk);
            const inputCount = (formChunk.match(/<input[\s>]|<select[\s>]|<textarea[\s>]/gi) || []).length;
            if (inputCount > 2 && !hasRequired) {
                issues.push({
                    id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
                    title: 'Form fields lack required attribute',
                    message: `Form with ${inputCount} fields has no required attributes. Mark mandatory fields so users get browser-level validation.`,
                    file: rel, line: getLineNumber(content, formStart), code: 'form-no-required',
                    fix: 'Add the "required" attribute to mandatory form fields',
                });
            }
            // Check for loading/spinner feedback on form submissions
            const hasLoadingFeedback = /spinner|loading|saving|please.wait|is-busy|wp-spinner|\.spin/i.test(formChunk);
            if (/method\s*=\s*['"]post['"]/i.test(formChunk) && !hasLoadingFeedback) {
                issues.push({
                    id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
                    title: 'Form submission without loading feedback',
                    message: 'POST form found without spinner or loading indicator. Users may double-submit if there is no visual feedback.',
                    file: rel, line: getLineNumber(content, formStart), code: 'form-no-loading',
                    fix: 'Add a spinner or "Saving..." indicator when the form is submitted',
                });
            }
        }
        // Flag forms relying solely on server-side validation (no inline JS validation)
        const hasServerValidation = /sanitize_callback|sanitize_text_field|absint|intval|esc_attr/.test(content);
        const hasJsValidation = /\.validate\(|addEventListener\s*\(\s*['"]submit|onsubmit|\.on\s*\(\s*['"]submit|checkValidity|reportValidity|setCustomValidity/.test(content);
        const hasFormTag = /<form[\s>]/i.test(content);
        if (hasFormTag && hasServerValidation && !hasJsValidation) {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
                title: 'Only server-side form validation detected',
                message: 'Forms rely solely on server-side validation. Adding inline JavaScript validation improves UX by giving instant feedback.',
                file: rel, line: 0, code: 'form-no-js-validation',
                fix: 'Add client-side validation (e.g., HTML5 required/pattern attributes or JS validation) alongside server-side checks',
            });
        }
    }
    return issues;
}
function checkAdminNoticeQuality(contents, pluginPath) {
    const issues = [];
    let totalNotices = 0;
    let dismissibleCount = 0;
    let nonDismissibleFiles = [];
    const noticeTypes = new Set();
    for (const [file, content] of contents) {
        const rel = relativePath(file, pluginPath);
        // Detect admin_notices hook usage
        const noticeHookPattern = /add_action\s*\(\s*['"]admin_notices['"]/g;
        let match;
        while ((match = noticeHookPattern.exec(content)) !== null) {
            totalNotices++;
            // Look ahead for the notice output within a reasonable range
            const chunkAfterHook = content.substring(match.index, match.index + 2000);
            if (/is-dismissible/.test(chunkAfterHook)) {
                dismissibleCount++;
            }
            else {
                nonDismissibleFiles.push({ file: rel, line: getLineNumber(content, match.index) });
            }
            // Collect notice type classes used
            const typeMatch = chunkAfterHook.match(/notice-(error|warning|success|info|updated)/g);
            if (typeMatch) {
                for (const t of typeMatch) {
                    noticeTypes.add(t);
                }
            }
        }
        // Also detect inline notice HTML patterns (not via hook)
        const inlineNoticePattern = /class\s*=\s*['"][^'"]*\bnotice\b[^'"]*['"]/g;
        while ((match = inlineNoticePattern.exec(content)) !== null) {
            const noticeChunk = content.substring(match.index, match.index + 200);
            if (/is-dismissible/.test(noticeChunk)) {
                dismissibleCount++;
            }
            const typeMatch = noticeChunk.match(/notice-(error|warning|success|info|updated)/g);
            if (typeMatch) {
                for (const t of typeMatch) {
                    noticeTypes.add(t);
                }
            }
        }
    }
    // Flag persistent non-dismissible notices
    if (nonDismissibleFiles.length > 0) {
        for (const { file, line } of nonDismissibleFiles) {
            issues.push({
                id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
                title: 'Non-dismissible admin notice',
                message: 'An admin notice is registered without the "is-dismissible" class. Persistent notices clutter the admin and annoy users.',
                file, line, code: 'notice-not-dismissible',
                fix: 'Add the "is-dismissible" class to the notice div and handle the dismiss action via AJAX if needed',
            });
        }
    }
    // Check for notice type variety
    if (totalNotices >= 2 && noticeTypes.size === 1) {
        const onlyType = [...noticeTypes][0];
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'low', type: 'info',
            title: `All admin notices use the same type: ${onlyType}`,
            message: `${totalNotices} admin notices found but all use "${onlyType}". Use notice-success for confirmations, notice-info for tips, and notice-error only for real errors.`,
            file: '', line: 0, code: 'notice-no-variety',
            fix: 'Use appropriate notice types: notice-success for positive feedback, notice-info for informational, notice-warning for caution, notice-error for failures',
        });
    }
    if (totalNotices >= 2 && noticeTypes.size === 1 && noticeTypes.has('notice-error')) {
        issues.push({
            id: generateTestId('admin-eval'), category: 'admin-eval', severity: 'medium', type: 'warning',
            title: 'All admin notices are error-type',
            message: `All ${totalNotices} notices use "notice-error". This creates a hostile admin experience. Positive actions should use notice-success.`,
            file: '', line: 0, code: 'notice-all-errors',
            fix: 'Reserve notice-error for actual failures. Use notice-success after saves and notice-info for neutral messages',
        });
    }
    return issues;
}
//# sourceMappingURL=admin-evaluator.js.map
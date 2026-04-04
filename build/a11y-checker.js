/**
 * WP Plugin QA MCP Server - Accessibility Checker
 * Static analysis of plugin output templates, PHP, and JS for accessibility issues.
 * Based on WCAG 2.1 AA requirements and the European Accessibility Act (EAA, enforced June 2025).
 */
import { generateTestId, findPhpFiles, findJsFiles, findFilesByExt, relativePath, safeReadFile, getLineNumber } from './shared-utils.js';
export function checkAccessibility(pluginPath) {
    const startTime = Date.now();
    const issues = [];
    const phpFiles = findPhpFiles(pluginPath);
    const jsFiles = findJsFiles(pluginPath);
    const cssFiles = findFilesByExt(pluginPath, '.css');
    // 1. Form elements need labels
    issues.push(...checkFormLabels(pluginPath, phpFiles));
    // 2. Images need alt attributes
    issues.push(...checkImageAlts(pluginPath, phpFiles));
    // 3. ARIA roles and attributes
    issues.push(...checkAriaUsage(pluginPath, phpFiles));
    // 4. Focus management in JS
    issues.push(...checkFocusManagement(pluginPath, jsFiles));
    // 5. Color contrast issues in CSS
    issues.push(...checkColorContrast(pluginPath, cssFiles));
    // 6. Keyboard navigation
    issues.push(...checkKeyboardNav(pluginPath, phpFiles, jsFiles));
    // 7. Screen reader text for icon-only buttons
    issues.push(...checkScreenReaderText(pluginPath, phpFiles));
    const errors = issues.filter(i => i.type === 'error').length;
    const totalChecks = 7;
    return {
        category: 'a11y',
        issues,
        passed: Math.max(0, totalChecks - errors),
        failed: errors,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
/**
 * Check that form inputs have associated labels.
 */
function checkFormLabels(pluginPath, phpFiles) {
    const issues = [];
    let unlabeledInputs = 0;
    const samples = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Find input/select/textarea elements
            if (/<(?:input|select|textarea)\b/i.test(line) && !/type\s*=\s*["']hidden["']/i.test(line)) {
                // Check for associated label (within 5 lines before/after or same line)
                const contextStart = Math.max(0, i - 5);
                const contextEnd = Math.min(lines.length, i + 5);
                const context = lines.slice(contextStart, contextEnd).join('\n');
                // Check for label, aria-label, aria-labelledby, title, or screen-reader-text
                const hasLabel = /<label/i.test(context) ||
                    /aria-label\s*=/i.test(line) ||
                    /aria-labelledby\s*=/i.test(line) ||
                    /title\s*=/i.test(line) ||
                    /screen-reader-text/i.test(context) ||
                    /sr-only/i.test(context) ||
                    /placeholder\s*=.*aria-label/i.test(context);
                if (!hasLabel) {
                    unlabeledInputs++;
                    if (samples.length < 5)
                        samples.push({ file: rel, line: i + 1 });
                }
            }
        }
    }
    if (unlabeledInputs > 0) {
        issues.push({
            id: generateTestId('a11y'), category: 'a11y', severity: 'high', type: 'error',
            title: `${unlabeledInputs} form inputs without labels`,
            message: `Found ${unlabeledInputs} <input>/<select>/<textarea> elements without associated <label>, aria-label, or aria-labelledby. Locations: ${samples.map(s => `${s.file}:${s.line}`).join(', ')}`,
            file: samples[0]?.file || '', line: samples[0]?.line || 0, code: 'missing-form-labels',
            fix: 'Add <label for="id"> elements or aria-label attributes to all form inputs',
        });
    }
    return issues;
}
/**
 * Check that images have alt attributes.
 */
function checkImageAlts(pluginPath, phpFiles) {
    const issues = [];
    let missingAlts = 0;
    const samples = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Find <img> tags
            if (/<img\b/i.test(line)) {
                // Check for alt attribute (even empty alt="" is valid for decorative images)
                if (!/\balt\s*=/i.test(line)) {
                    missingAlts++;
                    if (samples.length < 5)
                        samples.push({ file: rel, line: i + 1 });
                }
            }
        }
    }
    if (missingAlts > 0) {
        issues.push({
            id: generateTestId('a11y'), category: 'a11y', severity: 'high', type: 'error',
            title: `${missingAlts} images without alt attribute`,
            message: `Found <img> tags without alt attribute. Use alt="" for decorative images, descriptive text otherwise.`,
            file: samples[0]?.file || '', line: samples[0]?.line || 0, code: 'missing-img-alt',
            fix: 'Add alt attribute to all <img> tags. Use alt="" for decorative images.',
        });
    }
    return issues;
}
/**
 * Check for common ARIA misuse patterns.
 */
function checkAriaUsage(pluginPath, phpFiles) {
    const issues = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // role="button" on a div without tabindex
            if (/role\s*=\s*["']button["']/i.test(line) && /<div|<span/i.test(line)) {
                if (!/tabindex/i.test(line)) {
                    issues.push({
                        id: generateTestId('a11y'), category: 'a11y', severity: 'medium', type: 'warning',
                        title: 'role="button" without tabindex',
                        message: 'Non-interactive element with role="button" needs tabindex="0" for keyboard access',
                        file: rel, line: i + 1, code: 'aria-button-no-tabindex',
                        fix: 'Add tabindex="0" or use a <button> element instead',
                    });
                }
            }
            // aria-hidden="true" on focusable elements
            if (/aria-hidden\s*=\s*["']true["']/i.test(line)) {
                if (/<(?:a|button|input|select|textarea)\b/i.test(line) || /tabindex\s*=\s*["'][^-]/i.test(line)) {
                    issues.push({
                        id: generateTestId('a11y'), category: 'a11y', severity: 'high', type: 'error',
                        title: 'aria-hidden="true" on focusable element',
                        message: 'Focusable elements must not have aria-hidden="true" — they become invisible but still reachable',
                        file: rel, line: i + 1, code: 'aria-hidden-focusable',
                        fix: 'Remove aria-hidden="true" from focusable elements, or add tabindex="-1"',
                    });
                }
            }
            // Empty aria-label
            if (/aria-label\s*=\s*["']\s*["']/i.test(line)) {
                issues.push({
                    id: generateTestId('a11y'), category: 'a11y', severity: 'medium', type: 'warning',
                    title: 'Empty aria-label attribute',
                    message: 'aria-label="" provides no accessible name. Either add descriptive text or remove the attribute.',
                    file: rel, line: i + 1, code: 'empty-aria-label',
                    fix: 'Add descriptive text to aria-label or remove the empty attribute',
                });
            }
            // Redundant role on native element
            if (/<button[^>]*role\s*=\s*["']button["']/i.test(line)) {
                issues.push({
                    id: generateTestId('a11y'), category: 'a11y', severity: 'low', type: 'info',
                    title: 'Redundant role="button" on <button>',
                    message: '<button> already has implicit role of button — adding role="button" is redundant',
                    file: rel, line: i + 1, code: 'redundant-aria-role',
                });
            }
        }
    }
    return issues;
}
/**
 * Check JS files for focus management patterns.
 */
function checkFocusManagement(pluginPath, jsFiles) {
    const issues = [];
    let hasModal = false;
    let hasFocusTrap = false;
    let hasClickWithoutKeyboard = false;
    const clickOnlyFiles = [];
    for (const file of jsFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        // Check for modal/dialog patterns
        if (/modal|dialog|popup|overlay|lightbox/i.test(content)) {
            hasModal = true;
            if (/focus\s*\(|focusTrap|focus-trap|trapFocus/.test(content)) {
                hasFocusTrap = true;
            }
        }
        // Check for click-only handlers without keyboard alternatives
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // onClick/addEventListener('click') on non-button elements
            if (/\.addEventListener\s*\(\s*['"]click['"]/.test(line) || /\.on\s*\(\s*['"]click['"]/.test(line)) {
                // Check nearby for keyboard handler (within 10 lines)
                const contextEnd = Math.min(lines.length, i + 10);
                const context = lines.slice(i, contextEnd).join('\n');
                if (!/keydown|keyup|keypress|Enter|Space/.test(context)) {
                    hasClickWithoutKeyboard = true;
                    if (clickOnlyFiles.length < 3)
                        clickOnlyFiles.push({ file: rel, line: i + 1 });
                }
            }
        }
    }
    if (hasModal && !hasFocusTrap) {
        issues.push({
            id: generateTestId('a11y'), category: 'a11y', severity: 'high', type: 'error',
            title: 'Modal/dialog without focus trapping',
            message: 'Plugin has modal/dialog patterns but no focus trap implementation. Keyboard users can tab out of the modal.',
            file: '', line: 0, code: 'modal-no-focus-trap',
            fix: 'Implement focus trapping: on open, move focus into modal; trap Tab within modal; on close, return focus to trigger',
        });
    }
    if (hasClickWithoutKeyboard && clickOnlyFiles.length > 0) {
        issues.push({
            id: generateTestId('a11y'), category: 'a11y', severity: 'medium', type: 'warning',
            title: 'Click handlers without keyboard alternatives',
            message: `Found click event listeners without corresponding keyboard handlers. ${clickOnlyFiles.map(f => `${f.file}:${f.line}`).join(', ')}`,
            file: clickOnlyFiles[0].file, line: clickOnlyFiles[0].line, code: 'click-only-handler',
            fix: 'Add keydown handler for Enter/Space keys alongside click handlers for non-button elements',
        });
    }
    return issues;
}
/**
 * Basic color contrast check in CSS (static analysis).
 * Detects common patterns like light text on light background.
 */
function checkColorContrast(pluginPath, cssFiles) {
    const issues = [];
    // Very light colors that likely fail contrast against white backgrounds
    const veryLightColors = /(?:color\s*:\s*(?:#(?:f[0-9a-f]{5}|[e-f][0-9a-f]{5})|rgba?\s*\(\s*2[0-4]\d|25[0-5])\s*,\s*2[0-4]\d|25[0-5]\s*,\s*2[0-4]\d|25[0-5])/i;
    for (const file of cssFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        // Check for text color declarations that are very light
        if (/color\s*:\s*#(?:ccc|ddd|eee|fff|fafafa|f5f5f5)\b/i.test(content)) {
            const match = content.match(/color\s*:\s*(#(?:ccc|ddd|eee|fff|fafafa|f5f5f5))\b/i);
            if (match) {
                const idx = content.indexOf(match[0]);
                issues.push({
                    id: generateTestId('a11y'), category: 'a11y', severity: 'medium', type: 'warning',
                    title: 'Potentially low contrast text color',
                    message: `Text color "${match[1]}" may fail WCAG AA contrast ratio (4.5:1) against light backgrounds`,
                    file: rel, line: getLineNumber(content, idx), code: 'low-contrast-text',
                    fix: 'Ensure text color has at least 4.5:1 contrast ratio against the background',
                });
            }
        }
        // Check for !important on outline:none (removes focus indicators)
        if (/outline\s*:\s*(?:none|0)\s*!important/i.test(content)) {
            const idx = content.search(/outline\s*:\s*(?:none|0)\s*!important/i);
            issues.push({
                id: generateTestId('a11y'), category: 'a11y', severity: 'high', type: 'error',
                title: 'Focus indicator removed with !important',
                message: 'outline: none !important removes keyboard focus indicators — critical for keyboard users',
                file: rel, line: getLineNumber(content, idx), code: 'outline-none-important',
                fix: 'Replace outline: none with a custom visible focus style (e.g., box-shadow or border)',
            });
        }
        // Check for *:focus { outline: none } (global focus removal)
        if (/\*\s*:\s*focus[^{]*\{[^}]*outline\s*:\s*(?:none|0)/i.test(content)) {
            const idx = content.search(/\*\s*:\s*focus/i);
            issues.push({
                id: generateTestId('a11y'), category: 'a11y', severity: 'critical', type: 'error',
                title: 'Global focus indicator removed',
                message: '*:focus { outline: none } removes ALL keyboard focus indicators',
                file: rel, line: getLineNumber(content, idx), code: 'global-focus-removed',
                fix: 'Remove the global outline:none and add custom focus styles per element',
            });
        }
    }
    return issues;
}
/**
 * Check for keyboard navigation support.
 */
function checkKeyboardNav(pluginPath, phpFiles, jsFiles) {
    const issues = [];
    let nonInteractiveClickable = 0;
    const samples = [];
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // <div> or <span> with onclick but no tabindex or role
            if (/<(?:div|span|li)[^>]*onclick/i.test(line)) {
                if (!/tabindex/i.test(line) && !/role\s*=\s*["'](?:button|link)["']/i.test(line)) {
                    nonInteractiveClickable++;
                    if (samples.length < 5)
                        samples.push({ file: rel, line: i + 1 });
                }
            }
            // <a> without href (not keyboard accessible without tabindex)
            if (/<a\b(?![^>]*href)/i.test(line) && !/tabindex/i.test(line)) {
                if (/<a\b[^>]*onclick/i.test(line) || /<a\b[^>]*class/i.test(line)) {
                    nonInteractiveClickable++;
                    if (samples.length < 5)
                        samples.push({ file: rel, line: i + 1 });
                }
            }
        }
    }
    if (nonInteractiveClickable > 0) {
        issues.push({
            id: generateTestId('a11y'), category: 'a11y', severity: 'high', type: 'error',
            title: `${nonInteractiveClickable} clickable elements not keyboard accessible`,
            message: `Non-interactive elements (div, span) with onclick but no tabindex/role. ${samples.map(s => `${s.file}:${s.line}`).join(', ')}`,
            file: samples[0]?.file || '', line: samples[0]?.line || 0, code: 'not-keyboard-accessible',
            fix: 'Use <button> or <a> elements, or add tabindex="0" and role="button" with keyboard handler',
        });
    }
    return issues;
}
/**
 * Check for screen reader text on icon-only buttons/links.
 */
function checkScreenReaderText(pluginPath, phpFiles) {
    const issues = [];
    let iconOnlyButtons = 0;
    const samples = [];
    // Common icon class patterns
    const iconPatterns = /(?:dashicons|fa-|icon-|material-icons|wp-menu-image)/i;
    for (const file of phpFiles) {
        const content = safeReadFile(file);
        if (!content)
            continue;
        const rel = relativePath(file, pluginPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Button or link with icon class but potentially no text
            if (/<(?:button|a)\b/i.test(line) && iconPatterns.test(line)) {
                // Check if it has screen reader text or aria-label
                const contextEnd = Math.min(lines.length, i + 3);
                const context = lines.slice(i, contextEnd).join('\n');
                if (!/aria-label/i.test(context) && !/screen-reader-text/i.test(context) &&
                    !/sr-only/i.test(context) && !/visually-hidden/i.test(context) &&
                    !/title\s*=/i.test(line)) {
                    // Check if button has visible text content
                    const closingTag = context.match(/<\/(?:button|a)>/i);
                    if (closingTag) {
                        const innerContent = context.substring(context.indexOf('>') + 1, context.indexOf(closingTag[0]));
                        const textContent = innerContent.replace(/<[^>]+>/g, '').trim();
                        if (textContent.length === 0) {
                            iconOnlyButtons++;
                            if (samples.length < 5)
                                samples.push({ file: rel, line: i + 1 });
                        }
                    }
                }
            }
        }
    }
    if (iconOnlyButtons > 0) {
        issues.push({
            id: generateTestId('a11y'), category: 'a11y', severity: 'high', type: 'error',
            title: `${iconOnlyButtons} icon-only buttons/links without accessible names`,
            message: `Buttons/links with icon classes but no visible text, aria-label, or screen-reader-text. ${samples.map(s => `${s.file}:${s.line}`).join(', ')}`,
            file: samples[0]?.file || '', line: samples[0]?.line || 0, code: 'icon-only-no-label',
            fix: 'Add aria-label="Description" or <span class="screen-reader-text">Description</span> inside the element',
        });
    }
    return issues;
}
//# sourceMappingURL=a11y-checker.js.map
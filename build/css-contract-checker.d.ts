/**
 * WP Plugin QA MCP Server - CSS Contract Checker
 *
 * Markup <-> stylesheet contract drift. Catches the silent-bug class where the
 * markup names a class or a custom property that no stylesheet defines, so CSS
 * resolves it to nothing (or to a hardcoded fallback literal) and the host
 * theme decides what the control looks like.
 *
 * Nothing else sees this. It is valid CSS, valid HTML and valid PHP; WPCS,
 * PHPStan, stylelint and Plugin Check all analyze files in isolation and none
 * of them cross the markup<->stylesheet boundary. It does not throw, it does
 * not warn, and it reaches customers.
 *
 * Every one of these shipped in wp-sell-services 1.7.1 and was found by hand,
 * one support card at a time:
 *
 *   .wpss-btn--link        defined only in vendor-dashboard.css, which the
 *                          member dashboard does not load. The Remove control
 *                          under the profile photo had no rule at all and fell
 *                          through to the theme: pure black on a dark card,
 *                          measured 1.18:1. (Basecamp 10300330443)
 *   --wpss-muted           never a token. wpss-tour.css asked for it and
 *                          silently got its LIGHT literal on a dark dashboard.
 *   --wpss-surface-hover   same; the pair rendered white-on-white at 1.13:1.
 *   .wpss-toast            defined only in admin.css, so every frontend toast
 *                          rendered unstyled at position:static, ~3100px down
 *                          the page. The member never saw a save confirmation.
 *   .wpss-dispute-detail__actions
 *                          in the template from day one, in no stylesheet ever,
 *                          so the theme set the spacing: 0px between buttons.
 *
 * Two findings, deliberately separated by confidence:
 *
 *   UNDEFINED  the name is defined in no stylesheet at all. High confidence.
 *              A custom property here is worse than a missing class, because
 *              var() silently falls back to the literal the author typed --
 *              which is almost always the light-mode value, so the bug only
 *              appears in dark mode.
 *
 *   NARROW     the name IS defined, but only in a stylesheet outside the set
 *              this plugin loads everywhere. That is exactly the .wpss-btn--link
 *              shape. Reported as a warning, because proving which sheet loads
 *              on which surface needs runtime and this check is static.
 *
 * Conservative by design. Dynamically built class names (string concatenation,
 * template interpolation, JS joins) are skipped rather than guessed at, so the
 * check biases to false-negatives. A name that cannot be resolved statically is
 * not a finding.
 *
 * Optional per-plugin override: `audit/css-contract.json`
 *   { "universal_sheets": ["design-system.css", "frontend.css"],
 *     "ignore": ["prefix-", "some-exact-class"] }
 */
import type { CheckerResult } from './types.js';
export declare function checkCssContract(pluginPath: string): CheckerResult;

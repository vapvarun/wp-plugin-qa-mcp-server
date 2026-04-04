/**
 * WP Plugin QA MCP Server - Accessibility Checker
 * Static analysis of plugin output templates, PHP, and JS for accessibility issues.
 * Based on WCAG 2.1 AA requirements and the European Accessibility Act (EAA, enforced June 2025).
 */
import type { CheckerResult } from './types.js';
export declare function checkAccessibility(pluginPath: string): CheckerResult;

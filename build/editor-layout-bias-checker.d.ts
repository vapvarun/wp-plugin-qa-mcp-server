/**
 * WP Plugin QA MCP Server - Editor Layout Bias Checker
 *
 * Catches the "Gutenberg-narrative layout but plugin is metadata-heavy" bug:
 * the admin edit view crams 4+ cards into a 280px sidebar while the main
 * content area has only title + empty body. The pattern is fine for posts;
 * catastrophic for plugins where the metadata IS the authoring work.
 *
 * Learnomy example (before Wave A3): lesson-editor.php had 6 cards squeezed
 * into the sidebar (Publish, Placement, Settings, Completion Rules, Resources,
 * Release) while main had only Title + empty Content.
 *
 * Static implementation: regex on raw template source to count region usage.
 */
import type { CheckerResult } from './types.js';
export declare function checkEditorLayoutBias(pluginPath: string): CheckerResult;

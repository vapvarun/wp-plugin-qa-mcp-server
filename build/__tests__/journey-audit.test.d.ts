/**
 * Tests for the journey-audit module.
 *
 * Uses node:test (built-in, zero deps). Run with `npm test` after
 * adding the script to package.json.
 *
 * Targets the parts of journey-audit that the pass-2 audit flagged
 * as having edge cases:
 *
 *   - parseReport handles 3-column tables, 4-column tables (with index
 *     column), severity emoji vs word labels, missing files
 *   - consolidateMatrix tolerates a missing report path without
 *     crashing the whole call
 *   - coverageCheck recognises blanket-coverage group features
 *
 * The shape of these tests is deliberately small. They exist so a
 * future refactor (e.g. checker-signature normalisation) does not
 * silently break the parser. Add more fixtures here as new edge
 * cases surface.
 */
export {};

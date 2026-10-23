#!/usr/bin/env node
/**
 * WP Plugin QA MCP Server - Entry Point
 * Comprehensive WordPress plugin QA automation.
 * Note: several checkers shell out via execFileSync/spawnSync (php lint,
 * Playwright, composer, WP-CLI) — this is not a pure in-process server.
 */
export {};

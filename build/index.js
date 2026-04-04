#!/usr/bin/env node
/**
 * WP Plugin QA MCP Server - Entry Point
 * Comprehensive WordPress plugin QA automation.
 * Note: No shell commands or child processes used.
 */
import { WpPluginQaServer } from './server.js';
async function main() {
    console.error('Starting WP Plugin QA MCP Server v2.1.0...');
    const server = new WpPluginQaServer();
    await server.run();
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map
import type { Row } from './checks.js';
import type { WpCli } from './wp.js';
export declare function staticGuard(pluginPath: string, cli: WpCli, g: {
    id: string;
    run: string;
}): Row;

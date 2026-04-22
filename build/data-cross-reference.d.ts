/**
 * WP Plugin QA MCP Server - Data Cross-Reference
 *
 * Catalogs every data store (post_meta, user_meta, term_meta, option, transient,
 * custom DB table/column) a plugin touches, and records every writer + reader.
 * The critical class of bug this catches is "stale-read": a reader with zero
 * matching writers - the exact bug where UI always renders the default/zero
 * value because the real data lives elsewhere.
 */
import type { PluginManifest } from './types.js';
export interface CodeReference {
    file: string;
    line: number;
    snippet: string;
    role: 'read' | 'write' | 'delete';
}
export type DataStoreType = 'post_meta' | 'user_meta' | 'term_meta' | 'option' | 'transient' | 'db_column';
export type DataStoreVerdict = 'healthy' | 'stale-write' | 'stale-read' | 'orphan';
export type DataStoreSeverity = 'critical' | 'warning' | 'info';
export interface DataStoreEntry {
    type: DataStoreType;
    key: string;
    writers: CodeReference[];
    readers: CodeReference[];
    verdict: DataStoreVerdict;
    severity: DataStoreSeverity;
    hint?: string;
}
export interface DataCrossReferenceReport {
    summary: {
        totalStores: number;
        writersWithoutReaders: number;
        readersWithoutWriters: number;
        sharedStores: number;
        timestamp: string;
        notes: string[];
    };
    stores: DataStoreEntry[];
}
export declare function crossReferenceData(opts: {
    pluginPath: string;
    scanManifestCache?: PluginManifest;
}): DataCrossReferenceReport;

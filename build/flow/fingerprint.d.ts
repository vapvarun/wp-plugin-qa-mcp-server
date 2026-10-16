export declare function fingerprintFiles(files: string[], repoRoot: string): Record<string, string>;
export declare function diffFingerprints(prev: Record<string, string>, next: Record<string, string>): {
    changed: string[];
    deleted: string[];
};

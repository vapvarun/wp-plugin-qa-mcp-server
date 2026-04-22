/**
 * WP Plugin QA MCP Server - Basecamp Learner
 *
 * Plugin-agnostic Basecamp ledger generator with a local per-card cache.
 * Two-phase contract: first call with compact listings may return
 * { pending: true, needsFetch } WITHOUT writing; orchestrator fetches
 * missing card bodies + comments and re-invokes with fetched_full_cards /
 * fetched_comments to build plan/basecamp/ledger.md + ledger.json plus
 * a cache/ tree so subsequent runs only re-fetch what changed.
 */
export interface CompactCard {
    id: number | string;
    title: string;
    updated_at: string;
    created_at?: string;
    app_url?: string;
    comments_count?: number;
    assignees?: string[];
}
export interface FetchedCard {
    id: number | string;
    title: string;
    created_at: string;
    updated_at: string;
    comments_count?: number;
    app_url?: string;
    content?: string;
    creator?: {
        name?: string;
    } | string;
}
export interface FetchedComment {
    content: string;
    created_at?: string;
    creator?: {
        name?: string;
    } | string;
}
export interface LearnFromBasecampOptions {
    pluginPath: string;
    fetchedColumns: Record<string, CompactCard[]>;
    fetchedFullCards?: Record<string, FetchedCard>;
    fetchedComments?: Record<string, FetchedComment[]>;
    projectId?: string;
    projectUrl?: string;
    forceFull?: boolean;
    writeLedger?: boolean;
}
export type LearnFromBasecampResult = BasecampLedgerReport | BasecampPendingFetch;
export interface BasecampPendingFetch {
    pending: true;
    needsFetch: {
        cards: string[];
        comments: string[];
    };
    reason: string;
}
export interface BasecampLedgerReport {
    plugin: string;
    projectId: string;
    projectUrl: string;
    snapshotAt: string;
    columns: Record<string, {
        id: string;
        count: number;
        cards: CardSummary[];
    }>;
    insights: {
        doneWithoutRegressionFixture: string[];
        readyForTestingAging: AgingCard[];
        reopenDetection: 'not-supported-without-events-api';
        topModulesByBugCount: ModuleBucket[];
        fixCommitCoverage: {
            total: number;
            withFixSha: number;
            percentage: number;
        };
        possibleDuplicates: DuplicateCandidate[];
        warnings: string[];
    };
    writtenFiles: string[];
}
export interface CardSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    creator: string;
    appUrl: string;
    commentCount: number;
    firstCommentExcerpt?: string;
    fixCommit?: string;
    fixBranch?: string;
    moduleHints: string[];
    hasRegressionFixture: boolean;
}
export interface AgingCard {
    id: string;
    title: string;
    appUrl: string;
    daysInColumn: number;
}
export interface ModuleBucket {
    module: string;
    count: number;
    sampleCards: string[];
}
export interface DuplicateCandidate {
    newCard: string;
    historicalCard: string;
    score: number;
    sharedKeywords: string[];
}
export declare function learnFromBasecamp(opts: LearnFromBasecampOptions): Promise<LearnFromBasecampResult>;

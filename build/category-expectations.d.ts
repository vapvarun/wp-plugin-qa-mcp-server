/**
 * WP Plugin QA MCP Server - Category Expectations Engine
 *
 * Thinks like a customer, not a WordPress developer.
 * When someone builds a "community plugin", they're competing against
 * Discourse, Circle, Mighty Networks — not just other WP plugins.
 *
 * This module:
 * 1. Detects what SOFTWARE CATEGORY the plugin belongs to
 * 2. Defines what features CUSTOMERS EXPECT from that category
 *    (based on industry leaders across ALL platforms)
 * 3. Checks which expected features exist in the plugin
 * 4. Reports functional gaps between customer expectations and reality
 */
import type { PluginManifest } from './types.js';
export type SoftwareCategory = 'community' | 'e-commerce' | 'lms' | 'membership' | 'forms' | 'seo' | 'page-builder' | 'booking' | 'directory' | 'marketplace' | 'email-marketing' | 'backup-security' | 'analytics' | 'multilingual' | 'social' | 'media' | 'general';
export type FeatureStatus = 'found' | 'partial' | 'not-found';
export type FeatureImportance = 'must-have' | 'should-have' | 'nice-to-have';
export interface ExpectedFeature {
    name: string;
    importance: FeatureImportance;
    description: string;
    industryReference: string;
    detection: (manifest: PluginManifest, allCode: string) => FeatureStatus;
}
export interface CategoryDefinition {
    id: SoftwareCategory;
    name: string;
    description: string;
    industryLeaders: string[];
    detectionSignals: string[];
    features: ExpectedFeature[];
}
export interface DetectedCategory {
    category: SoftwareCategory;
    name: string;
    confidence: number;
    matchedSignals: string[];
}
export interface FeatureExpectationResult {
    feature: string;
    importance: FeatureImportance;
    status: FeatureStatus;
    description: string;
    industryReference: string;
}
export interface CategoryAnalysisResult {
    detectedCategory: DetectedCategory;
    alternateCategories: DetectedCategory[];
    totalExpected: number;
    found: number;
    partial: number;
    notFound: number;
    completenessScore: number;
    features: FeatureExpectationResult[];
    mustHaveGaps: FeatureExpectationResult[];
    shouldHaveGaps: FeatureExpectationResult[];
    niceToHaveGaps: FeatureExpectationResult[];
}
export declare function detectCategory(manifest: PluginManifest): DetectedCategory[];
export declare function analyzeExpectations(manifest: PluginManifest): CategoryAnalysisResult;
export declare function formatCategoryAnalysis(result: CategoryAnalysisResult): string;

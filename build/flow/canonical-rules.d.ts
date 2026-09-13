export interface CanonicalRule {
    id: string;
    pattern: RegExp;
    appliesTo: 'template' | 'php' | 'any';
    message: string;
    fix: string;
}
export declare const CANONICAL_RULES: CanonicalRule[];

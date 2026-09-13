export const CANONICAL_RULES = [
    { id: 'wpdb-in-template', pattern: /\$wpdb\b/, appliesTo: 'template',
        message: 'Raw $wpdb in a template; templates must consume the service layer, not query the DB.',
        fix: 'Move the query into a service/hydrator and pass the data in via the loader args.' },
    { id: 'rawsql-in-template', pattern: /\$wpdb->get_(results|row|var|col)\s*\(/, appliesTo: 'template',
        message: 'Raw SQL result call in a template.', fix: 'Hydrate in a service and pass results to the template.' },
    { id: 'wpquery-in-template', pattern: /\bnew\s+WP_Query\b|\bget_posts\s*\(/, appliesTo: 'template',
        message: 'Direct query construction in a template.', fix: 'Build the query in a service; templates render prepared data.' },
];
//# sourceMappingURL=canonical-rules.js.map
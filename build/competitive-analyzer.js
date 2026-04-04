/**
 * WP Plugin QA MCP Server - Competitive Analyzer
 * Scans plugin, searches 3 marketplaces (WordPress.org, CodeCanyon, Google),
 * compares features, and generates gap analysis + prioritized roadmap.
 */
import { scanPlugin } from './scanner.js';
// ─── Constants ──────────────────────────────────────────────────
const STOPWORDS = new Set([
    'for', 'the', 'and', 'with', 'wordpress', 'plugin', 'plugins',
    'pro', 'free', 'lite', 'premium', 'version', 'new', 'best',
    'top', 'all', 'your', 'this', 'that', 'from', 'will', 'can',
    'has', 'have', 'are', 'was', 'were', 'been', 'being', 'more',
    'very', 'most', 'also', 'just', 'than', 'into', 'only', 'other',
]);
const FEATURE_STOPWORDS = new Set([
    'support', 'supports', 'powerful', 'advanced', 'easy', 'simple',
    'beautiful', 'elegant', 'modern', 'lightweight', 'fast', 'quick',
    'fully', 'complete', 'completely', 'unlimited', 'flexible',
]);
const NON_FEATURE_PATTERNS = [
    /^\d{4}[-/]\d{2}/, // dates
    /^v?\d+\.\d+/, // versions
    /changelog|change\s*log/i,
    /check\s*out|buy\s*now|get\s*started|learn\s*more/i,
    /https?:\/\//, // URLs
    /^\s*$/, // empty
    /copyright|license|gpl/i,
    /documentation|read\s*more/i,
    /screenshot|demo|preview/i,
];
const CATEGORY_KEYWORDS = {
    'cpt': ['custom post type', 'post type', 'cpt'],
    'taxonomy': ['taxonomy', 'categories', 'tags', 'terms'],
    'rest-api': ['rest api', 'api endpoint', 'api integration', 'rest route', 'json api'],
    'block': ['gutenberg', 'block editor', 'block', 'blocks'],
    'shortcode': ['shortcode', 'shortcodes'],
    'widget': ['widget', 'sidebar widget'],
    'admin-page': ['admin panel', 'admin page', 'settings page', 'dashboard', 'admin menu'],
    'cron': ['cron', 'scheduled', 'schedule', 'background task', 'background process'],
    'cli': ['wp-cli', 'command line', 'cli command'],
    'integration': ['integration', 'woocommerce', 'buddypress', 'elementor', 'bbpress', 'learndash', 'zapier', 'mailchimp'],
    'import-export': ['import', 'export', 'csv', 'xml', 'migrate', 'backup'],
    'notification': ['notification', 'email', 'alert', 'smtp', 'push notification'],
    'multisite': ['multisite', 'network', 'multi-site'],
    'user-role': ['user role', 'role', 'capability', 'permission', 'access control'],
    'template': ['template', 'theme override', 'theme template', 'template override'],
    'frontend': ['frontend', 'front-end', 'display', 'layout', 'responsive', 'mobile'],
    'reporting': ['report', 'analytics', 'statistics', 'chart', 'graph', 'log'],
    'general': [],
};
const PREMIUM_INDICATORS = [
    'pro version', 'premium version', 'upgrade to', 'pricing',
    'lite version', 'go pro', 'premium features', 'paid',
];
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_DELAY_MS = 300;
// ─── Main Entry Point ───────────────────────────────────────────
export async function analyzeCompetitors(pluginPath, searchKeywords, maxCompetitors = 10) {
    // 1. Scan plugin
    const manifest = scanPlugin(pluginPath);
    // 2. Extract user's features from manifest
    const userFeatures = extractManifestFeatures(manifest);
    // 3. Derive search terms
    const searchTerms = deriveSearchTerms(manifest, searchKeywords);
    // 4-6. Search all 3 sources
    const suggestedSearchUrls = [];
    const sourcesSearched = [];
    const wpOrgResults = await searchWordPressOrg(searchTerms, manifest.header.slug);
    sourcesSearched.push({
        source: 'WordPress.org',
        found: wpOrgResults.length,
        status: wpOrgResults.length > 0 ? 'success' : 'no results',
    });
    const codecanyonResults = await searchCodeCanyon(searchTerms);
    if (codecanyonResults.blocked) {
        sourcesSearched.push({ source: 'CodeCanyon', found: 0, status: 'blocked (403)' });
        for (const term of searchTerms) {
            suggestedSearchUrls.push({
                source: 'CodeCanyon',
                url: `https://codecanyon.net/search?term=${encodeURIComponent(term)}&sort=sales&category=wordpress`,
            });
        }
    }
    else {
        sourcesSearched.push({
            source: 'CodeCanyon',
            found: codecanyonResults.results.length,
            status: codecanyonResults.results.length > 0 ? 'success' : 'no results',
        });
    }
    const googleResults = await searchGoogle(searchTerms);
    if (googleResults.blocked) {
        sourcesSearched.push({ source: 'Google', found: 0, status: 'blocked' });
        for (const term of searchTerms) {
            suggestedSearchUrls.push({
                source: 'Google',
                url: `https://www.google.com/search?q=${encodeURIComponent('wordpress plugin ' + term + ' premium')}`,
            });
        }
    }
    else {
        sourcesSearched.push({
            source: 'Google/Web',
            found: googleResults.results.length,
            status: googleResults.results.length > 0 ? 'success' : 'no results',
        });
    }
    // 7. Merge, deduplicate, rank, and take top N
    const allCompetitors = [
        ...wpOrgResults,
        ...codecanyonResults.results,
        ...googleResults.results,
    ];
    const totalFound = allCompetitors.length;
    const ranked = deduplicateAndRank(allCompetitors, maxCompetitors);
    // 8. Fetch detailed info for WP.org plugins (get description sections)
    await fetchDetailedInfo(ranked);
    // 9. Extract features from descriptions
    for (const comp of ranked) {
        if (comp.features.length === 0) {
            const descFeatures = extractFeaturesFromHtml(comp.name, comp.marketplace === 'wordpress.org' ? 'description' : comp.marketplace);
            comp.features.push(...descFeatures);
        }
    }
    // 10. Build report
    const featureMatrix = buildFeatureMatrix(userFeatures, ranked);
    const gaps = identifyGaps(featureMatrix, ranked);
    const usps = identifyUSPs(featureMatrix);
    const essentials = identifyEssentials(featureMatrix);
    const monetization = identifyMonetization(featureMatrix, ranked);
    const roadmap = generateRoadmap(gaps);
    // Market stats
    const installs = ranked.map(c => c.active_installs).filter(i => i > 0).sort((a, b) => a - b);
    const avgInstalls = installs.length > 0 ? Math.round(installs.reduce((a, b) => a + b, 0) / installs.length) : 0;
    const medianInstalls = installs.length > 0 ? installs[Math.floor(installs.length / 2)] : 0;
    const ratings = ranked.map(c => c.rating).filter(r => r > 0);
    const avgRating = ratings.length > 0 ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
    const installDistribution = buildInstallDistribution(ranked);
    return {
        userPlugin: {
            name: manifest.header.name || manifest.header.slug,
            slug: manifest.header.slug,
            version: manifest.header.version,
            featureCount: userFeatures.length,
            features: userFeatures,
        },
        market: {
            totalCompetitorsFound: totalFound,
            totalCompetitorsAnalyzed: ranked.length,
            searchTermsUsed: searchTerms,
            averageInstalls: avgInstalls,
            medianInstalls,
            averageRating: avgRating,
            installDistribution,
            sourcesSearched,
        },
        competitors: ranked,
        featureMatrix,
        gaps,
        uniqueSellingPoints: usps,
        essentialFeatures: essentials,
        monetizationOpportunities: monetization,
        roadmap,
        suggestedSearchUrls,
        generatedAt: new Date().toISOString(),
    };
}
// ─── Step 2: Extract Features from Plugin Manifest ──────────────
function extractManifestFeatures(manifest) {
    const features = [];
    for (const cpt of manifest.features.cpts) {
        features.push(makeFeature(cpt.label || cpt.postType, 'cpt', 'manifest'));
    }
    for (const tax of manifest.features.taxonomies) {
        features.push(makeFeature(tax.label || tax.taxonomy, 'taxonomy', 'manifest'));
    }
    for (const sc of manifest.features.shortcodes) {
        features.push(makeFeature(`Shortcode: ${sc.tag}`, 'shortcode', 'manifest'));
    }
    for (const block of manifest.features.blocks) {
        features.push(makeFeature(block.title || block.name, 'block', 'manifest'));
    }
    for (const route of manifest.features.restRoutes) {
        features.push(makeFeature(`REST: ${route.route}`, 'rest-api', 'manifest'));
    }
    for (const page of manifest.features.adminPages) {
        features.push(makeFeature(page.title || page.slug, 'admin-page', 'manifest'));
    }
    for (const widget of manifest.features.widgets) {
        features.push(makeFeature(widget.idBase || widget.className, 'widget', 'manifest'));
    }
    for (const cron of manifest.features.cronJobs) {
        features.push(makeFeature(`Cron: ${cron.hook}`, 'cron', 'manifest'));
    }
    for (const cli of manifest.features.cliCommands) {
        features.push(makeFeature(`CLI: ${cli.command}`, 'cli', 'manifest'));
    }
    for (const tmpl of manifest.features.templates) {
        features.push(makeFeature(`Template: ${tmpl.file}`, 'template', 'manifest'));
    }
    for (const integ of manifest.features.integrations) {
        features.push(makeFeature(`${integ.type} integration`, 'integration', 'manifest'));
    }
    // DB tables
    if (manifest.features.dbTables.length > 0) {
        features.push(makeFeature('Custom database tables', 'general', 'manifest'));
    }
    // AJAX handlers
    if (manifest.features.ajaxHandlers.length > 0) {
        features.push(makeFeature('AJAX support', 'rest-api', 'manifest'));
    }
    // Roles
    for (const role of manifest.features.customRoles) {
        features.push(makeFeature(`Role: ${role.displayName || role.role}`, 'user-role', 'manifest'));
    }
    return features;
}
// ─── Step 3: Derive Search Terms ────────────────────────────────
function deriveSearchTerms(manifest, userKeywords) {
    const terms = new Set();
    // User-provided keywords
    if (userKeywords) {
        for (const kw of userKeywords.split(',').map(k => k.trim()).filter(Boolean)) {
            terms.add(kw.toLowerCase());
        }
    }
    // Plugin name words (minus stopwords)
    const nameWords = (manifest.header.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .split(/[\s-]+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
    if (nameWords.length > 0) {
        terms.add(nameWords.join(' '));
    }
    // Slug / text domain
    const slug = manifest.header.slug || manifest.header.textDomain || '';
    if (slug) {
        const slugWords = slug.replace(/-/g, ' ').split(/\s+/)
            .filter(w => w.length > 2 && !STOPWORDS.has(w));
        if (slugWords.length > 0) {
            terms.add(slugWords.join(' '));
        }
    }
    // Description first meaningful words
    const descWords = (manifest.header.description || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w))
        .slice(0, 5);
    if (descWords.length >= 2) {
        terms.add(descWords.slice(0, 3).join(' '));
    }
    // Integration-derived terms
    for (const integ of manifest.features.integrations) {
        const baseName = nameWords.filter(w => w !== integ.type).join(' ');
        if (baseName) {
            terms.add(`${integ.type} ${baseName}`);
        }
    }
    // Cap at 6 unique search queries
    return [...terms].slice(0, 6);
}
// ─── Step 4: WordPress.org API ──────────────────────────────────
async function searchWordPressOrg(terms, excludeSlug) {
    const seen = new Set();
    const results = [];
    for (const term of terms) {
        try {
            const url = 'https://api.wordpress.org/plugins/info/1.2/?action=query_plugins'
                + `&request[search]=${encodeURIComponent(term)}`
                + '&request[per_page]=25'
                + '&request[fields][ratings]=1'
                + '&request[fields][active_installs]=1'
                + '&request[fields][tags]=1'
                + '&request[fields][sections]=1'
                + '&request[fields][tested]=1'
                + '&request[fields][requires_php]=1'
                + '&request[fields][last_updated]=1';
            const resp = await fetch(url);
            if (!resp.ok)
                continue;
            const data = await resp.json();
            if (!data.plugins)
                continue;
            for (const plugin of data.plugins) {
                if (plugin.slug === excludeSlug)
                    continue;
                if (seen.has(plugin.slug))
                    continue;
                seen.add(plugin.slug);
                const tags = plugin.tags ? Object.values(plugin.tags) : [];
                const hasPremium = detectPremium(plugin.short_description || '', plugin.slug);
                // Extract features from description + tags
                const features = [];
                for (const tag of tags) {
                    features.push(makeFeature(tag, categorizeFeature(tag), 'tag'));
                }
                if (plugin.sections?.description) {
                    features.push(...extractFeaturesFromHtml(plugin.sections.description, 'description'));
                }
                results.push({
                    slug: plugin.slug,
                    name: stripHtml(plugin.name),
                    version: plugin.version || '',
                    author: stripHtml(plugin.author || ''),
                    active_installs: plugin.active_installs || 0,
                    rating: plugin.rating || 0,
                    num_ratings: plugin.num_ratings || 0,
                    tested: plugin.tested || '',
                    requires_php: plugin.requires_php || '',
                    last_updated: plugin.last_updated || '',
                    tags,
                    features,
                    hasPremiumVersion: hasPremium.has,
                    premiumIndicators: hasPremium.indicators,
                    marketplace: 'wordpress.org',
                    url: `https://wordpress.org/plugins/${plugin.slug}/`,
                });
            }
        }
        catch {
            // Network error — skip this term
        }
        await delay(REQUEST_DELAY_MS);
    }
    return results;
}
async function searchCodeCanyon(terms) {
    const results = [];
    const seen = new Set();
    let blocked = false;
    for (const term of terms.slice(0, 3)) {
        try {
            const url = `https://codecanyon.net/search?term=${encodeURIComponent(term)}&sort=sales&category=wordpress`;
            const resp = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT },
            });
            if (resp.status === 403 || resp.status === 429) {
                blocked = true;
                continue;
            }
            if (!resp.ok)
                continue;
            const html = await resp.text();
            // Parse product cards from search results HTML
            const cardRegex = /<article[^>]*class="[^"]*product-card[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
            const titleRegex = /<h3[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/i;
            const priceRegex = /\$[\d,.]+/;
            const salesRegex = /([\d,]+)\s*Sales/i;
            const ratingRegex = /(\d+(?:\.\d+)?)\s*(?:out of|\/)\s*5/i;
            const descRegex = /<p[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/i;
            let match;
            while ((match = cardRegex.exec(html)) !== null) {
                const card = match[1];
                const titleMatch = titleRegex.exec(card);
                if (!titleMatch)
                    continue;
                const cardUrl = titleMatch[1];
                const name = stripHtml(titleMatch[2]).trim();
                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
                if (seen.has(slug))
                    continue;
                seen.add(slug);
                const priceMatch = priceRegex.exec(card);
                const salesMatch = salesRegex.exec(card);
                const ratingMatch = ratingRegex.exec(card);
                const descMatch = descRegex.exec(card);
                const features = [];
                if (descMatch) {
                    features.push(...extractFeaturesFromHtml(descMatch[1], 'codecanyon'));
                }
                features.push(...extractFeaturesFromTitle(name));
                results.push({
                    slug,
                    name,
                    version: '',
                    author: '',
                    active_installs: salesMatch ? parseInt(salesMatch[1].replace(/,/g, ''), 10) : 0,
                    rating: ratingMatch ? Math.round(parseFloat(ratingMatch[1]) * 20) : 0,
                    num_ratings: 0,
                    tested: '',
                    requires_php: '',
                    last_updated: '',
                    tags: [],
                    features,
                    hasPremiumVersion: true,
                    premiumIndicators: ['codecanyon listing'],
                    marketplace: 'codecanyon',
                    price: priceMatch ? priceMatch[0] : undefined,
                    url: cardUrl?.startsWith('http') ? cardUrl : cardUrl ? `https://codecanyon.net${cardUrl}` : undefined,
                });
            }
            // Fallback: simpler link patterns
            if (results.length === 0) {
                const simpleTitleRegex = /<a[^>]*href="(https:\/\/codecanyon\.net\/item\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
                while ((match = simpleTitleRegex.exec(html)) !== null) {
                    const itemUrl = match[1];
                    const name = stripHtml(match[2]).trim();
                    if (name.length < 3 || name.length > 100)
                        continue;
                    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
                    if (seen.has(slug))
                        continue;
                    seen.add(slug);
                    results.push({
                        slug,
                        name,
                        version: '',
                        author: '',
                        active_installs: 0,
                        rating: 0,
                        num_ratings: 0,
                        tested: '',
                        requires_php: '',
                        last_updated: '',
                        tags: [],
                        features: extractFeaturesFromTitle(name),
                        hasPremiumVersion: true,
                        premiumIndicators: ['codecanyon listing'],
                        marketplace: 'codecanyon',
                        url: itemUrl,
                    });
                }
            }
        }
        catch {
            blocked = true;
        }
        await delay(REQUEST_DELAY_MS);
    }
    return { results, blocked };
}
// ─── Step 6: Google Search (best-effort) ────────────────────────
async function searchGoogle(terms) {
    const results = [];
    const seen = new Set();
    let blocked = false;
    for (const term of terms.slice(0, 2)) {
        try {
            const query = `wordpress plugin ${term} premium`;
            const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20`;
            const resp = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT },
            });
            if (resp.status === 429 || resp.status === 403) {
                blocked = true;
                continue;
            }
            if (!resp.ok)
                continue;
            const html = await resp.text();
            // Parse organic results — find links with h3 titles
            const allLinks = html.matchAll(/<a[^>]*href="\/url\?q=(https?[^&"]+)[^"]*"[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/gi);
            for (const linkMatch of allLinks) {
                const resultUrl = decodeURIComponent(linkMatch[1]);
                const title = stripHtml(linkMatch[2]).trim();
                if (!isWordPressRelated(resultUrl, title))
                    continue;
                if (resultUrl.includes('wordpress.org'))
                    continue; // Already covered by WP.org API
                const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 50);
                if (seen.has(slug))
                    continue;
                seen.add(slug);
                results.push({
                    slug,
                    name: title,
                    version: '',
                    author: '',
                    active_installs: 0,
                    rating: 0,
                    num_ratings: 0,
                    tested: '',
                    requires_php: '',
                    last_updated: '',
                    tags: [],
                    features: extractFeaturesFromTitle(title),
                    hasPremiumVersion: true,
                    premiumIndicators: ['web listing'],
                    marketplace: 'web',
                    url: resultUrl,
                });
            }
        }
        catch {
            blocked = true;
        }
        await delay(REQUEST_DELAY_MS);
    }
    return { results, blocked };
}
// ─── Step 7: Deduplicate & Rank ─────────────────────────────────
function deduplicateAndRank(competitors, limit) {
    const unique = [];
    const seenNames = new Set();
    for (const comp of competitors) {
        const normalizedName = comp.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seenNames.has(normalizedName))
            continue;
        let isDuplicate = false;
        for (const seen of seenNames) {
            if (jaccardSimilarity(normalizedName.split(''), seen.split('')) > 0.8) {
                isDuplicate = true;
                break;
            }
        }
        if (isDuplicate)
            continue;
        seenNames.add(normalizedName);
        unique.push(comp);
    }
    unique.sort((a, b) => computeRankScore(b) - computeRankScore(a));
    return unique.slice(0, limit);
}
function computeRankScore(comp) {
    let score = 0;
    if (comp.active_installs > 0) {
        score += Math.log10(comp.active_installs) * 10;
    }
    score += (comp.rating || 0) / 10;
    score += Math.min(comp.features.length, 20);
    if (comp.marketplace === 'wordpress.org')
        score += 5;
    if (comp.marketplace === 'codecanyon')
        score += 3;
    return score;
}
// ─── Step 8: Fetch Detailed Info ────────────────────────────────
async function fetchDetailedInfo(competitors) {
    for (const comp of competitors) {
        if (comp.marketplace !== 'wordpress.org')
            continue;
        if (comp.features.length > 3)
            continue;
        try {
            const url = 'https://api.wordpress.org/plugins/info/1.2/?action=plugin_information'
                + `&request[slug]=${encodeURIComponent(comp.slug)}`
                + '&request[fields][sections]=1'
                + '&request[fields][tags]=1';
            const resp = await fetch(url);
            if (!resp.ok)
                continue;
            const data = await resp.json();
            if (data.sections?.description) {
                const descFeatures = extractFeaturesFromHtml(data.sections.description, 'description');
                comp.features.push(...descFeatures);
            }
            if (data.tags) {
                const tags = Object.values(data.tags);
                comp.tags = tags;
                for (const tag of tags) {
                    if (!comp.features.some(f => f.normalizedName === normalizeFeatureName(tag))) {
                        comp.features.push(makeFeature(tag, categorizeFeature(tag), 'tag'));
                    }
                }
            }
        }
        catch {
            // Skip on error
        }
        await delay(REQUEST_DELAY_MS);
    }
}
// ─── Step 9: Feature Extraction from HTML ───────────────────────
function extractFeaturesFromHtml(html, source) {
    const features = [];
    const seen = new Set();
    const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '');
    // Pattern 1: <li> items
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = liRegex.exec(cleaned)) !== null) {
        const text = stripHtml(match[1]).trim();
        if (isValidFeature(text, seen)) {
            seen.add(normalizeFeatureName(text));
            features.push(makeFeature(text, categorizeFeature(text), source));
        }
    }
    // Pattern 2: Bullet/check markers in text
    const lines = stripHtml(cleaned).split('\n');
    for (const line of lines) {
        const bulletMatch = line.match(/^[\s]*[★✓✔•●\-*\u2713\u2714\u2022]\s*(.+)/);
        if (bulletMatch) {
            const text = bulletMatch[1].trim();
            if (isValidFeature(text, seen)) {
                seen.add(normalizeFeatureName(text));
                features.push(makeFeature(text, categorizeFeature(text), source));
            }
        }
    }
    // Pattern 3: <strong>/<b> headings that look like features
    const boldRegex = /<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi;
    while ((match = boldRegex.exec(cleaned)) !== null) {
        const text = stripHtml(match[1]).trim();
        if (text.length > 3 && text.length < 80 && isValidFeature(text, seen)) {
            seen.add(normalizeFeatureName(text));
            features.push(makeFeature(text, categorizeFeature(text), source));
        }
    }
    // Pattern 4: h3/h4 section headings
    const headingRegex = /<h[34][^>]*>([\s\S]*?)<\/h[34]>/gi;
    while ((match = headingRegex.exec(cleaned)) !== null) {
        const text = stripHtml(match[1]).trim();
        if (text.length > 3 && text.length < 60 && isValidFeature(text, seen)) {
            seen.add(normalizeFeatureName(text));
            features.push(makeFeature(text, categorizeFeature(text), source));
        }
    }
    return features;
}
function extractFeaturesFromTitle(title) {
    const features = [];
    const parts = title.split(/\s*[-|–—/]\s*/);
    for (const part of parts) {
        const text = part.trim();
        if (text.length > 3 && text.length < 60 && !STOPWORDS.has(text.toLowerCase())) {
            features.push(makeFeature(text, categorizeFeature(text), 'web'));
        }
    }
    return features;
}
// ─── Step 10: Feature Matrix, Gaps, USPs, Roadmap ───────────────
function buildFeatureMatrix(userFeatures, competitors) {
    const allFeatures = new Map();
    for (const f of userFeatures) {
        allFeatures.set(f.normalizedName, { name: f.name, category: f.category });
    }
    for (const comp of competitors) {
        for (const f of comp.features) {
            if (!allFeatures.has(f.normalizedName)) {
                allFeatures.set(f.normalizedName, { name: f.name, category: f.category });
            }
        }
    }
    const matrix = [];
    for (const [normalizedName, { name, category }] of allFeatures) {
        const userHas = userFeatures.some(f => featuresMatch(f.normalizedName, normalizedName));
        const compMap = {};
        let count = 0;
        for (const comp of competitors) {
            const has = comp.features.some(f => featuresMatch(f.normalizedName, normalizedName));
            compMap[comp.slug] = has;
            if (has)
                count++;
        }
        matrix.push({
            feature: name,
            category,
            userPlugin: userHas,
            competitors: compMap,
            frequency: count,
            frequencyPercent: competitors.length > 0 ? Math.round((count / competitors.length) * 100) : 0,
        });
    }
    matrix.sort((a, b) => b.frequency - a.frequency);
    return matrix;
}
function identifyGaps(matrix, competitors) {
    const gaps = [];
    for (const entry of matrix) {
        if (entry.userPlugin)
            continue;
        if (entry.frequency === 0)
            continue;
        const topCompetitors = Object.entries(entry.competitors)
            .filter(([, has]) => has)
            .map(([slug]) => {
            const comp = competitors.find(c => c.slug === slug);
            return comp?.name || slug;
        })
            .slice(0, 5);
        const priority = getGapPriority(entry.frequencyPercent);
        const rationale = getGapRationale(priority, entry.frequencyPercent, entry.frequency);
        gaps.push({
            feature: entry.feature,
            category: entry.category,
            competitorCount: entry.frequency,
            competitorPercent: entry.frequencyPercent,
            topCompetitors,
            priority,
            rationale,
        });
    }
    gaps.sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0)
            return pDiff;
        return b.competitorPercent - a.competitorPercent;
    });
    return gaps;
}
function identifyUSPs(matrix) {
    return matrix
        .filter(entry => entry.userPlugin && entry.frequency === 0)
        .map(entry => entry.feature);
}
function identifyEssentials(matrix) {
    return matrix
        .filter(entry => entry.frequencyPercent >= 80)
        .map(entry => {
        const hasIt = entry.userPlugin ? '(you have this)' : '(MISSING)';
        return `${entry.feature} ${hasIt}`;
    });
}
function identifyMonetization(matrix, competitors) {
    const opportunities = [];
    for (const entry of matrix) {
        if (entry.userPlugin)
            continue;
        const premiumComps = Object.entries(entry.competitors)
            .filter(([slug, has]) => {
            if (!has)
                return false;
            const comp = competitors.find(c => c.slug === slug);
            return comp?.hasPremiumVersion || comp?.marketplace === 'codecanyon';
        })
            .map(([slug]) => {
            const comp = competitors.find(c => c.slug === slug);
            const price = comp?.price ? ` (${comp.price})` : '';
            return `${comp?.name || slug}${price}`;
        });
        if (premiumComps.length >= 2) {
            opportunities.push({
                feature: entry.feature,
                premiumCompetitors: premiumComps,
            });
        }
    }
    return opportunities.slice(0, 15);
}
function generateRoadmap(gaps) {
    return gaps.slice(0, 20).map((gap, index) => ({
        rank: index + 1,
        feature: gap.feature,
        category: gap.category,
        priority: gap.priority,
        effort: estimateEffort(gap.category),
        rationale: gap.rationale,
        competitorExamples: gap.topCompetitors,
    }));
}
// ─── Helpers ────────────────────────────────────────────────────
function makeFeature(name, category, source) {
    return {
        name: name.slice(0, 100),
        normalizedName: normalizeFeatureName(name),
        category,
        source,
    };
}
function normalizeFeatureName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 1 && !FEATURE_STOPWORDS.has(w))
        .join(' ')
        .trim();
}
function categorizeFeature(text) {
    const lower = text.toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.length === 0)
            continue;
        for (const kw of keywords) {
            if (lower.includes(kw))
                return category;
        }
    }
    return 'general';
}
function isValidFeature(text, seen) {
    if (text.length < 4 || text.length > 150)
        return false;
    if (NON_FEATURE_PATTERNS.some(p => p.test(text)))
        return false;
    const normalized = normalizeFeatureName(text);
    if (normalized.length < 3)
        return false;
    if (seen.has(normalized))
        return false;
    return true;
}
function featuresMatch(a, b) {
    if (a === b)
        return true;
    const tokensA = a.split(/\s+/).filter(Boolean);
    const tokensB = b.split(/\s+/).filter(Boolean);
    return jaccardSimilarity(tokensA, tokensB) >= 0.6;
}
function jaccardSimilarity(a, b) {
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item))
            intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}
function detectPremium(description, slug) {
    const lower = description.toLowerCase();
    const indicators = [];
    for (const indicator of PREMIUM_INDICATORS) {
        if (lower.includes(indicator)) {
            indicators.push(indicator);
        }
    }
    if (slug.endsWith('-lite') || slug.endsWith('-free')) {
        indicators.push('slug ends with -lite/-free');
    }
    const priceMatch = lower.match(/\$\d+/);
    if (priceMatch) {
        indicators.push(`price: ${priceMatch[0]}`);
    }
    return { has: indicators.length > 0, indicators };
}
function getGapPriority(percent) {
    if (percent >= 80)
        return 'critical';
    if (percent >= 50)
        return 'high';
    if (percent >= 25)
        return 'medium';
    return 'low';
}
function getGapRationale(priority, percent, count) {
    switch (priority) {
        case 'critical': return `Table stakes: ${percent}% of competitors (${count}) offer this. Users expect it.`;
        case 'high': return `Common feature: ${percent}% of competitors (${count}) have this. Significant market gap.`;
        case 'medium': return `Emerging feature: ${percent}% of competitors (${count}) offer this. Early adoption opportunity.`;
        default: return `Niche feature: ${percent}% of competitors (${count}) have this. Consider if aligned with product direction.`;
    }
}
function estimateEffort(category) {
    switch (category) {
        case 'rest-api':
        case 'block':
        case 'integration':
        case 'multisite':
            return 'large';
        case 'cpt':
        case 'taxonomy':
        case 'admin-page':
        case 'cron':
        case 'reporting':
        case 'import-export':
        case 'user-role':
        case 'notification':
            return 'medium';
        case 'shortcode':
        case 'widget':
        case 'template':
        case 'frontend':
        case 'cli':
        case 'general':
            return 'small';
        default:
            return 'medium';
    }
}
function stripHtml(html) {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function isWordPressRelated(url, title) {
    const lower = (url + ' ' + title).toLowerCase();
    const keywords = ['wordpress', 'woocommerce', 'buddypress', 'wp-', 'plugin', 'elementor', 'wpforms', 'yoast'];
    return keywords.some(kw => lower.includes(kw));
}
function buildInstallDistribution(competitors) {
    const ranges = [
        { range: '1M+', min: 1_000_000 },
        { range: '100K-1M', min: 100_000 },
        { range: '10K-100K', min: 10_000 },
        { range: '1K-10K', min: 1_000 },
        { range: '<1K', min: 0 },
    ];
    return ranges.map(({ range, min }) => ({
        range,
        count: competitors.filter(c => {
            if (min === 1_000_000)
                return c.active_installs >= min;
            if (min === 0)
                return c.active_installs < 1000 && c.active_installs >= 0;
            const max = min * 10;
            return c.active_installs >= min && c.active_installs < max;
        }).length,
    })).filter(d => d.count > 0);
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// ─── Report Formatter ───────────────────────────────────────────
export function formatCompetitiveReport(report) {
    const lines = [];
    lines.push(`# Competitive Analysis: ${report.userPlugin.name}`);
    lines.push(`Generated: ${report.generatedAt} | Version: ${report.userPlugin.version}`);
    lines.push('');
    // Market Overview
    lines.push('## Market Overview');
    lines.push(`- Competitors analyzed: ${report.market.totalCompetitorsAnalyzed} (found: ${report.market.totalCompetitorsFound})`);
    lines.push(`- Search terms used: ${report.market.searchTermsUsed.join(', ')}`);
    lines.push(`- Average active installs: ${report.market.averageInstalls.toLocaleString()} | Median: ${report.market.medianInstalls.toLocaleString()} | Average rating: ${report.market.averageRating}/100`);
    lines.push('');
    // Sources
    lines.push('### Sources Searched');
    lines.push('| Source | Found | Status |');
    lines.push('|--------|-------|--------|');
    for (const s of report.market.sourcesSearched) {
        lines.push(`| ${s.source} | ${s.found} | ${s.status} |`);
    }
    lines.push('');
    // Install Distribution
    if (report.market.installDistribution.length > 0) {
        lines.push('### Install Distribution');
        lines.push('| Range | Count |');
        lines.push('|-------|-------|');
        for (const d of report.market.installDistribution) {
            lines.push(`| ${d.range} | ${d.count} |`);
        }
        lines.push('');
    }
    // Top Competitors
    lines.push('## Top Competitors');
    lines.push('| Plugin | Installs | Rating | Marketplace | Premium | Price |');
    lines.push('|--------|----------|--------|-------------|---------|-------|');
    for (const c of report.competitors) {
        const installs = c.active_installs > 0 ? c.active_installs.toLocaleString() : '-';
        const rating = c.rating > 0 ? `${c.rating}/100` : '-';
        const premium = c.hasPremiumVersion ? 'Yes' : 'No';
        const price = c.price || (c.marketplace === 'wordpress.org' ? 'Free' : '-');
        lines.push(`| ${c.name} | ${installs} | ${rating} | ${c.marketplace} | ${premium} | ${price} |`);
    }
    lines.push('');
    // Feature Matrix (top 5 competitors)
    const top5 = report.competitors.slice(0, 5);
    if (top5.length > 0 && report.featureMatrix.length > 0) {
        lines.push(`## Feature Matrix (You vs Top ${top5.length})`);
        const header = ['Feature', 'You', ...top5.map(c => c.slug.slice(0, 15))];
        lines.push(`| ${header.join(' | ')} |`);
        lines.push(`| ${header.map(() => '---').join(' | ')} |`);
        const relevantFeatures = report.featureMatrix
            .filter(f => f.userPlugin || f.frequency > 0)
            .slice(0, 30);
        for (const entry of relevantFeatures) {
            const row = [
                entry.feature.slice(0, 40),
                entry.userPlugin ? 'Y' : '-',
                ...top5.map(c => entry.competitors[c.slug] ? 'Y' : '-'),
            ];
            lines.push(`| ${row.join(' | ')} |`);
        }
        lines.push('');
    }
    // USPs
    if (report.uniqueSellingPoints.length > 0) {
        lines.push('## Your Unique Selling Points');
        for (const usp of report.uniqueSellingPoints) {
            lines.push(`- ${usp}`);
        }
        lines.push('');
    }
    // Essential Features
    if (report.essentialFeatures.length > 0) {
        lines.push('## Essential Features (Table Stakes)');
        for (const ess of report.essentialFeatures) {
            lines.push(`- ${ess}`);
        }
        lines.push('');
    }
    // Gap Analysis
    if (report.gaps.length > 0) {
        lines.push('## Gap Analysis');
        lines.push('| Priority | Feature | Category | # Competitors | % |');
        lines.push('|----------|---------|----------|---------------|---|');
        for (const gap of report.gaps.slice(0, 30)) {
            lines.push(`| ${gap.priority} | ${gap.feature.slice(0, 40)} | ${gap.category} | ${gap.competitorCount} | ${gap.competitorPercent}% |`);
        }
        lines.push('');
    }
    // Monetization
    if (report.monetizationOpportunities.length > 0) {
        lines.push('## Monetization Opportunities');
        for (const opp of report.monetizationOpportunities) {
            lines.push(`- **${opp.feature}** — premium in: ${opp.premiumCompetitors.join(', ')}`);
        }
        lines.push('');
    }
    // Roadmap
    if (report.roadmap.length > 0) {
        lines.push('## Suggested Roadmap');
        lines.push('| # | Feature | Priority | Effort | Rationale |');
        lines.push('|---|---------|----------|--------|-----------|');
        for (const item of report.roadmap) {
            lines.push(`| ${item.rank} | ${item.feature.slice(0, 35)} | ${item.priority} | ${item.effort} | ${item.rationale.slice(0, 60)} |`);
        }
        lines.push('');
    }
    // Suggested Search URLs
    if (report.suggestedSearchUrls.length > 0) {
        lines.push('## Manual Search URLs (automated search was blocked)');
        for (const su of report.suggestedSearchUrls) {
            lines.push(`- ${su.source}: ${su.url}`);
        }
        lines.push('');
    }
    // User plugin feature summary
    lines.push('## Your Plugin Features');
    lines.push(`Total features detected: ${report.userPlugin.featureCount}`);
    const byCategory = new Map();
    for (const f of report.userPlugin.features) {
        byCategory.set(f.category, (byCategory.get(f.category) || 0) + 1);
    }
    for (const [cat, count] of byCategory) {
        lines.push(`- ${cat}: ${count}`);
    }
    lines.push('');
    return lines.join('\n');
}
//# sourceMappingURL=competitive-analyzer.js.map
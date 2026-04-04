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
import { findPhpFiles, findFilesByExt, safeReadFile } from './shared-utils.js';
// ─── Helper: Read all PHP/JS code into one string ─────────────────
function getAllCode(manifest) {
    const phpFiles = findPhpFiles(manifest.pluginPath);
    const jsFiles = findFilesByExt(manifest.pluginPath, '.js');
    const parts = [];
    for (const f of [...phpFiles, ...jsFiles]) {
        parts.push(safeReadFile(f));
    }
    return parts.join('\n');
}
// ─── Detection Helpers ────────────────────────────────────────────
function hasPattern(code, pattern) {
    return pattern.test(code);
}
function hasAny(code, keywords) {
    const lower = code.toLowerCase();
    return keywords.some(k => lower.includes(k.toLowerCase()));
}
function hasHook(manifest, pattern) {
    return manifest.features.hooks.consumed.some(h => pattern.test(h.hookName)) ||
        manifest.features.hooks.provided.some(h => pattern.test(h.hookName));
}
function hasCpt(manifest, pattern) {
    return manifest.features.cpts.some(c => pattern.test(c.postType));
}
function hasTable(manifest, pattern) {
    return manifest.features.dbTables.some(t => pattern.test(t.tableSuffix));
}
function hasAdminPage(manifest, pattern) {
    return manifest.features.adminPages.some(p => pattern.test(p.slug) || pattern.test(p.title));
}
function hasRestRoute(manifest, pattern) {
    return manifest.features.restRoutes.some(r => pattern.test(r.route));
}
function hasAjax(manifest, pattern) {
    return manifest.features.ajaxHandlers.some(h => pattern.test(h.action));
}
// Compound detection: returns 'found' if strong signal, 'partial' if weak signal
function detect(manifest, code, strong, weak) {
    if (strong())
        return 'found';
    if (weak && weak())
        return 'partial';
    return 'not-found';
}
// ─── Category Definitions ─────────────────────────────────────────
const CATEGORIES = [
    // ━━━ COMMUNITY PLATFORM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'community',
        name: 'Community Platform',
        description: 'Social networking, forums, groups, activity feeds',
        industryLeaders: ['Discourse', 'Circle', 'Mighty Networks', 'Tribe', 'Discord', 'Slack'],
        detectionSignals: [
            'buddypress', 'bbpress', 'community', 'social', 'forum', 'activity',
            'member', 'friend', 'follow', 'group', 'bp_', 'bbp_', 'profile',
            'activity_stream', 'social_network', 'user_profile',
        ],
        features: [
            {
                name: 'User Profiles',
                importance: 'must-have',
                description: 'Rich user profiles with avatar, bio, custom fields, activity history',
                industryReference: 'Circle, Mighty Networks, Discord all have rich profiles with customizable fields',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['profile', 'bp_member', 'user_profile', 'xprofile', 'member_profile']), () => hasAny(code, ['get_avatar', 'author_meta'])),
            },
            {
                name: 'Activity Feed',
                importance: 'must-have',
                description: 'Chronological or algorithmic feed of community activity',
                industryReference: 'Every community platform (Circle, Discourse, Facebook Groups) has an activity stream',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['activity', 'bp_activity', 'activity_stream', 'newsfeed', 'timeline']), () => hasCpt(m, /activity|feed|stream/)),
            },
            {
                name: 'Groups / Spaces',
                importance: 'must-have',
                description: 'Sub-communities where users can organize around topics or interests',
                industryReference: 'Circle has Spaces, Mighty Networks has Groups, Discord has Channels/Categories',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['bp_group', 'groups_create', 'group_id', 'create_group']), () => hasCpt(m, /group|space|community|circle/)),
            },
            {
                name: 'Private Messaging',
                importance: 'must-have',
                description: 'Direct messages between members, group chats',
                industryReference: 'Discord DMs, Circle DMs, Mighty Networks messaging — expected by 95%+ of users',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['bp_message', 'messages_new', 'direct_message', 'private_message', 'inbox']), () => hasTable(m, /message|conversation|inbox/)),
            },
            {
                name: 'Notifications',
                importance: 'must-have',
                description: 'In-app + email notifications for mentions, replies, likes, group invites',
                industryReference: 'Every platform has multi-channel notifications. Users expect real-time alerts',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['bp_notification', 'notification', 'notify', 'alert_user']), () => hasAny(code, ['wp_mail', 'email_notification'])),
            },
            {
                name: 'Friend / Follow System',
                importance: 'should-have',
                description: 'Ability to connect with or follow other members',
                industryReference: 'Twitter/X follow model or Facebook friend model. Most community platforms support both',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['bp_friend', 'follow', 'friend_request', 'connection']), () => hasTable(m, /friend|follow|connection/)),
            },
            {
                name: 'Content Moderation',
                importance: 'must-have',
                description: 'Report, flag, review, approve/reject content. Auto-moderation rules',
                industryReference: 'Discourse has trust levels + auto-moderation, Circle has admin tools, Discord has bots',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['moderat', 'report_content', 'flag_', 'spam_', 'bp_moderation']), () => hasAny(code, ['approve', 'reject', 'pending_review'])),
            },
            {
                name: 'Search & Discovery',
                importance: 'should-have',
                description: 'Search members, content, groups. Discovery recommendations',
                industryReference: 'Circle has search across all content types. Discourse has full-text search with filters',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['member_search', 'search_member', 'member_directory', 'user_search']), () => hasAny(code, ['WP_User_Query', 'get_users'])),
            },
            {
                name: 'Reactions / Likes',
                importance: 'should-have',
                description: 'Like, upvote, react to content with emoji or buttons',
                industryReference: 'Discourse has likes, Circle has reactions, Discord has emoji reactions',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['like', 'reaction', 'favorite', 'upvote', 'bp_activity_add_user_favorite']), () => hasTable(m, /like|reaction|favorite|vote/)),
            },
            {
                name: 'Mentions / Tagging',
                importance: 'should-have',
                description: '@mention users in posts and comments',
                industryReference: 'Universal across all community platforms — Slack, Discord, Circle all support @mentions',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['mention', '@mention', 'at_mention', 'bp_activity_at_name'])),
            },
            {
                name: 'Media Sharing',
                importance: 'should-have',
                description: 'Upload and share photos, videos, files within the community',
                industryReference: 'Instagram-like media in Circle/Mighty Networks. Discord file sharing. Essential for engagement',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['media_upload', 'bp_media', 'photo_upload', 'video_upload', 'gallery']), () => hasAny(code, ['wp_handle_upload', 'media_handle_upload'])),
            },
            {
                name: 'Email Digests',
                importance: 'should-have',
                description: 'Daily/weekly email summaries of community activity to re-engage users',
                industryReference: 'Discourse sends excellent digest emails. Circle has configurable email frequency',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['digest', 'email_digest', 'summary_email', 'weekly_email']), () => hasAny(code, ['wp_cron', 'schedule_event']) && hasAny(code, ['wp_mail'])),
            },
            {
                name: 'Mobile Responsive / App',
                importance: 'must-have',
                description: 'Fully responsive UI or native mobile app. 60%+ of social traffic is mobile',
                industryReference: 'Circle, Mighty Networks, Discord all have native mobile apps. Discourse is fully responsive',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['mobile', 'responsive', 'app_api', 'push_notification', 'pwa']), () => hasAny(code, ['wp_is_mobile', 'viewport', '@media'])),
            },
            {
                name: 'SSO / Social Login',
                importance: 'should-have',
                description: 'Login with Google, Facebook, Apple, or enterprise SSO',
                industryReference: 'Every modern platform supports social login. Circle, Mighty Networks, Discourse all have SSO',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['social_login', 'sso', 'oauth', 'google_login', 'facebook_login']), () => hasAny(code, ['authenticate', 'login_form'])),
            },
            {
                name: 'Onboarding / Welcome Flow',
                importance: 'should-have',
                description: 'Guided experience for new members: profile setup, group suggestions, intro post',
                industryReference: 'Circle has welcome spaces, Mighty Networks has guided setup, Discord has onboarding screens',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['onboarding', 'welcome', 'first_login', 'setup_wizard', 'getting_started']), () => hasAny(code, ['new_member', 'registration_complete'])),
            },
        ],
    },
    // ━━━ E-COMMERCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'e-commerce',
        name: 'E-Commerce',
        description: 'Online store, product catalog, checkout, payments',
        industryLeaders: ['Shopify', 'Gumroad', 'Lemon Squeezy', 'BigCommerce', 'Stripe', 'Square'],
        detectionSignals: [
            'woocommerce', 'product', 'cart', 'checkout', 'payment', 'order',
            'shop', 'store', 'edd_', 'easy_digital', 'purchase', 'price',
            'add_to_cart', 'wc_', 'inventory', 'shipping',
        ],
        features: [
            {
                name: 'Product Catalog',
                importance: 'must-have',
                description: 'Browsable product listings with categories, search, and filtering',
                industryReference: 'Shopify has collections/tags/filters. Amazon-level browsing expected',
                detection: (m, code) => detect(m, code, () => hasCpt(m, /product|download/) || hasAny(code, ['wc_get_products', 'edd_get_download']), () => hasAny(code, ['product', 'catalog', 'shop'])),
            },
            {
                name: 'Shopping Cart',
                importance: 'must-have',
                description: 'Add to cart, update quantities, remove items, cart persistence',
                industryReference: 'Shopify, Amazon — persistent cart, mini-cart, cart abandonment recovery',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['add_to_cart', 'cart_item', 'WC_Cart', 'edd_add_to_cart', 'shopping_cart'])),
            },
            {
                name: 'Secure Checkout',
                importance: 'must-have',
                description: 'Multi-step or single-page checkout with address, payment, confirmation',
                industryReference: 'Shopify checkout converts at 2x industry average. Single-page checkout trending',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['checkout', 'woocommerce_checkout', 'edd_checkout', 'payment_form'])),
            },
            {
                name: 'Payment Processing',
                importance: 'must-have',
                description: 'Credit card, PayPal, Apple Pay, Google Pay, buy-now-pay-later',
                industryReference: 'Shopify Payments, Stripe, PayPal — customers expect 3+ payment options',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['payment_gateway', 'stripe', 'paypal', 'process_payment', 'WC_Payment_Gateway']), () => hasAny(code, ['payment', 'pay_', 'charge'])),
            },
            {
                name: 'Order Management',
                importance: 'must-have',
                description: 'Order status tracking, fulfillment, order notes, admin order management',
                industryReference: 'Shopify has detailed order timeline. Customers expect tracking updates',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['order_status', 'wc_order', 'edd_payment', 'order_complete', 'fulfillment']), () => hasCpt(m, /order|payment/)),
            },
            {
                name: 'Customer Accounts',
                importance: 'must-have',
                description: 'Registration, order history, saved addresses, wishlist, account management',
                industryReference: 'Amazon, Shopify — full customer portal with order history and reordering',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['my_account', 'customer_account', 'order_history', 'woocommerce_account']), () => hasAny(code, ['wp_login', 'user_register'])),
            },
            {
                name: 'Email Notifications',
                importance: 'must-have',
                description: 'Order confirmation, shipping updates, abandoned cart, review requests',
                industryReference: 'Shopify sends 10+ transactional email types. Abandoned cart emails recover 5-10% of sales',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['WC_Email', 'edd_email', 'order_email', 'order_confirmation']), () => hasAny(code, ['wp_mail', 'email_notification'])),
            },
            {
                name: 'Coupons & Discounts',
                importance: 'should-have',
                description: 'Percentage/fixed discounts, coupon codes, bulk pricing, sales',
                industryReference: 'Every e-commerce platform has promotions. Shopify has automatic discounts',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['coupon', 'discount', 'WC_Coupon', 'edd_discount', 'promo_code'])),
            },
            {
                name: 'Reviews & Ratings',
                importance: 'should-have',
                description: 'Customer product reviews with star ratings, verified purchase badges',
                industryReference: 'Amazon reviews drive 90% of purchase decisions. Shopify has built-in reviews',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['product_review', 'woocommerce_review', 'star_rating', 'review_form']), () => hasAny(code, ['comment', 'rating'])),
            },
            {
                name: 'Inventory Management',
                importance: 'should-have',
                description: 'Stock tracking, low stock alerts, backorder handling',
                industryReference: 'Shopify has real-time inventory sync across channels. Essential for physical goods',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['stock', 'inventory', 'manage_stock', 'backorder', 'out_of_stock'])),
            },
            {
                name: 'Shipping & Tax',
                importance: 'should-have',
                description: 'Shipping rate calculation, tax management, shipping zones',
                industryReference: 'Shopify has automatic tax calculation in 100+ countries. Real-time shipping rates',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['shipping_rate', 'tax_rate', 'WC_Shipping', 'shipping_zone', 'calculate_tax']), () => hasAny(code, ['shipping', 'tax'])),
            },
            {
                name: 'Analytics & Reports',
                importance: 'should-have',
                description: 'Sales reports, revenue tracking, conversion funnel, customer analytics',
                industryReference: 'Shopify Analytics, Gumroad dashboard — sellers expect revenue dashboards',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['sales_report', 'revenue', 'analytics', 'wc_admin_report', 'order_report']), () => hasAdminPage(m, /report|analytic|dashboard/)),
            },
            {
                name: 'Search & Filtering',
                importance: 'should-have',
                description: 'Product search with faceted filtering by price, category, attributes',
                industryReference: 'Amazon-style faceted search. Shopify has smart search with suggestions',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['product_search', 'facet', 'filter_product', 'price_filter', 'layered_nav']), () => hasAny(code, ['search', 'filter'])),
            },
            {
                name: 'Multi-Currency',
                importance: 'nice-to-have',
                description: 'Display prices in customer currency, automatic conversion',
                industryReference: 'Shopify Markets handles multi-currency. Gumroad shows local currency automatically',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['multi_currency', 'currency_switch', 'exchange_rate', 'geolocation_currency'])),
            },
        ],
    },
    // ━━━ LEARNING MANAGEMENT SYSTEM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'lms',
        name: 'Learning Management System',
        description: 'Online courses, lessons, quizzes, student management',
        industryLeaders: ['Teachable', 'Thinkific', 'Kajabi', 'Udemy', 'Coursera', 'Podia'],
        detectionSignals: [
            'learndash', 'course', 'lesson', 'quiz', 'student', 'instructor',
            'enrollment', 'certificate', 'lms', 'tutor', 'lifter', 'sensei',
            'curriculum', 'module', 'assignment', 'grade',
        ],
        features: [
            {
                name: 'Course Builder',
                importance: 'must-have',
                description: 'Create and organize courses with modules, lessons, and sections',
                industryReference: 'Teachable has drag-drop course builder. Thinkific has curriculum editor. Kajabi has pipeline builder',
                detection: (m, code) => detect(m, code, () => hasCpt(m, /course|lesson|module/) || hasAny(code, ['course_builder', 'create_course', 'ld_course']), () => hasAny(code, ['course', 'curriculum'])),
            },
            {
                name: 'Quizzes & Assessments',
                importance: 'must-have',
                description: 'Multiple question types, auto-grading, passing scores, retakes',
                industryReference: 'Teachable has 3 quiz types. Thinkific has assignments. Kajabi has assessments',
                detection: (m, code) => detect(m, code, () => hasCpt(m, /quiz|exam|assessment/) || hasAny(code, ['quiz', 'question_type', 'grading']), () => hasAny(code, ['answer', 'score', 'test'])),
            },
            {
                name: 'Progress Tracking',
                importance: 'must-have',
                description: 'Track lesson completion, course progress %, resume where left off',
                industryReference: 'Netflix-like progress bars. Udemy shows exact completion %. Coursera has weekly goals',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['progress', 'completion', 'mark_complete', 'lesson_complete', 'course_progress']), () => hasTable(m, /progress|completion|activity/)),
            },
            {
                name: 'Certificates',
                importance: 'should-have',
                description: 'Auto-generated completion certificates with student name, date, course',
                industryReference: 'Coursera/Udemy certificates are LinkedIn-shareable. Teachable has built-in certificates',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['certificate', 'cert_', 'completion_cert', 'generate_certificate'])),
            },
            {
                name: 'Student Dashboard',
                importance: 'must-have',
                description: 'My courses, progress overview, upcoming lessons, achievements',
                industryReference: 'Every LMS platform has a student dashboard. Teachable, Thinkific, Kajabi all have one',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['student_dashboard', 'my_courses', 'learner_dashboard', 'enrolled_courses']), () => hasAdminPage(m, /dashboard|my.course|student/)),
            },
            {
                name: 'Drip Content',
                importance: 'should-have',
                description: 'Release lessons on a schedule — daily, weekly, or days after enrollment',
                industryReference: 'Teachable, Kajabi, Thinkific all have drip scheduling. Prevents binge-and-refund',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['drip', 'schedule_lesson', 'timed_content', 'content_release'])),
            },
            {
                name: 'Payment & Subscriptions',
                importance: 'must-have',
                description: 'One-time purchase, subscription, payment plans, free trials',
                industryReference: 'Teachable takes 0-5% transaction fee. Kajabi has built-in payments. Multiple price points',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['enrollment', 'purchase_course', 'subscription', 'payment_plan', 'edd_', 'wc_']), () => hasAny(code, ['price', 'payment', 'buy'])),
            },
            {
                name: 'Discussion / Q&A',
                importance: 'should-have',
                description: 'Per-lesson comments, Q&A threads, instructor responses',
                industryReference: 'Udemy has Q&A per lecture. Teachable has comments. Coursera has discussion forums',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['lesson_comment', 'course_discussion', 'qa_', 'lesson_discussion']), () => hasAny(code, ['comment', 'discussion', 'forum'])),
            },
            {
                name: 'Email Automation',
                importance: 'should-have',
                description: 'Welcome emails, lesson reminders, completion congrats, abandoned cart',
                industryReference: 'Kajabi has built-in email marketing. Teachable sends auto-emails. Critical for completion rates',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['enrollment_email', 'course_email', 'reminder_email', 'drip_email']), () => hasAny(code, ['wp_mail']) && hasAny(code, ['enroll', 'course'])),
            },
            {
                name: 'Instructor Tools',
                importance: 'should-have',
                description: 'Multi-instructor support, instructor dashboard, revenue sharing',
                industryReference: 'Udemy is multi-instructor. Teachable supports multiple authors. Revenue split is expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['instructor', 'teacher', 'author_course', 'instructor_dashboard'])),
            },
            {
                name: 'Video Hosting / Player',
                importance: 'must-have',
                description: 'Video lessons with player controls, speed adjustment, resume playback',
                industryReference: 'Teachable/Thinkific have built-in video hosting. Wistia-like players expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['video_player', 'video_lesson', 'vimeo', 'wistia', 'video_progress']), () => hasAny(code, ['video', 'embed', 'iframe'])),
            },
        ],
    },
    // ━━━ MEMBERSHIP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'membership',
        name: 'Membership',
        description: 'Content restriction, membership levels, recurring payments',
        industryLeaders: ['Patreon', 'Memberful', 'MemberPress', 'Substack', 'Ghost'],
        detectionSignals: [
            'membership', 'restrict', 'access_level', 'member_', 'subscription',
            'paywall', 'gated', 'mepr_', 'pmpro_', 'rcp_', 'swpm_',
            'content_restrict', 'protected_content', 'membership_level',
        ],
        features: [
            {
                name: 'Content Restriction',
                importance: 'must-have',
                description: 'Lock posts, pages, categories, or custom content behind membership',
                industryReference: 'Patreon tiers, Substack paid posts, Ghost member-only content. Core feature',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['restrict', 'protect_content', 'access_level', 'content_restriction', 'mepr_rule']), () => hasAny(code, ['current_user_can', 'is_member'])),
            },
            {
                name: 'Membership Levels / Tiers',
                importance: 'must-have',
                description: 'Multiple membership plans with different access and pricing',
                industryReference: 'Patreon has unlimited tiers. Ghost has free/paid. Memberful has multiple plans',
                detection: (m, code) => detect(m, code, () => hasCpt(m, /membership|level|plan|tier/) || hasAny(code, ['membership_level', 'membership_plan', 'tier']), () => hasAny(code, ['level', 'plan', 'membership'])),
            },
            {
                name: 'Recurring Payments',
                importance: 'must-have',
                description: 'Monthly/yearly billing with automatic renewal, failed payment handling',
                industryReference: 'Stripe subscriptions, PayPal recurring. Every membership platform handles this',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['subscription', 'recurring', 'renewal', 'stripe_subscription', 'billing_cycle']), () => hasAny(code, ['payment', 'subscribe'])),
            },
            {
                name: 'Registration / Login',
                importance: 'must-have',
                description: 'Custom registration form, login page, password reset, account management',
                industryReference: 'Branded registration flow. Patreon, Ghost, Memberful all have custom signup',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['registration_form', 'login_form', 'member_register', 'signup_form']), () => hasAny(code, ['wp_login', 'register', 'login'])),
            },
            {
                name: 'Content Teaser / Preview',
                importance: 'should-have',
                description: 'Show excerpt or partial content to non-members with upgrade CTA',
                industryReference: 'Medium paywall shows first paragraphs. Substack shows preview. Converts free to paid',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['teaser', 'excerpt_restrict', 'content_preview', 'paywall_preview']), () => hasAny(code, ['the_excerpt', 'more_tag'])),
            },
            {
                name: 'Trial Periods',
                importance: 'should-have',
                description: 'Free trial for X days before charging, with auto-conversion',
                industryReference: 'Netflix 30-day trial model. Kajabi, Teachable offer free trials. Increases conversions 2-3x',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['trial', 'free_trial', 'trial_period', 'trial_days'])),
            },
            {
                name: 'Member Directory',
                importance: 'nice-to-have',
                description: 'Searchable list of members with profiles',
                industryReference: 'Mighty Networks has member directory. Professional associations expect this',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['member_directory', 'members_list', 'user_directory'])),
            },
            {
                name: 'Cancellation & Refund Handling',
                importance: 'should-have',
                description: 'Self-service cancellation, prorated refunds, win-back flows',
                industryReference: 'Stripe handles proration. Patreon allows instant cancel. Users expect self-service',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['cancel_subscription', 'cancellation', 'refund', 'downgrade']), () => hasAny(code, ['cancel', 'unsubscribe'])),
            },
        ],
    },
    // ━━━ FORMS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'forms',
        name: 'Forms & Surveys',
        description: 'Form builder, contact forms, surveys, data collection',
        industryLeaders: ['Typeform', 'JotForm', 'Google Forms', 'Tally', 'SurveyMonkey'],
        detectionSignals: [
            'form', 'field', 'submission', 'contact_form', 'gravity', 'wpforms',
            'ninja_forms', 'formidable', 'cf7', 'wpcf7', 'survey', 'input_field',
        ],
        features: [
            {
                name: 'Visual Form Builder',
                importance: 'must-have',
                description: 'Drag-and-drop or visual interface for creating forms without code',
                industryReference: 'Typeform, JotForm, Google Forms — all are visual builders. Zero code expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['form_builder', 'drag_drop', 'field_type', 'add_field', 'form_editor']), () => hasAdminPage(m, /form|builder|editor/)),
            },
            {
                name: 'Multiple Field Types',
                importance: 'must-have',
                description: 'Text, email, number, select, checkbox, radio, file upload, date, phone',
                industryReference: 'Typeform has 20+ field types. JotForm has 100+. Users expect at least 10 basic types',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['field_type', 'text_field', 'email_field', 'select_field', 'checkbox_field']), () => hasAny(code, ['input', 'textarea', 'select'])),
            },
            {
                name: 'Email Notifications',
                importance: 'must-have',
                description: 'Send email on submission to admin and/or submitter with form data',
                industryReference: 'Every form tool sends email notifications. Auto-responders expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['form_notification', 'submission_email', 'form_email', 'auto_responder']), () => hasAny(code, ['wp_mail'])),
            },
            {
                name: 'Spam Protection',
                importance: 'must-have',
                description: 'CAPTCHA, honeypot, rate limiting, Akismet integration',
                industryReference: 'Google reCAPTCHA is standard. Tally has built-in spam protection. Essential for public forms',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['captcha', 'recaptcha', 'honeypot', 'akismet', 'antispam']), () => hasAny(code, ['spam', 'bot_check'])),
            },
            {
                name: 'Conditional Logic',
                importance: 'should-have',
                description: 'Show/hide fields based on previous answers',
                industryReference: 'Typeform is built on conditional logic. JotForm, Gravity Forms all support it',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['conditional', 'condition_logic', 'show_if', 'hide_if', 'conditional_field'])),
            },
            {
                name: 'Submission Management',
                importance: 'should-have',
                description: 'View, search, filter, export submissions in admin',
                industryReference: 'JotForm has full submission viewer. Google Forms has Sheets integration. Users expect admin access',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['form_entry', 'submission_list', 'entry_view', 'form_submission']), () => hasTable(m, /entry|submission|form_data/)),
            },
            {
                name: 'File Uploads',
                importance: 'should-have',
                description: 'Allow file/image uploads with size/type restrictions',
                industryReference: 'JotForm, Typeform, Google Forms all support file uploads. Essential for applications/support',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['file_upload', 'upload_field', 'file_input', 'allowed_file_types']), () => hasAny(code, ['wp_handle_upload', 'multipart'])),
            },
            {
                name: 'Multi-Page / Multi-Step',
                importance: 'nice-to-have',
                description: 'Break long forms into multiple pages with progress indicator',
                industryReference: 'Typeform is one-question-at-a-time. JotForm has page breaks. Improves completion rates',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['multi_page', 'page_break', 'multi_step', 'form_step', 'wizard'])),
            },
            {
                name: 'Export / Integration',
                importance: 'should-have',
                description: 'CSV export, Zapier, Mailchimp, Google Sheets integration',
                industryReference: 'Typeform connects to 500+ apps. JotForm has 100+ integrations. Data must flow somewhere',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['export_csv', 'zapier', 'mailchimp', 'integration', 'webhook']), () => hasAny(code, ['export', 'csv', 'webhook'])),
            },
        ],
    },
    // ━━━ SEO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'seo',
        name: 'SEO Tool',
        description: 'Search engine optimization, meta tags, sitemaps, schema',
        industryLeaders: ['Ahrefs', 'SEMrush', 'Moz', 'Surfer SEO', 'Screaming Frog'],
        detectionSignals: [
            'seo', 'meta_description', 'meta_title', 'sitemap', 'schema',
            'rankmath', 'yoast', 'canonical', 'breadcrumb', 'og_', 'open_graph',
            'search_engine', 'keyword', 'robots_txt',
        ],
        features: [
            {
                name: 'Meta Title & Description',
                importance: 'must-have',
                description: 'Edit SEO title and meta description per page/post with preview',
                industryReference: 'Yoast, RankMath, Ahrefs — Google snippet preview is expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['meta_title', 'meta_description', 'seo_title', 'wpseo_title', 'rank_math']), () => hasAny(code, ['title', 'description', 'meta'])),
            },
            {
                name: 'XML Sitemap',
                importance: 'must-have',
                description: 'Auto-generated XML sitemap with all public content',
                industryReference: 'Every SEO tool generates sitemaps. Google expects sitemap.xml. Essential for indexing',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['sitemap', 'xml_sitemap', 'sitemap_xml', 'sitemap_index'])),
            },
            {
                name: 'Schema / Structured Data',
                importance: 'must-have',
                description: 'JSON-LD schema markup for rich snippets (Article, Product, FAQ, Review, etc.)',
                industryReference: 'Google rich results require schema. RankMath has 20+ schema types. Ahrefs audits schema',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['schema', 'json_ld', 'structured_data', 'rich_snippet']), () => hasAny(code, ['application/ld+json', 'itemtype'])),
            },
            {
                name: 'Content Analysis',
                importance: 'should-have',
                description: 'Real-time SEO scoring as you write: keyword density, readability, heading structure',
                industryReference: 'Yoast traffic light system. Surfer SEO content editor. RankMath has content AI',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['content_analysis', 'seo_score', 'readability', 'keyword_density', 'focus_keyword'])),
            },
            {
                name: 'Social Media Cards',
                importance: 'should-have',
                description: 'Open Graph and Twitter Card meta tags with image preview',
                industryReference: 'Facebook, Twitter, LinkedIn all read OG tags. Users expect social preview control',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['og:', 'open_graph', 'twitter:card', 'og_image', 'social_meta']), () => hasAny(code, ['og_', 'twitter_'])),
            },
            {
                name: 'Redirect Management',
                importance: 'should-have',
                description: '301/302 redirect manager, automatic 404 → redirect suggestions',
                industryReference: 'Screaming Frog finds broken links. RankMath/Yoast have redirect managers. Prevents traffic loss',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['redirect', '301_redirect', 'redirect_manager', 'wp_redirect'])),
            },
            {
                name: 'Breadcrumbs',
                importance: 'nice-to-have',
                description: 'Navigation breadcrumbs with schema markup',
                industryReference: 'Yoast breadcrumbs are widely used. Google shows breadcrumbs in search results',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['breadcrumb', 'bread_crumb', 'BreadcrumbList'])),
            },
        ],
    },
    // ━━━ BOOKING / APPOINTMENTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'booking',
        name: 'Booking & Appointments',
        description: 'Scheduling, calendar, appointment booking, reservations',
        industryLeaders: ['Calendly', 'Acuity', 'Square Appointments', 'SimplyBook.me', 'Cal.com'],
        detectionSignals: [
            'booking', 'appointment', 'calendar', 'schedule', 'reservation',
            'time_slot', 'availability', 'booking_form', 'event_booking',
        ],
        features: [
            {
                name: 'Calendar / Schedule View',
                importance: 'must-have',
                description: 'Visual calendar showing available and booked time slots',
                industryReference: 'Calendly, Cal.com — clean calendar UI is the entire product. Users expect month/week/day views',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['calendar', 'fullcalendar', 'calendar_view', 'schedule_view', 'datepicker']), () => hasAny(code, ['date', 'schedule'])),
            },
            {
                name: 'Time Slot Management',
                importance: 'must-have',
                description: 'Define available hours, buffer times between appointments, lunch breaks',
                industryReference: 'Calendly has availability windows with buffer. Acuity has business hours settings',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['time_slot', 'availability', 'business_hours', 'available_times', 'buffer_time'])),
            },
            {
                name: 'Online Payments',
                importance: 'should-have',
                description: 'Collect payment at booking time or require deposit',
                industryReference: 'Acuity, Square Appointments collect payment upfront. Reduces no-shows by 50%+',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['booking_payment', 'deposit', 'pay_at_booking', 'stripe', 'paypal']), () => hasAny(code, ['payment', 'price'])),
            },
            {
                name: 'Email Reminders',
                importance: 'must-have',
                description: 'Confirmation email, reminder before appointment, follow-up after',
                industryReference: 'Calendly sends reminders 24h and 1h before. Essential for reducing no-shows',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['reminder', 'booking_email', 'appointment_reminder', 'confirmation_email']), () => hasAny(code, ['wp_mail', 'cron']) && hasAny(code, ['booking', 'appointment'])),
            },
            {
                name: 'Cancellation / Rescheduling',
                importance: 'must-have',
                description: 'Self-service cancel or reschedule with policy enforcement',
                industryReference: 'Calendly allows reschedule from email. Cal.com has cancellation policies. Self-service expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['cancel_booking', 'reschedule', 'cancellation_policy', 'cancel_appointment']), () => hasAny(code, ['cancel', 'reschedule'])),
            },
            {
                name: 'Timezone Handling',
                importance: 'should-have',
                description: 'Auto-detect customer timezone, show times in their local time',
                industryReference: 'Calendly auto-detects timezone. Cal.com shows local time. Critical for global businesses',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['timezone', 'time_zone', 'wp_timezone', 'Intl.DateTimeFormat'])),
            },
            {
                name: 'Staff / Resource Management',
                importance: 'should-have',
                description: 'Multiple staff members with individual calendars and services',
                industryReference: 'Acuity, Square Appointments support multiple providers. Salon/clinic essential feature',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['staff', 'provider', 'resource', 'employee_calendar', 'staff_member'])),
            },
        ],
    },
    // ━━━ MARKETPLACE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'marketplace',
        name: 'Marketplace',
        description: 'Multi-vendor marketplace, vendor management, commissions',
        industryLeaders: ['Etsy', 'Amazon Marketplace', 'Fiverr', 'Airbnb', 'Uber'],
        detectionSignals: [
            'vendor', 'marketplace', 'multi_vendor', 'commission', 'dokan',
            'wcfm', 'multivendor', 'seller', 'payout', 'vendor_dashboard',
            'store_front', 'vendor_registration',
        ],
        features: [
            {
                name: 'Vendor Registration',
                importance: 'must-have',
                description: 'Vendors can sign up, submit application, get approved/rejected',
                industryReference: 'Etsy, Amazon — vendor onboarding with verification. Application review process',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['vendor_register', 'seller_signup', 'vendor_application', 'become_vendor']), () => hasAny(code, ['vendor', 'seller'])),
            },
            {
                name: 'Vendor Dashboard',
                importance: 'must-have',
                description: 'Vendor-specific panel: products, orders, earnings, analytics',
                industryReference: 'Etsy seller dashboard, Amazon Seller Central. Vendors need their own control panel',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['vendor_dashboard', 'seller_dashboard', 'vendor_panel', 'store_manager']), () => hasAdminPage(m, /vendor|seller|store/)),
            },
            {
                name: 'Commission Management',
                importance: 'must-have',
                description: 'Percentage or flat fee per sale, configurable per vendor/category',
                industryReference: 'Etsy takes 6.5%, Amazon 8-15%, Fiverr 20%. Commission is the business model',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['commission', 'vendor_commission', 'commission_rate', 'earning']), () => hasTable(m, /commission|earning|payout/)),
            },
            {
                name: 'Payout Management',
                importance: 'must-have',
                description: 'Automated or manual payouts to vendors via PayPal, Stripe Connect, bank transfer',
                industryReference: 'Stripe Connect handles marketplace payouts. Etsy deposits biweekly. Vendors expect reliable payouts',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['payout', 'withdraw', 'vendor_payment', 'disbursement', 'stripe_connect'])),
            },
            {
                name: 'Vendor Store Pages',
                importance: 'should-have',
                description: 'Each vendor gets a branded store page with their products',
                industryReference: 'Etsy shop pages, Amazon storefronts. Vendors want their own brand presence',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['store_page', 'vendor_store', 'seller_page', 'store_url', 'storefront'])),
            },
            {
                name: 'Reviews Per Vendor',
                importance: 'should-have',
                description: 'Customers can rate vendors separately from products',
                industryReference: 'Etsy has seller reviews, Airbnb has host ratings. Trust signals for multi-vendor',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['vendor_review', 'seller_rating', 'store_review', 'vendor_feedback'])),
            },
            {
                name: 'Order Splitting',
                importance: 'should-have',
                description: 'Single cart checkout splits orders to multiple vendors automatically',
                industryReference: 'Amazon handles multi-vendor orders seamlessly. Customers expect unified checkout',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['sub_order', 'split_order', 'vendor_order', 'order_split'])),
            },
        ],
    },
    // ━━━ DIRECTORY / LISTING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'directory',
        name: 'Directory & Listings',
        description: 'Business directory, classified ads, property listings',
        industryLeaders: ['Yelp', 'Google Maps', 'Zillow', 'TripAdvisor', 'Craigslist'],
        detectionSignals: [
            'directory', 'listing', 'classified', 'business_directory', 'property',
            'geodirectory', 'listify', 'real_estate', 'job_listing', 'event_listing',
            'location', 'map', 'claim_listing',
        ],
        features: [
            {
                name: 'Listing Submission',
                importance: 'must-have',
                description: 'Frontend form for users to submit listings with details and images',
                industryReference: 'Yelp business claim, Google My Business, Zillow listing submission. Self-service expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['submit_listing', 'add_listing', 'listing_form', 'frontend_submit']), () => hasCpt(m, /listing|business|property|job|event/)),
            },
            {
                name: 'Search & Filtering',
                importance: 'must-have',
                description: 'Search by location, category, price range, attributes with faceted filtering',
                industryReference: 'Zillow filters, Yelp search, TripAdvisor filters. Core discovery mechanism',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['listing_search', 'filter_listing', 'faceted_search', 'location_search']), () => hasAny(code, ['search', 'filter'])),
            },
            {
                name: 'Map Integration',
                importance: 'must-have',
                description: 'Google Maps or OpenStreetMap with pin markers for listings',
                industryReference: 'Yelp, Google Maps, Zillow — map view is expected for location-based directories',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['google_map', 'leaflet', 'mapbox', 'openstreetmap', 'maps_api', 'geocod']), () => hasAny(code, ['latitude', 'longitude', 'lat', 'lng', 'map'])),
            },
            {
                name: 'Reviews & Ratings',
                importance: 'must-have',
                description: 'User reviews with star ratings for each listing',
                industryReference: 'Yelp stars, Google reviews, TripAdvisor reviews. Directories without reviews have no value',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['listing_review', 'star_rating', 'review_form', 'rating_score']), () => hasAny(code, ['review', 'rating', 'stars'])),
            },
            {
                name: 'Categories & Tags',
                importance: 'must-have',
                description: 'Hierarchical categories and tags for organizing listings',
                industryReference: 'Yelp has 1000+ categories. Every directory needs organized taxonomy',
                detection: (m, code) => detect(m, code, () => m.features.taxonomies.length > 0, () => hasAny(code, ['category', 'tag'])),
            },
            {
                name: 'Claim / Verify Listing',
                importance: 'should-have',
                description: 'Business owners can claim and manage their listing',
                industryReference: 'Google My Business verification, Yelp business claim. Ensures data accuracy',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['claim_listing', 'verify_listing', 'owner_claim', 'claim_business'])),
            },
            {
                name: 'Featured / Promoted Listings',
                importance: 'should-have',
                description: 'Paid placement, featured badges, sticky listings for monetization',
                industryReference: 'Yelp ads, Zillow premier agent. Primary monetization for directories',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['featured_listing', 'promote', 'sticky_listing', 'sponsored'])),
            },
        ],
    },
    // ━━━ BACKUP & SECURITY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'backup-security',
        name: 'Backup & Security',
        description: 'Website backup, malware scanning, firewall, login protection',
        industryLeaders: ['Cloudflare', 'Sucuri', 'Wordfence', 'Jetpack', 'UpdraftPlus', 'BlogVault'],
        detectionSignals: [
            'backup', 'security', 'firewall', 'malware', 'scan', 'wordfence',
            'sucuri', 'ithemes', 'brute_force', 'two_factor', '2fa', 'login_protect',
            'file_integrity', 'vulnerability',
        ],
        features: [
            {
                name: 'Scheduled Backups',
                importance: 'must-have',
                description: 'Automatic daily/weekly backups of files and database',
                industryReference: 'UpdraftPlus, BlogVault, Jetpack — auto backups are the core product',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['backup_schedule', 'create_backup', 'database_backup', 'file_backup']), () => hasAny(code, ['backup', 'wp_cron']) && hasAny(code, ['zip', 'tar', 'mysqldump'])),
            },
            {
                name: 'One-Click Restore',
                importance: 'must-have',
                description: 'Restore from any backup point with a single click',
                industryReference: 'BlogVault, Jetpack offer one-click restore. Users expect easy recovery',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['restore_backup', 'one_click_restore', 'rollback', 'restore_point'])),
            },
            {
                name: 'Malware Scanning',
                importance: 'must-have',
                description: 'Scan files for known malware signatures, backdoors, code injections',
                industryReference: 'Wordfence, Sucuri, Patchstack — malware scanning is expected. Real-time protection',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['malware_scan', 'scan_file', 'malware_signature', 'file_integrity']), () => hasAny(code, ['scan', 'malware', 'infected'])),
            },
            {
                name: 'Firewall / WAF',
                importance: 'should-have',
                description: 'Application-level firewall blocking common attack patterns',
                industryReference: 'Cloudflare WAF, Wordfence firewall, Sucuri WAF — blocks 99% of automated attacks',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['firewall', 'waf', 'block_ip', 'ip_blacklist', 'rule_engine'])),
            },
            {
                name: 'Login Protection',
                importance: 'should-have',
                description: 'Brute force protection, login lockout, 2FA',
                industryReference: 'Every security plugin has login protection. Two-factor is increasingly expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['brute_force', 'login_lockout', 'two_factor', '2fa', 'login_attempt']), () => hasAny(code, ['failed_login', 'lock', 'limit_login'])),
            },
            {
                name: 'Cloud Storage',
                importance: 'should-have',
                description: 'Store backups off-site: S3, Google Drive, Dropbox',
                industryReference: 'UpdraftPlus connects to 10+ cloud services. Off-site backups are critical for disaster recovery',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['s3_bucket', 'google_drive', 'dropbox', 'remote_storage', 'cloud_backup'])),
            },
            {
                name: 'Activity Logging',
                importance: 'should-have',
                description: 'Log all admin actions: logins, changes, updates for audit trail',
                industryReference: 'WP Activity Log, Sucuri audit log. Essential for multi-admin sites and compliance',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['activity_log', 'audit_log', 'log_action', 'user_activity']), () => hasTable(m, /log|audit|activity/)),
            },
        ],
    },
    // ━━━ EMAIL MARKETING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'email-marketing',
        name: 'Email Marketing',
        description: 'Newsletter, email campaigns, subscriber management, automation',
        industryLeaders: ['Mailchimp', 'ConvertKit', 'Klaviyo', 'Brevo', 'ActiveCampaign'],
        detectionSignals: [
            'newsletter', 'email_campaign', 'subscriber', 'mailchimp', 'convertkit',
            'email_list', 'opt_in', 'email_marketing', 'campaign', 'autoresponder',
            'email_template', 'broadcast', 'drip_campaign',
        ],
        features: [
            {
                name: 'Subscriber Management',
                importance: 'must-have',
                description: 'Add, import, segment, tag subscribers. Manage lists',
                industryReference: 'Mailchimp lists, ConvertKit tags, ActiveCampaign contacts. Foundation of email marketing',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['subscriber', 'email_list', 'add_subscriber', 'subscriber_list']), () => hasTable(m, /subscriber|email_list|newsletter/)),
            },
            {
                name: 'Opt-in Forms',
                importance: 'must-have',
                description: 'Signup forms: popup, inline, slide-in, after post',
                industryReference: 'ConvertKit forms, Mailchimp popups. Multiple form types for different contexts',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['opt_in', 'signup_form', 'subscribe_form', 'newsletter_form']), () => hasAny(code, ['subscribe', 'signup'])),
            },
            {
                name: 'Email Templates',
                importance: 'must-have',
                description: 'Visual email builder or pre-designed templates',
                industryReference: 'Mailchimp has drag-drop email builder. ConvertKit has clean templates. Visual editing expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['email_template', 'template_builder', 'email_editor', 'newsletter_template'])),
            },
            {
                name: 'Campaign Analytics',
                importance: 'should-have',
                description: 'Open rates, click rates, unsubscribe rates, bounce rates',
                industryReference: 'Every email platform tracks engagement. Mailchimp, ConvertKit — analytics dashboard expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['open_rate', 'click_rate', 'email_stats', 'campaign_report', 'tracking_pixel']), () => hasAny(code, ['track', 'analytics']) && hasAny(code, ['email', 'campaign'])),
            },
            {
                name: 'Automation / Sequences',
                importance: 'should-have',
                description: 'Automated email sequences triggered by actions (signup, purchase, etc.)',
                industryReference: 'ConvertKit automations, ActiveCampaign workflows. Automation is the killer feature',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['automation', 'sequence', 'drip_campaign', 'autoresponder', 'email_workflow'])),
            },
            {
                name: 'Segmentation',
                importance: 'should-have',
                description: 'Group subscribers by behavior, tags, custom fields for targeted sends',
                industryReference: 'Mailchimp segments, ConvertKit tags. Targeted emails get 2-3x higher engagement',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['segment', 'subscriber_tag', 'email_segment', 'audience_segment'])),
            },
            {
                name: 'GDPR / Unsubscribe',
                importance: 'must-have',
                description: 'One-click unsubscribe, GDPR consent tracking, data export/delete',
                industryReference: 'CAN-SPAM and GDPR require unsubscribe. Every email platform handles this. Legal requirement',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['unsubscribe', 'gdpr', 'consent', 'opt_out', 'privacy_policy']), () => hasAny(code, ['unsubscribe', 'remove_subscriber'])),
            },
        ],
    },
    // ━━━ PAGE BUILDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'page-builder',
        name: 'Page Builder',
        description: 'Visual page builder, drag-and-drop, custom layouts',
        industryLeaders: ['Webflow', 'Squarespace', 'Wix', 'Framer', 'Elementor', 'Divi'],
        detectionSignals: [
            'elementor', 'divi', 'beaver_builder', 'page_builder', 'visual_composer',
            'drag_drop', 'builder', 'widget_area', 'section', 'column', 'layout',
            'template_builder', 'brizy', 'oxygen', 'breakdance',
        ],
        features: [
            {
                name: 'Visual Drag-Drop Editor',
                importance: 'must-have',
                description: 'WYSIWYG drag-and-drop interface for building pages',
                industryReference: 'Webflow, Squarespace, Wix — visual editing is the entire product',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['drag_drop', 'builder_editor', 'visual_editor', 'page_builder', 'live_editor']), () => hasAny(code, ['builder', 'editor', 'sortable'])),
            },
            {
                name: 'Pre-built Templates',
                importance: 'must-have',
                description: 'Library of professionally designed page templates',
                industryReference: 'Squarespace has 100+ templates. Elementor has 300+ templates. Users expect ready-made designs',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['template_library', 'starter_template', 'import_template', 'pre_built'])),
            },
            {
                name: 'Responsive Design Controls',
                importance: 'must-have',
                description: 'Preview and customize for desktop, tablet, mobile with per-device controls',
                industryReference: 'Webflow has per-breakpoint styling. Elementor has responsive controls. Mobile-first expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['responsive', 'breakpoint', 'mobile_editor', 'tablet_view', 'device_preview']), () => hasAny(code, ['responsive', 'mobile', '@media'])),
            },
            {
                name: 'Undo / Redo / Revisions',
                importance: 'should-have',
                description: 'Undo changes, revision history, restore previous versions',
                industryReference: 'Every modern editor has Ctrl+Z. Figma, Webflow, Google Docs — revision history expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['undo', 'redo', 'revision', 'history', 'autosave'])),
            },
            {
                name: 'Global Styles / Theme',
                importance: 'should-have',
                description: 'Global color palette, typography, spacing settings applied site-wide',
                industryReference: 'Webflow has global styles. Squarespace has site-wide fonts/colors. Design consistency',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['global_style', 'global_color', 'site_settings', 'typography_settings', 'design_system']), () => hasAny(code, ['theme_mod', 'customize'])),
            },
            {
                name: 'Custom Widgets / Elements',
                importance: 'should-have',
                description: 'Extensible element library — text, image, video, gallery, form, map, etc.',
                industryReference: 'Elementor has 90+ widgets. Divi has 46 modules. Rich element library differentiates builders',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['register_widget', 'widget_base', 'element_type', 'module_', 'custom_widget']), () => m.features.widgets.length > 0),
            },
        ],
    },
    // ━━━ ANALYTICS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'analytics',
        name: 'Analytics & Reporting',
        description: 'Website analytics, tracking, dashboards, reporting',
        industryLeaders: ['Google Analytics', 'Plausible', 'Fathom', 'Mixpanel', 'Hotjar'],
        detectionSignals: [
            'analytics', 'tracking', 'pageview', 'google_analytics', 'ga4',
            'statistics', 'visitor', 'heatmap', 'event_tracking', 'conversion',
            'dashboard_widget', 'site_stats',
        ],
        features: [
            {
                name: 'Traffic Dashboard',
                importance: 'must-have',
                description: 'Overview of visitors, pageviews, sessions in a visual dashboard',
                industryReference: 'Google Analytics dashboard, Plausible one-page view. At-a-glance metrics expected',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['analytics_dashboard', 'site_stats', 'visitor_count', 'pageview_stats']), () => hasAdminPage(m, /analytic|stat|dashboard/)),
            },
            {
                name: 'Privacy-Compliant Tracking',
                importance: 'must-have',
                description: 'GDPR-compliant tracking with consent management',
                industryReference: 'Plausible, Fathom are cookie-free. GDPR consent banners expected. Privacy-first trending',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['gdpr', 'consent', 'cookie_consent', 'privacy', 'do_not_track']), () => hasAny(code, ['cookie', 'consent'])),
            },
            {
                name: 'Event Tracking',
                importance: 'should-have',
                description: 'Track custom events: button clicks, form submissions, downloads',
                industryReference: 'GA4 events, Mixpanel events, Hotjar recordings. Beyond pageviews',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['event_track', 'custom_event', 'track_event', 'gtag.*event'])),
            },
            {
                name: 'Real-Time Stats',
                importance: 'nice-to-have',
                description: 'Live visitor count, active pages, real-time events',
                industryReference: 'Google Analytics real-time view. Plausible shows live visitors. Engaging feature',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['real_time', 'realtime', 'live_visitor', 'active_now'])),
            },
            {
                name: 'Data Export',
                importance: 'should-have',
                description: 'Export reports as CSV, PDF, or via API',
                industryReference: 'GA4 has data export and API. Plausible has CSV export. Businesses need data portability',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['export_csv', 'export_report', 'download_report', 'api_stats']), () => hasAny(code, ['export', 'csv', 'download'])),
            },
        ],
    },
    // ━━━ SOCIAL SHARING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'social',
        name: 'Social & Sharing',
        description: 'Social sharing buttons, social login, auto-posting',
        industryLeaders: ['Buffer', 'Hootsuite', 'AddThis', 'ShareThis', 'AddToAny'],
        detectionSignals: [
            'social_share', 'share_button', 'facebook_share', 'twitter_share',
            'social_login', 'social_media', 'sharing', 'social_icons',
            'auto_post', 'social_feed',
        ],
        features: [
            {
                name: 'Share Buttons',
                importance: 'must-have',
                description: 'Share to Facebook, Twitter/X, LinkedIn, Pinterest, WhatsApp, email',
                industryReference: 'AddToAny, ShareThis — share buttons on 15M+ sites. Standard feature',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['share_button', 'social_share', 'facebook_share', 'twitter_share']), () => hasAny(code, ['share', 'social'])),
            },
            {
                name: 'Share Count Display',
                importance: 'should-have',
                description: 'Show number of shares per platform as social proof',
                industryReference: 'Social Warfare, Shared Counts — share counts add credibility',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['share_count', 'social_count', 'share_total'])),
            },
            {
                name: 'Social Login',
                importance: 'should-have',
                description: 'Login/register via Facebook, Google, Apple, Twitter',
                industryReference: 'Auth0, Firebase Auth — social login reduces registration friction by 50%+',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['social_login', 'google_login', 'facebook_login', 'oauth', 'sso'])),
            },
            {
                name: 'Open Graph Tags',
                importance: 'must-have',
                description: 'OG meta tags for rich social media previews',
                industryReference: 'Facebook, LinkedIn, Twitter all read OG tags. Without them, shared links look broken',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['og:', 'open_graph', 'og_title', 'og_image', 'twitter:card'])),
            },
            {
                name: 'Auto-Post to Social',
                importance: 'nice-to-have',
                description: 'Automatically share new posts to social media accounts',
                industryReference: 'Buffer, Hootsuite, Jetpack Publicize — auto-posting saves time',
                detection: (m, code) => detect(m, code, () => hasAny(code, ['auto_post', 'publicize', 'auto_share', 'social_publish'])),
            },
        ],
    },
];
// ─── Category Detection ───────────────────────────────────────────
export function detectCategory(manifest) {
    const allCode = getAllCode(manifest);
    const allCodeLower = allCode.toLowerCase();
    const headerLower = (manifest.header.name + ' ' + manifest.header.description + ' ' + manifest.header.slug).toLowerCase();
    const scores = [];
    for (const cat of CATEGORIES) {
        let score = 0;
        const matched = [];
        for (const signal of cat.detectionSignals) {
            const signalLower = signal.toLowerCase();
            // Check in header (strongest signal — 3 points)
            if (headerLower.includes(signalLower)) {
                score += 3;
                matched.push(`header:${signal}`);
            }
            // Check in code (weaker signal — 1 point)
            if (allCodeLower.includes(signalLower)) {
                score += 1;
                if (!matched.some(m => m.endsWith(signal))) {
                    matched.push(`code:${signal}`);
                }
            }
        }
        // Also check hook names
        for (const hook of manifest.features.hooks.consumed) {
            for (const signal of cat.detectionSignals) {
                if (hook.hookName.toLowerCase().includes(signal.toLowerCase())) {
                    score += 2;
                    if (!matched.some(m => m.endsWith(signal))) {
                        matched.push(`hook:${signal}`);
                    }
                }
            }
        }
        // Check integration types
        for (const integration of manifest.features.integrations) {
            for (const signal of cat.detectionSignals) {
                if (integration.type.toLowerCase().includes(signal.toLowerCase())) {
                    score += 3;
                    matched.push(`integration:${signal}`);
                }
            }
        }
        if (score > 0) {
            const confidence = Math.min(Math.round((score / (cat.detectionSignals.length * 2)) * 100), 100);
            scores.push({
                category: cat.id,
                name: cat.name,
                confidence,
                matchedSignals: matched.slice(0, 10), // top 10 signals
            });
        }
    }
    // Sort by confidence descending
    scores.sort((a, b) => b.confidence - a.confidence);
    // If nothing detected, return 'general'
    if (scores.length === 0 || scores[0].confidence < 5) {
        return [{
                category: 'general',
                name: 'General WordPress Plugin',
                confidence: 100,
                matchedSignals: ['default'],
            }];
    }
    return scores;
}
// ─── Feature Expectation Analysis ─────────────────────────────────
export function analyzeExpectations(manifest) {
    const detectedCategories = detectCategory(manifest);
    const primary = detectedCategories[0];
    // Find the category definition
    const catDef = CATEGORIES.find(c => c.id === primary.category);
    // If it's 'general' or not found, return empty result
    if (!catDef || primary.category === 'general') {
        return {
            detectedCategory: primary,
            alternateCategories: detectedCategories.slice(1, 3),
            totalExpected: 0,
            found: 0,
            partial: 0,
            notFound: 0,
            completenessScore: 0,
            features: [],
            mustHaveGaps: [],
            shouldHaveGaps: [],
            niceToHaveGaps: [],
        };
    }
    const allCode = getAllCode(manifest);
    const features = [];
    for (const feature of catDef.features) {
        const status = feature.detection(manifest, allCode);
        features.push({
            feature: feature.name,
            importance: feature.importance,
            status,
            description: feature.description,
            industryReference: feature.industryReference,
        });
    }
    const found = features.filter(f => f.status === 'found').length;
    const partial = features.filter(f => f.status === 'partial').length;
    const notFound = features.filter(f => f.status === 'not-found').length;
    // Weighted completeness score
    const weights = { 'must-have': 3, 'should-have': 2, 'nice-to-have': 1 };
    const statusScores = { 'found': 1, 'partial': 0.5, 'not-found': 0 };
    let weightedScore = 0;
    let maxScore = 0;
    for (const f of features) {
        const w = weights[f.importance];
        maxScore += w;
        weightedScore += w * statusScores[f.status];
    }
    const completenessScore = maxScore > 0 ? Math.round((weightedScore / maxScore) * 100) : 0;
    // Gap lists
    const gaps = features.filter(f => f.status === 'not-found');
    const partialGaps = features.filter(f => f.status === 'partial');
    return {
        detectedCategory: primary,
        alternateCategories: detectedCategories.slice(1, 3),
        totalExpected: features.length,
        found,
        partial,
        notFound,
        completenessScore,
        features,
        mustHaveGaps: [...gaps, ...partialGaps].filter(f => f.importance === 'must-have'),
        shouldHaveGaps: [...gaps, ...partialGaps].filter(f => f.importance === 'should-have'),
        niceToHaveGaps: [...gaps, ...partialGaps].filter(f => f.importance === 'nice-to-have'),
    };
}
// ─── Format Category Analysis ─────────────────────────────────────
export function formatCategoryAnalysis(result) {
    const lines = [];
    lines.push(`## Customer Expectation Analysis`);
    lines.push(`Detected Category: **${result.detectedCategory.name}** (${result.detectedCategory.confidence}% confidence)`);
    if (result.alternateCategories.length > 0) {
        const alts = result.alternateCategories.map(c => `${c.name} (${c.confidence}%)`).join(', ');
        lines.push(`Also matches: ${alts}`);
    }
    lines.push('');
    if (result.totalExpected === 0) {
        lines.push('Category could not be determined — no industry expectations to compare against.');
        return lines.join('\n');
    }
    lines.push(`Feature Completeness: **${result.completenessScore}%** (${result.found} found / ${result.partial} partial / ${result.notFound} missing out of ${result.totalExpected})`);
    lines.push('');
    // Feature matrix
    lines.push('| Feature | Importance | Status | Industry Context |');
    lines.push('|---------|-----------|--------|-----------------|');
    for (const f of result.features) {
        const statusIcon = f.status === 'found' ? 'FOUND' : f.status === 'partial' ? 'PARTIAL' : 'MISSING';
        lines.push(`| ${f.feature} | ${f.importance} | ${statusIcon} | ${f.industryReference.split('.')[0]} |`);
    }
    lines.push('');
    // Must-have gaps
    if (result.mustHaveGaps.length > 0) {
        lines.push('### Must-Have Gaps (customers will leave without these)');
        for (const gap of result.mustHaveGaps) {
            lines.push(`- **${gap.feature}**: ${gap.description}`);
            lines.push(`  Industry: ${gap.industryReference}`);
        }
        lines.push('');
    }
    // Should-have gaps
    if (result.shouldHaveGaps.length > 0) {
        lines.push('### Should-Have Gaps (competitors have these)');
        for (const gap of result.shouldHaveGaps) {
            lines.push(`- **${gap.feature}**: ${gap.description}`);
            lines.push(`  Industry: ${gap.industryReference}`);
        }
        lines.push('');
    }
    // Nice-to-have gaps
    if (result.niceToHaveGaps.length > 0) {
        lines.push('### Nice-to-Have Gaps (differentiators)');
        for (const gap of result.niceToHaveGaps) {
            lines.push(`- ${gap.feature}: ${gap.description}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=category-expectations.js.map
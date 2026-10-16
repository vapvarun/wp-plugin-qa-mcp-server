/**
 * Presentation rules evaluated inside the page. Each one is a bug shape that
 * reached human QA because no gate looked at the rendered page: text the theme
 * made unreadable, a light card left on a dark theme, a nested card that merges
 * into its parent, theme bullets on plugin lists, a theme sidebar on a plugin
 * page, an admin page whose only heading is screen-reader text.
 *
 * The function is serialised into the page, so it must not reference anything
 * outside its own body.
 */
import type { Assertion } from './config.js';

export interface RuleArgs {
  root: string;
  kind: 'front' | 'admin';
  dark: boolean;
  sidebar?: string;
  fullWidth?: boolean;
  width: number;
  assertions: Assertion[];
}
export interface RuleFailure { rule: string; detail: string }

export function pageRules(a: RuleArgs): RuleFailure[] {
  const out: RuleFailure[] = [];
  const fail = (rule: string, detail: string) => out.push({ rule, detail });
  // Any CSS colour (oklch, color-mix, hsl, named) resolves through a 1x1 canvas; regex parsing missed oklch buttons.
  const cvs = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const memo = new Map<string, number[] | null>();
  const rgba = (s: string): number[] | null => {
    if (!s || s === 'transparent') return null;
    if (memo.has(s)) return memo.get(s)!;
    let out: number[] | null = null;
    if (cvs) {
      cvs.clearRect(0, 0, 1, 1);
      cvs.fillStyle = '#000';
      cvs.fillStyle = s;
      cvs.fillRect(0, 0, 1, 1);
      const d = cvs.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3] / 255];
    }
    memo.set(s, out);
    return out;
  };
  const lum = (c: number[]) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (x: number[], y: number[]) => {
    const [h, l] = [lum(x), lum(y)].sort((p, q) => q - p);
    return (h + 0.05) / (l + 0.05);
  };
  const name = (el: Element) => {
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + id + cls;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1;
  };
  /** First ancestor background that is mostly opaque; null when a background image is in the way. */
  const effectiveBg = (el: Element | null): number[] | null => {
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = rgba(s.backgroundColor);
      if (c && c[3] >= 0.5) return c;
    }
    return [255, 255, 255, 1];
  };

  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    fail('overflow', `page is ${document.documentElement.scrollWidth}px wide in a ${window.innerWidth}px viewport`);
  }

  if (a.kind === 'front' && a.fullWidth && a.sidebar) {
    const side = Array.from(document.querySelectorAll(a.sidebar)).filter(visible);
    if (side.length) fail('sidebar', `theme sidebar shown on a plugin page: ${side.map(name).join(', ')}`);
  }

  const roots = Array.from(document.querySelectorAll(a.root)).filter(visible);
  if (!roots.length) {
    fail('root', `plugin root "${a.root}" is not rendered`);
    return out;
  }

  const spread = (c: number[]) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  const pageBg = effectiveBg(document.body) ?? [255, 255, 255, 1];
  const neutralTheme = spread(pageBg) < 6;
  const lowContrast: string[] = [];
  const surfaces: string[] = [];
  const offPalette: string[] = [];
  const mergedItems: string[] = [];
  const merged: string[] = [];
  const bullets: string[] = [];
  for (const root of roots) {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (!visible(el)) continue;
      const s = getComputedStyle(el);

      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1);
      if (ownText && !(el as HTMLButtonElement).disabled) {
        const fg = rgba(s.color);
        const bg = effectiveBg(el);
        if (fg && bg && fg[3] > 0.5) {
          const size = parseFloat(s.fontSize);
          const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
          const r = ratio(fg, bg);
          if (r < (large ? 3 : 4.5)) lowContrast.push(`${name(el)} ${r.toFixed(2)}:1 "${(el.textContent ?? '').trim().slice(0, 30)}"`);
        }
      }

      const own = rgba(s.backgroundColor);
      const rect = el.getBoundingClientRect();
      const neutral = own && Math.max(own[0], own[1], own[2]) - Math.min(own[0], own[1], own[2]) < 40;
      if (own && own[3] >= 0.9 && neutral && s.backgroundImage === 'none' && rect.width >= 240 && rect.height >= 60) {
        const L = lum(own);
        if (a.dark ? L > 0.3 : L < 0.4) surfaces.push(`${name(el)} ${s.backgroundColor}`);
      }
      // A plugin palette of its own (slate on a neutral black theme) reads as a different site.
      if (a.dark && neutralTheme && own && own[3] >= 0.9 && s.backgroundImage === 'none' && rect.width >= 240 && rect.height >= 60 && lum(own) < 0.3 && spread(own) >= 12) {
        offPalette.push(`${name(el)} ${s.backgroundColor} on ${document.body.tagName.toLowerCase()} rgb(${pageBg.slice(0, 3).join(', ')})`);
      }

      const cardLike = (n: Element) => {
        const c = getComputedStyle(n);
        const bg = rgba(c.backgroundColor);
        return parseFloat(c.borderTopLeftRadius) >= 4 && ((bg && bg[3] > 0.5) || parseFloat(c.borderTopWidth) > 0);
      };
      const control = /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName);
      if (!control && rect.width >= 200 && rect.height >= 60 && cardLike(el)) {
        let p: Element | null = el.parentElement;
        while (p && root.contains(p) && !cardLike(p)) p = p.parentElement;
        if (p && root.contains(p)) {
          const mine = effectiveBg(el);
          const theirs = effectiveBg(p);
          const border = rgba(s.borderTopColor);
          const bw = parseFloat(s.borderTopWidth);
          // Any visible border or a shadow separates the cards; typical card borders sit near 1.2:1.
          const edge = bw > 0 && border && border[3] > 0.2 && mine ? ratio(border, mine) : 1;
          const shadow = s.boxShadow && s.boxShadow !== 'none';
          if (mine && theirs && ratio(mine, theirs) < 1.05 && edge < 1.08 && !shadow) merged.push(`${name(el)} inside ${name(p)}`);
        }
      }

      // Repeated items (meeting cards, rows) inside a card need an edge, a shadow or their own surface.
      // Form rows and fields are spaced by layout, not separated by edges, so they are not items.
      const kids = Array.from(el.children).filter((k) => visible(k) && k.getBoundingClientRect().width >= 200 && k.getBoundingClientRect().height >= 60 && !k.querySelector('input:not([type=hidden]), select, textarea'));
      const first = kids[0]?.classList[0];
      if (first && kids.length >= 2 && kids.every((k) => k.classList[0] === first) && el.closest('[class*="card"]')) {
        const host = effectiveBg(el);
        const separated = (k: Element) => {
          const c = getComputedStyle(k);
          const sides = ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
            const w = parseFloat(c.getPropertyValue(`border-${side.toLowerCase()}-width`));
            const col = rgba(c.getPropertyValue(`border-${side.toLowerCase()}-color`));
            return w > 0 && col && col[3] > 0.2 && host && ratio(col, host) >= 1.08;
          });
          const bg = effectiveBg(k);
          return sides || (c.boxShadow && c.boxShadow !== 'none') || (bg && host && ratio(bg, host) >= 1.05);
        };
        if (!kids.some(separated)) mergedItems.push(`${kids.length} × ${name(kids[0])} in ${name(el)}`);
      }

      if ((el.tagName === 'UL' || el.tagName === 'OL') && el.getAttribute('class')) {
        const li = el.querySelector(':scope > li');
        if (li && getComputedStyle(li).display === 'list-item' && getComputedStyle(li).listStyleType !== 'none') bullets.push(name(el));
      }
    }
  }
  const top = (xs: string[]) => xs.slice(0, 5).join('; ') + (xs.length > 5 ? ` (+${xs.length - 5} more)` : '');
  if (lowContrast.length) fail('contrast', top(lowContrast));
  if (surfaces.length) fail(a.dark ? 'dark-surface' : 'light-surface', `${a.dark ? 'light' : 'dark'} panel on a ${a.dark ? 'dark' : 'light'} scheme: ${top(surfaces)}`);
  if (merged.length) fail('nested-card', `card has the same background as its parent and no visible edge: ${top(merged)}`);
  if (offPalette.length) fail('off-palette', `plugin surface tinted against the theme's neutral dark palette: ${top(offPalette)}`);
  if (mergedItems.length) fail('merged-items', `repeated items have no edge, shadow or surface of their own: ${top(mergedItems)}`);
  if (bullets.length) fail('list-markers', `theme list markers on plugin lists: ${top(bullets)}`);

  if (a.kind === 'admin') {
    const heads = Array.from(document.querySelectorAll('#wpbody h1, #wpbody [class*="page-header"]')).filter(
      (h) => visible(h) && (h as HTMLElement).innerText.trim().length > 0,
    );
    if (!heads.length) fail('admin-header', 'no visible page heading (screen-reader-only h1 does not count)');
  }

  for (const as of a.assertions) {
    if (as.from_width && a.width < as.from_width) continue;
    const box = (sel?: string) => {
      const el = sel ? Array.from(document.querySelectorAll(sel)).find(visible) : undefined;
      return el ? el.getBoundingClientRect() : null;
    };
    if (as.type === 'box') {
      const b = box(as.selector);
      if (!b) fail('box', `${as.selector} not rendered`);
      else {
        if (as.min_width && b.width < as.min_width) fail('box', `${as.selector} is ${Math.round(b.width)}px, expected >= ${as.min_width}`);
        if (as.max_width && b.width > as.max_width) fail('box', `${as.selector} is ${Math.round(b.width)}px, expected <= ${as.max_width}`);
      }
    } else if (as.type === 'within') {
      const b = box(as.selector);
      const c = box(as.container);
      if (!b || !c) fail('within', `${!b ? as.selector : as.container} not rendered`);
      else if (b.left < c.left - 1 || b.right > c.right + 1) fail('within', `${as.selector} [${Math.round(b.left)}-${Math.round(b.right)}] leaves ${as.container} [${Math.round(c.left)}-${Math.round(c.right)}]`);
    } else if (as.type === 'gap') {
      const x = box(as.a);
      const y = box(as.b);
      if (!x || !y) fail('gap', `${!x ? as.a : as.b} not rendered`);
      else {
        const g = Math.round(y.top - x.bottom);
        if (as.max !== undefined && g > as.max) fail('gap', `${as.a} to ${as.b} is ${g}px, expected <= ${as.max}`);
      }
    }
  }
  return out;
}

/** Fresh-install shapes: a list container rendered with nothing in it, and visible PHP errors. */
export function walkRules(root: string): RuleFailure[] {
  const out: RuleFailure[] = [];
  const scope = document.querySelector(root) ?? document.body;
  const text = document.body.innerText;
  const php = text.match(/(Fatal error|Parse error|Warning|Notice|Deprecated): .{0,120}/);
  if (php) out.push({ rule: 'php-error', detail: php[0] });
  const empty: string[] = [];
  for (const el of Array.from(scope.querySelectorAll('[class]'))) {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (!/(__|-)(list|grid|items|platforms|options|cards|rows)\b/.test(cls)) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    if (el.children.length === 0 && (el.textContent ?? '').trim() === '' && r.width > 0) empty.push(cls.split(/\s+/)[0]);
  }
  if (empty.length) out.push({ rule: 'empty-container', detail: `list rendered with nothing in it: ${empty.slice(0, 5).join(', ')}` });
  return out;
}

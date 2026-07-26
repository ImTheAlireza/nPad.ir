/**
 * Entry point.
 *
 * Loaded as <script type="module" defer>, so it never blocks parsing and
 * runs after the DOM is ready.
 */

import { initMenus } from './ui.js';
import { initTheme } from './theme.js';
import { initEditor } from './editor.js';
import { initAnalytics, trackEvent } from './analytics.js';

function readStrings() {
    const node = document.getElementById('i18n');
    if (!node) return {};
    try {
        return JSON.parse(node.textContent);
    } catch {
        return {};
    }
}

function main() {
    const strings = readStrings();

    initAnalytics();
    initMenus();
    initTheme({ onChange: trackEvent });
    initEditor({ strings, onEvent: trackEvent });

    trackEvent('page_view');

    // Progressive enhancement: the site is fully usable without this.
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
    main();
}

/**
 * Theme toggle.
 *
 * The pre-paint half of this lives inline in includes/head.php: it sets
 * data-theme on <html> before first paint so dark-mode users never see the
 * white flash the old build produced by waiting for DOMContentLoaded.
 */

const STORAGE_KEY = 'npad:theme';

function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function apply(theme, animate = false) {
    document.documentElement.dataset.theme = theme;

    // Keep the browser UI (address bar, form controls) in step.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1120' : '#eef1f5');

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
        const isDark = theme === 'dark';
        btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
        const label = isDark ? btn.dataset.labelLight : btn.dataset.labelDark;
        if (label) btn.setAttribute('aria-label', label);
        btn.querySelectorAll('[data-icon]').forEach((icon) => {
            const shouldShow = icon.dataset.icon === (isDark ? 'sun' : 'moon');
            icon.hidden = !shouldShow;
            if (shouldShow && animate) {
                icon.classList.remove('icon--pop');
                // Force reflow so the animation restarts on repeated toggles.
                void icon.offsetWidth;
                icon.classList.add('icon--pop');
            }
        });
    });
}

export function initTheme({ onChange } = {}) {
    // The inline pre-paint script in head.php sets data-theme before first
    // paint, but this function must not blindly trust it: proxying layers
    // (e.g. Cloudflare Rocket Loader) can defer or rewrite inline scripts,
    // and any boot order that skips it would apply light mode over a saved
    // dark preference. localStorage is the source of truth; the DOM
    // attribute is only a pre-paint cache of it.
    let stored = null;
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (value === 'dark' || value === 'light') stored = value;
    } catch {
        stored = null;
    }
    apply(stored || (systemPrefersDark() ? 'dark' : 'light'));

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const next = currentTheme() === 'dark' ? 'light' : 'dark';
            apply(next, true);
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch {
                /* storage unavailable */
            }
            if (typeof onChange === 'function') {
                onChange(next === 'dark' ? 'dark_mode_enabled' : 'dark_mode_disabled');
            }
        });
    });

    // Follow the OS only while the user has expressed no preference.
    if (window.matchMedia) {
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = () => {
            let stored = null;
            try {
                stored = localStorage.getItem(STORAGE_KEY);
            } catch {
                stored = null;
            }
            if (!stored) apply(systemPrefersDark() ? 'dark' : 'light');
        };
        if (query.addEventListener) query.addEventListener('change', listener);
        else if (query.addListener) query.addListener(listener);
    }
}

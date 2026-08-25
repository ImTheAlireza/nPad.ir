/**
 * Anonymous usage events.
 *
 * Only the event name is transmitted; the server adds a timestamp, the user
 * agent and a truncated IP. Note content is never involved.
 *
 * Uses a same-origin relative URL so the request satisfies the site's
 * connect-src 'self' CSP — the old code hardcoded https://npad.ir/track.php,
 * which broke on any other host (staging, local, www).
 */

const ENDPOINT = '/api/track.php';

/** Mirrors the server-side allow-list in api/track.php. */
const ALLOWED = new Set([
    'page_view',
    'new_file',
    'open_file',
    'download_txt',
    'download_html',
    'print_used',
    'view_details',
    'copy_used',
    'cut_used',
    'paste_used',
    'paste_plain_used',
    'dark_mode_enabled',
    'dark_mode_disabled',
    'link_created',
    'clear_data',
    'find_used',
    'focus_mode_enabled',
    'dir_toggled',
    'spellcheck_toggled',
    'spell_replace_used',
    'spell_add_word',
]);

let enabled = true;

/**
 * Respect Do Not Track and Global Privacy Control.
 */
function optedOut() {
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return true;
    if (navigator.globalPrivacyControl === true) return true;
    return false;
}

export function initAnalytics() {
    enabled = !optedOut();
    return trackEvent;
}

/**
 * @param {string} name
 */
export function trackEvent(name) {
    if (!enabled || !ALLOWED.has(name)) return;

    const body = new FormData();
    body.append('event', name);

    try {
        if (navigator.sendBeacon) {
            navigator.sendBeacon(ENDPOINT, body);
        } else {
            fetch(ENDPOINT, { method: 'POST', body, keepalive: true, credentials: 'omit' })
                .catch(() => {});
        }
    } catch {
        /* analytics must never interfere with the editor */
    }
}

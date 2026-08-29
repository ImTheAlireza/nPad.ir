/**
 * NPad admin dashboard — AI provider panel.
 *
 * An ES module so it can share parseAIResponse() with the app: the test
 * button diagnoses failures exactly like the editor does (HTML replies,
 * reasoning-only answers, token-limit empties, provider errors with HTTP
 * status + code) instead of the old false-"connected" empty-reply success.
 * dashboard.php loads this with type="module" (deferred by default; the
 * strict script-src CSP allows external scripts).
 */
import { requestChatCompletion } from '../assets/js/ai-parse.js';

(function () {
    'use strict';

    const KEY_BASE_URL = 'npad:ai-base-url';
    const KEY_API_KEY  = 'npad:ai-api-key';
    const KEY_MODEL    = 'npad:ai-model';
    const KEY_CONSENT  = 'npad:ai-consent';
    const KEY_FEAT_ACK = 'npad:ai-feat-ack';

    const $ = (id) => document.getElementById(id);

    // ── Load saved values into fields ──────────────────────────────────
    function loadFields() {
        const baseUrlEl = $('dash-ai-base-url');
        const apiKeyEl  = $('dash-ai-api-key');
        const modelEl   = $('dash-ai-model');
        if (!baseUrlEl) return; // panel not present (login screen)
        baseUrlEl.value = localStorage.getItem(KEY_BASE_URL) || '';
        apiKeyEl.value  = localStorage.getItem(KEY_API_KEY)  || '';
        modelEl.value   = localStorage.getItem(KEY_MODEL)    || '';
        updateConsentStatus();
    }

    function updateConsentStatus() {
        const consent = localStorage.getItem(KEY_CONSENT) === '1';
        const el = $('dash-consent-status');
        if (!el) return;
        el.textContent      = consent ? '✓ Consent given' : '✗ No consent yet';
        el.style.background = consent ? '#d1fae5' : 'var(--surface-2)';
        el.style.color      = consent ? '#065f46' : 'var(--text-muted)';
    }

    function setStatus(msg, color) {
        const el = $('dash-ai-status');
        if (!el) return;
        el.textContent = msg;
        el.style.color = color === 'green'  ? '#065f46'
                       : color === 'red'    ? 'var(--danger, #dc2626)'
                       : color === 'orange' ? '#92400e'
                       : 'var(--text-muted)';
    }

    // ── Save button ────────────────────────────────────────────────────
    const saveBtn = $('dash-ai-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const baseUrl = ($('dash-ai-base-url')?.value || '').trim();
            const apiKey  = ($('dash-ai-api-key')?.value  || '').trim();
            const model   = ($('dash-ai-model')?.value    || '').trim();

            if (!baseUrl || !apiKey || !model) {
                setStatus('Fill in all three fields before saving.', 'red');
                return;
            }

            localStorage.setItem(KEY_BASE_URL, baseUrl);
            localStorage.setItem(KEY_API_KEY,  apiKey);
            localStorage.setItem(KEY_MODEL,    model);
            setStatus('✓ Settings saved', 'green');
            setTimeout(() => setStatus(''), 3000);
        });
    }

    // ── Test connection button ─────────────────────────────────────────
    const testBtn = $('dash-ai-test');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            const baseUrl = ($('dash-ai-base-url')?.value || '').trim();
            const apiKey  = ($('dash-ai-api-key')?.value  || '').trim();
            const model   = ($('dash-ai-model')?.value    || '').trim();

            if (!baseUrl || !apiKey || !model) {
                setStatus('Fill in all three fields first.', 'red');
                return;
            }

            testBtn.disabled    = true;
            testBtn.textContent = 'Testing…';
            setStatus('');

            const base     = baseUrl.replace(/\/+$/, '');
            const endpoint = base.endsWith('/chat/completions')
                ? base
                : base + '/chat/completions';

            try {
                // Same diagnostics and reasoning-model mitigations as the
                // editor: provider errors with HTTP status/code, HTML
                // replies and reasoning-only answers fail with an
                // explanation; thinking models get a real token budget and
                // one automatic retry instead of a false "connected".
                const reply = await requestChatCompletion(endpoint, apiKey, {
                    model    : model,
                    messages : [{ role: 'user', content: 'Reply with "ok".' }],
                    max_tokens: 32,
                    max_completion_tokens: 32,
                }, {});
                setStatus('✓ Connected! Model replied: "' + reply.slice(0, 40) + '"', 'green');
            } catch (err) {
                setStatus('✗ ' + err.message, 'red');
            } finally {
                testBtn.disabled    = false;
                testBtn.textContent = 'Test connection';
            }
        });
    }

    // ── Revoke consent button ──────────────────────────────────────────
    const revokeBtn = $('dash-revoke-consent');
    if (revokeBtn) {
        revokeBtn.addEventListener('click', () => {
            localStorage.removeItem(KEY_CONSENT);
            localStorage.removeItem(KEY_FEAT_ACK);
            updateConsentStatus();
            setStatus('Consent revoked and all acknowledgements cleared.', 'orange');
            setTimeout(() => setStatus(''), 4000);
        });
    }

    // ── Grant consent button ───────────────────────────────────────────
    const grantBtn = $('dash-grant-consent');
    if (grantBtn) {
        grantBtn.addEventListener('click', () => {
            localStorage.setItem(KEY_CONSENT, '1');
            updateConsentStatus();
            setStatus('Consent granted. AI features are now enabled for this browser.', 'green');
            setTimeout(() => setStatus(''), 4000);
        });
    }

    // ── Init ───────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', loadFields);
    // Also run immediately in case DOMContentLoaded already fired (defer)
    if (document.readyState !== 'loading') loadFields();
})();

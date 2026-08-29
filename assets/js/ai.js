import { sanitizeHtml } from './sanitize.js';
import { requestChatCompletion } from './ai-parse.js';

/**
 * NPad AI module.
 *
 * Provides the 5 quick-win AI features powered by any OpenAI-compatible API:
 *   1. Smart Title Generator
 *   2. Summarize Note
 *   3. Tone Rewriter
 *   4. Extract To-Dos
 *   5. Smart Formatting Cleanup
 *
 * All settings (base URL, API key, model) are stored only in localStorage.
 * Note content is never sent anywhere unless the user has:
 *   a) configured a provider (base URL + key + model), AND
 *   b) given global consent (npad:ai-consent = "1").
 *
 * The cloud-send indicator (☁ icon) appears on every AI menu item via CSS.
 */

/* -------------------------------------------------------------------------
   Storage keys
   Two namespaces:
     - npad:ai-*       → site-default credentials (set by admin in dashboard)
     - npad:ai-user-*  → user's own credentials (set in the app settings dialog)

   getAIConfig() returns user keys when present, otherwise site defaults.
   The settings dialog only ever reads/writes the user namespace.
   ------------------------------------------------------------------------- */
const KEY_BASE_URL      = 'npad:ai-base-url';       // site default (admin-set)
const KEY_API_KEY       = 'npad:ai-api-key';
const KEY_MODEL         = 'npad:ai-model';
const KEY_USER_BASE_URL = 'npad:ai-user-base-url';  // user's own credentials
const KEY_USER_API_KEY  = 'npad:ai-user-api-key';
const KEY_USER_MODEL    = 'npad:ai-user-model';
const KEY_CONSENT       = 'npad:ai-consent';

/* -------------------------------------------------------------------------
   Read / write settings
   ------------------------------------------------------------------------- */

/** True when the user has saved their own credentials in the dialog. */
export function hasUserConfig() {
    return !!(
        (localStorage.getItem(KEY_USER_BASE_URL) || '').trim() &&
        (localStorage.getItem(KEY_USER_API_KEY)  || '').trim() &&
        (localStorage.getItem(KEY_USER_MODEL)    || '').trim()
    );
}

/**
 * Active config: user credentials take priority over site defaults.
 * Returns { baseUrl, apiKey, model, isUserConfig }.
 */
export function getAIConfig() {
    if (hasUserConfig()) {
        return {
            baseUrl      : (localStorage.getItem(KEY_USER_BASE_URL) || '').trim(),
            apiKey       : (localStorage.getItem(KEY_USER_API_KEY)  || '').trim(),
            model        : (localStorage.getItem(KEY_USER_MODEL)    || '').trim(),
            isUserConfig : true,
        };
    }
    return {
        baseUrl      : (localStorage.getItem(KEY_BASE_URL) || '').trim(),
        apiKey       : (localStorage.getItem(KEY_API_KEY)  || '').trim(),
        model        : (localStorage.getItem(KEY_MODEL)    || '').trim(),
        isUserConfig : false,
    };
}

/** Save the user's own credentials (user namespace only). */
export function saveAIConfig({ baseUrl, apiKey, model }) {
    localStorage.setItem(KEY_USER_BASE_URL, baseUrl.trim());
    localStorage.setItem(KEY_USER_API_KEY,  apiKey.trim());
    localStorage.setItem(KEY_USER_MODEL,    model.trim());
}

/** Remove the user's own credentials — fall back to site defaults. */
export function clearUserConfig() {
    localStorage.removeItem(KEY_USER_BASE_URL);
    localStorage.removeItem(KEY_USER_API_KEY);
    localStorage.removeItem(KEY_USER_MODEL);
}

export function hasAIConfig() {
    const { baseUrl, apiKey, model } = getAIConfig();
    return !!(baseUrl && apiKey && model);
}

export function hasConsent() {
    return localStorage.getItem(KEY_CONSENT) === '1';
}

export function setConsent(value) {
    if (value) {
        localStorage.setItem(KEY_CONSENT, '1');
    } else {
        localStorage.removeItem(KEY_CONSENT);
        // Clean up the retired per-feature acknowledgement map, if any.
        localStorage.removeItem('npad:ai-feat-ack');
    }
}

/* -------------------------------------------------------------------------
   Pre-flight: ensure config + one-time global consent.
   The user sees at most ONE dialog before AI features work — the global
   consent. Once agreed it is stored in localStorage forever (until revoked
   in settings). No per-feature repeat dialogs.
   Returns true if ready to proceed, false if the user cancelled.
   ------------------------------------------------------------------------- */
export async function preflight(featureId, featureLabel, strings, showDialog, toast) {
    // 1. Config check — must have base URL + key + model before anything else.
    if (!hasAIConfig()) {
        const action = await showDialog({
            title: strings.aiNoConfig,
            bodyHtml: `<p>${strings.aiNoConfigBody}</p>`,
            buttons: [
                { label: strings.aiOpenSettings, action: 'settings', variant: 'btn--primary' },
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
            ],
        });
        if (action === 'settings') {
            openAISettings(strings, showDialog, toast);
        }
        return false;
    }

    // 2. Global consent — shown exactly once, then never again.
    if (!hasConsent()) {
        const { model } = getAIConfig();
        const action = await showDialog({
            title: strings.aiConsentTitle,
            bodyHtml: `
                <div class="ai-consent-body">
                    <span class="ai-cloud-badge" aria-hidden="true">☁</span>
                    <p>${strings.aiConsentBody}</p>
                    <ul>
                        <li>${strings.aiConsentPoint1}</li>
                        <li>${strings.aiConsentPoint2}</li>
                        <li>${strings.aiConsentPoint3}</li>
                    </ul>
                    <p style="font-size:12px;color:var(--text-muted);margin-top:var(--space-2)">${strings.aiSendBody.replace('{model}', model)}</p>
                </div>`,
            buttons: [
                { label: strings.aiConsentAgree, action: 'agree', variant: 'btn--primary' },
                { label: strings.cancel,          action: 'cancel', variant: 'btn--ghost' },
            ],
        });
        if (action !== 'agree') return false;
        setConsent(true);
    }

    return true;
}

/* -------------------------------------------------------------------------
   Core API call — routed through /api/ai-proxy.php so the strict
   connect-src 'self' CSP is never violated. The proxy forwards the request
   server-side and streams the provider's response back unchanged.
   ------------------------------------------------------------------------- */

export async function callAI(systemPrompt, userContent, strings, {
    temperature = 1.0,
    maxTokens   = 512,
} = {}) {
    const { baseUrl, apiKey, model } = getAIConfig();

    // Normalise the base URL (strip trailing slash, ensure /chat/completions)
    const base = baseUrl.replace(/\/+$/, '');
    const endpoint = base.endsWith('/chat/completions')
        ? base
        : `${base}/chat/completions`;

    const payload = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userContent },
        ],
        temperature,
        max_tokens: maxTokens,
        // OpenAI reasoning models (o-series) reject max_tokens and require
        // this name; other OpenAI-compatible providers ignore the extra key.
        max_completion_tokens: maxTokens,
    };

    // requestChatCompletion adds reasoning-model mitigations (larger budget,
    // temperature handling) and one automatic retry on empty-length.
    return requestChatCompletion(endpoint, apiKey, payload, strings);
}

/* -------------------------------------------------------------------------
   AI Settings dialog (used by dashboard panel AND inline no-config prompt)
   ------------------------------------------------------------------------- */
export async function openAISettings(strings, showDialog, toast) {
    // Read ONLY the user's own saved credentials — never pre-fill with site defaults.
    const userBaseUrl = (localStorage.getItem(KEY_USER_BASE_URL) || '').trim();
    const userApiKey  = (localStorage.getItem(KEY_USER_API_KEY)  || '').trim();
    const userModel   = (localStorage.getItem(KEY_USER_MODEL)    || '').trim();
    const hasSiteDefault = !!(
        (localStorage.getItem(KEY_BASE_URL) || '').trim() &&
        (localStorage.getItem(KEY_API_KEY)  || '').trim() &&
        (localStorage.getItem(KEY_MODEL)    || '').trim()
    );

    // Status banner: tell user which config is active
    const activeBanner = hasUserConfig()
        ? `<p class="ai-settings-status ai-settings-status--user">${strings.aiStatusUser || '✓ Using your credentials'}</p>`
        : hasSiteDefault
            ? `<p class="ai-settings-status ai-settings-status--default">${strings.aiStatusDefault || 'ℹ Using site default — fill in your own credentials below to override'}</p>`
            : '';

    const removeBtn = (userBaseUrl || userApiKey || userModel)
        ? `<button type="button" class="btn btn--ghost btn--sm" id="aiRemoveCreds" style="margin-top:var(--space-3)">
               ${strings.aiRemoveCreds || 'Remove my credentials (use site default)'}
           </button>`
        : '';

    const action = await showDialog({
        title: strings.aiSettingsTitle,
        bodyHtml: `
            ${activeBanner}
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-3);margin-top:var(--space-2)">
                ${strings.aiSettingsBody}
            </p>
            <label class="field">
                <span class="field__label">${strings.aiBaseUrl}</span>
                <input class="field__input" id="aiBaseUrl" type="url"
                       placeholder="https://api.deepseek.com/v1"
                       value="${escapeVal(userBaseUrl)}" autocomplete="off" spellcheck="false">
            </label>
            <label class="field">
                <span class="field__label">${strings.aiApiKey}</span>
                <input class="field__input" id="aiApiKey" type="password"
                       placeholder="sk-…"
                       value="${escapeVal(userApiKey)}" autocomplete="off" spellcheck="false">
            </label>
            <label class="field">
                <span class="field__label">${strings.aiModel}</span>
                <input class="field__input" id="aiModel" type="text"
                       placeholder="deepseek-chat"
                       value="${escapeVal(userModel)}" autocomplete="off" spellcheck="false">
            </label>
            ${removeBtn}
            <details style="margin-top:var(--space-3);font-size:12px;color:var(--text-muted)">
                <summary style="cursor:pointer">${strings.aiExamples}</summary>
                <table style="margin-top:var(--space-2);width:100%;font-size:12px;border-collapse:collapse">
                    <tr><th style="text-align:start;padding:4px 8px 4px 0;font-weight:600">Provider</th><th style="text-align:start;padding:4px 0;font-weight:600">Base URL</th><th style="text-align:start;padding:4px 0 4px 8px;font-weight:600">Model</th></tr>
                    <tr><td style="padding:4px 8px 4px 0">DeepSeek</td><td style="padding:4px 0">https://api.deepseek.com/v1</td><td style="padding:4px 0 4px 8px">deepseek-chat</td></tr>
                    <tr><td style="padding:4px 8px 4px 0">OpenAI</td><td style="padding:4px 0">https://api.openai.com/v1</td><td style="padding:4px 0 4px 8px">gpt-4o-mini</td></tr>
                    <tr><td style="padding:4px 8px 4px 0">Gemini</td><td style="padding:4px 0">https://generativelanguage.googleapis.com/v1beta/openai</td><td style="padding:4px 0 4px 8px">gemini-2.0-flash</td></tr>
                    <tr><td style="padding:4px 8px 4px 0">Groq</td><td style="padding:4px 0">https://api.groq.com/openai/v1</td><td style="padding:4px 0 4px 8px">llama-3.3-70b-versatile</td></tr>
                </table>
            </details>`,
        buttons: [
            { label: strings.aiSaveSettings, action: 'save',   variant: 'btn--primary' },
            { label: strings.aiTestConn,     action: 'test',   variant: 'btn--ghost' },
            { label: strings.cancel,          action: 'cancel', variant: 'btn--ghost' },
        ],
        onOpen(body) {
            // "Test connection" — use the form values, don't close the dialog.
            body.closest('dialog')?.querySelector('[data-action="test"]')
                ?.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const tmpCfg = readSettingsForm(body);
                    const btn = e.currentTarget;
                    btn.disabled = true;
                    btn.textContent = strings.aiTesting;
                    try {
                        await testConnection(tmpCfg, strings);
                        toast(strings.aiTestOk, 'success');
                    } catch (err) {
                        toast(`${strings.aiTestFail}: ${err.message}`, 'error');
                    } finally {
                        btn.disabled = false;
                        btn.textContent = strings.aiTestConn;
                    }
                });

            // "Remove my credentials" — clear user namespace and close.
            body.querySelector('#aiRemoveCreds')?.addEventListener('click', (e) => {
                e.stopPropagation();
                clearUserConfig();
                toast(strings.aiCredsRemoved || 'Your credentials removed — using site default', 'success');
                body.closest('dialog')?.close();
            });
        },
    });

    if (action === 'save') {
        const form = document.getElementById('aiBaseUrl')?.closest('.dialog__body');
        if (form) {
            const cfg = readSettingsForm(form);
            if (cfg.baseUrl && cfg.apiKey && cfg.model) {
                saveAIConfig(cfg);
                toast(strings.aiSettingsSaved, 'success');
            } else {
                toast(strings.aiSettingsIncomplete || 'Fill in all three fields to save', 'error');
            }
        }
    }
}

function readSettingsForm(body) {
    return {
        baseUrl: (body.querySelector('#aiBaseUrl')?.value || '').trim(),
        apiKey : (body.querySelector('#aiApiKey')?.value  || '').trim(),
        model  : (body.querySelector('#aiModel')?.value   || '').trim(),
    };
}

async function testConnection(cfg, strings) {
    const base = cfg.baseUrl.replace(/\/+$/, '');
    const endpoint = base.endsWith('/chat/completions')
        ? base
        : `${base}/chat/completions`;

    const payload = {
        model: cfg.model,
        messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
        max_tokens: 32,
        max_completion_tokens: 32,
    };
    // Same diagnostics and reasoning-model mitigations as callAI: provider
    // errors, HTML replies, empty and reasoning-only answers all fail the
    // test with a clear message; thinking models get a real token budget.
    await requestChatCompletion(endpoint, cfg.apiKey, payload, strings);
}

function escapeVal(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Human count for a character total: "1,234 words" / "۵۶۷". Falls back to
 * the raw number when Intl is unavailable.
 */
function fmtWords(charCount) {
    const words = Math.max(1, Math.ceil(charCount / 6)); // ≈6 chars per word
    try {
        return new Intl.NumberFormat(document.documentElement.lang || 'en').format(words);
    } catch {
        return String(words);
    }
}

/**
 * Clean raw innerText before sending to the model:
 *  - collapse runs of 3+ blank lines to 2
 *  - replace non-breaking spaces and tabs with regular spaces
 *  - trim leading/trailing whitespace
 * Trims to `limit` chars at the nearest sentence boundary where possible.
 * When a cut happens, `onTruncate(originalLength, keptLength)` fires — the
 * caller uses it to warn the user that only part of the text is processed.
 */
function cleanInput(raw, limit, onTruncate) {
    const s = (raw || '')
        .replace(/\u00a0/g, ' ')   // nbsp → space
        .replace(/\t/g, ' ')        // tabs → space
        .replace(/(\n\s*){3,}/g, '\n\n')  // 3+ blank lines → 2
        .trim();
    if (s.length <= limit) return s;
    // Try to cut at a sentence boundary (. ! ?) within the last 200 chars of the limit
    const window = s.slice(limit - 200, limit);
    const m = window.match(/[.!?][\s\n]/g);
    let cut;
    if (m) {
        const lastIdx = window.lastIndexOf(m[m.length - 1]);
        cut = s.slice(0, limit - 200 + lastIdx + 1).trim();
    } else {
        cut = s.slice(0, limit).trim();
    }
    if (typeof onTruncate === 'function') {
        try { onTruncate(s.length, cut.length); } catch { /* never let the warning break the run */ }
    }
    return cut;
}

/* -------------------------------------------------------------------------
   Selection preservation
   Opening a modal dialog moves focus out of the contenteditable, and after
   close() browsers hand focus back to whatever triggered the dialog — not
   the editor. execCommand() silently does nothing unless the editor has
   focus, so every "Apply" path must re-focus and restore the exact range
   that was captured before the first dialog opened.
   ------------------------------------------------------------------------- */

/** Clone the live selection range when it is a non-collapsed range inside `editorEl`. */
function captureSelectionRange(editorEl) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    if (!editorEl.contains(sel.anchorNode) && !editorEl.contains(sel.focusNode)) return null;
    try { return sel.getRangeAt(0).cloneRange(); } catch { return null; }
}

/** Focus the editor and restore `range` (or collapse to the end when absent). */
function focusEditorWithRange(editorEl, range) {
    editorEl.focus();
    if (!range) return;
    try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } catch { /* ignore */ }
}

/* -------------------------------------------------------------------------
   Feature implementations
   Each function receives (editorEl, strings, showDialog, toast, createNote?)
   and returns early if cancelled at any gate.
   ------------------------------------------------------------------------- */

/** 1. Smart Title: suggests 3 titles from first ~500 chars of text */
export async function runSmartTitle(editorEl, strings, showDialog, toast, onApplyTitle) {
    const ready = await preflight('smart-title', strings.aiSmartTitle, strings, showDialog, toast);
    if (!ready) return;

    const text = cleanInput(editorEl.innerText || '', 400);
    if (!text) { toast(strings.aiEmptyNote, 'info'); return; }

    const loadingToast = showLoadingIndicator(strings.aiWorking);
    try {
        const sys = `3 short note titles, one per line, no quotes, no numbering. Max 60 chars each. Match input language (Persian/English).`;
        const result = await callAI(sys, text, strings, { temperature: 1.5, maxTokens: 80 });
        loadingToast();

        const titles = result.split('\n').map(t => t.trim()).filter(Boolean).slice(0, 3);
        if (!titles.length) { toast(strings.aiEmptyResponse, 'error'); return; }

        const listHtml = titles.map((t, i) =>
            `<label class="field--inline" style="margin-top:var(--space-2);cursor:pointer">
                <input type="radio" name="ai-title" value="${escapeVal(t)}" ${i === 0 ? 'checked' : ''}>
                <span style="font-size:14px">${escapeHtmlVal(t)}</span>
            </label>`
        ).join('');

        const action = await showDialog({
            title: strings.aiSmartTitle,
            bodyHtml: `<p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-2)">${strings.aiPickTitle}</p>${listHtml}`,
            buttons: [
                { label: strings.aiApply, action: 'apply', variant: 'btn--primary' },
                { label: strings.cancel,   action: 'cancel', variant: 'btn--ghost' },
            ],
        });
        if (action === 'apply') {
            // The dialog body stays in the DOM after close(); query inside it
            // rather than the whole document so a concurrent dialog can never
            // shadow the radio group.
            const chosen = document.getElementById('appDialog')
                ?.querySelector('input[name="ai-title"]:checked')?.value;
            if (chosen && typeof onApplyTitle === 'function') onApplyTitle(chosen);
        }
    } catch (err) {
        loadingToast();
        toast(`${strings.aiError}: ${err.message}`, 'error');
    }
}

/** 2. Summarize: bullet summary + key points + action items → new note */
export async function runSummarize(editorEl, strings, showDialog, toast, onCreateNote) {
    const ready = await preflight('summarize', strings.aiSummarize, strings, showDialog, toast);
    if (!ready) return;

    const text = cleanInput(editorEl.innerText || '', 200_000,
        (orig, cut) => toast(`${strings.aiTruncated || 'Note trimmed to'} ${fmtWords(cut)} ${strings.aiTruncatedFor || 'for AI'}`, 'info'),
    );
    if (text.length < 50) { toast(strings.aiNoteTooShort, 'info'); return; }

    // Scale output budget with note size
    const sumMaxTok = text.length > 50_000 ? 1200 : text.length > 15_000 ? 800 : 500;

    const loadingToast = showLoadingIndicator(strings.aiWorking);
    try {
        const sys = `Summarize in input language (Persian/English). Markdown:
## Summary — 2-3 bullets
## Key Points — up to 5 bullets
## Action Items — tasks or "None"`;
        const result = await callAI(sys, text, strings, { temperature: 0.0, maxTokens: sumMaxTok });
        loadingToast();

        const action = await showDialog({
            title: strings.aiSummarize,
            bodyHtml: `
                <div style="max-height:260px;overflow-y:auto;font-size:13px;white-space:pre-wrap;font-family:var(--font-mono);background:var(--surface-2);padding:var(--space-3);border-radius:var(--radius-md)">${escapeHtmlVal(result)}</div>
                <p style="font-size:12px;color:var(--text-muted);margin-top:var(--space-2)">${strings.aiSummaryHint}</p>`,
            buttons: [
                { label: strings.aiSaveAsNote, action: 'save',   variant: 'btn--primary' },
                { label: strings.cancel,        action: 'cancel', variant: 'btn--ghost' },
            ],
        });
        if (action === 'save' && typeof onCreateNote === 'function') {
            onCreateNote(strings.aiSummaryNoteTitle, result);
        }
    } catch (err) {
        loadingToast();
        toast(`${strings.aiError}: ${err.message}`, 'error');
    }
}

/** 3. Tone Rewriter: rewrites selected (or full) text in chosen tone */
export async function runToneRewrite(editorEl, strings, showDialog, toast) {
    const ready = await preflight('tone-rewrite', strings.aiToneRewrite, strings, showDialog, toast);
    if (!ready) return;

    const sel = window.getSelection();
    const hasSelection = sel && sel.rangeCount && !sel.isCollapsed && editorEl.contains(sel.anchorNode);
    // Capture the exact range now: the picker and result dialogs will take
    // focus and collapse the live selection.
    const savedRange = captureSelectionRange(editorEl);
    const FULL_LIMIT = 30_000;

    const rawText = hasSelection ? sel.toString() : (editorEl.innerText || '');
    // Full-note mode must never silently drop content: if the note exceeds
    // the processing budget, abort with guidance instead of rewriting only
    // the first chunk and wiping the rest.
    if (!hasSelection && rawText.length > FULL_LIMIT + 2000) {
        toast(`${strings.aiNoteTooLong || 'This note is too long for one pass — select the part to rewrite and try again'} (${fmtWords(rawText.length)})`, 'info');
        return;
    }
    const _toneWarn = (orig, cut) =>
        toast(`${strings.aiTruncated || 'Text trimmed to'} ${fmtWords(cut)} ${strings.aiTruncatedFor || 'for AI'}`, 'info');
    const inputText = cleanInput(rawText, FULL_LIMIT, _toneWarn);

    if (!inputText) { toast(strings.aiEmptyNote, 'info'); return; }

    const tones = [
        { id: 'formal',     label: strings.aiToneFormal },
        { id: 'casual',     label: strings.aiToneCasual },
        { id: 'concise',    label: strings.aiToneConcise },
        { id: 'persuasive', label: strings.aiTonePersuasive },
        { id: 'friendly',   label: strings.aiToneFriendly },
    ];
    const toneHtml = tones.map((t, i) =>
        `<label class="field--inline" style="margin-top:var(--space-2);cursor:pointer">
            <input type="radio" name="ai-tone" value="${t.id}" ${i === 0 ? 'checked' : ''}>
            <span style="font-size:14px">${escapeHtmlVal(t.label)}</span>
        </label>`
    ).join('');

    const pick = await showDialog({
        title: strings.aiToneRewrite,
        bodyHtml: `
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-2)">${hasSelection ? strings.aiToneSelection : strings.aiToneFullNote}</p>
            ${toneHtml}`,
        buttons: [
            { label: strings.aiRewrite, action: 'rewrite', variant: 'btn--primary' },
            { label: strings.cancel,    action: 'cancel',  variant: 'btn--ghost' },
        ],
    });
    if (pick !== 'rewrite') return;

    const tone = document.getElementById('appDialog')
        ?.querySelector('input[name="ai-tone"]:checked')?.value || 'formal';
    const toneLabel = tones.find(t => t.id === tone)?.label || tone;

    const loadingToast = showLoadingIndicator(strings.aiWorking);
    try {
        const sys = `Rewrite in ${toneLabel} tone. Same language and meaning. Return only the rewritten text.`;
        const maxTok = Math.min(1200, Math.ceil(inputText.length / 3 * 1.3) + 50);
        const result = await callAI(sys, inputText, strings, { temperature: 1.0, maxTokens: maxTok });
        loadingToast();

        const action = await showDialog({
            title: `${strings.aiToneRewrite} — ${toneLabel}`,
            bodyHtml: `
                <div style="max-height:240px;overflow-y:auto;font-size:13px;white-space:pre-wrap;background:var(--surface-2);padding:var(--space-3);border-radius:var(--radius-md)">${escapeHtmlVal(result)}</div>
                <p style="font-size:12px;color:var(--text-muted);margin-top:var(--space-2)">${strings.aiRewriteHint}</p>`,
            buttons: [
                { label: strings.aiApply, action: 'apply', variant: 'btn--primary' },
                { label: strings.cancel,   action: 'cancel', variant: 'btn--ghost' },
            ],
        });
        if (action === 'apply') {
            if (hasSelection) {
                // Re-focus the editor and restore the exact selection the
                // user made — the modal dialog moved focus elsewhere and
                // execCommand is a silent no-op without it.
                focusEditorWithRange(editorEl, savedRange);
                document.execCommand('insertText', false, result);
            } else {
                editorEl.focus();
                document.execCommand('selectAll');
                document.execCommand('insertText', false, result);
            }
        }
    } catch (err) {
        loadingToast();
        toast(`${strings.aiError}: ${err.message}`, 'error');
    }
}

/** 4. Extract To-Dos: finds obligation phrases and converts to checklist HTML */
export async function runExtractTodos(editorEl, strings, showDialog, toast) {
    const ready = await preflight('extract-todos', strings.aiExtractTodos, strings, showDialog, toast);
    if (!ready) return;

    const text = cleanInput(editorEl.innerText || '', 100_000,
        (orig, cut) => toast(`${strings.aiTruncated || 'Note trimmed to'} ${fmtWords(cut)} ${strings.aiTruncatedFor || 'for AI'}`, 'info'),
    );
    if (text.length < 20) { toast(strings.aiEmptyNote, 'info'); return; }

    const todoMaxTok = text.length > 20_000 ? 600 : 300;

    const loadingToast = showLoadingIndicator(strings.aiWorking);
    try {
        const sys = `Extract every task/to-do. One per line, no bullets, no numbering. Keep input language (Persian/English). If none: reply NONE`;
        const result = await callAI(sys, text, strings, { temperature: 0.0, maxTokens: todoMaxTok });
        loadingToast();

        if (result.trim().toUpperCase() === 'NONE') {
            toast(strings.aiNoTodos, 'info');
            return;
        }

        const tasks = result.split('\n').map(t => t.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
        const preview = tasks.map(t => `<li style="font-size:13px;margin:4px 0">${escapeHtmlVal(t)}</li>`).join('');

        const action = await showDialog({
            title: strings.aiExtractTodos,
            bodyHtml: `
                <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-2)">${strings.aiTodosFound.replace('{n}', tasks.length)}</p>
                <ul style="max-height:200px;overflow-y:auto;padding-inline-start:var(--space-4)">${preview}</ul>
                <p style="font-size:12px;color:var(--text-muted);margin-top:var(--space-2)">${strings.aiTodosHint}</p>`,
            buttons: [
                { label: strings.aiInsertChecklist, action: 'insert', variant: 'btn--primary' },
                { label: strings.cancel,             action: 'cancel', variant: 'btn--ghost' },
            ],
        });
        if (action === 'insert') {
            insertChecklistItems(editorEl, tasks);
        }
    } catch (err) {
        loadingToast();
        toast(`${strings.aiError}: ${err.message}`, 'error');
    }
}

/** 5. Smart Formatting: converts wall-of-text to headings/lists/paragraphs */
export async function runSmartFormat(editorEl, strings, showDialog, toast) {
    const ready = await preflight('smart-format', strings.aiSmartFormat, strings, showDialog, toast);
    if (!ready) return;

    const sel = window.getSelection();
    const hasSelection = sel && sel.rangeCount && !sel.isCollapsed && editorEl.contains(sel.anchorNode);
    // Capture the exact range now: the result dialog will take focus and
    // collapse the live selection.
    const savedRange = captureSelectionRange(editorEl);
    const FULL_LIMIT = 30_000;

    const rawText = hasSelection ? sel.toString() : (editorEl.innerText || '');
    // Full-note mode must never silently drop content: applying would
    // replace the WHOLE note with a rewrite of the first chunk only.
    if (!hasSelection && rawText.length > FULL_LIMIT + 2000) {
        toast(`${strings.aiNoteTooLong || 'This note is too long for one pass — select the part to format and try again'} (${fmtWords(rawText.length)})`, 'info');
        return;
    }
    const _fmtWarn = (orig, cut) =>
        toast(`${strings.aiTruncated || 'Text trimmed to'} ${fmtWords(cut)} ${strings.aiTruncatedFor || 'for AI'}`, 'info');
    const inputText = cleanInput(rawText, FULL_LIMIT, _fmtWarn);

    if (!inputText) { toast(strings.aiEmptyNote, 'info'); return; }

    const loadingToast = showLoadingIndicator(strings.aiWorking);
    try {
        const sys = `Reformat as clean HTML. Allowed tags: <h2> <h3> <p> <ul> <ol> <li> <strong> <em>. No other tags. Preserve language (Persian/English). Return HTML only.`;
        const maxTok = Math.min(4000, Math.ceil(inputText.length / 3.5 * 1.4) + 50);
        const result = await callAI(sys, inputText, strings, { temperature: 0.0, maxTokens: maxTok });
        loadingToast();

        // Strip any markdown code fences the model may wrap around HTML,
        // then sanitize through the same allow-list used for paste/import.
        const raw = result.replace(/^```html?\n?/i, '').replace(/\n?```$/, '').trim();
        // Some models answer in Markdown despite the HTML-only instruction.
        // When no HTML tag is present, convert the markdown structure first
        // so the preview shows real formatting instead of raw "##" text.
        const asHtml = /<[a-z][\s\S]*>/i.test(raw) ? raw : markdownToHtml(raw);
        const cleaned = sanitizeHtml(asHtml);

        const action = await showDialog({
            title: strings.aiSmartFormat,
            bodyHtml: `
                <div style="max-height:240px;overflow-y:auto;font-size:13px;border:1px solid var(--border-subtle);padding:var(--space-3);border-radius:var(--radius-md)">${cleaned}</div>
                <p style="font-size:12px;color:var(--text-muted);margin-top:var(--space-2)">${strings.aiFormatHint}</p>`,
            buttons: [
                { label: strings.aiApply, action: 'apply', variant: 'btn--primary' },
                { label: strings.cancel,   action: 'cancel', variant: 'btn--ghost' },
            ],
        });
        if (action === 'apply') {
            if (hasSelection) {
                // Re-focus the editor and restore the exact selection —
                // without this the browser drops the insertHTML silently.
                focusEditorWithRange(editorEl, savedRange);
                document.execCommand('insertHTML', false, cleaned);
            } else {
                editorEl.focus();
                document.execCommand('selectAll');
                document.execCommand('insertHTML', false, cleaned);
            }
        }
    } catch (err) {
        loadingToast();
        toast(`${strings.aiError}: ${err.message}`, 'error');
    }
}

/**
 * Minimal Markdown → HTML for Smart Formatting results that arrive as
 * Markdown instead of HTML. Supports headings, bold/italic, inline code,
 * bullet and numbered lists; everything else becomes a paragraph.
 * The output is still passed through the allow-list sanitizer afterwards.
 */
function markdownToHtml(md) {
    const escapeIn = (s) => s
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s) => escapeIn(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    const lines = String(md || '').split(/\r?\n/);
    const out = [];
    let list = null; // 'ul' | 'ol'

    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { closeList(); continue; }

        const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
            closeList();
            const level = Math.min(heading[1].length + 1, 4); // # → h2 … #### → h4
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            continue;
        }

        const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
        if (bullet) {
            if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
            out.push(`<li>${inline(bullet[1])}</li>`);
            continue;
        }

        const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
        if (numbered) {
            if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
            out.push(`<li>${inline(numbered[1])}</li>`);
            continue;
        }

        closeList();
        out.push(`<p>${inline(trimmed)}</p>`);
    }
    closeList();
    return out.join('\n');
}

/* -------------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------------- */

/** Show a subtle loading indicator via a toast-like message. Returns a cleanup fn. */
function showLoadingIndicator(label) {
    const region = document.getElementById('toastRegion');
    let el = null;
    if (region) {
        el = document.createElement('div');
        el.className = 'toast toast--info ai-loading-toast';
        el.innerHTML = `<span class="ai-spinner" aria-hidden="true"></span> ${escapeHtmlVal(label)}`;
        region.appendChild(el);
    }
    return () => { if (el) el.remove(); };
}

/** Insert extracted tasks as a checklist at end of editor. */
function insertChecklistItems(editorEl, tasks) {
    const items = tasks.map(t =>
        `<li class="checklist-item"><input type="checkbox" class="task-checkbox"> ${escapeHtmlVal(t)}</li>`
    ).join('');
    const html = `<ul class="checklist">${items}</ul>`;
    editorEl.focus();
    // Place caret at end.
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand('insertHTML', false, html);
}

function escapeHtmlVal(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
}

/* -------------------------------------------------------------------------
   Floating AI selection toolbar
   Shows near the selection after text is selected inside the editor.
   Single-word selections get "Suggest replacements" instead.
   ------------------------------------------------------------------------- */

let _selToolbar    = null;
let _selVisible    = false;
let _savedRange    = null; // preserved before dialog steals focus
let _ignoreNextUp  = false; // suppress re-evaluation when clicking toolbar itself

function getSelToolbar() {
    if (_selToolbar) return _selToolbar;

    const el = document.createElement('div');
    el.className  = 'ai-sel-toolbar';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'AI actions');
    // Never use the `hidden` attribute — it sets display:none which breaks
    // offsetWidth measurement. Visibility is controlled by opacity + pointer-events
    // via the --visible modifier class.
    document.body.appendChild(el);
    _selToolbar = el;

    // Mark that the next document pointerup came from inside the toolbar
    // so handleSelectionAI knows to skip re-evaluation.
    el.addEventListener('pointerdown', () => { _ignoreNextUp = true; });

    // Hide when clicking outside
    document.addEventListener('pointerdown', (e) => {
        if (_selVisible && !el.contains(e.target)) {
            _hideSelToolbar();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _selVisible) _hideSelToolbar();
    });

    return el;
}

function _hideSelToolbar() {
    if (!_selToolbar) return;
    _selVisible = false;
    _selToolbar.classList.remove('ai-sel-toolbar--visible');
    // opacity + pointer-events handle invisibility — no display:none needed
}

function _showSelToolbar(el, x, y) {
    // Already in the DOM with opacity:0, pointer-events:none — just measure & position.
    el.classList.remove('ai-sel-toolbar--visible');

    // One rAF lets any pending innerHTML render so offsetWidth is real
    requestAnimationFrame(() => {
        const w  = el.offsetWidth  || 320;
        const h  = el.offsetHeight || 44;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = x - w / 2;
        let top  = y - h - 12;    // above cursor

        left = Math.max(8, Math.min(left, vw - w - 8));
        if (top < 8) top = y + 18; // flip below if no room above
        top  = Math.max(8, Math.min(top, vh - h - 8));

        el.style.left = `${left}px`;
        el.style.top  = `${top}px`;
        _selVisible   = true;
        el.classList.add('ai-sel-toolbar--visible');
    });
}

/**
 * Called from editor.js on document pointerup.
 * editorEl  — the contenteditable div
 * x, y      — clientX/Y of the pointer event
 */
export function handleSelectionAI(editorEl, strings, showDialog, toast, onCreateNote, x, y) {
    // If the user just clicked a toolbar button, skip this evaluation
    if (_ignoreNextUp) { _ignoreNextUp = false; return; }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        _hideSelToolbar();
        return;
    }
    // Selection must be inside the editor
    if (!editorEl.contains(sel.anchorNode) && !editorEl.contains(sel.focusNode)) {
        _hideSelToolbar();
        return;
    }

    const _rawSel = sel.toString().trim();
    const text = _rawSel.length > 40_000 ? _rawSel.slice(0, 40_000).trim() : _rawSel;
    if (!text) { _hideSelToolbar(); return; }

    // Save range now — opening a dialog will collapse the selection
    _savedRange = sel.getRangeAt(0).cloneRange();

    // Single word = no whitespace
    const isSingleWord = !/\s/.test(text) && text.length > 0 && text.length <= 40;

    const toolbar = getSelToolbar();

    const buttons = isSingleWord
        ? [{ action: 'word-replace',   label: strings.aiSelWordReplace || 'Suggest replacements', icon: true }]
        : [
            { action: 'sel-summarize', label: strings.aiSelSummarize  || 'Summarize' },
            { action: 'sel-rewrite',   label: strings.aiSelRewrite    || 'Rewrite'   },
            { action: 'sel-shorten',   label: strings.aiSelShorten    || 'Shorten'   },
            { action: 'sel-expand',    label: strings.aiSelExpand     || 'Expand'    },
            { action: 'sel-translate', label: strings.aiSelTranslate  || 'Translate' },
          ];

    toolbar.innerHTML = buttons.map(b =>
        `<button class="ai-sel-toolbar__btn" data-ai-sel="${b.action}" type="button">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>
            </svg>
            ${escapeHtmlVal(b.label)}
            <span class="ai-sel-toolbar__cloud" aria-hidden="true">☁</span>
        </button>`
    ).join('');

    toolbar.onclick = async (e) => {
        const btn = e.target.closest('[data-ai-sel]');
        if (!btn) return;
        const action    = btn.dataset.aiSel;
        const savedText = _savedRange ? _savedRange.toString().trim() : text;
        _hideSelToolbar();
        await runSelectionAction(action, savedText, editorEl, strings, showDialog, toast, onCreateNote, _savedRange);
    };

    _showSelToolbar(toolbar, x, y);
}

async function runSelectionAction(action, text, editorEl, strings, showDialog, toast, onCreateNote, savedRange) {
    const ready = await preflight(action, action, strings, showDialog, toast);
    if (!ready) return;

    const loading = showLoadingIndicator(strings.aiWorking || 'AI is working…');
    // Safety net: no code path may leave the spinner toast behind.
    const finishLoading = () => { try { loading(); } catch { /* ignore */ } };

    try {
        let result;

        if (action === 'sel-summarize') {
            const selSumMaxTok = text.length > 20_000 ? 500 : 200;
            result = await callAI(
                'Summarize in input language (Persian/English), 2-4 bullets. Bullets only.',
                text, strings, { temperature: 0.0, maxTokens: selSumMaxTok },
            );
            finishLoading();
            const act = await showDialog({
                title: strings.aiSelSummarize || 'Summarize',
                bodyHtml: `<div style="font-size:13px;white-space:pre-wrap;background:var(--surface-2);padding:var(--space-3);border-radius:var(--radius-md);max-height:200px;overflow-y:auto">${escapeHtmlVal(result)}</div>`,
                buttons: [
                    { label: strings.aiSaveAsNote || 'Save as note',       action: 'save',    variant: 'btn--primary' },
                    { label: strings.aiApply      || 'Replace selection',   action: 'replace', variant: 'btn--ghost'   },
                    { label: strings.cancel       || 'Cancel',              action: 'cancel',  variant: 'btn--ghost'   },
                ],
            });
            if (act === 'save' && typeof onCreateNote === 'function') {
                onCreateNote(strings.aiSummaryNoteTitle || 'Summary', result);
            } else if (act === 'replace') {
                // Focus first: after the dialog closed, focus sits on the
                // toolbar button and execCommand would be dropped.
                focusEditorWithRange(editorEl, savedRange);
                document.execCommand('insertText', false, result);
            }

        } else if (action === 'sel-rewrite') {
            const rwText = cleanInput(text, 15_000,
                (o, c) => toast(`${strings.aiTruncated || 'Selection trimmed to'} ${fmtWords(c)} ${strings.aiTruncatedFor || 'for AI'}`, 'info'));
            result = await callAI(
                'Rewrite in same language and meaning. Return only the rewritten text.',
                rwText, strings, { temperature: 1.0, maxTokens: Math.min(1200, Math.ceil(rwText.length / 3.5 * 1.2) + 30) },
            );
            finishLoading();
            await _applyOrDiscard(result, strings, showDialog, editorEl, savedRange);

        } else if (action === 'sel-shorten') {
            const shText = cleanInput(text, 15_000,
                (o, c) => toast(`${strings.aiTruncated || 'Selection trimmed to'} ${fmtWords(c)} ${strings.aiTruncatedFor || 'for AI'}`, 'info'));
            result = await callAI(
                'Shorten and condense. Same language. Return only the shortened text.',
                shText, strings, { temperature: 1.0, maxTokens: Math.min(600, Math.ceil(shText.length / 3.5 * 0.7) + 20) },
            );
            finishLoading();
            await _applyOrDiscard(result, strings, showDialog, editorEl, savedRange);

        } else if (action === 'sel-expand') {
            const exText = cleanInput(text, 8_000,
                (o, c) => toast(`${strings.aiTruncated || 'Selection trimmed to'} ${fmtWords(c)} ${strings.aiTruncatedFor || 'for AI'}`, 'info'));
            result = await callAI(
                'Expand with more detail and richness. Same language. Return only the expanded text.',
                exText, strings, { temperature: 1.0, maxTokens: 500 },
            );
            finishLoading();
            await _applyOrDiscard(result, strings, showDialog, editorEl, savedRange);

        } else if (action === 'sel-translate') {
            const trText = cleanInput(text, 25_000,
                (o, c) => toast(`${strings.aiTruncated || 'Selection trimmed to'} ${fmtWords(c)} ${strings.aiTruncatedFor || 'for AI'}`, 'info'));
            result = await callAI(
                'Translate: if Persian→English, if English→Persian. Return only the translation.',
                trText, strings, { temperature: 1.3, maxTokens: Math.min(2000, Math.ceil(trText.length / 3.5 * 1.3) + 30) },
            );
            finishLoading();
            await _applyOrDiscard(result, strings, showDialog, editorEl, savedRange);

        } else if (action === 'word-replace') {
            result = await callAI(
                `5 synonym/replacement words for the given word. Same language (Persian/English). One per line, no numbering, no explanation.`,
                text, strings, { temperature: 1.5, maxTokens: 40 },
            );
            finishLoading();
            const words = result.split('\n').map(w => w.trim()).filter(Boolean).slice(0, 5);
            const listHtml = words.map(w =>
                `<button class="ai-word-replace-option" type="button">${escapeHtmlVal(w)}</button>`
            ).join('');
            await showDialog({
                title: strings.aiSelWordReplace || 'Suggest replacements',
                bodyHtml: `
                    <p style="font-size:12px;color:var(--text-muted);margin-bottom:var(--space-3)">
                        Click a word to replace <strong>${escapeHtmlVal(text)}</strong>:
                    </p>
                    <div class="ai-word-replace-list">${listHtml}</div>`,
                buttons: [
                    { label: strings.cancel || 'Cancel', action: 'cancel', variant: 'btn--ghost' },
                ],
                onOpen(body) {
                    body.querySelectorAll('.ai-word-replace-option').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const word = btn.textContent;
                            const dlg  = body.closest('dialog');
                            // Close dialog first so the editor re-gains focus,
                            // then restore the saved range and insert.
                            if (dlg) dlg.close();
                            setTimeout(() => {
                                focusEditorWithRange(editorEl, savedRange);
                                document.execCommand('insertText', false, word);
                            }, 0);
                        });
                    });
                },
            });
        } else {
            finishLoading();
        }
    } catch (err) {
        finishLoading();
        toast(`${strings.aiError || 'AI error'}: ${err.message}`, 'error');
    }
}

async function _applyOrDiscard(result, strings, showDialog, editorEl, savedRange) {
    const act = await showDialog({
        title: strings.aiApply || 'Result',
        bodyHtml: `<div style="font-size:13px;white-space:pre-wrap;background:var(--surface-2);padding:var(--space-3);border-radius:var(--radius-md);max-height:220px;overflow-y:auto">${escapeHtmlVal(result)}</div>`,
        buttons: [
            { label: strings.aiApply || 'Replace selection', action: 'apply',  variant: 'btn--primary' },
            { label: strings.cancel  || 'Cancel',            action: 'cancel', variant: 'btn--ghost'   },
        ],
    });
    if (act === 'apply') {
        // Focus the editor and restore the saved range BEFORE inserting:
        // after the dialog closed, focus sits on the toolbar button and
        // execCommand is a silent no-op without the editor holding focus.
        await new Promise(r => setTimeout(r, 0));
        focusEditorWithRange(editorEl, savedRange);
        document.execCommand('insertText', false, result);
    }
}

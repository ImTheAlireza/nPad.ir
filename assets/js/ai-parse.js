/**
 * Shared AI provider-response diagnostics.
 *
 * Used by assets/js/ai.js (app features + settings test) and
 * admin/ai-panel.js (dashboard test) so every surface explains failures
 * identically:
 *   - provider error bodies (any status) → provider message with HTTP status
 *     and error code, e.g. "AI provider error (HTTP 402) [insufficient_balance]: …"
 *   - HTML replies (Base URL pointing at a website) → actionable hint
 *   - 200 with an error body → surfaced instead of "empty response"
 *   - empty content with finish_reason "length" → reasoning-model guidance
 *   - reasoning-only answers (deepseek-reasoner & friends) → guidance
 *   - non-OpenAI shapes (Gemini `candidates`, Anthropic `content`) → hint
 */

/**
 * @param {Response} response  fetch response (already awaited)
 * @param {object}   strings   app string table (optional keys fall back to EN)
 * @returns {Promise<string>} the assistant message text
 * @throws {Error} with a diagnosable, user-safe message
 */
export async function parseAIResponse(response, strings) {
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { data = null; }

    const errBody = data && typeof data.error === 'object' && data.error !== null ? data.error : null;
    const providerError = (errBody && typeof errBody.message === 'string' && errBody.message)
        || (typeof data?.message === 'string' ? data.message : null);
    const errType = errBody && (typeof errBody.type === 'string' ? errBody.type : (typeof errBody.code === 'string' ? errBody.code : ''));
    const htmlReply = /^\s*(<!doctype\s+html|<html[\s>])/i.test(raw);

    const htmlHint = (status) =>
        (strings?.aiHtmlResponse || 'The server returned an HTML page instead of a JSON API response (HTTP {status}). The Base URL probably points at a website, not an API — it should look like https://api.deepseek.com/v1')
            .replace('{status}', status);

    const providerErrorMessage = () => {
        const statusTag = response.status !== 200 ? ` (HTTP ${response.status})` : '';
        const typeTag = errType ? ` [${errType}]` : '';
        return `AI provider error${statusTag}${typeTag}: ${providerError}`;
    };

    // Provider-reported errors — any status. These carry the provider's own
    // words (invalid key, insufficient balance, rate limit…); prefix the
    // status/code so the account being billed is unambiguous.
    if (typeof providerError === 'string' && providerError) throw new Error(providerErrorMessage());

    // Error statuses without a provider error body.
    if (!response.ok) {
        if (htmlReply) throw new Error(htmlHint(response.status));
        throw new Error(`HTTP ${response.status}${raw ? ` — ${raw.slice(0, 160)}` : ''}`);
    }

    // 200 but nothing usable — diagnose the likely cause.
    const choice = data?.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
    if (content) return content;
    // Legacy completions shape.
    if (typeof choice?.text === 'string' && choice.text.trim()) return choice.text.trim();

    if (choice?.finish_reason === 'length') {
        const err = new Error(strings?.aiEmptyLength || 'The model hit its token limit before producing any text (finish reason "length"). Try again, select less text, or use a standard chat model instead of a reasoning model.');
        err.emptyLength = true; // callers may retry with a larger budget
        throw err;
    }
    if (typeof choice?.message?.reasoning_content === 'string' && choice.message.reasoning_content.trim()) {
        throw new Error(strings?.aiReasoningOnly || 'The model returned only internal reasoning and no answer text. Use a standard chat model (e.g. deepseek-chat, gpt-4o-mini) for these features.');
    }
    if (Array.isArray(data?.candidates) || Array.isArray(data?.content)) {
        throw new Error(strings?.aiWrongShape || 'The endpoint answered in a non-OpenAI format. Use the provider\'s OpenAI-compatible Base URL — for Gemini: https://generativelanguage.googleapis.com/v1beta/openai');
    }
    if (htmlReply) throw new Error(htmlHint(response.status));
    throw new Error(strings?.aiEmptyResponse || 'Empty response from AI');
}

/* -------------------------------------------------------------------------
   Reasoning-model aware request wrapper
   Reasoning/"thinking" models (deepseek-reasoner, R1, QwQ, Gemini thinking,
   OpenAI o-series/gpt-5…) spend completion tokens on hidden reasoning
   BEFORE writing any answer. Feature budgets are small (40-4000), so such
   models end with finish_reason "length" and empty text. Mitigations:
     1. models that look like reasoning models start with a larger budget
     2. one automatic retry with a much larger budget on empty-length
     3. OpenAI reasoning models reject custom temperature — omit it
   ------------------------------------------------------------------------- */

const REPLY_BUDGET_FLOOR = 2048; // initial budget for reasoning-style models
const RETRY_BUDGET_CAP   = 16384;

function reasoningInfo(model) {
    const m = String(model || '');
    return {
        thinksLike: /deepseek-reasoner|(^|[-_./])r\d+([-_.]|$)|(^|[-_./])o[134]([-_.]|mini|preview|$)|qwq|think|gpt-5/i.test(m),
        strictOpenAI: /(^|[-_./])(o[134]([-_.]|mini|preview|$)|gpt-5)/i.test(m),
    };
}

/**
 * POST a chat completion through the proxy with the mitigations above.
 * @returns {Promise<string>} the assistant message text
 */
export async function requestChatCompletion(endpoint, apiKey, payload, strings) {
    let body = { ...payload };

    const info = reasoningInfo(body.model);
    if (info.thinksLike && (Number(body.max_tokens) || 0) < REPLY_BUDGET_FLOOR) {
        body.max_tokens = REPLY_BUDGET_FLOOR;
        body.max_completion_tokens = REPLY_BUDGET_FLOOR;
    }
    if (info.strictOpenAI) delete body.temperature;

    for (let attempt = 1; ; attempt++) {
        const response = await fetch('/api/ai-proxy.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint, apiKey, payload: body }),
        });
        try {
            return await parseAIResponse(response, strings);
        } catch (err) {
            if (err?.emptyLength && attempt === 1) {
                const current = Number(body.max_tokens) || 0;
                const retryTo = Math.min(RETRY_BUDGET_CAP, Math.max(4096, current * 8));
                if (retryTo > current) {
                    body = { ...body, max_tokens: retryTo, max_completion_tokens: retryTo };
                    continue; // one retry with real headroom for thinking
                }
            }
            throw err;
        }
    }
}

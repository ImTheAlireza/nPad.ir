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
        throw new Error(strings?.aiEmptyLength || 'The model hit its token limit before producing any text (finish reason "length"). Try again, select less text, or use a standard chat model instead of a reasoning model.');
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

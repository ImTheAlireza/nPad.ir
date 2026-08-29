#!/usr/bin/env node
/**
 * NPad local dev server — serves the real PHP site through php-wasm
 * (PHP 8.2 compiled to WebAssembly), no system PHP required.
 *
 * Usage:  node dev-server.mjs            (PORT env var optional, default 8787)
 *
 * The whole site is mirrored into the php-wasm virtual filesystem at
 * startup and kept in sync with fs.watch, so edits to PHP/CSS/JS are
 * picked up without a restart.
 *
 * DEV-ONLY AI BRIDGE: php-wasm cannot make outbound HTTP requests, so
 * api/ai-proxy.php (which forwards to the user's AI provider via
 * file_get_contents) always fails with "Could not reach the AI provider"
 * under this server. POST /api/ai-proxy.php is therefore handled here with
 * Node fetch, mirroring the PHP validation. Production (real PHP) is
 * unaffected — this branch only exists under `npm run dev`.
 */

import { PHP, PHPRequestHandler } from '@php-wasm/universal';
import { loadNodeRuntime } from '@php-wasm/node';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 8787);
const VFS = '/site';

/**
 * Dev mirror of api/ai-proxy.php. Same request/response contract:
 * in:  { endpoint, apiKey, payload }   out: provider status + body as JSON.
 */
async function handleAiProxy(res, bodyBuf) {
    const send = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
    };

    let reqBody;
    try {
        reqBody = JSON.parse(bodyBuf.toString('utf8'));
    } catch {
        return send(400, { error: { message: 'Invalid JSON' } });
    }

    const endpoint = String(reqBody.endpoint ?? '').trim();
    const apiKey   = String(reqBody.apiKey ?? '').trim();
    const payload  = reqBody.payload;
    if (!endpoint || !apiKey || payload === undefined || payload === null) {
        return send(400, { error: { message: 'Missing endpoint, apiKey or payload' } });
    }

    let parsed;
    try { parsed = new URL(endpoint); } catch { return send(400, { error: { message: 'Invalid endpoint' } }); }

    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) {
        return send(400, { error: { message: 'Only HTTPS endpoints are allowed (HTTP permitted for localhost)' } });
    }
    if (!isLocalhost && npadIsPrivateHost(parsed.hostname)) {
        return send(400, { error: { message: 'Endpoint resolves to a private address' } });
    }

    try {
        const upstream = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'User-Agent': 'npad-ai-proxy-dev/1.0',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(60_000),
        });
        const text = await upstream.text();

        // Mirror of the PHP proxy guard: a non-JSON upstream reply means the
        // Base URL points at a website rather than an API root — wrap it in
        // a clear error instead of forwarding an unparseable page.
        const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase();
        const trimmed = text.trim();
        const looksJson = contentType.includes('json')
            || (contentType === '' && (trimmed.startsWith('{') || trimmed.startsWith('[')));
        if (!looksJson) {
            const snippet = trimmed.replace(/<[^>]*>/g, '').slice(0, 120);
            return send(502, { error: { message: `The AI endpoint did not return a JSON API response (content-type: ${contentType || 'unknown'}). Check the Base URL — it should be the provider's OpenAI-compatible API root, e.g. https://api.deepseek.com/v1${snippet ? ` — Response started with: "${snippet}"…` : ''}` } });
        }

        res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        res.end(text);
    } catch (err) {
        const timedOut = err?.name === 'TimeoutError';
        send(502, { error: { message: timedOut
            ? 'The AI provider timed out.'
            : `Could not reach the AI provider. Check the Base URL. (${err?.message ?? 'network error'})` } });
    }
}

/** Mirror of npad_is_private_host() in api/ai-proxy.php. */
function npadIsPrivateHost(host) {
    const privateV4 = ['10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.',
        '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.',
        '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '169.254.'];
    if (privateV4.some((p) => host.startsWith(p))) return true;
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
    return ['.local', '.internal', '.intranet', '.corp', '.home', '.lan'].some((t) => host.endsWith(t));
}

/** Mirror the repository into the PHP virtual filesystem. */
function mirror(host, vfs) {
    php.mkdirTree(vfs);
    for (const entry of fs.readdirSync(host, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const h = path.join(host, entry.name);
        const v = `${vfs}/${entry.name}`;
        if (entry.isDirectory()) mirror(h, v);
        else if (entry.isFile()) php.writeFile(v, fs.readFileSync(h));
    }
}

/** Copy a single changed file into the VFS (or remove it if deleted). */
function syncOne(rel) {
    const abs = path.join(ROOT, rel);
    const v = `${VFS}/${rel.split(path.sep).join('/')}`;
    try {
        const st = fs.statSync(abs);
        if (st.isFile()) {
            php.writeFile(v, fs.readFileSync(abs));
        } else if (st.isDirectory()) {
            php.mkdirTree(v);
        }
    } catch {
        try { php.unlink(v); } catch { /* already gone */ }
    }
}

const rt = await loadNodeRuntime('8.2', { emscriptenOptions: { processId: 1 } });
const php = new PHP(rt);

console.log('Mirroring site into php-wasm filesystem…');
mirror(ROOT, VFS);

// Keep the VFS fresh while the server runs.
const pending = new Map();
fs.watch(ROOT, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString();
    if (rel.startsWith('.git') || rel.startsWith('node_modules')) return;
    clearTimeout(pending.get(rel));
    pending.set(
        rel,
        setTimeout(() => {
            pending.delete(rel);
            try { syncOne(rel); } catch { /* ignore transient watcher errors */ }
        }, 120),
    );
});

const handler = new PHPRequestHandler({
    php,
    documentRoot: VFS,
    absoluteUrl: `http://127.0.0.1:${PORT}/`,
    // Mirrors the .htaccess rewrites: the sitemap is generated and the
    // landing pages live at pretty URLs. Note the handler strips trailing
    // slashes from the URL prefix, so rules must match the leading-slash form.
    rewriteRules: [
        { match: /^\/sitemap\.xml$/, replacement: '/sitemap.php' },
        { match: /^\/(online-notepad|markdown-editor|math-notepad|checklist-app)\/?$/, replacement: '/$1.php' },
        { match: /^\/fa\/(online-notepad|markdown-editor|math-notepad|checklist-app)\/?$/, replacement: '/fa/$1.php' },
    ],
    // Mirrors ErrorDocument 404 /404.php; the original REQUEST_URI is
    // preserved so the 404 page can keep Persian visitors in Persian.
    getFileNotFoundAction: () => ({ type: 'internal-redirect', uri: '/404.php' }),
});

const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const method = req.method ?? 'GET';
    try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

        const body = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
        });

        // DEV-ONLY: route the AI proxy through Node fetch (php-wasm has no
        // outbound network). Mirrors api/ai-proxy.php for local/preview use.
        if (method === 'POST' && url.pathname === '/api/ai-proxy.php') {
            await handleAiProxy(res, body);
            console.log(
                `${new Date().toISOString()} ${method} ${url.pathname} -> dev-bridge (${Date.now() - started}ms)`,
            );
            return;
        }

        const headers = { host: req.headers.host ?? `127.0.0.1:${PORT}` };
        for (const [k, v] of Object.entries(req.headers)) {
            if (v === undefined || k === 'host') continue;
            headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }

        const response = await handler.request({
            method,
            url: url.pathname + url.search,
            headers,
            body: body.length ? body : undefined,
        });

        res.writeHead(response.httpStatusCode, response.headers);
        if (method !== 'HEAD' && response.bytes.byteLength) {
            res.end(Buffer.from(response.bytes));
        } else {
            res.end();
        }
        console.log(
            `${new Date().toISOString()} ${method} ${url.pathname} -> ${response.httpStatusCode} (${Date.now() - started}ms)`,
        );
    } catch (err) {
        console.error('Request failed:', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        }
        res.end('Internal Server Error');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`NPad dev server (php-wasm 8.2) listening on http://0.0.0.0:${PORT}`);
    console.log(`Document root: ${ROOT}`);
});

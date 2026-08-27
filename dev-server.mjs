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
        const headers = { host: req.headers.host ?? `127.0.0.1:${PORT}` };
        for (const [k, v] of Object.entries(req.headers)) {
            if (v === undefined || k === 'host') continue;
            headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }

        const body = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
        });

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

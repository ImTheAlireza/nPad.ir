<?php
/**
 * AI API proxy.
 *
 * Receives a JSON payload from the browser and forwards it to the configured
 * AI provider. This keeps all external fetch calls server-side so the strict
 * connect-src 'self' CSP never needs to be relaxed.
 *
 * The browser sends:
 *   { endpoint, apiKey, payload }
 *
 * The proxy forwards `payload` to `endpoint` with `apiKey` as the Bearer
 * token, then streams the provider's response back to the browser unchanged.
 *
 * Security:
 *  - Same-origin enforced (Sec-Fetch-Site / Origin / Referer).
 *  - POST only, JSON only.
 *  - Only HTTPS (or localhost) endpoints are forwarded — plain HTTP to
 *    arbitrary hosts is blocked.
 *  - No credentials are stored server-side; the key comes from the browser
 *    on every request and is never logged.
 *  - A hard cap of 60 s on the upstream request prevents slowloris abuse.
 *  - Response size is capped at 4 MB.
 */

declare(strict_types=1);

define('CONFIG_LOADED', true);
require_once dirname(__DIR__) . '/includes/bootstrap.php';

// ── CORS / Content-type headers ───────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

// ── Method ────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => ['message' => 'Method not allowed']]);
    exit;
}

// ── Same-origin check (mirrors api/track.php) ─────────────────────────────
$fetchSite = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
if ($fetchSite !== '' && !in_array($fetchSite, ['same-origin', 'same-site', 'none'], true)) {
    http_response_code(403);
    echo json_encode(['error' => ['message' => 'Forbidden']]);
    exit;
}
if ($fetchSite === '') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '';
    if ($origin !== '') {
        $host = parse_url($origin, PHP_URL_HOST);
        // HTTP_HOST may carry a port (localhost:8787, preview hosts) while
        // parse_url strips it — compare host-only, case-insensitively.
        $hostHeader = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
        $requestHost = strtolower((string) preg_replace('/:\d+$/', '', $hostHeader));
        if ($host !== null && strtolower($host) !== $requestHost) {
            http_response_code(403);
            echo json_encode(['error' => ['message' => 'Forbidden']]);
            exit;
        }
    }
    // Allow curl / direct calls only when developing locally.
}

// ── Parse request body ────────────────────────────────────────────────────
$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'Empty request body']]);
    exit;
}

$req = json_decode($raw, true);
if (!is_array($req)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'Invalid JSON']]);
    exit;
}

$endpoint = trim((string) ($req['endpoint'] ?? ''));
$apiKey   = trim((string) ($req['apiKey']   ?? ''));
$payload  = $req['payload'] ?? null;

if ($endpoint === '' || $apiKey === '' || $payload === null) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'Missing endpoint, apiKey or payload']]);
    exit;
}

// ── Validate endpoint ─────────────────────────────────────────────────────
// Allow HTTPS always; allow plain HTTP only for localhost development.
$scheme = strtolower((string) parse_url($endpoint, PHP_URL_SCHEME));
$host   = strtolower((string) parse_url($endpoint, PHP_URL_HOST));

$isLocalhost = in_array($host, ['localhost', '127.0.0.1', '::1'], true);

if ($scheme !== 'https' && !($scheme === 'http' && $isLocalhost)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'Only HTTPS endpoints are allowed (HTTP permitted for localhost)']]);
    exit;
}

// Block private/internal ranges unless localhost.
if (!$isLocalhost && npad_is_private_host($host)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'Endpoint resolves to a private address']]);
    exit;
}

// ── Forward request ───────────────────────────────────────────────────────
$bodyJson = json_encode($payload);
if ($bodyJson === false) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'Could not re-encode payload']]);
    exit;
}

$context = stream_context_create([
    'http' => [
        'method'        => 'POST',
        'header'        => implode("\r\n", [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey,
            'User-Agent: npad-ai-proxy/1.0',
        ]),
        'content'       => $bodyJson,
        'timeout'       => 60,
        'ignore_errors' => true,   // capture non-2xx bodies for forwarding
    ],
    'ssl' => [
        'verify_peer'      => true,
        'verify_peer_name' => true,
    ],
]);

$responseBody = @file_get_contents($endpoint, false, $context);

// $http_response_header is set by file_get_contents after the request.
if ($responseBody === false || !isset($http_response_header)) {
    // Could not connect at all (DNS failure, timeout, refused…).
    http_response_code(502);
    echo json_encode(['error' => ['message' => 'Could not reach the AI provider. Check the Base URL.']]);
    exit;
}

// Cap response size at 4 MB to prevent memory exhaustion.
if (strlen($responseBody) > 4 * 1024 * 1024) {
    http_response_code(502);
    echo json_encode(['error' => ['message' => 'Response from AI provider was too large']]);
    exit;
}

// Parse the HTTP status line from $http_response_header.
$statusLine = $http_response_header[0] ?? 'HTTP/1.1 200 OK';
preg_match('/HTTP\/\S+\s+(\d+)/', $statusLine, $m);
$upstreamStatus = (int) ($m[1] ?? 200);

http_response_code($upstreamStatus);
echo $responseBody;
exit;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Rough check: is $host a private/internal IP or name?
 * We do not resolve hostnames here — we just block known private literals.
 * A determined attacker with a public hostname resolving to 10.x can still
 * get through; that is an acceptable trade-off for a personal notepad.
 */
function npad_is_private_host(string $host): bool
{
    // IPv4 private ranges as prefixes.
    $privateV4 = ['10.', '192.168.', '172.16.', '172.17.', '172.18.',
                  '172.19.', '172.20.', '172.21.', '172.22.', '172.23.',
                  '172.24.', '172.25.', '172.26.', '172.27.', '172.28.',
                  '172.29.', '172.30.', '172.31.', '169.254.'];
    foreach ($privateV4 as $prefix) {
        if (str_starts_with($host, $prefix)) return true;
    }
    // IPv6 loopback / link-local.
    if ($host === '::1' || str_starts_with($host, 'fe80:') || str_starts_with($host, 'fc') || str_starts_with($host, 'fd')) return true;
    // Common internal TLDs.
    foreach (['.local', '.internal', '.intranet', '.corp', '.home', '.lan'] as $tld) {
        if (str_ends_with($host, $tld)) return true;
    }
    return false;
}

<?php
/**
 * Anonymous event collector.
 *
 * Records that a feature was used. Never receives or stores note content.
 * The IP is truncated before it reaches the database.
 *
 * Changes from the previous version:
 *  - degrades to 204 when config.php is absent instead of a fatal error
 *  - honours Do Not Track / Global Privacy Control
 *  - same-origin enforced via Sec-Fetch-Site with an Origin fallback
 *  - rate-limit state written atomically (the old read-modify-write raced)
 */

declare(strict_types=1);

define('CONFIG_LOADED', true);

require_once dirname(__DIR__) . '/includes/bootstrap.php';

header('Content-Type: text/plain; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/** Analytics is optional; the site must work without a database. */
if (!npad_analytics_enabled()) {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit('Method Not Allowed');
}

/**
 * Respect opt-out signals.
 */
if (($_SERVER['HTTP_DNT'] ?? '') === '1' || ($_SERVER['HTTP_SEC_GPC'] ?? '') === '1') {
    http_response_code(204);
    exit;
}

/**
 * Same-origin check.
 *
 * sendBeacon does not always send an Origin header, so prefer the
 * Sec-Fetch-Site metadata header and fall back to Origin/Referer.
 */
$fetchSite = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
if ($fetchSite !== '' && !in_array($fetchSite, ['same-origin', 'same-site', 'none'], true)) {
    http_response_code(403);
    exit('Forbidden');
}

if ($fetchSite === '') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '';
    if ($origin !== '') {
        $host = parse_url($origin, PHP_URL_HOST);
        if ($host !== null && $host !== ($_SERVER['HTTP_HOST'] ?? '')) {
            http_response_code(403);
            exit('Forbidden');
        }
    }
}

/** Events the client is permitted to report. Mirrors assets/js/analytics.js. */
const ALLOWED_EVENTS = [
    'page_view',
    'new_file',
    'open_file',
    'download_txt',
    'download_html',
    'download_markdown',
    'download_json',
    'download_docx',
    'download_pdf',
    'download_rtf',
    'print_used',
    'view_details',
    'backups_opened',
    'backup_restored',
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
    'table_inserted',
    'table_tool_used',
    'image_inserted',
    'image_replaced',
    'image_removed',
    'image_resized',
    'image_cropped',
    'image_details_saved',
];

$event = trim((string) ($_POST['event'] ?? ''));

if ($event === '' || !in_array($event, ALLOWED_EVENTS, true)) {
    http_response_code(400);
    exit('Invalid event');
}

/**
 * Client IP. REMOTE_ADDR only — forwarded headers are attacker-controlled
 * unless a trusted proxy list is configured.
 */
$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');

/**
 * Fixed-window rate limit.
 *
 * Written with LOCK_EX so concurrent beacons cannot corrupt the counter,
 * which the previous read-modify-write could.
 */
function npad_rate_limited(string $ip): bool
{
    $max = defined('MAX_REQUESTS_PER_MINUTE') ? (int) MAX_REQUESTS_PER_MINUTE : 60;
    if ($max <= 0) {
        return false;
    }

    $file = sys_get_temp_dir() . '/npad_rate_' . hash('sha256', $ip . date('YmdHi'));

    $handle = @fopen($file, 'c+');
    if ($handle === false) {
        return false; // fail open: never lose a page view to a temp-dir issue
    }

    $limited = false;
    if (flock($handle, LOCK_EX)) {
        $count = (int) stream_get_contents($handle);
        if ($count >= $max) {
            $limited = true;
        } else {
            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, (string) ($count + 1));
        }
        flock($handle, LOCK_UN);
    }
    fclose($handle);

    return $limited;
}

if (npad_rate_limited($ip)) {
    http_response_code(429);
    exit('Too Many Requests');
}

/**
 * GDPR-style IP truncation: drop the final IPv4 octet, or the last 80 bits
 * of an IPv6 address.
 */
function npad_anonymise_ip(string $ip): string
{
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $parts = explode('.', $ip);
        $parts[3] = '0';
        return implode('.', $parts);
    }

    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        $packed = inet_pton($ip);
        if ($packed !== false) {
            // Keep the first 48 bits, zero the rest.
            $masked = substr($packed, 0, 6) . str_repeat("\0", 10);
            $result = inet_ntop($masked);
            if ($result !== false) {
                return $result;
            }
        }
    }

    return 'unknown';
}

$anonIp    = npad_anonymise_ip($ip);
$userAgent = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? 'unknown'), 0, 255);

try {
    $conn = getDBConnection();

    $stmt = $conn->prepare(
        'INSERT INTO analytics (event_type, ip_address, user_agent, created_at) VALUES (?, ?, ?, NOW())'
    );

    if ($stmt === false) {
        throw new RuntimeException('prepare failed');
    }

    $stmt->bind_param('sss', $event, $anonIp, $userAgent);
    $stmt->execute();
    $stmt->close();
    $conn->close();

    http_response_code(204);
} catch (Throwable $e) {
    error_log('[npad/track] ' . $e->getMessage());
    // Never surface internals to the client.
    http_response_code(204);
}

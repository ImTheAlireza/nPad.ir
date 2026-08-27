<?php
/**
 * CSV export of the analytics table (private).
 *
 * Changes: config path fixed for admin/, session expiry enforced
 * consistently with dashboard.php, streamed in batches rather than
 * buffering the whole table, and CSV injection neutralised.
 */

declare(strict_types=1);

define('CONFIG_LOADED', true);

require_once dirname(__DIR__) . '/includes/bootstrap.php';

if (!npad_analytics_enabled()) {
    http_response_code(503);
    exit('Analytics is not configured.');
}

ini_set('session.cookie_httponly', '1');
ini_set('session.use_strict_mode', '1');
ini_set('session.cookie_samesite', 'Strict');
// HTTPS-only site (enforced at the edge); always mark the cookie Secure.
ini_set('session.cookie_secure', '1');

session_start();

$sessionLifetime = defined('SESSION_LIFETIME') ? (int) SESSION_LIFETIME : 1800;

if (empty($_SESSION['logged_in'])) {
    header('Location: dashboard.php');
    exit;
}

if ((time() - (int) ($_SESSION['last_activity'] ?? time())) > $sessionLifetime) {
    $_SESSION = [];
    session_destroy();
    header('Location: dashboard.php');
    exit;
}

$_SESSION['last_activity'] = time();

try {
    $conn = getDBConnection();
} catch (Throwable $e) {
    error_log('[npad/export] ' . $e->getMessage());
    http_response_code(500);
    exit('Database connection failed.');
}

$filename = 'npad-analytics-' . date('Y-m-d-His') . '.csv';

header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$output = fopen('php://output', 'w');

// BOM so Excel detects UTF-8.
fwrite($output, "\xEF\xBB\xBF");

fputcsv($output, ['ID', 'Event', 'IP (truncated)', 'User agent', 'Timestamp']);

/**
 * A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
 * Prefix with an apostrophe so exported user agents cannot execute.
 */
function csvSafe(?string $value): string
{
    $value = (string) $value;
    return preg_match('/^[=+\-@\t\r]/', $value) ? "'" . $value : $value;
}

$stmt = $conn->prepare(
    'SELECT id, event_type, ip_address, user_agent, created_at FROM analytics ORDER BY id DESC'
);

if ($stmt === false) {
    fclose($output);
    exit;
}

$stmt->execute();
$result = $stmt->get_result();

$n = 0;
while ($row = $result->fetch_assoc()) {
    fputcsv($output, [
        $row['id'],
        csvSafe($row['event_type']),
        csvSafe($row['ip_address']),
        csvSafe($row['user_agent']),
        $row['created_at'],
    ]);

    // Flush periodically so large exports stream instead of exhausting memory.
    if (++$n % 500 === 0) {
        flush();
    }
}

$stmt->close();
$conn->close();
fclose($output);

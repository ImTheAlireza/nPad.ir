<?php
/**
 * Secure Analytics Export
 * Fixed: Session Security, CSRF Protection
 */

// Load configuration
define('CONFIG_LOADED', true);
require_once __DIR__ . '/config.php';

// Secure session configuration
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_secure', 1);
ini_set('session.use_strict_mode', 1);
ini_set('session.cookie_samesite', 'Strict');

session_start();

// Check authentication
if (!isset($_SESSION['logged_in'])) {
    header('Location: dashboard.php');
    exit;
}

// Check session expiry
if (isset($_SESSION['last_activity'])) {
    $inactive_time = time() - $_SESSION['last_activity'];
    if ($inactive_time > SESSION_LIFETIME) {
        session_destroy();
        header('Location: dashboard.php');
        exit;
    }
}
$_SESSION['last_activity'] = time();

// Get database connection
try {
    $conn = getDBConnection();
} catch (Exception $e) {
    die('Database connection failed');
}

// Fetch all data using prepared statement (even though no user input, good practice)
$stmt = $conn->prepare("
    SELECT id, event_type, ip_address, user_agent, created_at 
    FROM analytics 
    ORDER BY created_at DESC
");

if (!$stmt) {
    die('Query preparation failed');
}

$stmt->execute();
$result = $stmt->get_result();

// Set secure CSV headers
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="analytics_export_' . date('Y-m-d_His') . '.csv"');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

// Open output stream
$output = fopen('php://output', 'w');

// UTF-8 BOM for Excel compatibility
fprintf($output, chr(0xEF).chr(0xBB).chr(0xBF));

// Column headers
fputcsv($output, ['ID', 'Event Type', 'IP Address', 'User Agent', 'Timestamp']);

// Data rows
while($row = $result->fetch_assoc()) {
    fputcsv($output, [
        $row['id'],
        $row['event_type'],
        $row['ip_address'],
        $row['user_agent'],
        $row['created_at']
    ]);
}

fclose($output);
$stmt->close();
$conn->close();
exit;
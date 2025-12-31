<?php
/**
 * Secure Event Tracking Endpoint
 * Fixed: SQL Injection, CORS, Rate Limiting, Input Validation
 */

// Load configuration
define('CONFIG_LOADED', true);
require_once __DIR__ . '/config.php';

// Set secure headers
header("Content-Type: text/plain");
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: DENY");

// CORS - Only allow YOUR domain
$allowed_origin = ALLOWED_ORIGIN;
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';

if ($origin === $allowed_origin) {
    header("Access-Control-Allow-Origin: $allowed_origin");
    header("Access-Control-Allow-Methods: POST");
    header("Access-Control-Allow-Headers: Content-Type");
}

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

/**
 * Rate Limiting Function
 * @param string $ip
 * @return bool True if allowed, False if rate limited
 */
function checkRateLimit($ip) {
    $cache_file = sys_get_temp_dir() . '/track_rate_' . md5($ip);
    $max_requests = MAX_REQUESTS_PER_MINUTE;
    $time_window = 60; // seconds
    
    // Read current requests
    $requests = [];
    if (file_exists($cache_file)) {
        $data = file_get_contents($cache_file);
        $requests = json_decode($data, true) ?: [];
    }
    
    // Remove old requests outside time window
    $now = time();
    $requests = array_filter($requests, function($timestamp) use ($now, $time_window) {
        return ($now - $timestamp) < $time_window;
    });
    
    // Check limit
    if (count($requests) >= $max_requests) {
        return false;
    }
    
    // Add current request
    $requests[] = $now;
    file_put_contents($cache_file, json_encode($requests));
    
    return true;
}

/**
 * Anonymize IP Address (GDPR Compliant)
 * @param string $ip
 * @return string
 */
function anonymizeIP($ip) {
    // IPv4
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $parts = explode('.', $ip);
        $parts[3] = '0'; // Mask last octet
        return implode('.', $parts);
    }
    
    // IPv6
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        $parts = explode(':', $ip);
        // Mask last 4 groups
        for ($i = 4; $i < 8; $i++) {
            if (isset($parts[$i])) {
                $parts[$i] = '0';
            }
        }
        return implode(':', $parts);
    }
    
    return 'unknown';
}

// Only handle POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    exit('Method Not Allowed');
}

// Validate event parameter exists
if (!isset($_POST['event']) || empty($_POST['event'])) {
    http_response_code(400);
    exit('Missing event parameter');
}

// Get and validate client IP
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

// Rate limiting check
if (!checkRateLimit($ip)) {
    http_response_code(429); // Too Many Requests
    exit('Rate limit exceeded');
}

// Validate and sanitize event name
$event = trim($_POST['event']);

// Check event length
if (strlen($event) > MAX_EVENT_LENGTH) {
    http_response_code(400);
    exit('Event name too long');
}

// Whitelist allowed event types (security best practice)
$allowed_events = [
    'page_view',
    'new_file',
    'open_file',
    'download_txt',
    'print_used',
    'view_details',
    'copy_used',
    'cut_used',
    'paste_used',
    'paste_plain_used',
    'dark_mode_enabled',
    'dark_mode_disabled',
    'link_created',
    'clear_data'
];

if (!in_array($event, $allowed_events)) {
    http_response_code(400);
    exit('Invalid event type');
}

// Anonymize IP
$anon_ip = anonymizeIP($ip);

// Get and sanitize user agent
$user_agent = isset($_SERVER['HTTP_USER_AGENT']) 
    ? substr($_SERVER['HTTP_USER_AGENT'], 0, 255) 
    : 'unknown';

// Database insertion using prepared statement (SQL Injection Prevention)
try {
    $conn = getDBConnection();
    
    // Prepare statement
    $stmt = $conn->prepare(
        "INSERT INTO analytics (event_type, ip_address, user_agent, created_at) 
         VALUES (?, ?, ?, NOW())"
    );
    
    if (!$stmt) {
        throw new Exception('Prepare failed: ' . $conn->error);
    }
    
    // Bind parameters (s = string)
    $stmt->bind_param('sss', $event, $anon_ip, $user_agent);
    
    // Execute
    if ($stmt->execute()) {
        http_response_code(200);
        echo 'OK';
    } else {
        throw new Exception('Execute failed: ' . $stmt->error);
    }
    
    $stmt->close();
    
} catch (Exception $e) {
    error_log('Track.php error: ' . $e->getMessage());
    http_response_code(500);
    exit('Server Error');
}
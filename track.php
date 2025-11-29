<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: text/plain");

// --- CONFIGURATION ---
$host = 'localhost';
$user = 'gniwvzcf_npad';
$pass = '9510290042AlirezA';
$db   = 'gniwvzcf_notepad';

// Connect
$conn = new mysqli($host, $user, $pass, $db);
if ($conn->connect_error) { 
    http_response_code(500);
    exit('DB Error');
}

// Handle POST request only
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['event'])) {
    
    $event = $conn->real_escape_string($_POST['event']);
    
    // Anonymize IP (GDPR friendly)
    $ip = $_SERVER['REMOTE_ADDR'];
    $parts = explode('.', $ip);
    if (count($parts) === 4) {
        array_pop($parts);
        $anon_ip = implode('.', $parts) . '.0';
    } else {
        $anon_ip = 'unknown';
    }
    
    $ua = isset($_SERVER['HTTP_USER_AGENT']) ? 
          $conn->real_escape_string(substr($_SERVER['HTTP_USER_AGENT'], 0, 255)) : 
          'unknown';

    // Insert
    $sql = "INSERT INTO analytics (event_type, ip_address, user_agent) 
            VALUES ('$event', '$anon_ip', '$ua')";
    
    if ($conn->query($sql)) {
        echo 'OK';
    } else {
        http_response_code(500);
        echo 'Insert Error';
    }
} else {
    http_response_code(400);
    echo 'Invalid Request';
}

$conn->close();
?>
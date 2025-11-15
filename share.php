<?php
header('Content-Type: application/json');

// === CONFIG ===
$DB_HOST = 'localhost';
$DB_USER = 'gniwvzcf_npad';
$DB_PASS = '9510290042AlirezA';
$DB_NAME = 'gniwvzcf_sharecenter';

// === CONNECT ===
$mysqli = new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
if ($mysqli->connect_error) {
    http_response_code(500);
    echo json_encode(["error" => "Database connection failed"]);
    exit;
}

// === CREATE TABLE IF NOT EXISTS ===
$createTable = "
CREATE TABLE IF NOT EXISTS shared_files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hash VARCHAR(10) UNIQUE NOT NULL,
    html TEXT NOT NULL,
    password_hash VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)";
$mysqli->query($createTable);

$data = json_decode(file_get_contents("php://input"), true);
$html = $data['html'] ?? '';
$password = $data['password'] ?? null; // Added password field

// === BASIC SANITIZATION ===
// HTML is treated as plain text when saved, prevents execution
$sanitizedHtml = $html; // trust that frontend will handle sanitizing


// === GENERATE UNIQUE HASH ===
function generateHash($length = 10) {
    return substr(str_shuffle(str_repeat('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 50)), 0, $length);
}
$hash = generateHash();
while ($mysqli->query("SELECT 1 FROM shared_files WHERE hash = '$hash'")->num_rows > 0) {
    $hash = generateHash();
}

// === HASH PASSWORD IF GIVEN ===
$passwordHash = $password ? password_hash($password, PASSWORD_DEFAULT) : null;

// === INSERT INTO DATABASE ===
$stmt = $mysqli->prepare("INSERT INTO shared_files (hash, html, password_hash) VALUES (?, ?, ?)");
$stmt->bind_param("sss", $hash, $sanitizedHtml, $passwordHash);
$success = $stmt->execute();




// === RETURN RESPONSE ===
if ($success) {
    echo json_encode(["success" => true, "hash" => $hash]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "error" => "Failed to store data"]);
}
?>

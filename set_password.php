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

// === PARSE POST DATA ===
$data = json_decode(file_get_contents("php://input"), true);
$hash = $data['hash'] ?? '';
$password = $data['password'] ?? null;

if (!$hash || strlen($hash) !== 10) {
    http_response_code(400);
    echo json_encode(["success" => false, "error" => "Invalid hash"]);
    exit;
}

if (!$password) {
    http_response_code(400);
    echo json_encode(["success" => false, "error" => "Password required"]);
    exit;
}

// === UPDATE PASSWORD ===
$passwordHash = password_hash($password, PASSWORD_DEFAULT);
$stmt = $mysqli->prepare("UPDATE shared_files SET password_hash = ? WHERE hash = ?");
$stmt->bind_param("ss", $passwordHash, $hash);
$success = $stmt->execute();

// === RETURN RESPONSE ===
if ($success && $stmt->affected_rows > 0) {
    echo json_encode(["success" => true]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "error" => "Failed to update password"]);
}
?>
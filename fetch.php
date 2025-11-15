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
    echo json_encode(["success" => false, "error" => "Database connection failed"]);
    exit;
}

// === READ HASH FROM GET ===
$hash = $_GET['hash'] ?? '';
if (!$hash || strlen($hash) !== 10) {
    http_response_code(400);
    echo json_encode(["success" => false, "error" => "Invalid or missing hash"]);
    exit;
}

// === READ PASSWORD FROM BODY ===
$input = json_decode(file_get_contents("php://input"), true);
$password = $input['password'] ?? null;

// === FETCH ROW ===
$stmt = $mysqli->prepare("SELECT html, password_hash FROM shared_files WHERE hash = ?");
$stmt->bind_param("s", $hash);
$stmt->execute();
$result = $stmt->get_result();

if ($result->num_rows === 0) {
    echo json_encode(["success" => false, "error" => "File not found"]);
    exit;
}

$row = $result->fetch_assoc();
$storedHtml = $row['html'];
$storedPasswordHash = $row['password_hash'];

if ($storedPasswordHash) {
    if (!$password) {
        echo json_encode(["password_required" => true]);
        exit;
    }

    // In fetch.php, modify the password verification section:
    if (!password_verify($password, $storedPasswordHash)) {
        http_response_code(401); // Unauthorized
        echo json_encode(["success" => false, "error" => "Incorrect password"]);
        exit;
    }
}

// === Return content ===
echo json_encode([
    "success" => true,
    "html" => $storedHtml
]);
?>

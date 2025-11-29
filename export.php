<?php
session_start();
if (!isset($_SESSION['logged_in'])) {
    header('Location: dashboard.php');
    exit;
}

// DB Connection
$conn = new mysqli('localhost', 'gniwvzcf_npad', '9510290042AlirezA', 'gniwvzcf_notepad');

// Fetch all data
$result = $conn->query("SELECT * FROM analytics ORDER BY created_at DESC");

// Set CSV headers
header('Content-Type: text/csv');
header('Content-Disposition: attachment; filename="analytics_export_' . date('Y-m-d') . '.csv"');

$output = fopen('php://output', 'w');

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
$conn->close();
exit;
?>
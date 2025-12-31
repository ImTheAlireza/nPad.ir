<?php

if (!defined('CONFIG_LOADED')) {
    die('Direct access not permitted');
}


define('DB_HOST', 'localhost');
define('DB_USER', 'gniwvzcf_npad');       
define('DB_PASS', '9510290042AlirezA');  
define('DB_NAME', 'gniwvzcf_notepad');


define('ADMIN_PASSWORD_HASH', password_hash('9510290042', PASSWORD_BCRYPT));


define('ALLOWED_ORIGIN', 'https://npad.ir'); 
define('SESSION_LIFETIME', 3600); 
define('MAX_REQUESTS_PER_MINUTE', 60); 
define('MAX_EVENT_LENGTH', 100); 


define('TIMEZONE', 'Asia/Tehran');
date_default_timezone_set(TIMEZONE);

error_reporting(E_ALL);
ini_set('display_errors', '0'); 
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/error.log');


function getDBConnection() {
    static $conn = null;
    
    if ($conn === null) {
        $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
        
        if ($conn->connect_error) {
            error_log('Database connection failed: ' . $conn->connect_error);
            throw new Exception('Database connection failed');
        }
        
      
        $conn->set_charset('utf8mb4');
        
       
        $conn->query("SET time_zone = '+03:30'");
    }
    
    return $conn;
}

function verifyAdminPassword($password) {
    return password_verify($password, ADMIN_PASSWORD_HASH);
}
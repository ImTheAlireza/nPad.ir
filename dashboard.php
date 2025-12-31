<?php
/**
 * Enhanced Analytics Dashboard
 * Fixed: Session Security, CSRF Protection, SQL Injection, Input Validation
 * Enhanced: More metrics, IP tracking, date/time display, activity breakdown
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

/**
 * Generate CSRF Token
 */
function generateCSRFToken() {
    if (!isset($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/**
 * Verify CSRF Token
 */
function verifyCSRFToken($token) {
    return isset($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

/**
 * Check if session is expired
 */
function isSessionExpired() {
    if (isset($_SESSION['last_activity'])) {
        $inactive_time = time() - $_SESSION['last_activity'];
        if ($inactive_time > SESSION_LIFETIME) {
            return true;
        }
    }
    $_SESSION['last_activity'] = time();
    return false;
}

// Handle logout
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: dashboard.php');
    exit;
}

// Check session expiry
if (isset($_SESSION['logged_in']) && isSessionExpired()) {
    session_destroy();
    session_start();
    $_SESSION['login_error'] = 'Session expired. Please login again.';
}

// Handle login
if (isset($_POST['password']) && isset($_POST['csrf_token'])) {
    if (!verifyCSRFToken($_POST['csrf_token'])) {
        $_SESSION['login_error'] = 'Invalid security token. Please try again.';
    } else {
        if (verifyAdminPassword($_POST['password'])) {
            session_regenerate_id(true);
            $_SESSION['logged_in'] = true;
            $_SESSION['login_time'] = time();
            $_SESSION['last_activity'] = time();
            unset($_SESSION['login_error']);
            header('Location: dashboard.php');
            exit;
        } else {
            $_SESSION['login_error'] = 'Invalid password.';
            sleep(1);
        }
    }
}

// Show login page if not authenticated
if (!isset($_SESSION['logged_in'])) {
    $csrf_token = generateCSRFToken();
    $error_message = $_SESSION['login_error'] ?? '';
    unset($_SESSION['login_error']);
    ?>
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard Login</title>
        <style>
            body{font-family:'Inter',sans-serif;background-color:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;overflow:hidden}.blob{position:absolute;filter:blur(80px);z-index:-1;opacity:.6;animation:move 20s infinite alternate}.blob-1{top:10%;left:20%;width:300px;height:300px;background:#7c3aed;border-radius:40% 60% 70% 30%}.blob-2{bottom:20%;right:20%;width:350px;height:350px;background:#06b6d4;border-radius:60% 40% 30% 70%;animation-delay:-5s}@keyframes move{0%{transform:translate(0,0) rotate(0deg)}100%{transform:translate(50px,50px) rotate(20deg)}}.login-box{background:rgba(15,23,42,.6);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);padding:40px;border-radius:20px;width:100%;max-width:350px;box-shadow:0 25px 50px -12px rgba(0,0,0,.5)}h2{text-align:center;margin-bottom:24px;font-weight:600}input{width:100%;padding:12px 16px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:white;margin-bottom:20px;box-sizing:border-box;outline:0;transition:.3s}input:focus{border-color:#06b6d4}button{width:100%;padding:12px;background:linear-gradient(135deg,#06b6d4,#3b82f6);color:white;border:0;border-radius:10px;font-weight:600;cursor:pointer;transition:.2s}button:hover{opacity:.9}.error{background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);color:#fca5a5;padding:12px;border-radius:8px;margin-bottom:20px;font-size:14px;text-align:center}
        </style>
    </head>
    <body>
        <div class="blob blob-1"></div>
        <div class="blob blob-2"></div>
        <div class="login-box">
            <h2><i class="fas fa-rocket"></i> Access Node</h2>
            <?php if ($error_message): ?>
                <div class="error"><?php echo htmlspecialchars($error_message); ?></div>
            <?php endif; ?>
            <form method="POST">
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrf_token); ?>">
                <input type="password" name="password" placeholder="Enter security key..." required autofocus>
                <button type="submit">Authenticate</button>
            </form>
        </div>
    </body>
    </html>
    <?php
    exit;
}

// User is logged in - Generate new CSRF token for actions
$csrf_token = generateCSRFToken();

// --- DATABASE CONNECTION ---
try {
    $conn = getDBConnection();
} catch (Exception $e) {
    die('Database connection failed. Please check configuration.');
}

// Get current admin IP for highlighting
$admin_ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

// --- DATA FILTER WITH VALIDATION ---
$allowed_filters = ['all', 'today', 'week', 'month'];
$date_filter = isset($_GET['filter']) && in_array($_GET['filter'], $allowed_filters) 
    ? $_GET['filter'] 
    : 'all';

$time_condition = "1=1";

switch($date_filter) {
    case 'today': 
        $time_condition = "DATE(created_at) = CURDATE()"; 
        break;
    case 'week':  
        $time_condition = "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"; 
        break;
    case 'month': 
        $time_condition = "created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"; 
        break;
}

function buildQuery($base_where = "") {
    global $time_condition;
    if ($base_where === "") {
        return "WHERE $time_condition";
    } else {
        return "WHERE $base_where AND $time_condition";
    }
}

// --- ENHANCED METRICS ---
$stmt = $conn->prepare("SELECT COUNT(*) as c FROM analytics " . buildQuery());
$stmt->execute();
$total_events = $stmt->get_result()->fetch_assoc()['c'];
$stmt->close();

$stmt = $conn->prepare("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='page_view'"));
$stmt->execute();
$total_visits = $stmt->get_result()->fetch_assoc()['c'];
$stmt->close();

$stmt = $conn->prepare("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='download_txt'"));
$stmt->execute();
$total_saves = $stmt->get_result()->fetch_assoc()['c'];
$stmt->close();

$stmt = $conn->prepare("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='print_used'"));
$stmt->execute();
$total_prints = $stmt->get_result()->fetch_assoc()['c'];
$stmt->close();

$stmt = $conn->prepare("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='dark_mode_enabled'"));
$stmt->execute();
$dark_mode_users = $stmt->get_result()->fetch_assoc()['c'];
$stmt->close();

$stmt = $conn->prepare("SELECT COUNT(DISTINCT ip_address) as c FROM analytics " . buildQuery());
$stmt->execute();
$unique_ips = $stmt->get_result()->fetch_assoc()['c'];
$stmt->close();

// NEW: Copy/Paste actions
$stmt = $conn->prepare("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type IN ('copy_used', 'cut_used', 'paste_used', 'paste_plain_used')"));
$stmt->execute();
$clipboard_actions = $stmt->get_result()->fetch_assoc()['c'];
$stmt->close();

// NEW: Link creation count
$stmt = $conn->prepare("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='link_created'"));
$stmt->execute();
$links_created = $stmt->get_result()->fetch_assoc()['c'];
$stmt->close();

// NEW: New file actions
$stmt = $conn->prepare("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='new_file'"));
$stmt->execute();
$new_files = $stmt->get_result()->fetch_assoc()['c'];
$stmt->close();

// NEW: Average events per visitor
$avg_events_per_ip = $unique_ips > 0 ? round($total_events / $unique_ips, 1) : 0;

// NEW: Most active IP
$most_active_result = $conn->query("
    SELECT ip_address, COUNT(*) as count 
    FROM analytics 
    " . buildQuery() . " 
    GROUP BY ip_address 
    ORDER BY count DESC 
    LIMIT 1
");
$most_active_ip = $most_active_result->fetch_assoc();

// NEW: Peak hour
$peak_hour_result = $conn->query("
    SELECT HOUR(created_at) as hour, COUNT(*) as count 
    FROM analytics 
    " . buildQuery() . " 
    GROUP BY HOUR(created_at) 
    ORDER BY count DESC 
    LIMIT 1
");
$peak_hour = $peak_hour_result->fetch_assoc();

// --- CHARTS DATA ---
$main_filter_sql = buildQuery();

$hourly = $conn->query("
    SELECT HOUR(created_at) as hour, COUNT(*) as count 
    FROM analytics 
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) 
    GROUP BY HOUR(created_at) 
    ORDER BY hour
");

$daily = $conn->query("
    SELECT DATE(created_at) as date, COUNT(*) as count 
    FROM analytics 
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) 
    GROUP BY DATE(created_at) 
    ORDER BY date
");

$user_agents = $conn->query("
    SELECT 
        CASE 
            WHEN user_agent LIKE '%Chrome%' THEN 'Chrome' 
            WHEN user_agent LIKE '%Firefox%' THEN 'Firefox' 
            WHEN user_agent LIKE '%Safari%' AND user_agent NOT LIKE '%Chrome%' THEN 'Safari' 
            WHEN user_agent LIKE '%Edge%' THEN 'Edge' 
            ELSE 'Other' 
        END as browser, 
        COUNT(*) as count 
    FROM analytics 
    $main_filter_sql 
    GROUP BY browser 
    ORDER BY count DESC 
    LIMIT 5
");

$breakdown = $conn->query("
    SELECT event_type, COUNT(*) as count 
    FROM analytics 
    $main_filter_sql 
    GROUP BY event_type 
    ORDER BY count DESC 
    LIMIT 10
");

// ENHANCED: Recent activity with more details (25 instead of 12)
$recent = $conn->query("
    SELECT event_type, ip_address, user_agent, created_at 
    FROM analytics 
    ORDER BY created_at DESC 
    LIMIT 25
");

// NEW: Top IPs by activity
$top_ips = $conn->query("
    SELECT ip_address, COUNT(*) as count 
    FROM analytics 
    $main_filter_sql 
    GROUP BY ip_address 
    ORDER BY count DESC 
    LIMIT 10
");

// Process data for JavaScript
$hourly_labels = []; 
$hourly_data = []; 
while($row = $hourly->fetch_assoc()) { 
    $hourly_labels[] = $row['hour'] . ':00'; 
    $hourly_data[] = (int)$row['count']; 
}

$daily_labels = []; 
$daily_data = []; 
while($row = $daily->fetch_assoc()) { 
    $daily_labels[] = date('M d', strtotime($row['date'])); 
    $daily_data[] = (int)$row['count']; 
}

$browser_labels = []; 
$browser_data = []; 
while($row = $user_agents->fetch_assoc()) { 
    $browser_labels[] = $row['browser']; 
    $browser_data[] = (int)$row['count']; 
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Enhanced Analytics Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
    <style>
        :root {
            --bg: #0f172a;
            --card-bg: rgba(15, 23, 42, 0.65);
            --border: rgba(255, 255, 255, 0.06);
            --text: #94a3b8;
            --text-light: #f1f5f9;
            --accent: #06b6d4;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            min-height: 100vh;
            overflow-x: hidden;
            font-size: 13px;
        }

        .blob {
            position: fixed;
            border-radius: 50%;
            filter: blur(100px);
            z-index: -1;
            opacity: 0.4;
            animation: float 20s infinite alternate;
        }
        .blob-1 { top: -10%; left: -10%; width: 600px; height: 600px; background: #4c1d95; }
        .blob-2 { bottom: -10%; right: -10%; width: 500px; height: 500px; background: #155e75; animation-delay: -5s; }
        .blob-3 { top: 40%; left: 40%; width: 300px; height: 300px; background: #be185d; opacity: 0.2; animation-delay: -10s; }

        @keyframes float { from { transform: translate(0,0); } to { transform: translate(40px, 40px); } }

        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }

        .glass {
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 16px;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
        }

        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 16px 24px; flex-wrap: wrap; gap: 15px; }
        .header h1 { color: var(--text-light); font-size: 18px; font-weight: 600; margin: 0; }
        .header .admin-ip { font-size: 11px; color: var(--text); margin-left: 10px; padding: 4px 10px; background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 6px; }
        
        .nav-group { display: flex; gap: 6px; background: rgba(0,0,0,0.3); padding: 4px; border-radius: 10px; border: 1px solid var(--border); }
        .btn { padding: 6px 14px; border-radius: 8px; color: var(--text); text-decoration: none; transition: 0.2s; font-weight: 500; }
        .btn:hover { color: var(--text-light); background: rgba(255,255,255,0.05); }
        .btn.active { background: var(--accent); color: #fff; }
        .btn-icon { padding: 8px 12px; color: var(--text); border: 1px solid var(--border); border-radius: 10px; background: rgba(0,0,0,0.2); text-decoration: none; margin-left: 10px; transition: 0.2s; }
        .btn-icon:hover { background: rgba(6, 182, 212, 0.2); color: var(--accent); }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .stat-card { padding: 16px; position: relative; overflow: hidden; }
        .stat-card::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, var(--accent), transparent); opacity: 0.5; }
        .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
        .stat-icon { font-size: 14px; opacity: 0.6; }
        .stat-value { font-size: 24px; font-weight: 700; color: var(--text-light); }
        .stat-subtext { font-size: 10px; margin-top: 4px; opacity: 0.7; }

        .grid-2-1 { display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 15px; }
        .grid-1-1 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; }
        .grid-1-2 { display: grid; grid-template-columns: 1fr 2fr; gap: 15px; margin-bottom: 15px; }

        .chart-card { padding: 20px; }
        .chart-card h3 { color: var(--text-light); font-size: 14px; margin-bottom: 15px; font-weight: 500; }
        
        .chart-box { position: relative; height: 220px; width: 100%; }

        .table-container { padding: 0; overflow: hidden; max-height: 600px; overflow-y: auto; }
        .table-header { padding: 15px 20px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--card-bg); backdrop-filter: blur(20px); z-index: 10; }
        .table-header h3 { margin: 0; font-size: 14px; color: var(--text-light); }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border); }
        th { font-size: 11px; text-transform: uppercase; font-weight: 600; background: rgba(0,0,0,0.2); position: sticky; top: 51px; z-index: 5; }
        td { font-size: 12px; color: var(--text-light); }

        .tag { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; border: 1px solid transparent; white-space: nowrap; }
        .tag-view { border-color: rgba(6, 182, 212, 0.3); color: #06b6d4; background: rgba(6, 182, 212, 0.1); }
        .tag-save { border-color: rgba(34, 197, 94, 0.3); color: #22c55e; background: rgba(34, 197, 94, 0.1); }
        .tag-dark { border-color: rgba(168, 85, 247, 0.3); color: #a855f7; background: rgba(168, 85, 247, 0.1); }
        .tag-clipboard { border-color: rgba(251, 146, 60, 0.3); color: #fb923c; background: rgba(251, 146, 60, 0.1); }
        .tag-other { border-color: rgba(100, 116, 139, 0.3); color: #64748b; background: rgba(100, 116, 139, 0.1); }
        
        .ip-cell { font-family: monospace; opacity: 0.7; position: relative; }
        .ip-admin { color: #06b6d4 !important; opacity: 1 !important; font-weight: 600; }
        .ip-badge { display: inline-block; margin-left: 6px; padding: 2px 6px; background: rgba(6, 182, 212, 0.2); border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 4px; font-size: 9px; color: #06b6d4; }
        
        .datetime-cell { font-size: 11px; }
        .date-part { display: block; opacity: 0.6; }
        .time-part { display: block; font-weight: 600; }
        
        .browser-badge { display: inline-block; padding: 2px 6px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 4px; font-size: 9px; color: #3b82f6; margin-left: 4px; }
        
        @media (max-width: 1200px) { 
            .grid-2-1, .grid-1-2, .grid-1-1 { grid-template-columns: 1fr; } 
            .stats-grid { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
        }
        @media (max-width: 600px) { 
            .header { flex-direction: column; gap: 15px; } 
            .nav-group { width: 100%; justify-content: space-between; } 
        }
    </style>
</head>
<body>

    <div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div>

    <div class="container">
        
        <div class="glass header">
            <div>
                <h1><i class="fas fa-rocket"></i> NPad Analytics</h1>
                <span class="admin-ip"><i class="fas fa-user-shield"></i> Your IP: <?php echo htmlspecialchars($admin_ip); ?></span>
            </div>
            <div style="display:flex; align-items:center; flex-wrap: wrap; gap: 10px;">
                <nav class="nav-group">
                    <a href="?filter=all" class="btn <?php echo $date_filter=='all'?'active':''; ?>">All</a>
                    <a href="?filter=today" class="btn <?php echo $date_filter=='today'?'active':''; ?>">Today</a>
                    <a href="?filter=week" class="btn <?php echo $date_filter=='week'?'active':''; ?>">Week</a>
                    <a href="?filter=month" class="btn <?php echo $date_filter=='month'?'active':''; ?>">Month</a>
                </nav>
                <a href="export.php" class="btn-icon" title="Export CSV"><i class="fas fa-download"></i></a>
                <a href="?logout" class="btn-icon" title="Logout"><i class="fas fa-power-off"></i></a>
            </div>
        </div>

        <div class="stats-grid">
            <div class="glass stat-card">
                <div class="stat-label"><span class="stat-icon">📊</span> Total Events</div>
                <div class="stat-value"><?php echo number_format($total_events); ?></div>
                <div class="stat-subtext"><?php echo $avg_events_per_ip; ?> avg per visitor</div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label"><span class="stat-icon">👁️</span> Page Views</div>
                <div class="stat-value" style="color:#06b6d4"><?php echo number_format($total_visits); ?></div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label"><span class="stat-icon">🌐</span> Unique Visitors</div>
                <div class="stat-value"><?php echo number_format($unique_ips); ?></div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label"><span class="stat-icon">💾</span> Downloads</div>
                <div class="stat-value" style="color:#22c55e"><?php echo number_format($total_saves); ?></div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label"><span class="stat-icon">🌙</span> Dark Mode</div>
                <div class="stat-value" style="color:#a855f7"><?php echo number_format($dark_mode_users); ?></div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label"><span class="stat-icon">📋</span> Clipboard</div>
                <div class="stat-value" style="color:#fb923c"><?php echo number_format($clipboard_actions); ?></div>
                <div class="stat-subtext">Copy/Cut/Paste</div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label"><span class="stat-icon">🖨️</span> Prints</div>
                <div class="stat-value" style="color:#8b5cf6"><?php echo number_format($total_prints); ?></div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label"><span class="stat-icon">⏰</span> Peak Hour</div>
                <div class="stat-value" style="color:#f59e0b"><?php echo $peak_hour ? $peak_hour['hour'] . ':00' : 'N/A'; ?></div>
                <div class="stat-subtext"><?php echo $peak_hour ? number_format($peak_hour['count']) . ' events' : ''; ?></div>
            </div>
        </div>

        <div class="grid-2-1">
            <div class="glass chart-card">
                <h3><i class="fas fa-chart-line"></i> Activity Trend (24h)</h3>
                <div class="chart-box">
                    <canvas id="hourlyChart"></canvas>
                </div>
            </div>
            <div class="glass chart-card">
                <h3><i class="fas fa-globe"></i> Browser Usage</h3>
                <div class="chart-box">
                    <canvas id="browserChart"></canvas>
                </div>
            </div>
        </div>

        <div class="grid-1-1">
            <div class="glass chart-card">
                <h3><i class="fas fa-chart-pie"></i> Event Distribution</h3>
                <div class="chart-box">
                    <canvas id="eventChart"></canvas>
                </div>
            </div>
            <div class="glass chart-card">
                <h3><i class="fas fa-chart-bar"></i> Daily Activity (7 Days)</h3>
                <div class="chart-box">
                    <canvas id="dailyChart"></canvas>
                </div>
            </div>
        </div>

        <div class="grid-1-2">
            <div class="glass table-container">
                <div class="table-header"><h3><i class="fas fa-users"></i> Top 10 IPs</h3></div>
                <table>
                    <thead><tr><th>IP Address</th><th>Events</th></tr></thead>
                    <tbody>
                        <?php while($row = $top_ips->fetch_assoc()): 
                            $is_admin = ($row['ip_address'] === $admin_ip);
                        ?>
                        <tr>
                            <td class="ip-cell <?php echo $is_admin ? 'ip-admin' : ''; ?>">
                                <?php echo htmlspecialchars($row['ip_address']); ?>
                                <?php if($is_admin): ?>
                                    <span class="ip-badge">YOU</span>
                                <?php endif; ?>
                            </td>
                            <td style="font-weight: 600;"><?php echo number_format($row['count']); ?></td>
                        </tr>
                        <?php endwhile; ?>
                    </tbody>
                </table>
            </div>
            
            <div class="glass table-container">
                <div class="table-header"><h3><i class="fas fa-stream"></i> Live Feed (Last 25)</h3></div>
                <table>
                    <thead><tr><th>Event</th><th>IP</th><th>Date & Time</th></tr></thead>
                    <tbody>
                        <?php while($row = $recent->fetch_assoc()): 
                            $cls = 'tag-other';
                            if($row['event_type']=='page_view') $cls='tag-view';
                            elseif($row['event_type']=='download_txt') $cls='tag-save';
                            elseif(strpos($row['event_type'], 'dark_mode') !== false) $cls='tag-dark';
                            elseif(in_array($row['event_type'], ['copy_used', 'cut_used', 'paste_used', 'paste_plain_used'])) $cls='tag-clipboard';
                            
                            $is_admin = ($row['ip_address'] === $admin_ip);
                            
                            // Extract browser info
                            $browser = 'Unknown';
                            if(strpos($row['user_agent'], 'Chrome') !== false) $browser = 'Chrome';
                            elseif(strpos($row['user_agent'], 'Firefox') !== false) $browser = 'Firefox';
                            elseif(strpos($row['user_agent'], 'Safari') !== false && strpos($row['user_agent'], 'Chrome') === false) $browser = 'Safari';
                            elseif(strpos($row['user_agent'], 'Edge') !== false) $browser = 'Edge';
                        ?>
                        <tr>
                            <td><span class="tag <?php echo $cls; ?>"><?php echo htmlspecialchars($row['event_type']); ?></span></td>
                            <td class="ip-cell <?php echo $is_admin ? 'ip-admin' : ''; ?>">
                                <?php echo htmlspecialchars($row['ip_address']); ?>
                                <?php if($is_admin): ?>
                                    <span class="ip-badge">YOU</span>
                                <?php endif; ?>
                                <span class="browser-badge"><?php echo $browser; ?></span>
                            </td>
                            <td class="datetime-cell">
                                <span class="date-part"><?php echo htmlspecialchars(date('M d, Y', strtotime($row['created_at']))); ?></span>
                                <span class="time-part"><?php echo htmlspecialchars(date('H:i:s', strtotime($row['created_at']))); ?></span>
                            </td>
                        </tr>
                        <?php endwhile; ?>
                    </tbody>
                </table>
            </div>
        </div>

    </div>

    <script>
        Chart.defaults.color = '#64748b';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
        Chart.defaults.font.family = "'Inter', sans-serif";
        Chart.defaults.font.size = 11;

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false } },
                y: { border: { display: false } }
            }
        };

        new Chart(document.getElementById('hourlyChart'), {
            type: 'line',
            data: {
                labels: <?php echo json_encode($hourly_labels); ?>,
                datasets: [{
                    data: <?php echo json_encode($hourly_data); ?>,
                    borderColor: '#06b6d4',
                    borderWidth: 2,
                    backgroundColor: (ctx) => {
                        const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220);
                        gradient.addColorStop(0, 'rgba(6, 182, 212, 0.3)');
                        gradient.addColorStop(1, 'rgba(6, 182, 212, 0)');
                        return gradient;
                    },
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6
                }]
            },
            options: { ...commonOptions, interaction: { intersect: false, mode: 'index' } }
        });

        new Chart(document.getElementById('browserChart'), {
            type: 'doughnut',
            data: {
                labels: <?php echo json_encode($browser_labels); ?>,
                datasets: [{
                    data: <?php echo json_encode($browser_data); ?>,
                    backgroundColor: ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#64748b'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: { legend: { display: true, position: 'right', labels: { boxWidth: 10, color: '#94a3b8' } } }
            }
        });

        <?php 
        $breakdown->data_seek(0);
        $ev_l = []; $ev_d = [];
        while($r = $breakdown->fetch_assoc()) { 
            $ev_l[] = $r['event_type']; 
            $ev_d[] = (int)$r['count']; 
        }
        ?>
        new Chart(document.getElementById('eventChart'), {
            type: 'bar',
            data: {
                labels: <?php echo json_encode($ev_l); ?>,
                datasets: [{
                    data: <?php echo json_encode($ev_d); ?>,
                    backgroundColor: '#8b5cf6',
                    borderRadius: 4,
                    barThickness: 16
                }]
            },
            options: { ...commonOptions, indexAxis: 'y' }
        });

        new Chart(document.getElementById('dailyChart'), {
            type: 'bar',
            data: {
                labels: <?php echo json_encode($daily_labels); ?>,
                datasets: [{
                    data: <?php echo json_encode($daily_data); ?>,
                    backgroundColor: (ctx) => {
                        const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220);
                        gradient.addColorStop(0, 'rgba(6, 182, 212, 0.8)');
                        gradient.addColorStop(1, 'rgba(6, 182, 212, 0.3)');
                        return gradient;
                    },
                    borderRadius: 6,
                    borderWidth: 0
                }]
            },
            options: { 
                ...commonOptions,
                scales: {
                    x: { grid: { display: false } },
                    y: { 
                        border: { display: false },
                        beginAtZero: true
                    }
                }
            }
        });
    </script>
</body>
</html>

<?php $conn->close(); ?>
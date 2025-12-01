<?php
// --- SECURITY ---
$admin_password = "9510290042";

session_start();

// Handle logout
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: dashboard.php');
    exit;
}

// Handle login
if (isset($_POST['password']) && $_POST['password'] === $admin_password) {
    $_SESSION['logged_in'] = true;
}

if (!isset($_SESSION['logged_in'])) {
    // ... (Login HTML remains the same, omitted for brevity, reusing previous login style)
    ?>
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard Login</title>
        <style>
            body{font-family:'Inter',sans-serif;background-color:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;overflow:hidden}.blob{position:absolute;filter:blur(80px);z-index:-1;opacity:.6;animation:move 20s infinite alternate}.blob-1{top:10%;left:20%;width:300px;height:300px;background:#7c3aed;border-radius:40% 60% 70% 30%}.blob-2{bottom:20%;right:20%;width:350px;height:350px;background:#06b6d4;border-radius:60% 40% 30% 70%;animation-delay:-5s}@keyframes move{0%{transform:translate(0,0) rotate(0deg)}100%{transform:translate(50px,50px) rotate(20deg)}}.login-box{background:rgba(15,23,42,.6);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);padding:40px;border-radius:20px;width:100%;max-width:350px;box-shadow:0 25px 50px -12px rgba(0,0,0,.5)}h2{text-align:center;margin-bottom:24px;font-weight:600}input{width:100%;padding:12px 16px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:white;margin-bottom:20px;box-sizing:border-box;outline:0;transition:.3s}input:focus{border-color:#06b6d4}button{width:100%;padding:12px;background:linear-gradient(135deg,#06b6d4,#3b82f6);color:white;border:0;border-radius:10px;font-weight:600;cursor:pointer;transition:.2s}button:hover{opacity:.9}
        </style>
    </head>
    <body><div class="blob blob-1"></div><div class="blob blob-2"></div><div class="login-box"><h2>Access Node</h2><form method="POST"><input type="password" name="password" placeholder="Enter security key..." required autofocus><button type="submit">Authenticate</button></form></div></body></html>
    <?php
    exit;
}

// --- DB CONNECTION ---
$conn = new mysqli('localhost', 'gniwvzcf_npad', '9510290042AlirezA', 'gniwvzcf_notepad');

// --- TIMEZONE FIX (Iran) ---
date_default_timezone_set('Asia/Tehran');
$conn->query("SET time_zone = '+03:30'");

if ($conn->connect_error) { die("Connection failed: " . $conn->connect_error); }

// --- DATA FILTER LOGIC (FIXED) ---
$date_filter = isset($_GET['filter']) ? $_GET['filter'] : 'all';
$time_condition = ""; // Just the condition, not the "WHERE" keyword

switch($date_filter) {
    case 'today': $time_condition = "DATE(created_at) = CURDATE()"; break;
    case 'week':  $time_condition = "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"; break;
    case 'month': $time_condition = "created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"; break;
    default:      $time_condition = "1=1"; break; // Always true for 'all'
}

// Helper function to build queries safely
function buildQuery($base_where = "") {
    global $time_condition;
    if ($base_where === "") {
        return "WHERE $time_condition";
    } else {
        return "WHERE $base_where AND $time_condition";
    }
}

// --- QUERIES (USING HELPER) ---
$total_events = $conn->query("SELECT COUNT(*) as c FROM analytics " . buildQuery())->fetch_assoc()['c'];

// Fix: These now use AND properly
$total_visits = $conn->query("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='page_view'"))->fetch_assoc()['c'];
$total_saves  = $conn->query("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='download_txt'"))->fetch_assoc()['c'];
$total_prints = $conn->query("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='print_used'"))->fetch_assoc()['c'];
$dark_mode_users = $conn->query("SELECT COUNT(*) as c FROM analytics " . buildQuery("event_type='dark_mode_enabled'"))->fetch_assoc()['c'];
$unique_ips   = $conn->query("SELECT COUNT(DISTINCT ip_address) as c FROM analytics " . buildQuery())->fetch_assoc()['c'];

// --- CHARTS DATA ---
// Note: Charts usually show trend, so we often keep them broader, but here we apply filter to Breakdown/Browsers
$main_filter_sql = buildQuery();

// Charts
$hourly = $conn->query("SELECT HOUR(created_at) as hour, COUNT(*) as count FROM analytics WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) GROUP BY HOUR(created_at) ORDER BY hour");
$daily = $conn->query("SELECT DATE(created_at) as date, COUNT(*) as count FROM analytics WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY date");

// These adhere to the specific filter
$user_agents = $conn->query("SELECT CASE WHEN user_agent LIKE '%Chrome%' THEN 'Chrome' WHEN user_agent LIKE '%Firefox%' THEN 'Firefox' WHEN user_agent LIKE '%Safari%' AND user_agent NOT LIKE '%Chrome%' THEN 'Safari' WHEN user_agent LIKE '%Edge%' THEN 'Edge' ELSE 'Other' END as browser, COUNT(*) as count FROM analytics $main_filter_sql GROUP BY browser ORDER BY count DESC LIMIT 5");

$breakdown = $conn->query("SELECT event_type, COUNT(*) as count FROM analytics $main_filter_sql GROUP BY event_type ORDER BY count DESC LIMIT 6");

$recent = $conn->query("SELECT event_type, ip_address, created_at FROM analytics ORDER BY created_at DESC LIMIT 12");

// Process Data for JS
$hourly_labels = []; $hourly_data = []; while($row = $hourly->fetch_assoc()) { $hourly_labels[] = $row['hour'] . ':00'; $hourly_data[] = $row['count']; }
$daily_labels = []; $daily_data = []; while($row = $daily->fetch_assoc()) { $daily_labels[] = date('M d', strtotime($row['date'])); $daily_data[] = $row['count']; }
$browser_labels = []; $browser_data = []; while($row = $user_agents->fetch_assoc()) { $browser_labels[] = $row['browser']; $browser_data[] = $row['count']; }

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dark Analytics</title>
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

        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }

        .glass {
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 16px;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
        }

        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 16px 24px; }
        .header h1 { color: var(--text-light); font-size: 18px; font-weight: 600; margin: 0; }
        
        .nav-group { display: flex; gap: 6px; background: rgba(0,0,0,0.3); padding: 4px; border-radius: 10px; border: 1px solid var(--border); }
        .btn { padding: 6px 14px; border-radius: 8px; color: var(--text); text-decoration: none; transition: 0.2s; font-weight: 500; }
        .btn:hover { color: var(--text-light); background: rgba(255,255,255,0.05); }
        .btn.active { background: var(--accent); color: #fff; }
        .btn-icon { padding: 8px 12px; color: var(--text); border: 1px solid var(--border); border-radius: 10px; background: rgba(0,0,0,0.2); text-decoration: none; margin-left: 10px; }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .stat-card { padding: 16px; position: relative; overflow: hidden; }
        .stat-card::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, var(--accent), transparent); opacity: 0.5; }
        .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
        .stat-value { font-size: 24px; font-weight: 700; color: var(--text-light); }

        .grid-2-1 { display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 15px; }
        .grid-1-2 { display: grid; grid-template-columns: 1fr 2fr; gap: 15px; margin-bottom: 15px; }

        .chart-card { padding: 20px; }
        .chart-card h3 { color: var(--text-light); font-size: 14px; margin-bottom: 15px; font-weight: 500; }
        
        /* FIXED HEIGHT WRAPPER FOR CHARTS TO PREVENT EXPANSION */
        .chart-box { position: relative; height: 220px; width: 100%; }

        .table-container { padding: 0; overflow: hidden; }
        .table-header { padding: 15px 20px; border-bottom: 1px solid var(--border); }
        .table-header h3 { margin: 0; font-size: 14px; color: var(--text-light); }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px 20px; text-align: left; border-bottom: 1px solid var(--border); }
        th { font-size: 11px; text-transform: uppercase; font-weight: 600; background: rgba(0,0,0,0.2); }
        td { font-size: 12px; color: var(--text-light); }

        .tag { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; border: 1px solid transparent; }
        .tag-view { border-color: rgba(6, 182, 212, 0.3); color: #06b6d4; background: rgba(6, 182, 212, 0.1); }
        .tag-save { border-color: rgba(34, 197, 94, 0.3); color: #22c55e; background: rgba(34, 197, 94, 0.1); }
        
        @media (max-width: 900px) { .grid-2-1, .grid-1-2 { grid-template-columns: 1fr; } }
        @media (max-width: 600px) { .header { flex-direction: column; gap: 15px; } .nav-group { width: 100%; justify-content: space-between; } }
    </style>
</head>
<body>

    <div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div>

    <div class="container">
        
        <div class="glass header">
            <h1><i class="fas fa-rocket"></i> NPad Analytics</h1>
            <div style="display:flex; align-items:center;">
                <nav class="nav-group">
                    <a href="?filter=all" class="btn <?php echo $date_filter=='all'?'active':''; ?>">All</a>
                    <a href="?filter=today" class="btn <?php echo $date_filter=='today'?'active':''; ?>">Today</a>
                    <a href="?filter=week" class="btn <?php echo $date_filter=='week'?'active':''; ?>">Week</a>
                </nav>
                <a href="export.php" class="btn-icon"><i class="fas fa-download"></i></a>
                <a href="?logout" class="btn-icon"><i class="fas fa-power-off"></i></a>
            </div>
        </div>

        <div class="stats-grid">
            <div class="glass stat-card">
                <div class="stat-label">Total Events</div>
                <div class="stat-value"><?php echo number_format($total_events); ?></div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label">Page Views</div>
                <div class="stat-value" style="color:#06b6d4"><?php echo number_format($total_visits); ?></div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label">Unique Visitors</div>
                <div class="stat-value"><?php echo number_format($unique_ips); ?></div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label">Downloads</div>
                <div class="stat-value" style="color:#22c55e"><?php echo number_format($total_saves); ?></div>
            </div>
            <div class="glass stat-card">
                <div class="stat-label">Dark Mode</div>
                <div class="stat-value" style="color:#a855f7"><?php echo number_format($dark_mode_users); ?></div>
            </div>
        </div>

        <div class="grid-2-1">
            <div class="glass chart-card">
                <h3>Activity Trend (24h)</h3>
                <div class="chart-box">
                    <canvas id="hourlyChart"></canvas>
                </div>
            </div>
            <div class="glass chart-card">
                <h3>Browser Usage</h3>
                <div class="chart-box">
                    <canvas id="browserChart"></canvas>
                </div>
            </div>
        </div>

        <div class="grid-1-2">
            <div class="glass chart-card">
                <h3>Event Distribution</h3>
                <div class="chart-box">
                    <canvas id="eventChart"></canvas>
                </div>
            </div>
            <div class="glass table-container">
                <div class="table-header"><h3>Live Feed (Last 12)</h3></div>
                <table>
                    <thead><tr><th>Event</th><th>IP</th><th>Time</th></tr></thead>
                    <tbody>
                        <?php while($row = $recent->fetch_assoc()): 
                            $cls = 'tag-other';
                            if($row['event_type']=='page_view') $cls='tag-view';
                            if($row['event_type']=='download_txt') $cls='tag-save';
                        ?>
                        <tr>
                            <td><span class="tag <?php echo $cls; ?>"><?php echo $row['event_type']; ?></span></td>
                            <td style="font-family:monospace; opacity:0.7;"><?php echo $row['ip_address']; ?></td>
                            <td><?php echo date('H:i', strtotime($row['created_at'])); ?></td>
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
        Chart.defaults.maintainAspectRatio = false; 

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
        while($r = $breakdown->fetch_assoc()) { $ev_l[] = $r['event_type']; $ev_d[] = $r['count']; }
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
    </script>
</body>
</html>


<?php $conn->close(); ?>


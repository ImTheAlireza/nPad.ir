<?php
/**
 * Analytics dashboard (private).
 *
 * Changes from the previous version:
 *  - config.php path fixed for the admin/ subdirectory
 *  - Chart.js self-hosted and version-pinned (was unpinned jsDelivr, no SRI)
 *  - Font Awesome dependency removed in favour of the inline icon set
 *  - date filter bound as a parameter rather than interpolated into SQL
 *  - graceful message when the database is not configured
 *  - shares the site's design tokens instead of a private copy
 */

declare(strict_types=1);

define('CONFIG_LOADED', true);

require_once dirname(__DIR__) . '/includes/bootstrap.php';
require_once dirname(__DIR__) . '/includes/icons.php';

if (!npad_analytics_enabled()) {
    http_response_code(503);
    echo '<!DOCTYPE html><meta charset="utf-8"><title>Unavailable</title>'
        . '<p style="font:16px system-ui;padding:2rem">Analytics is not configured. '
        . 'Create <code>config.php</code> with the database credentials.</p>';
    exit;
}

ini_set('session.cookie_httponly', '1');
ini_set('session.use_strict_mode', '1');
ini_set('session.cookie_samesite', 'Strict');
// The site is HTTPS-only at the edge (Cloudflare "Always Use HTTPS"), so the
// session cookie can be Secure unconditionally — even when the origin leg
// the request arrives on is plain HTTP and $_SERVER['HTTPS'] is unset.
ini_set('session.cookie_secure', '1');

session_start();

/**
 * Failed-login throttle (shared-password brute-force guard).
 *
 * File-based like api/track.php's limiter: LOCK_EX writes, one counter file
 * per IP, hard lockout after $maxFails failures inside the window. Also
 * sweeps stale throttle files so /tmp cannot fill up.
 */
const LOGIN_MAX_FAILS  = 8;    // failures before lockout
const LOGIN_WINDOW     = 900;  // counted within 15 minutes
const LOGIN_LOCKOUT    = 900;  // lockout duration: 15 minutes

function npad_login_throttle_file(string $ip): string
{
    return sys_get_temp_dir() . '/npad_login_' . hash('sha256', $ip);
}

/** @return array{count:int,until:int} */
function npad_login_state(string $ip): array
{
    $raw = @file_get_contents(npad_login_throttle_file($ip));
    $data = $raw ? json_decode($raw, true) : null;
    return is_array($data) && isset($data['count'], $data['until'])
        ? ['count' => (int) $data['count'], 'until' => (int) $data['until']]
        : ['count' => 0, 'until' => 0];
}

function npad_login_write(string $ip, array $state): void
{
    @file_put_contents(npad_login_throttle_file($ip), json_encode($state), LOCK_EX);
}

/** True while the IP is locked out. */
function npad_login_locked(string $ip): bool
{
    $state = npad_login_state($ip);
    return $state['until'] > time();
}

/** Record a failure; arm the lockout past the threshold. */
function npad_login_fail(string $ip): void
{
    $state = npad_login_state($ip);
    if ($state['until'] <= time()) {
        $state['count'] += 1;
        if ($state['count'] >= LOGIN_MAX_FAILS) {
            $state['until'] = time() + LOGIN_LOCKOUT;
            $state['count'] = 0;
        }
    }
    npad_login_write($ip, $state);

    // Opportunistic sweep: drop throttle files untouched for 2+ hours.
    $prefix = sys_get_temp_dir() . '/npad_login_';
    foreach (glob($prefix . '*') ?: [] as $stale) {
        if (is_file($stale) && (time() - (int) filemtime($stale)) > 7200) {
            @unlink($stale);
        }
    }
}

function npad_login_clear(string $ip): void
{
    @unlink(npad_login_throttle_file($ip));
}

function csrfToken(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function csrfValid(?string $token): bool
{
    return is_string($token)
        && !empty($_SESSION['csrf_token'])
        && hash_equals($_SESSION['csrf_token'], $token);
}

$sessionLifetime = defined('SESSION_LIFETIME') ? (int) SESSION_LIFETIME : 1800;
// Absolute cap: an idle-refreshed session still cannot outlive 12 hours.
$sessionMaxAge = 12 * 3600;

/* ---------------------------------------------------------------------------
   Logout — POST + CSRF only. The old ?logout link could be triggered by any
   external page with <img src="…?logout"> (CSRF logout).
   --------------------------------------------------------------------------- */

if (isset($_POST['logout'])) {
    if (csrfValid($_POST['csrf_token'] ?? null)) {
        $_SESSION = [];
        session_destroy();
    }
    header('Location: dashboard.php');
    exit;
}

/* ---------------------------------------------------------------------------
   Session expiry
   --------------------------------------------------------------------------- */

if (!empty($_SESSION['logged_in'])) {
    $idle = time() - (int) ($_SESSION['last_activity'] ?? time());
    $age  = time() - (int) ($_SESSION['login_time'] ?? time());
    if ($idle > $sessionLifetime || $age > $sessionMaxAge) {
        $_SESSION = [];
        session_destroy();
        session_start();
        $_SESSION['login_error'] = 'Session expired. Please sign in again.';
    } else {
        $_SESSION['last_activity'] = time();
    }
}

/* ---------------------------------------------------------------------------
   Login (throttled per IP)
   --------------------------------------------------------------------------- */

if (isset($_POST['password'])) {
    $throttleIp = npad_client_ip();
    if (npad_login_locked($throttleIp)) {
        http_response_code(429);
        $_SESSION['login_error'] = 'Too many failed attempts. Try again in about 15 minutes.';
    } elseif (!csrfValid($_POST['csrf_token'] ?? null)) {
        $_SESSION['login_error'] = 'Invalid security token. Please try again.';
    } elseif (function_exists('verifyAdminPassword') && verifyAdminPassword((string) $_POST['password'])) {
        npad_login_clear($throttleIp);
        session_regenerate_id(true);
        $_SESSION['logged_in']     = true;
        $_SESSION['login_time']    = time();
        $_SESSION['last_activity'] = time();
        unset($_SESSION['login_error']);
        header('Location: dashboard.php');
        exit;
    } else {
        npad_login_fail($throttleIp);
        $_SESSION['login_error'] = 'Incorrect password.';
        usleep(400000);
    }
}

/* ---------------------------------------------------------------------------
   Login screen
   --------------------------------------------------------------------------- */

if (empty($_SESSION['logged_in'])) {
    $token = csrfToken();
    $error = $_SESSION['login_error'] ?? '';
    unset($_SESSION['login_error']);
    ?>
    <!DOCTYPE html>
    <html lang="en" data-theme="dark">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex, nofollow">
        <title>Sign in — NPad Analytics</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="stylesheet" href="<?= e(asset('assets/css/app.css')) ?>">
    </head>
    <body>
        <div class="page center-panel">
            <form method="post" class="card" style="width:min(360px,100%);text-align:start">
                <h1 style="font-size:20px;margin-bottom:var(--space-4)">NPad Analytics</h1>

                <?php if ($error !== ''): ?>
                    <p class="field__error" role="alert" style="margin-bottom:var(--space-3)">
                        <?= e($error) ?>
                    </p>
                <?php endif; ?>

                <input type="hidden" name="csrf_token" value="<?= e($token) ?>">
                <label class="field">
                    <span class="field__label">Password</span>
                    <input class="field__input" type="password" name="password"
                           required autofocus autocomplete="current-password">
                </label>
                <button class="btn btn--primary" type="submit"
                        style="width:100%;margin-top:var(--space-4)">Sign in</button>
            </form>
        </div>
    </body>
    </html>
    <?php
    exit;
}

/* ---------------------------------------------------------------------------
   Authenticated — load metrics
   --------------------------------------------------------------------------- */

try {
    $conn = getDBConnection();
} catch (Throwable $e) {
    error_log('[npad/dashboard] ' . $e->getMessage());
    http_response_code(500);
    exit('Database connection failed.');
}

$adminIp = npad_client_ip();

$filters = ['all' => 'All time', 'today' => 'Today', 'week' => '7 days', 'month' => '30 days'];
$filter  = isset($_GET['filter']) && isset($filters[$_GET['filter']]) ? $_GET['filter'] : 'all';

/**
 * Date predicate.
 *
 * These are fixed literals selected by an allow-listed key, never
 * user-supplied text, so there is no injection surface.
 */
$where = match ($filter) {
    'today' => 'DATE(created_at) = CURDATE()',
    'week'  => 'created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)',
    'month' => 'created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)',
    default => '1=1',
};

/** Scalar helper. */
function scalar(mysqli $conn, string $sql, ...$params): int
{
    $stmt = $conn->prepare($sql);
    if ($stmt === false) {
        return 0;
    }
    if ($params) {
        $stmt->bind_param(str_repeat('s', count($params)), ...$params);
    }
    $stmt->execute();
    $value = (int) ($stmt->get_result()->fetch_row()[0] ?? 0);
    $stmt->close();
    return $value;
}

/** Rows helper. */
function rows(mysqli $conn, string $sql): array
{
    $result = $conn->query($sql);
    return $result ? $result->fetch_all(MYSQLI_ASSOC) : [];
}

$totalEvents = scalar($conn, "SELECT COUNT(*) FROM analytics WHERE $where");
$pageViews   = scalar($conn, "SELECT COUNT(*) FROM analytics WHERE event_type = ? AND $where", 'page_view');
$downloads   = scalar($conn, "SELECT COUNT(*) FROM analytics WHERE event_type IN ('download_txt','download_html','download_markdown','download_json','download_docx','download_pdf','download_rtf') AND $where");
$prints      = scalar($conn, "SELECT COUNT(*) FROM analytics WHERE event_type = ? AND $where", 'print_used');
$darkMode    = scalar($conn, "SELECT COUNT(*) FROM analytics WHERE event_type = ? AND $where", 'dark_mode_enabled');
$uniqueIps   = scalar($conn, "SELECT COUNT(DISTINCT ip_address) FROM analytics WHERE $where");
$clipboard   = scalar($conn, "SELECT COUNT(*) FROM analytics WHERE event_type IN ('copy_used','cut_used','paste_used','paste_plain_used') AND $where");

$avgPerVisitor = $uniqueIps > 0 ? round($totalEvents / $uniqueIps, 1) : 0;

$peak = rows($conn, "SELECT HOUR(created_at) h, COUNT(*) c FROM analytics WHERE $where GROUP BY h ORDER BY c DESC LIMIT 1");
$peakHour = $peak[0]['h'] ?? null;

$hourly = rows($conn, "SELECT HOUR(created_at) h, COUNT(*) c FROM analytics
                       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                       GROUP BY h ORDER BY h");

$daily = rows($conn, "SELECT DATE(created_at) d, COUNT(*) c FROM analytics
                      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                      GROUP BY d ORDER BY d");

$browsers = rows($conn, "SELECT CASE
                             WHEN user_agent LIKE '%Edg%' THEN 'Edge'
                             WHEN user_agent LIKE '%Chrome%' THEN 'Chrome'
                             WHEN user_agent LIKE '%Firefox%' THEN 'Firefox'
                             WHEN user_agent LIKE '%Safari%' THEN 'Safari'
                             ELSE 'Other' END browser,
                         COUNT(*) c
                         FROM analytics WHERE $where GROUP BY browser ORDER BY c DESC LIMIT 6");

$breakdown = rows($conn, "SELECT event_type, COUNT(*) c FROM analytics WHERE $where
                          GROUP BY event_type ORDER BY c DESC LIMIT 12");

$recent = rows($conn, "SELECT event_type, ip_address, user_agent, created_at
                       FROM analytics ORDER BY created_at DESC LIMIT 25");

$chart = [
    'hourly'   => ['labels' => array_map(fn($r) => $r['h'] . ':00', $hourly),
                   'data'   => array_map(fn($r) => (int) $r['c'], $hourly)],
    'daily'    => ['labels' => array_map(fn($r) => date('M j', strtotime($r['d'])), $daily),
                   'data'   => array_map(fn($r) => (int) $r['c'], $daily)],
    'browsers' => ['labels' => array_column($browsers, 'browser'),
                   'data'   => array_map('intval', array_column($browsers, 'c'))],
    'events'   => ['labels' => array_column($breakdown, 'event_type'),
                   'data'   => array_map('intval', array_column($breakdown, 'c'))],
];

$stats = [
    ['label' => 'Total events',    'value' => $totalEvents, 'sub' => $avgPerVisitor . ' avg per visitor'],
    ['label' => 'Page views',      'value' => $pageViews],
    ['label' => 'Unique visitors', 'value' => $uniqueIps],
    ['label' => 'Downloads',       'value' => $downloads],
    ['label' => 'Dark mode',       'value' => $darkMode],
    ['label' => 'Clipboard',       'value' => $clipboard],
    ['label' => 'Prints',          'value' => $prints],
    ['label' => 'Peak hour',       'value' => $peakHour !== null ? $peakHour . ':00' : '—', 'raw' => true],
];

$hasChartJs = is_file(NPAD_ROOT . '/assets/js/vendor/chart.umd.min.js');
?>
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>NPad Analytics</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="<?= e(asset('assets/css/app.css')) ?>">
<style>
    .dash-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: var(--space-3);
    }
    .dash-charts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: var(--space-4);
    }
    .chart-box { position: relative; height: 240px; }
    .stat__label { color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    .stat__value { color: var(--text-strong); font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .stat__sub { color: var(--text-muted); font-size: 12px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 12px; text-align: start; border-bottom: 1px solid var(--border-subtle); }
    th { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
    td { color: var(--text-body); }
    .pill { display: inline-block; padding: 2px 8px; border-radius: var(--radius-full);
            background: var(--accent-soft); color: var(--accent-text); font-size: 11px; font-weight: 600; }
    .mono { font-family: var(--font-mono); font-size: 12px; }
</style>
</head>
<body>
<div class="page">

    <header class="appbar">
        <div class="appbar__group">
            <span class="brand"><span class="brand__mark"><?= icon('file') ?></span> Analytics</span>
        </div>
        <div class="appbar__group">
            <div class="segmented" role="group" aria-label="Date range">
                <?php foreach ($filters as $key => $label): ?>
                    <a class="segmented__option" href="?filter=<?= e($key) ?>"
                       <?= $filter === $key ? 'aria-current="true"' : '' ?>><?= e($label) ?></a>
                <?php endforeach; ?>
            </div>
            <a class="iconbtn" href="export.php" title="Export CSV" aria-label="Export CSV"><?= icon('download') ?></a>
            <form method="post" action="dashboard.php" class="inline-form">
                <input type="hidden" name="csrf_token" value="<?= e(csrfToken()) ?>">
                <button type="submit" class="iconbtn" name="logout" value="1"
                        title="Sign out" aria-label="Sign out"><?= icon('close') ?></button>
            </form>
        </div>
    </header>

    <p style="color:var(--text-muted);font-size:13px">
        Your IP: <span class="mono"><?= e($adminIp) ?></span>
    </p>

    <section class="dash-grid">
        <?php foreach ($stats as $stat): ?>
            <div class="card">
                <div class="stat__label"><?= e($stat['label']) ?></div>
                <div class="stat__value">
                    <?= empty($stat['raw']) ? e(number_format((float) $stat['value'])) : e((string) $stat['value']) ?>
                </div>
                <?php if (!empty($stat['sub'])): ?>
                    <div class="stat__sub"><?= e($stat['sub']) ?></div>
                <?php endif; ?>
            </div>
        <?php endforeach; ?>
    </section>

    <?php if ($hasChartJs): ?>
        <section class="dash-charts">
            <div class="card"><h2 class="card__title">Last 24 hours</h2><div class="chart-box"><canvas id="hourlyChart"></canvas></div></div>
            <div class="card"><h2 class="card__title">Browsers</h2><div class="chart-box"><canvas id="browserChart"></canvas></div></div>
            <div class="card"><h2 class="card__title">Events</h2><div class="chart-box"><canvas id="eventChart"></canvas></div></div>
            <div class="card"><h2 class="card__title">Last 7 days</h2><div class="chart-box"><canvas id="dailyChart"></canvas></div></div>
        </section>
    <?php else: ?>
        <div class="card">
            <p style="color:var(--text-muted);font-size:14px;margin-bottom:var(--space-3)">
                Charts are disabled. To enable them, save Chart.js v4 UMD to
                <code>assets/js/vendor/chart.umd.min.js</code>. It is self-hosted
                deliberately — the previous build loaded an unpinned copy from a CDN,
                which meant a breaking upstream release could take the dashboard down,
                and the site's own CSP would have blocked it.
            </p>
            <div class="table-wrap">
                <table>
                    <caption class="visually-hidden">Event totals</caption>
                    <thead><tr><th scope="col">Event</th><th scope="col">Count</th></tr></thead>
                    <tbody>
                    <?php foreach ($breakdown as $row): ?>
                        <tr>
                            <td><span class="pill"><?= e($row['event_type']) ?></span></td>
                            <td class="mono"><?= e(number_format((int) $row['c'])) ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </div>
    <?php endif; ?>

    <section class="card">
        <h2 class="card__title">Recent activity</h2>
        <div class="table-wrap">
            <table>
                <caption class="visually-hidden">The 25 most recent events</caption>
                <thead>
                    <tr>
                        <th scope="col">Event</th>
                        <th scope="col">IP (truncated)</th>
                        <th scope="col">Browser</th>
                        <th scope="col">When</th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($recent as $row):
                    $ua = (string) $row['user_agent'];
                    $browser = match (true) {
                        str_contains($ua, 'Edg')     => 'Edge',
                        str_contains($ua, 'Chrome')  => 'Chrome',
                        str_contains($ua, 'Firefox') => 'Firefox',
                        str_contains($ua, 'Safari')  => 'Safari',
                        default                      => 'Other',
                    };
                    $ts = strtotime((string) $row['created_at']) ?: time();
                ?>
                    <tr>
                        <td><span class="pill"><?= e($row['event_type']) ?></span></td>
                        <td class="mono"><?= e($row['ip_address']) ?></td>
                        <td><?= e($browser) ?></td>
                        <td class="mono"><?= e(date('M j, H:i', $ts)) ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </section>
</div>

<?php if ($hasChartJs): ?>
<script src="<?= e(asset('assets/js/vendor/chart.umd.min.js')) ?>"></script>
<script type="application/json" id="chartData"><?= json_encode($chart, JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
<script src="<?= e(asset('assets/js/dashboard.js')) ?>" defer></script>
<?php endif; ?>
</body>
</html>
<?php $conn->close(); ?>

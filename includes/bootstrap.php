<?php
/**
 * NPad — application bootstrap.
 *
 * Loaded by every entry point. Defines paths, loads optional config,
 * and exposes small helpers used across the templates.
 */

declare(strict_types=1);

define('NPAD_ROOT', dirname(__DIR__));
define('NPAD_VERSION', '2.15.0');

/**
 * Supported interface languages.
 * 'dir' drives the <html dir> attribute and RTL styling.
 */
const NPAD_LANGS = [
    'en' => ['dir' => 'ltr', 'label' => 'English',  'locale' => 'en_US', 'path' => '/'],
    'fa' => ['dir' => 'rtl', 'label' => 'فارسی',    'locale' => 'fa_IR', 'path' => '/fa/'],
];

const NPAD_DEFAULT_LANG = 'en';

/**
 * config.php holds DB credentials and is intentionally absent from git.
 * The public site must work without it; only the analytics layer needs it.
 */
if (!defined('CONFIG_LOADED')) {
    define('CONFIG_LOADED', true);
}
if (is_readable(NPAD_ROOT . '/config.php')) {
    require_once NPAD_ROOT . '/config.php';
}

/**
 * True when the analytics database is configured and usable.
 */
function npad_analytics_enabled(): bool
{
    return function_exists('getDBConnection') && defined('DB_NAME');
}

/**
 * Escape for HTML text/attribute context.
 *
 * Accepts any scalar: array keys arrive as int when they look numeric
 * (PHP casts '3' to 3), so restricting this to ?string would throw under
 * declare(strict_types=1).
 */
function e(string|int|float|bool|null $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Cache-busting asset URL.
 *
 * Uses filemtime() when the file exists, otherwise falls back to the app
 * version. The original code called filemtime() on a missing file, which
 * raised E_WARNING inside <head> and produced "?v=" URLs.
 */
function asset(string $relativePath): string
{
    $clean    = '/' . ltrim($relativePath, '/');
    $absolute = NPAD_ROOT . $clean;
    $version  = is_file($absolute) ? (string) filemtime($absolute) : NPAD_VERSION;

    return $clean . '?v=' . $version;
}

/**
 * Inline a file's contents (used for critical CSS).
 */
function inline_file(string $relativePath): string
{
    $absolute = NPAD_ROOT . '/' . ltrim($relativePath, '/');

    return is_file($absolute) ? (string) file_get_contents($absolute) : '';
}

/**
 * Load the translation table for a language, falling back to the default.
 */
function npad_load_lang(string $lang): array
{
    $lang = isset(NPAD_LANGS[$lang]) ? $lang : NPAD_DEFAULT_LANG;
    $file = NPAD_ROOT . '/lang/' . $lang . '.php';

    if (!is_readable($file)) {
        $file = NPAD_ROOT . '/lang/' . NPAD_DEFAULT_LANG . '.php';
    }

    $strings = require $file;

    return is_array($strings) ? $strings : [];
}

/**
 * Translate a dot-notated key, e.g. t('faq.items.0.q').
 * Returns the key itself when missing so gaps are obvious rather than silent.
 */
function t(string $key, ?array $strings = null)
{
    static $cache = null;

    if ($strings !== null) {
        $cache = $strings;
        return '';
    }

    $value = $cache;
    foreach (explode('.', $key) as $segment) {
        if (!is_array($value) || !array_key_exists($segment, $value)) {
            return $key;
        }
        $value = $value[$segment];
    }

    return $value;
}

/**
 * Absolute URL for a path on the canonical host.
 */
function npad_url(string $path = '/'): string
{
    return 'https://npad.ir' . '/' . ltrim($path, '/');
}

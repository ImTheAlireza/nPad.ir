<?php
/**
 * Inline SVG icon set.
 *
 * Replaces Font Awesome entirely. The old build pulled ~30KB of CSS plus a
 * webfont from cdnjs (and referenced a local fa-solid-900.woff2 that was not
 * in the repository), for roughly 30 glyphs. These paths cost well under 4KB
 * total, need no network request, and cannot be blocked by CSP.
 */

declare(strict_types=1);

/**
 * Icon path data, drawn on a 24x24 grid with a 2px stroke.
 */
function npad_icon_paths(): array
{
    return [
        'file'        => '<path d="M14 3v5h5"/><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l6 6v10a2 2 0 0 1-2 2z"/>',
        'folder'      => '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        'download'    => '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>',
        'printer'     => '<path d="M7 9V3h10v6"/><path d="M7 19H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 15h10v6H7z"/>',
        'info'        => '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
        'trash'       => '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
        'copy'        => '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        'scissors'    => '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/>',
        'clipboard'   => '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
        'text'        => '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>',
        'select-all'  => '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m9 12 2 2 4-4"/>',
        'bold'        => '<path d="M7 5h6a4 4 0 0 1 0 8H7z"/><path d="M7 13h7a4 4 0 0 1 0 8H7z"/>',
        'italic'      => '<path d="M19 4h-9"/><path d="M14 20H5"/><path d="M15 4 9 20"/>',
        'underline'   => '<path d="M7 4v6a5 5 0 0 0 10 0V4"/><path d="M5 21h14"/>',
        'strike'      => '<path d="M4 12h16"/><path d="M17 7a4 4 0 0 0-4-3h-1a4 4 0 0 0-1 7.9"/><path d="M8 17a4 4 0 0 0 4 3h1a4 4 0 0 0 2.5-7"/>',
        'subscript'   => '<path d="m4 5 8 10"/><path d="M12 5 4 15"/><path d="M20 21h-4c0-2 3-2.5 3-4a1.5 1.5 0 0 0-3 0"/>',
        'superscript' => '<path d="m4 9 8 10"/><path d="M12 9 4 19"/><path d="M20 9h-4c0-2 3-2.5 3-4a1.5 1.5 0 0 0-3 0"/>',
        'list-ul'     => '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
        'list-ol'     => '<path d="M10 6h10"/><path d="M10 12h10"/><path d="M10 18h10"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M4 15h2v1.5H4V18h2"/>',
        'align-left'  => '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/>',
        'align-center'=> '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M6 18h12"/>',
        'align-right' => '<path d="M4 6h16"/><path d="M10 12h10"/><path d="M7 18h13"/>',
        'align-just'  => '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
        'palette'     => '<path d="M12 3a9 9 0 1 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1a1.5 1.5 0 0 1 1.06-2.56H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
        'highlight'   => '<path d="m9 11 4-4 5 5-4 4z"/><path d="m5 19 3-1 8-8-3-3-8 8z"/><path d="M4 21h6"/>',
        'undo'        => '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
        'redo'        => '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/>',
        'indent'      => '<path d="M4 6h16"/><path d="M10 12h10"/><path d="M4 18h16"/><path d="m4 10 3 2-3 2z" fill="currentColor"/>',
        'outdent'     => '<path d="M4 6h16"/><path d="M10 12h10"/><path d="M4 18h16"/><path d="m7 10-3 2 3 2z" fill="currentColor"/>',
        'link'        => '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/>',
        'eraser'      => '<path d="m19 20-9 .01"/><path d="M15 5 5 15a2 2 0 0 0 0 3l2 2h5l8-8a2 2 0 0 0 0-3l-2-2a2 2 0 0 0-3 0z"/>',
        'moon'        => '<path d="M21 13a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10z"/>',
        'sun'         => '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
        'chevron'     => '<path d="m6 9 6 6 6-6"/>',
        'close'       => '<path d="M18 6 6 18M6 6l12 12"/>',
        'save'        => '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
        'format'      => '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
        'lock'        => '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
        'bolt'        => '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
        'offline'     => '<path d="M12 20h.01"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M2 9a15 15 0 0 1 20 0"/>',
        'student'     => '<path d="m12 4 10 5-10 5L2 9z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
        'work'        => '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
        'pen'         => '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
        'keyboard'    => '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
        'arrow-up'    => '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
        'globe'       => '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
    ];
}

/**
 * Render an icon.
 *
 * @param string $name  Key from npad_icon_paths()
 * @param array  $attrs Extra attributes (e.g. ['class' => 'icon faq__chevron'])
 */
function icon(string $name, array $attrs = []): string
{
    static $paths = null;
    $paths ??= npad_icon_paths();

    if (!isset($paths[$name])) {
        return '';
    }

    $attrs['class'] ??= 'icon';
    $attrs['viewBox'] = '0 0 24 24';
    $attrs['aria-hidden'] = 'true';
    $attrs['focusable'] = 'false';

    $rendered = '';
    foreach ($attrs as $key => $value) {
        if ($value === null || $value === false) {
            continue;
        }
        $rendered .= ' ' . $key . '="' . htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8') . '"';
    }

    return '<svg' . $rendered . '>' . $paths[$name] . '</svg>';
}

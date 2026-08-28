<?php
/**
 * Shared renderer for the landing pages (online-notepad, markdown-editor,
 * math-notepad, checklist-app) in either language.
 *
 * The application page is an app, not a document: it changes per visitor and
 * answers no specific query. These pages give each intent a stable, crawlable
 * URL with real copy, while the app itself stays a click away.
 *
 * Copy lives in lang/{en,fa}.php under landing.pages.<slug>, so the lang
 * parity test guarantees no locale ships a half-translated page.
 *
 * Expects $lang and $slug from the entry file. Served at pretty URLs
 * (/online-notepad, /fa/online-notepad) via .htaccess rewrites.
 */

declare(strict_types=1);

// Not a standalone endpoint: refuse direct requests.
if (!isset($lang, $slug)) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/icons.php';

$lang    = $lang ?? NPAD_DEFAULT_LANG;
$strings = npad_load_lang($lang);
t('', $strings);

$page = t("landing.pages.{$slug}");
if (!is_array($page) || !isset($page['h1'])) {
    http_response_code(404);
    exit;
}

$appPath      = NPAD_LANGS[$lang]['path'];
$canonicalPath = $lang === 'fa' ? "/fa/{$slug}" : "/{$slug}";
$skipTarget   = '#main';

// Marketing page: app bar shows brand + language + theme toggle only, and
// only the theme-toggle JS is loaded (no editor bundle).
$appbarChrome   = true;
$includeThemeJs = true;

$pageTitle = $page['title'];
$pageDesc  = $page['description'];

// Each landing page shares its own card, not the generic homepage one.
$ogTitle = $page['h1'];
$ogDesc  = $page['description'];

require __DIR__ . '/head.php';

/** The other landing pages, for the internal-link mesh. */
$related = NPAD_LANDING_SLUGS;

/**
 * A distinct hero emblem per page. The pages share a template by design, so
 * this gives each one an at-a-glance identity for human visitors and quietly
 * reinforces that each targets a different tool/intent.
 */
$emblems = [
    'online-notepad'   => 'file',
    'markdown-editor'  => 'code',
    'math-notepad'     => 'sigma',
    'checklist-app'    => 'check-square',
    'text-editor'      => 'text',
    'word-counter'     => 'list-ol',
    'rich-text-editor' => 'format',
];
$emblem = $emblems[$slug] ?? 'file';
?>

<div class="page">
    <?php require __DIR__ . '/appbar.php'; ?>

    <article class="content" id="main">
        <nav class="breadcrumb" aria-label="<?= e(t('landing.breadcrumb_home')) ?>">
            <a href="<?= e($appPath) ?>"><?= e(t('landing.breadcrumb_home')) ?></a>
            <span aria-hidden="true">›</span>
            <span aria-current="page"><?= e($page['h1']) ?></span>
        </nav>

        <section class="hero">
            <span class="hero__emblem"><?= icon($emblem) ?></span>
            <h1><?= e($page['h1']) ?></h1>
            <p><?= e($page['lede']) ?></p>
            <div class="hero__actions">
                <a class="btn btn--primary" href="<?= e($appPath) ?>#editor">
                    <?= icon('arrow-up') ?> <?= e(t('landing.open_app')) ?>
                </a>
                <span class="hero__note"><?= e(t('landing.open_app_note')) ?></span>
            </div>
        </section>

        <section>
            <h2 class="section__title"><?= e(t('landing.steps_title')) ?></h2>
            <ol class="steps">
                <?php foreach ($page['steps'] as $index => $step): ?>
                    <li class="steps__item">
                        <span class="steps__n"><?= $index + 1 ?></span>
                        <div>
                            <h3 class="steps__title"><?= e($step['title']) ?></h3>
                            <p><?= e($step['desc']) ?></p>
                        </div>
                    </li>
                <?php endforeach; ?>
            </ol>
        </section>

        <section>
            <h2 class="section__title"><?= e(t('landing.features_title')) ?></h2>
            <div class="card-grid">
                <?php foreach ($page['features'] as $feature): ?>
                    <article class="card">
                        <h3 class="card__title"><?= e($feature['title']) ?></h3>
                        <p class="card__desc"><?= e($feature['desc']) ?></p>
                    </article>
                <?php endforeach; ?>
            </div>
        </section>

        <section>
            <h2 class="section__title"><?= e(t('landing.faq_title')) ?></h2>
            <div class="faq">
                <?php foreach ($page['faq'] as $item): ?>
                    <details class="faq__item">
                        <summary class="faq__q">
                            <span><?= e($item['q']) ?></span>
                            <?= icon('chevron', ['class' => 'icon faq__chevron']) ?>
                        </summary>
                        <div class="faq__a"><?= e($item['a']) ?></div>
                    </details>
                <?php endforeach; ?>
            </div>
        </section>

        <section>
            <h2 class="section__title"><?= e(t('landing.related_title')) ?></h2>
            <div class="prose">
                <?php
                $links = array_filter($related, static fn(string $s): bool => $s !== $slug);
                $parts = array_map(
                    static function (string $s) use ($lang): string {
                        $href  = $lang === 'fa' ? "/fa/{$s}" : "/{$s}";
                        $label = t("footer_tools.{$s}");
                        return '<a href="' . e($href) . '">' . e($label) . '</a>';
                    },
                    $links,
                );
                echo implode(' · ', $parts);
                ?>
            </div>
        </section>

        <section class="cta">
            <h2><?= e(t('landing.cta_title')) ?></h2>
            <p><?= e(t('landing.cta_body')) ?></p>
            <a class="btn btn--primary" href="<?= e($appPath) ?>#editor">
                <?= icon('arrow-up') ?> <?= e(t('landing.cta_button')) ?>
            </a>
        </section>
    </article>

    <?php require __DIR__ . '/footer.php'; ?>
</div>
</body>
</html>

<?php
/**
 * Structured data: the FAQ text below mirrors the visible copy exactly, and
 * the breadcrumb describes this page's real position (home › tool).
 */
$faqEntities = array_map(
    static fn(array $item): array => [
        '@type'          => 'Question',
        'name'           => $item['q'],
        'acceptedAnswer' => ['@type' => 'Answer', 'text' => $item['a']],
    ],
    $page['faq'],
);

$graph = [
    '@context' => 'https://schema.org',
    '@graph'   => [
        [
            '@type'               => 'SoftwareApplication',
            'name'                => $page['h1'],
            'url'                 => npad_url($canonicalPath),
            'description'         => $page['description'],
            'applicationCategory' => 'UtilitiesApplication',
            'operatingSystem'     => 'Any',
            'browserRequirements' => 'Requires JavaScript',
            'inLanguage'          => $lang,
            'isPartOf'            => ['@type' => 'WebSite', 'name' => 'NPad', 'url' => npad_url('/')],
            'offers'              => ['@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'USD'],
            'featureList'         => array_map(
                static fn(array $f): string => $f['title'],
                $page['features'],
            ),
        ],
        ['@type' => 'FAQPage', 'mainEntity' => $faqEntities],
        [
            '@type'           => 'BreadcrumbList',
            'itemListElement' => [
                [
                    '@type'    => 'ListItem',
                    'position' => 1,
                    'name'     => t('landing.breadcrumb_home'),
                    'item'     => npad_url($appPath),
                ],
                [
                    '@type'    => 'ListItem',
                    'position' => 2,
                    'name'     => $page['h1'],
                    'item'     => npad_url($canonicalPath),
                ],
            ],
        ],
    ],
];
?>
<script type="application/ld+json"><?= json_encode($graph, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>

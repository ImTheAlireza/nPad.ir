<?php
/**
 * Comparison landing page (NPad vs Google Keep / Notion / Evernote), in either
 * language. Served at the pretty URLs /compare and /fa/compare.
 *
 * This is deliberately its own template rather than a landing.pages.* entry:
 * it carries a comparison table and a different section rhythm. Copy lives in
 * lang/{en,fa}.php under 'compare', so the lang parity test guards it.
 *
 * Expects $lang from the entry file.
 */

declare(strict_types=1);

if (!isset($lang)) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/icons.php';

$lang    = $lang ?? NPAD_DEFAULT_LANG;
$strings = npad_load_lang($lang);
t('', $strings);

$page = t('compare');
if (!is_array($page) || !isset($page['h1'])) {
    http_response_code(404);
    exit;
}

$appPath       = NPAD_LANGS[$lang]['path'];
$canonicalPath = $lang === 'fa' ? '/fa/compare' : '/compare';
$skipTarget    = '#main';

// Marketing page: chrome-only app bar + theme-toggle JS only.
$appbarChrome   = true;
$includeThemeJs = true;

$pageTitle = $page['title'];
$pageDesc  = $page['description'];
$ogTitle   = $page['h1'];
$ogDesc    = $page['description'];

require __DIR__ . '/head.php';

/**
 * Map a cell value to a class so Yes/No/Partial read at a glance. Values are
 * localised, so compare against the localised tokens from the copy.
 */
$cellClass = static function (string $value) use ($page): string {
    return match ($value) {
        $page['yes']     => 'compare__cell--yes',
        $page['no']      => 'compare__cell--no',
        $page['partial'] => 'compare__cell--partial',
        default          => '',
    };
};
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
            <span class="hero__emblem"><?= icon('table') ?></span>
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
            <h2 class="section__title"><?= e($page['intro_title']) ?></h2>
            <div class="prose"><p><?= e($page['intro_body']) ?></p></div>
        </section>

        <section>
            <h2 class="section__title"><?= e($page['table_title']) ?></h2>
            <div class="compare__scroll">
                <table class="compare">
                    <caption class="visually-hidden"><?= e($page['table_caption']) ?></caption>
                    <thead>
                        <tr>
                            <th scope="col"><?= e($page['col_feature']) ?></th>
                            <th scope="col" class="compare__col--npad"><?= e($page['col_npad']) ?></th>
                            <th scope="col"><?= e($page['col_keep']) ?></th>
                            <th scope="col"><?= e($page['col_notion']) ?></th>
                            <th scope="col"><?= e($page['col_evernote']) ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($page['rows'] as $row): ?>
                            <tr>
                                <th scope="row"><?= e($row['feature']) ?></th>
                                <td class="compare__col--npad <?= e($cellClass($row['npad'])) ?>"><?= e($row['npad']) ?></td>
                                <td class="<?= e($cellClass($row['keep'])) ?>"><?= e($row['keep']) ?></td>
                                <td class="<?= e($cellClass($row['notion'])) ?>"><?= e($row['notion']) ?></td>
                                <td class="<?= e($cellClass($row['evernote'])) ?>"><?= e($row['evernote']) ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </section>

        <section>
            <h2 class="section__title"><?= e($page['when_title']) ?></h2>
            <div class="card-grid">
                <?php foreach ($page['when_items'] as $item): ?>
                    <article class="card">
                        <h3 class="card__title"><?= e($item['title']) ?></h3>
                        <p class="card__desc"><?= e($item['desc']) ?></p>
                    </article>
                <?php endforeach; ?>
            </div>
        </section>

        <section>
            <h2 class="section__title"><?= e($page['when_not_title']) ?></h2>
            <div class="prose"><p><?= e($page['when_not_body']) ?></p></div>
        </section>

        <section>
            <h2 class="section__title"><?= e($page['faq_title']) ?></h2>
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
                $parts = array_map(
                    static function (string $s) use ($lang): string {
                        $href  = $lang === 'fa' ? "/fa/{$s}" : "/{$s}";
                        $label = t("footer_tools.{$s}");
                        return '<a href="' . e($href) . '">' . e($label) . '</a>';
                    },
                    array_slice(NPAD_LANDING_SLUGS, 0, 4),
                );
                echo implode(' · ', $parts);
                ?>
            </div>
        </section>

        <section class="cta">
            <h2><?= e($page['cta_title']) ?></h2>
            <p><?= e($page['cta_body']) ?></p>
            <a class="btn btn--primary" href="<?= e($appPath) ?>#editor">
                <?= icon('arrow-up') ?> <?= e($page['cta_button']) ?>
            </a>
        </section>
    </article>

    <?php require __DIR__ . '/footer.php'; ?>
</div>
</body>
</html>

<?php
/**
 * Structured data: FAQ mirrors the visible copy, breadcrumb gives the page's
 * real position. No fabricated ratings.
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

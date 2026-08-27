<?php
/**
 * Marketing / SEO content.
 *
 * Rendered from lang/*.php for the requested language only. The old build
 * shipped both languages in every response and hid one with CSS — roughly
 * 8KB of permanently invisible markup, plus a flash of English for Persian
 * visitors before JavaScript resolved.
 *
 * Expects: $lang
 */

declare(strict_types=1);

// Not a standalone endpoint: refuse direct requests.
if (!defined('NPAD_ROOT')) {
    http_response_code(404);
    exit;
}

$homePath = NPAD_LANGS[$lang]['path'];
?>
<div class="content">

    <section class="hero">
        <h1><?= e(t('hero.title')) ?></h1>
        <p><?= e(t('hero.lede')) ?></p>
        <div class="hero__actions">
            <a class="btn btn--primary" href="#editor">
                <?= icon('arrow-up') ?> <?= e(t('hero.cta')) ?>
            </a>
        </div>
    </section>

    <section>
        <h2 class="section__title"><?= e(t('why.title')) ?></h2>
        <div class="prose"><p><?= e(t('why.body')) ?></p></div>
    </section>

    <section>
        <h2 class="section__title"><?= e(t('features.title')) ?></h2>
        <div class="card-grid">
            <?php foreach (t('features.items') as $item): ?>
                <article class="card">
                    <div class="card__icon"><?= icon($item['icon']) ?></div>
                    <h3 class="card__title"><?= e($item['title']) ?></h3>
                    <p class="card__desc"><?= e($item['desc']) ?></p>
                </article>
            <?php endforeach; ?>
        </div>
    </section>

    <section>
        <h2 class="section__title"><?= e(t('audience.title')) ?></h2>
        <div class="card-grid">
            <?php foreach (t('audience.items') as $item): ?>
                <article class="card">
                    <div class="card__icon"><?= icon($item['icon']) ?></div>
                    <h3 class="card__title"><?= e($item['title']) ?></h3>
                    <p class="card__desc"><?= e($item['desc']) ?></p>
                </article>
            <?php endforeach; ?>
        </div>
    </section>

    <section>
        <h2 class="section__title"><?= e(t('shortcuts.title')) ?></h2>
        <div class="shortcut-grid">
            <?php foreach (t('shortcuts.items') as $item): ?>
                <div class="shortcut">
                    <span><?= e($item['desc']) ?></span>
                    <kbd><?= e($item['keys']) ?></kbd>
                </div>
            <?php endforeach; ?>
        </div>
        <p class="prose" style="margin-top:var(--space-3)"><?= e(t('shortcuts.note')) ?></p>
    </section>

    <section>
        <h2 class="section__title"><?= e(t('faq.title')) ?></h2>
        <?php
        /**
         * <details>/<summary> gives us expand/collapse with zero JavaScript,
         * correct semantics, and no max-height clipping.
         */
        ?>
        <div class="faq">
            <?php foreach (t('faq.items') as $item): ?>
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

    <section class="cta">
        <h2><?= e(t('cta.title')) ?></h2>
        <p><?= e(t('cta.body')) ?></p>
        <a class="btn btn--primary" href="#editor">
            <?= icon('arrow-up') ?> <?= e(t('cta.button')) ?>
        </a>
    </section>
</div>

<?php
/**
 * Structured data.
 *
 * The previous build claimed aggregateRating 4.8 from 1250 ratings. That was
 * fabricated and violates Google's structured-data policy, so it is gone.
 * FAQPage markup below reflects content genuinely present on the page.
 */
$faqEntities = array_map(
    static fn(array $item): array => [
        '@type'          => 'Question',
        'name'           => $item['q'],
        'acceptedAnswer' => ['@type' => 'Answer', 'text' => $item['a']],
    ],
    t('faq.items'),
);

$graph = [
    '@context' => 'https://schema.org',
    '@graph'   => [
        [
            '@type'  => 'Organization',
            '@id'    => npad_url('/') . '#organization',
            'name'   => 'NPad',
            'url'    => npad_url('/'),
            'logo'   => [
                '@type'  => 'ImageObject',
                'url'    => npad_url('/icon-512.png'),
                'width'  => 512,
                'height' => 512,
            ],
            'email'  => 'alirezashabanzadeh01@gmail.com',
        ],
        [
            '@type'      => 'WebSite',
            '@id'        => npad_url('/') . '#website',
            'name'       => 'NPad',
            'url'        => npad_url('/'),
            'description' => t('meta.description'),
            'inLanguage' => $lang,
            'publisher'  => ['@id' => npad_url('/') . '#organization'],
        ],
        [
            '@type'               => 'WebApplication',
            'name'                => 'NPad',
            'url'                 => npad_url($homePath),
            'description'         => t('meta.description'),
            'applicationCategory' => 'UtilitiesApplication',
            'operatingSystem'     => 'Any',
            'browserRequirements' => 'Requires JavaScript',
            'inLanguage'          => $lang,
            'isPartOf'            => ['@id' => npad_url('/') . '#website'],
            'offers'              => ['@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'USD'],
            'featureList'         => array_map(
                static fn(array $f): string => $f['title'],
                t('features.items'),
            ),
        ],
        ['@type' => 'FAQPage', 'mainEntity' => $faqEntities],
    ],
];
?>
<script type="application/ld+json"><?= json_encode($graph, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>

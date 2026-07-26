/**
 * Dashboard charts.
 *
 * Extracted from inline <script> in dashboard.php so the admin pages need no
 * 'unsafe-inline' beyond the shared theme bootstrap. Data arrives through a
 * JSON island rather than PHP-interpolated JavaScript literals.
 */

(function () {
    'use strict';

    if (typeof Chart === 'undefined') return;

    const node = document.getElementById('chartData');
    if (!node) return;

    let data;
    try {
        data = JSON.parse(node.textContent);
    } catch {
        return;
    }

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#22d3ee';
    const muted = styles.getPropertyValue('--text-muted').trim() || '#a4b0c4';
    const grid = styles.getPropertyValue('--border-subtle').trim() || '#2b374c';

    Chart.defaults.color = muted;
    Chart.defaults.borderColor = grid;
    Chart.defaults.font.family = styles.getPropertyValue('--font-ui').trim() || 'sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.responsive = true;

    const base = {
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { precision: 0 } },
        },
    };

    const make = (id, config) => {
        const canvas = document.getElementById(id);
        if (canvas) new Chart(canvas, config);
    };

    make('hourlyChart', {
        type: 'line',
        data: {
            labels: data.hourly.labels,
            datasets: [{
                data: data.hourly.data,
                borderColor: accent,
                backgroundColor: 'rgba(34, 211, 238, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 5,
            }],
        },
        options: { ...base, interaction: { intersect: false, mode: 'index' } },
    });

    make('browserChart', {
        type: 'doughnut',
        data: {
            labels: data.browsers.labels,
            datasets: [{
                data: data.browsers.data,
                backgroundColor: ['#22d3ee', '#818cf8', '#f472b6', '#34d399', '#fbbf24', '#94a3b8'],
                borderWidth: 0,
            }],
        },
        options: {
            cutout: '70%',
            plugins: { legend: { display: true, position: 'right', labels: { boxWidth: 10 } } },
        },
    });

    make('eventChart', {
        type: 'bar',
        data: {
            labels: data.events.labels,
            datasets: [{ data: data.events.data, backgroundColor: '#818cf8', borderRadius: 4 }],
        },
        options: { ...base, indexAxis: 'y' },
    });

    make('dailyChart', {
        type: 'bar',
        data: {
            labels: data.daily.labels,
            datasets: [{ data: data.daily.data, backgroundColor: accent, borderRadius: 6 }],
        },
        options: base,
    });
})();

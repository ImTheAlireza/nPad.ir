#!/usr/bin/env node
/**
 * NPad test runner.
 *
 *   node tests/run.mjs
 *
 * Requires dev dependencies: npm install
 */

let pass = 0;
let fail = 0;
const failures = [];
// Async checks are tracked so the harness can wait for them before the
// final tally — previously they were counted before they ran and killed
// by process.exit mid-flight if they were still pending.
const pendingChecks = new Set();

function group(name) {
    console.log(`\n${name}`);
}

function reportFail(name, err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message.split('\n')[0]}`);
    fail++;
    failures.push(name);
}

function check(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            const tracked = result.then(
                () => { console.log(`  ok    ${name}`); pass++; pendingChecks.delete(tracked); },
                (err) => { reportFail(name, err); pendingChecks.delete(tracked); },
            ).catch((err) => { reportFail(name, err); pendingChecks.delete(tracked); });
            pendingChecks.add(tracked);
            return tracked;
        }
        console.log(`  ok    ${name}`);
        pass++;
    } catch (err) {
        reportFail(name, err);
    }
}

const suites = [
    ['static', './static.test.mjs'],
    ['contrast', './contrast.test.mjs'],
    ['lang', './lang.test.mjs'],
    ['sanitize', './sanitize.test.mjs'],
    ['table', './table.test.mjs'],
    ['formats', './formats.test.mjs'],
    ['codeblocks', './codeblocks.test.mjs'],
    ['storage', './storage.test.mjs'],
    ['render', './render.test.mjs'],
    // codeblocks-ui boots its own jsdom page; like tables-ui it must run
    // before the behaviour suite, which closes its window with timers pending.
    ['codeblocks-ui', './codeblocks-ui.test.mjs'],
    ['math', './math.test.mjs'],
    ['math-ui', './math-ui.test.mjs'],
    ['structure', './structure.test.mjs'],
    ['structure-ui', './structure-ui.test.mjs'],
    // tables-ui boots its own jsdom page and must run before the behaviour
    // suite: the behaviour page closes its window with timers still pending
    // (a jsdom quirk), and a timer firing after that close crashes the
    // process if anything keeps the event loop alive afterwards.
    ['tables-ui', './tables-ui.test.mjs'],
    ['ai-buttons', './ai-buttons.test.mjs'],
    ['autocomplete', './autocomplete.test.mjs'],
    ['behaviour', './behaviour.test.mjs'],
];

for (const [name, file] of suites) {
    try {
        const mod = await import(file);
        await mod.default(check, group);
    } catch (err) {
        console.log(`\n${name}: SUITE FAILED TO LOAD`);
        console.log(`  ${err.message.split('\n')[0]}`);
        fail++;
        failures.push(`${name} (load)`);
    }
}

console.log(`\n${'='.repeat(60)}`);

// Let still-running async checks (real-timer UI tests) finish so their
// results land in the tally instead of dying at process.exit.
while (pendingChecks.size) {
    await Promise.all([...pendingChecks]);
}

console.log(`${pass} passed, ${fail} failed`);
if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(fail ? 1 : 0);

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

function group(name) {
    console.log(`\n${name}`);
}

function check(name, fn) {
    try {
        fn();
        console.log(`  ok    ${name}`);
        pass++;
    } catch (err) {
        console.log(`  FAIL  ${name}`);
        console.log(`        ${err.message.split('\n')[0]}`);
        fail++;
        failures.push(name);
    }
}

const suites = [
    ['static', './static.test.mjs'],
    ['contrast', './contrast.test.mjs'],
    ['lang', './lang.test.mjs'],
    ['sanitize', './sanitize.test.mjs'],
    ['render', './render.test.mjs'],
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
console.log(`${pass} passed, ${fail} failed`);
if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(fail ? 1 : 0);

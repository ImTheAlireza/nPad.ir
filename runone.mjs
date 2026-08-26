import mod from '/home/user/nPad.ir/tests/structure.test.mjs';
let pass = 0, fail = 0;
const group = (n) => console.log(`\n${n}`);
const check = (name, fn) => { try { fn(); console.log(`  ok    ${name}`); pass++; } catch (e) { console.log(`  FAIL  ${name}`); console.log('        ' + e.message.split('\n')[0]); fail++; } };
await mod(check, group);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

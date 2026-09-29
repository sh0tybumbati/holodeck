#!/usr/bin/env node
// Runs every test/test-*.mjs (the pure-node unit tests) and fails if any does.
//   node test/run-unit.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
let failed = 0, total = 0;
for (const file of readdirSync(dir).filter(f => /^test-.*\.mjs$/.test(f)).sort()) {
    const r = spawnSync(process.execPath, [join(dir, file)], { encoding: 'utf8' });
    const lines = r.stdout.split('\n').filter(Boolean);
    const passes = lines.filter(l => l.startsWith('PASS')).length;
    const fails = lines.filter(l => l.startsWith('FAIL'));
    total += passes + fails.length;
    console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${file} (${passes} passed)`);
    if (r.status !== 0) { failed++; console.log(r.stdout.split('\n').filter(l => !l.startsWith('PASS')).join('\n').slice(0, 2000), r.stderr.slice(0, 1000)); }
}
console.log(failed ? `\n${failed} test file(s) failed` : `\nall ${total} unit tests passed`);
process.exit(failed ? 1 : 0);

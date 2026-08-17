#!/usr/bin/env node
// Headless regression run for Holodeck.
//
//   node test/run-regression.mjs
//
// Serves the project on a local port, loads it in a headless Chromium-family browser with
// test/browser-harness.js injected, and asserts on what the harness reports. No npm deps.
// Needs a browser binary (brave/chromium/chrome) and network access for the CDN scripts.
//
// The harness POSTs its results back to /__results when it finishes, so the run is bounded by
// the harness actually completing rather than by a fixed browser time budget — the exports it
// reads back are megabyte-scale and racing them against a budget made the suite flake.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const RUN_TIMEOUT_MS = 180000;

const BROWSERS = [
    '/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'
];

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json'
};

function findBrowser() {
    const found = BROWSERS.find(p => existsSync(p));
    if (!found) {
        console.error('No Chromium-family browser found. Looked in:\n  ' + BROWSERS.join('\n  '));
        process.exit(2);
    }
    return found;
}

let resolveResults;
const resultsPromise = new Promise(resolve => { resolveResults = resolve; });

const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);

    if (req.method === 'POST' && path === '/__results') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        res.writeHead(204).end();
        resolveResults(Buffer.concat(chunks).toString());
        return;
    }

    const file = join(ROOT, path === '/' ? 'index.html' : path);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
        let body = await readFile(file);
        // Inject the harness without touching the shipped index.html, and mark the CDN
        // scripts crossorigin so window.onerror reports real messages instead of the
        // opaque "Script error." — otherwise the harness cannot tell its own synthetic
        // pointer-event noise from a genuine app failure.
        if (file.endsWith('index.html')) {
            body = body.toString()
                .replace(/<script src="(https:\/\/[^"]+)"><\/script>/g,
                    '<script crossorigin="anonymous" src="$1"></script>')
                .replace(/<\/body>/,
                    '<script type="module" src="test/browser-harness.js"></script>\n</body>');
        }
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
});

// Parse the harness before spending a browser run on it. A syntax error there means the
// module never executes, which otherwise surfaces only as an unexplained timeout.
const harnessSource = await readFile(join(ROOT, 'test', 'browser-harness.js'), 'utf8');
try {
    new Function(harnessSource);
} catch (err) {
    console.error('test/browser-harness.js does not parse:\n  ' + err.message);
    process.exit(1);
}

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const browser = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--no-sandbox',
    `http://127.0.0.1:${port}/index.html`
], { stdio: 'ignore' });

const timeout = new Promise(resolve => setTimeout(() => resolve(null), RUN_TIMEOUT_MS));
const raw = await Promise.race([resultsPromise, timeout]);

browser.kill('SIGKILL');
server.close();

if (raw === null) {
    console.error(`Harness did not report within ${RUN_TIMEOUT_MS / 1000}s.`);
    console.error('Either it threw while loading, or the browser could not reach the CDN scripts.');
    process.exit(1);
}

let results;
try {
    results = JSON.parse(raw);
} catch {
    console.error('Harness output was not valid JSON:\n' + raw.slice(0, 2000));
    process.exit(1);
}

let failed = 0;
for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);

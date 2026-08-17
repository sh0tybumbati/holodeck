#!/usr/bin/env node
// Headless regression run for Holodeck.
//
//   node test/run-regression.mjs
//
// Serves the project on a local port, loads it in a headless Chromium-family browser with
// test/browser-harness.js injected, and asserts on what the harness reports. No npm deps.
// Needs a browser binary (brave/chromium/chrome) and network access for the CDN scripts.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));

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

async function serve() {
    const server = createServer(async (req, res) => {
        const path = decodeURIComponent(req.url.split('?')[0]);
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
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, port: server.address().port };
}

function dumpDom(browser, url) {
    return new Promise((resolve, reject) => {
        const child = spawn(browser, [
            '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader', '--no-sandbox',
            '--virtual-time-budget=30000', '--dump-dom', url
        ], { stdio: ['ignore', 'pipe', 'ignore'] });

        let dom = '';
        child.stdout.on('data', d => { dom += d; });
        child.on('error', reject);
        child.on('close', () => resolve(dom));

        setTimeout(() => { child.kill('SIGKILL'); reject(new Error('browser timed out')); }, 120000);
    });
}

const { server, port } = await serve();
const dom = await dumpDom(findBrowser(), `http://127.0.0.1:${port}/index.html`);
server.close();

const match = dom.match(/<pre id="HOLODECK_RESULT">([\s\S]*?)<\/pre>/);
if (!match) {
    console.error('Harness produced no results — the page probably failed to load.');
    process.exit(1);
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const raw = decode(match[1]).trim();
if (!raw) {
    console.error('Harness started but never finished — it was killed mid-run.');
    console.error('Most likely an uncaught error left the app in a state the harness could not drive.');
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

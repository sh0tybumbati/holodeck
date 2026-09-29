#!/usr/bin/env node
// Reports where Holodeck's panels land at a given viewport size, and fails if any two
// overlap or anything runs off-screen.
//
//   node test/measure-layout.mjs            # narrow, the mobile breakpoint
//   node test/measure-layout.mjs 1440 900   # desktop
//   node test/measure-layout.mjs 500 700 touch   # with the touch-mode class applied
//
// Every panel in the app is absolutely positioned, so a media query change can silently
// stack two of them on the same coordinates. This measures instead of eyeballing.
//
// Note: Chromium will not open a window narrower than ~500px, so that is the floor here.

import { findBrowser, browserArgs } from './browser-utils.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const [width = 500, height = 800, mode = ''] = process.argv.slice(2);
const TOUCH = mode === 'touch';

const PANELS = ['top-left-toolbar', 'top-toolbar', 'left-sidebar', 'right-sidebar',
    'viewcube-wrapper', 'theme-toggles', 'variables-panel', 'status-bar'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const measure = `<script>
setTimeout(function () {
  if (${TOUCH}) document.body.classList.add('touch-mode');
  // Add a shape so the properties panel is populated: the right sidebar is the largest
  // panel and is not laid out at all while nothing is selected.
  var add = document.querySelector('[data-shape="cube"]');
  if (add) add.click();
  var ids = ${JSON.stringify(PANELS)};
  var boxes = {};
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;   // hidden panels are not laid out
    boxes[id] = { l: Math.round(r.left), t: Math.round(r.top),
                  r: Math.round(r.right), b: Math.round(r.bottom) };
  });
  var overlaps = [], ids2 = Object.keys(boxes);
  for (var i = 0; i < ids2.length; i++) for (var j = i + 1; j < ids2.length; j++) {
    var a = boxes[ids2[i]], b = boxes[ids2[j]];
    if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) overlaps.push(ids2[i] + ' ~ ' + ids2[j]);
  }
  var off = ids2.filter(function (id) {
    return boxes[id].r > innerWidth + 1 || boxes[id].b > innerHeight + 1 || boxes[id].l < -1;
  });
  fetch('/__layout', { method: 'POST', body: JSON.stringify(
    { viewport: innerWidth + 'x' + innerHeight, boxes: boxes, overlaps: overlaps, offscreen: off })
  }).catch(function () {});
}, 3500);
</script>`;

let resolveLayout;
const layoutPromise = new Promise(resolve => { resolveLayout = resolve; });

const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (req.method === 'POST' && path === '/__layout') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        res.writeHead(204).end();
        resolveLayout(Buffer.concat(chunks).toString());
        return;
    }
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
        let body = await readFile(file);
        if (file.endsWith('index.html')) body = body.toString().replace('</body>', measure + '\n</body>');
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch { res.writeHead(404).end('not found'); }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const browser = findBrowser();

// Its own profile: without this the browser attaches to an already-running instance, which
// silently ignores --window-size and would put this measurement in the user's own browser.
const profileDir = await mkdtemp(join(tmpdir(), 'holodeck-layout-'));

const child = spawn(browser, [...browserArgs(profileDir), `--window-size=${width},${height}`,
    `http://127.0.0.1:${server.address().port}/index.html`], { stdio: 'ignore' });

const raw = await Promise.race([layoutPromise, new Promise(r => setTimeout(() => r(null), 60000))]);
child.kill('SIGKILL');
server.close();
// Best-effort: the browser may still be flushing its profile as it dies.
await rm(profileDir, { recursive: true, force: true }).catch(() => {});

if (raw === null) { console.error('Page did not report a layout within 60s.'); process.exit(1); }

const layout = JSON.parse(raw);
console.log(`viewport ${layout.viewport}${TOUCH ? '  (touch-mode)' : ''}\n`);
for (const [id, b] of Object.entries(layout.boxes)) {
    console.log(`  ${id.padEnd(20)} x ${String(b.l).padStart(4)}..${String(b.r).padStart(4)}   `
        + `y ${String(b.t).padStart(4)}..${String(b.b).padStart(4)}`);
}
console.log('\noffscreen: ' + (layout.offscreen.join(', ') || 'none'));
console.log('overlaps:  ' + (layout.overlaps.join(', ') || 'none'));
process.exit(layout.overlaps.length === 0 && layout.offscreen.length === 0 ? 0 : 1);

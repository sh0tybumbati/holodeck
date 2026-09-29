// Shared by the browser-driven tests: finds a Chromium-family binary and the flags that
// make it work headless on a sandboxed CI machine.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BROWSERS = [
    process.env.HOLODECK_BROWSER,
    '/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH)
        ? readdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH).filter(d => d.startsWith('chromium-'))
            .map(d => join(process.env.PLAYWRIGHT_BROWSERS_PATH, d, 'chrome-linux', 'chrome')) : [])
].filter(Boolean);

export function findBrowser() {
    const found = BROWSERS.find(p => existsSync(p));
    if (!found) {
        console.error('No Chromium-family browser found. Looked in:\n  ' + BROWSERS.join('\n  '));
        process.exit(2);
    }
    return found;
}

export function browserArgs(profileDir) {
    return [
        '--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
        `--user-data-dir=${profileDir}`,
        // Sandboxed machines reach the CDN only through a proxy, which Chromium does not read
        // from the environment on its own.
        ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=127.0.0.1;localhost'] : [])
    ];
}

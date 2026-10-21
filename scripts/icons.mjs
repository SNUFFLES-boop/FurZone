// Renders the app icons (Android mipmaps, Windows .ico sizes) from the logo, using Chromium.
// node scripts/icons.mjs   (then scripts/make_ico.py packs the Windows sizes)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = new URL('..', import.meta.url).pathname;

const GRAD = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#ec4899"/><stop offset="1" stop-color="#fb923c"/></linearGradient>`;
const PAW = `M32 41c-5 0-9-2.7-9-6.8 0-4.3 4.1-8.9 9-8.9s9 4.6 9 8.9C41 38.3 37 41 32 41zM19 24.5a3.2 3.5 0 1 0 6.4 0a3.2 3.5 0 1 0-6.4 0zM25 17a3.3 3.8 0 1 0 6.6 0a3.3 3.8 0 1 0-6.6 0zM32.4 17a3.3 3.8 0 1 0 6.6 0a3.3 3.8 0 1 0-6.6 0zM38.6 24.5a3.2 3.5 0 1 0 6.4 0a3.2 3.5 0 1 0-6.4 0z`;
const BUBBLE = `M32 4C16.5 4 4 14.9 4 28.5c0 7.6 3.9 14.4 10.1 18.9L12 60l13.6-7.2c2.1.4 4.2.7 6.4.7 15.5 0 28-10.9 28-24.5S47.5 4 32 4z`;

// Full icon (legacy launchers, Windows): gradient tile with a white bubble and gradient paw.
const full = (round) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRAD}</defs>
  ${round ? '<circle cx="32" cy="32" r="32" fill="url(#g)"/>' : '<rect width="64" height="64" rx="14" fill="url(#g)"/>'}
  <g transform="translate(9.6 10) scale(0.7)"><path d="${BUBBLE}" fill="#fff"/><path d="${PAW}" fill="url(#g)"/></g></svg>`;
// Adaptive icon layers: 108 units, the middle 66 always visible.
const background = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRAD}</defs><rect width="64" height="64" fill="url(#g)"/></svg>`;
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><defs>${GRAD}</defs>
  <g transform="translate(31 30) scale(0.72)"><path d="${BUBBLE}" fill="#fff"/><path d="${PAW}" fill="url(#g)"/></g></svg>`;

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size, file) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
for (const [name, d] of Object.entries(DENSITIES)) {
    const dir = `${root}android/res/mipmap-${name}/`;
    await mkdir(dir, { recursive: true });
    await render(full(false), Math.round(48 * d), dir + 'ic_launcher.png');
    await render(full(true), Math.round(48 * d), dir + 'ic_launcher_round.png');
    await render(background, Math.round(108 * d), dir + 'ic_launcher_background.png');
    await render(foreground, Math.round(108 * d), dir + 'ic_launcher_foreground.png');
}
await mkdir(`${root}desktop/icon`, { recursive: true });
for (const s of [16, 24, 32, 48, 64, 128, 256]) await render(full(false), s, `${root}desktop/icon/${s}.png`);
await browser.close();
console.log('icons rendered');

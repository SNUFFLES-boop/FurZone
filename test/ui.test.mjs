// Clicks through the built app (dist/web) in Chromium, in demo mode. Run `npm run build` first.
// Screenshots go to test/shots/.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = new URL('../dist/web/', import.meta.url).pathname;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png' };

const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
        const file = join(ROOT, path === '/' ? 'index.html' : path);
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end();
    }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
let passed = 0;
const errors = [];

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log('ok - ' + name);
    } catch (e) {
        console.log('not ok - ' + name);
        console.log(e);
        await page.screenshot({ path: SHOTS + 'FAILED.png' }).catch(() => {});
        await browser.close();
        server.close();
        process.exit(1);
    }
}

const context = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const shot = (name) => page.screenshot({ path: SHOTS + name + '.png' });
const text = (t) => page.getByText(t, { exact: false }).first().waitFor();
const toastSays = (t) => page.locator('.toast', { hasText: t }).first().waitFor();

await test('without a server, the login screen offers the demo', async () => {
    await page.goto(base);
    await text('Share your art, suits and VRChat adventures');
    await page.getByRole('button', { name: 'Try the demo' }).waitFor();
    assert.equal(await page.locator('.auth-form').isVisible(), false);
    await shot('01-welcome');
});

await test('sign up checks the form and the username', async () => {
    await page.getByRole('button', { name: 'Try the demo' }).click();
    await page.locator('.auth-form').waitFor();
    await page.getByPlaceholder('yourname').fill('Ember Tail!');
    assert.equal(await page.getByPlaceholder('yourname').inputValue(), 'embertail');
    await text('@embertail is taken');
    await page.getByPlaceholder('yourname').fill('testfox');
    await text('@testfox is free');
    await page.getByPlaceholder('you@example.com').fill('not-an-email');
    await page.getByPlaceholder('At least 8 characters').fill('short');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await text('Enter a valid email.');
    await page.getByPlaceholder('you@example.com').fill('fox@example.com');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await text('Use at least 8 characters');
    await page.getByPlaceholder('At least 8 characters').fill('Sup3r-Secret-Paws');
    await text('Strong');
    await shot('02-signup');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await page.locator('.slide').first().waitFor();
});

await test('the feed shows posts with species, badges and credits', async () => {
    await text('First time out in the new suit');
    const first = page.locator('.slide').first();
    assert.ok(await first.locator('.name-sub').textContent());
    assert.ok((await page.locator('.conn-vrchat').count()) > 0, 'VRChat badges show');
    assert.ok((await page.locator('.conn-discord').count()) > 0, 'Discord badges show');
    await shot('03-feed');
});

await test('boop with the button and by double-tapping', async () => {
    const slide = page.locator('.slide').first();
    const count = slide.locator('.boop .rail-count');
    const before = Number(await count.textContent());
    await slide.locator('.boop').click();
    await page.waitForFunction((n) => Number(document.querySelector('.slide .boop .rail-count').textContent) === n, before + 1);
    assert.equal(await slide.locator('.boop').getAttribute('aria-pressed'), 'true');
    await slide.locator('.boop').click();
    await page.waitForFunction((n) => Number(document.querySelector('.slide .boop .rail-count').textContent) === n, before);
    await slide.locator('.slide-media').dblclick({ position: { x: 40, y: 180 } });
    await page.waitForFunction((n) => Number(document.querySelector('.slide .boop .rail-count').textContent) === n, before + 1);
    await page.locator('.paw-burst').first().waitFor({ state: 'attached' }).catch(() => {});
});

await test('comments: read, add, and tags in them are links', async () => {
    const slide = page.locator('.slide', { hasText: 'First time out' }).first();
    await slide.scrollIntoViewIfNeeded();
    await slide.getByRole('button', { name: 'Comments' }).click();
    await text('You look AMAZING in it');
    await page.getByLabel('Comment', { exact: true }).fill('So cute!! #fursuit');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('.comment', { hasText: 'So cute!!' }).waitFor();
    assert.equal(await page.locator('.comment a.tag', { hasText: '#fursuit' }).count(), 1);
    await shot('04-comments');
    await page.getByRole('button', { name: 'Close' }).click();
});

await test('a text post is shown as text, never as HTML', async () => {
    await page.locator('.tabbar .nav-new').click();
    await page.getByPlaceholder('Say something about it').fill('<img src=x onerror="window.__xss=1"> hello pack');
    await page.getByRole('button', { name: '#vrchat' }).click();
    assert.match(await page.getByPlaceholder('Say something about it').inputValue(), /#vrchat$/);
    await page.getByPlaceholder('Art by @artist').fill('Art by @mochibun');
    await shot('05-create');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await toastSays('Posted!');
    await page.locator('.text-post', { hasText: 'onerror' }).waitFor();
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('.slide img[src="x"]').count(), 0);
    assert.equal(await page.locator('.credit a.mention', { hasText: '@mochibun' }).count(), 1);
});

await test('a picture post: uploads and shows uncropped', async () => {
    await page.locator('.tabbar .nav-new').click();
    // A tiny PNG made in the page, picked through the real file input.
    const png = await page.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 300;
        c.height = 500;
        const x = c.getContext('2d');
        x.fillStyle = '#ec4899';
        x.fillRect(0, 0, 300, 500);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await page.locator('.drop.has-media img').waitFor();
    await page.getByPlaceholder('Say something about it').fill('New art! #art');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await toastSays('Posted!');
    await page.locator('.slide .slide-img').waitFor();
    assert.equal(await page.locator('.slide .slide-img').evaluate((el) => getComputedStyle(el).objectFit), 'contain');
    await shot('06-picture-post');
});

await test('explore: search by species, trending tags, tag pages', async () => {
    await page.locator('.tabbar .nav-explore').click();
    await page.locator('.tag-chip', { hasText: '#art' }).first().waitFor();
    await page.getByLabel('Search').fill('fox');
    await page.locator('.person', { hasText: 'Ember' }).waitFor();
    await shot('07-explore');
    await page.getByLabel('Search').fill('');
    await page.locator('.tag-chip', { hasText: '#fursuit' }).first().click();
    await page.locator('.tag-title', { hasText: '#fursuit' }).waitFor();
    await page.locator('.slide', { hasText: 'First time out' }).waitFor();
    assert.equal(await page.locator('.slide', { hasText: 'Awoo. That is all.' }).count(), 0);
});

await test('profile: edit species and pronouns, shown on the profile', async () => {
    await page.locator('.tabbar .nav-me').click();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByPlaceholder('Red fox, protogen, dragon').fill('Arctic fox');
    await page.getByPlaceholder('they/them').fill('he/him');
    await page.getByPlaceholder('Tell the pack about yourself').fill('Hi! I draw things #art');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await toastSays('Profile saved');
    await page.locator('.pill', { hasText: 'Arctic fox' }).waitFor();
    await page.locator('.pill', { hasText: 'he/him' }).waitFor();
    await page.locator('.grid .tile').nth(1).waitFor();
    await shot('08-profile');
});

await test('VRChat: bad link refused, code shown, then connected', async () => {
    await page.locator('.tabbar .nav-me').click();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('.conn-row.vrchat').getByRole('button', { name: 'Connect' }).click();
    await page.getByPlaceholder('https://vrchat.com/home/user/usr_').fill('https://vrchat.com/home/user/nope');
    await page.getByRole('button', { name: 'Get my code' }).click();
    await toastSays('usr_');
    await page.getByPlaceholder('https://vrchat.com/home/user/usr_').fill('https://vrchat.com/home/user/usr_c1644b5b-3ca4-45b4-97c6-a2a0de70d469');
    await page.getByRole('button', { name: 'Get my code' }).click();
    const code = await page.locator('.code-box code').textContent();
    assert.match(code, /^PAWST-[A-HJ-NP-Z2-9]{6}$/);
    await shot('09-vrchat-code');
    await page.getByRole('button', { name: "I've added it" }).click();
    await toastSays('VRChat connected');
    await page.locator('.conn-row.vrchat', { hasText: 'Connected as' }).waitFor();
    await page.locator('.conn-row.discord').getByRole('button', { name: 'Connect' }).click();
    await page.locator('.conn-row.discord', { hasText: 'Connected as' }).waitFor();
    await shot('10-connections');
    await page.getByRole('button', { name: 'Close' }).click();
    await page.locator('.profile-id .conn-vrchat').waitFor();
    await page.locator('.profile-id .conn-discord').waitFor();
    await page.locator('.conn-line.vrchat').waitFor();
});

await test('blocking someone removes their posts', async () => {
    await page.locator('.tabbar .nav-home').click();
    const slide = page.locator('.slide', { hasText: 'Awoo. That is all.' });
    await page.locator('.slides').evaluate(async (el) => {
        for (let i = 0; i < 30 && !el.textContent.includes('Awoo. That is all.'); i++) {
            el.scrollTop = el.scrollHeight;
            await new Promise((r) => setTimeout(r, 150));
        }
    });
    await slide.waitFor();
    await slide.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Block @blitzwolf' }).click();
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    await toastSays('Blocked @blitzwolf');
    await page.waitForFunction(() => !document.body.textContent.includes('Awoo. That is all.'));
    await page.locator('.tabbar .nav-me').click();
    await page.locator('.profile-actions a[href="#/settings"]').click();
    await page.getByRole('button', { name: 'Blocked accounts' }).click();
    await page.locator('.person', { hasText: 'blitzwolf' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
});

await test('inbox shows boops and follows and clears the badge', async () => {
    await page.locator('.tabbar .nav-inbox').click();
    await page.getByRole('button', { name: 'Show me what it looks like' }).click();
    await page.locator('.note', { hasText: 'started following you' }).waitFor();
    await page.locator('.note', { hasText: 'booped your post' }).waitFor();
    await shot('11-inbox');
    assert.equal(await page.locator('.tabbar .nav-inbox .badge').isHidden(), true);
});

await test('settings, then log out back to the login screen', async () => {
    await page.locator('.tabbar .nav-me').click();
    await page.locator('.profile-actions a[href="#/settings"]').click();
    await text('Connected accounts');
    await shot('12-settings');
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.locator('.auth-form').waitFor();
    await page.getByRole('tab', { name: 'Log in' }).click();
    await page.getByPlaceholder('you@example.com').fill('fox@example.com');
    await page.getByPlaceholder('Your password').fill('wrong password');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await text('Wrong email or password.');
    await page.getByPlaceholder('Your password').fill('Sup3r-Secret-Paws');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.locator('.tabbar').waitFor();
    await page.locator('.tabbar .nav-home').click();
    await page.locator('.slide').first().waitFor();
});

await test('desktop layout: side menu instead of the tab bar', async () => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.locator('.rail-nav').waitFor();
    assert.equal(await page.locator('.tabbar').isVisible(), false);
    await page.waitForTimeout(300);
    await shot('13-desktop');
    await page.locator('.rail-nav .nav-me').click();
    await page.locator('.profile-id').waitFor();
    await shot('14-desktop-profile');
});

await test('no errors and nothing blocked by the security policy', async () => {
    assert.deepEqual(errors.filter((e) => !/blob:|ERR_FILE_NOT_FOUND/.test(e)), []);
});

console.log(`\n${passed} UI tests passed`);
await browser.close();
server.close();

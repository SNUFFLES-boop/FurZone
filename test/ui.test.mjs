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
    await page.locator('.heart-burst').first().waitFor({ state: 'attached' });
});

await test('front page: new like button, liked by, popular, details and the share menu', async () => {
    await page.locator('.cat-chip', { hasText: 'All' }).click();
    const slide = page.locator('.slide').first();
    await slide.waitFor();
    // Liked from the last test: the heart is filled and the post says who liked it.
    await slide.locator('.boop.on .like-on').waitFor();
    await slide.locator('.liked-by', { hasText: 'Liked by' }).waitFor();
    await slide.locator('.boop').click();
    await slide.locator('.boop:not(.on)').waitFor();
    await slide.locator('.boop').click();
    await slide.locator('.like-spark').first().waitFor({ state: 'attached' });
    await slide.locator('.liked-by', { hasText: 'you' }).waitFor();
    await shot('03b-liked');
    await slide.locator('.liked-by').click();
    await page.locator('.sheet .person').first().waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.locator('.scrim').waitFor({ state: 'detached' });
    // Post details.
    await slide.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Post details' }).click();
    await page.locator('.detail-row', { hasText: 'Likes' }).waitFor();
    await page.locator('.detail-row', { hasText: 'Posted' }).waitFor();
    await noJunkText('post details');
    await page.getByRole('dialog', { name: 'Post details' }).getByLabel('Close').click();
    await page.locator('.scrim').waitFor({ state: 'detached' });
    // Share menu.
    await slide.getByRole('button', { name: 'Share' }).click();
    for (const app of ['Discord', 'X', 'Instagram', 'Facebook', 'Reddit', 'WhatsApp', 'Copy', 'Lounge']) {
        await page.locator('.share-tile', { hasText: new RegExp('^' + app + '$') }).waitFor();
    }
    await shot('03c-share');
    await page.locator('.share-tile', { hasText: /^Copy$/ }).click();
    await toastSays('Copied');
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /on FurZone/);
    await slide.getByRole('button', { name: 'Share' }).click();
    await page.locator('.share-tile', { hasText: /^Lounge$/ }).click();
    await toastSays('Shared in the Lounge');
    // Popular: posts ranked by likes and comments, with a Trending badge.
    await page.locator('.cat-chip', { hasText: 'Popular' }).click();
    await page.locator('.slides .slide .trend-pill', { hasText: '#1 Trending' }).first().waitFor();
    await shot('03d-popular');
    await noJunkText('popular feed');
    await page.locator('.cat-chip', { hasText: 'All' }).click();
    await page.locator('.slide').first().waitFor();
});

await test('comments: read, add, and tags in them are links', async () => {
    const slide = page.locator('.slide', { hasText: 'First time out' }).first();
    await slide.scrollIntoViewIfNeeded();
    await slide.getByRole('button', { name: 'Comments' }).click();
    await text('You look AMAZING in it');
    // Top comments first: the one with hearts.
    assert.match(await page.locator('.comment').first().textContent(), /You look AMAZING/);
    const top = page.locator('.comment', { hasText: 'You look AMAZING' });
    await top.getByRole('button', { name: 'Like comment' }).click();
    assert.equal(await top.getByRole('button', { name: 'Like comment' }).getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => document.querySelector('.comment-like.on span').textContent === '4');
    await page.getByLabel('Comment', { exact: true }).fill('So cute!! #fursuit');
    await page.getByRole('button', { name: 'Send' }).click();
    const mine = page.locator('.comment', { hasText: 'So cute!!' });
    await mine.waitFor();
    await mine.locator('.ctag-you').waitFor();
    assert.match(await page.locator('.comment').first().textContent(), /So cute/, 'new comment shows first');
    assert.equal(await page.locator('.comment a.tag', { hasText: '#fursuit' }).count(), 1);
    await page.getByRole('tab', { name: 'Oldest' }).click();
    assert.match(await page.locator('.comment').first().textContent(), /You look AMAZING/);
    await page.locator('.sheet-head .count-pill', { hasText: '3' }).waitFor();
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
    await page.locator('.quality-row .seg.on', { hasText: 'Best quality' }).waitFor();
    await page.locator('.quality-info', { hasText: '300 × 500' }).waitFor();
    await page.getByPlaceholder('Say something about it').fill('New art! #art');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await toastSays('Posted!');
    await page.locator('.slide .slide-img').waitFor();
    assert.equal(await page.locator('.slide .slide-img').evaluate((el) => getComputedStyle(el).objectFit), 'contain');
    await shot('06-picture-post');
});

await test('video player: seek bar, full screen, skip, speed, fit, back to the feed', async () => {
    await page.locator('.tabbar .nav-new').click();
    const webm = await readFile(new URL('./fixtures/wide.webm', import.meta.url));
    await page.locator('input[type=file]').setInputFiles({ name: 'wide.webm', mimeType: 'video/webm', buffer: webm });
    await page.locator('.drop.has-media video').waitFor();
    await page.getByPlaceholder('Say something about it').fill('Wide video #vrchat');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await toastSays('Posted!');
    await page.locator('.slide.wide-video').first().waitFor();
    await page.locator('.tabbar .nav-home').click();
    const slide = page.locator('.slides .slide.wide-video').first();
    await slide.waitFor();
    // Wide videos fit instead of being cut off, and the buttons sit below the category chips.
    assert.equal(await slide.locator('video').evaluate((v) => getComputedStyle(v).objectFit), 'contain');
    const tools = await slide.locator('.video-tools').boundingBox();
    const chips = await page.locator('.cat-row').boundingBox();
    assert.ok(tools.y >= chips.y + chips.height, 'sound/full screen buttons are below the chips');
    // Drag the seek bar.
    const bar = await slide.locator('.scrub').boundingBox();
    await page.mouse.move(bar.x + bar.width * 0.1, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.6, bar.y + bar.height / 2, { steps: 5 });
    await slide.locator('.scrub-bubble').waitFor();
    await shot('06b-scrubbing');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('.slide.wide-video video').currentTime > 3);
    // Full screen player.
    await slide.locator('.full-pill').click();
    await page.locator('.player.in .player-stage video').waitFor();
    await page.locator('.player.show').waitFor();
    await shot('06c-player');
    const t0 = await page.locator('.player video').evaluate((v) => v.currentTime);
    await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
    assert.ok((await page.locator('.player video').evaluate((v) => v.currentTime)) > t0 + 1 || t0 > 0, 'skipped ahead');
    await page.getByRole('button', { name: 'Back 10 seconds' }).click();
    await page.getByRole('button', { name: 'Playback speed' }).click();
    await page.locator('.player-menu-item', { hasText: '1.5×' }).click();
    assert.equal(await page.locator('.player video').evaluate((v) => v.playbackRate), 1.5);
    await page.getByRole('button', { name: 'Fill the screen' }).click();
    assert.equal(await page.locator('.player-stage').getAttribute('data-fit'), 'cover');
    await page.getByRole('button', { name: 'Repeat' }).click();
    assert.equal(await page.locator('.player video').evaluate((v) => v.loop), false);
    await noJunkText('player');
    if (await page.evaluate(() => !!document.fullscreenElement)) await page.evaluate(() => document.exitFullscreen());
    await page.locator('.player').getByRole('button', { name: 'Close' }).click();
    await page.locator('.player').waitFor({ state: 'detached' });
    // The same video is back in the feed, still at its place, looping again.
    assert.equal(await slide.locator('video').count(), 1);
    assert.equal(await slide.locator('video').evaluate((v) => v.loop), true);
});

await test('explore: search by species, trending tags, tag pages', async () => {
    await page.locator('.tabbar .nav-explore').click();
    await page.locator('.tag-chip', { hasText: '#art' }).first().waitFor();
    // Discover: trending by default, with ranks and stats; then other sorts and filters.
    await page.locator('.discover .tile').first().waitFor();
    await page.locator('.discover .tile-rank.rank-1').waitFor();
    assert.ok((await page.locator('.discover .tile-stats').count()) > 3);
    await page.getByRole('tab', { name: 'Most viewed' }).click();
    await page.locator('.discover .tile').first().waitFor();
    await page.getByRole('button', { name: 'Pictures' }).click();
    await page.getByRole('button', { name: 'All time' }).click();
    await page.locator('.discover .tile img').first().waitFor();
    assert.equal(await page.locator('.discover .tile-text').count(), 0, 'only pictures');
    await page.getByRole('button', { name: 'Text' }).click();
    await page.locator('.discover .tile-text').first().waitFor();
    await page.getByRole('tab', { name: 'Newest' }).click();
    assert.equal(await page.getByRole('button', { name: 'This week' }).isVisible(), false, 'no time filter for Newest');
    await page.getByRole('tab', { name: 'Trending' }).click();
    await page.getByRole('button', { name: 'Everything' }).click();
    await page.getByRole('button', { name: 'This week' }).click();
    await shot('07-explore');
    await page.getByLabel('Search').fill('fox');
    await page.locator('.person', { hasText: 'Ember' }).waitFor();
    await shot('07b-explore-search');
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
    assert.match(code, /^FURZONE-[A-HJ-NP-Z2-9]{6}$/);
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

// Text that should never reach the screen (a value that was missing, shown as a word).
async function noJunkText(where) {
    const t = await page.locator('body').innerText();
    assert.doesNotMatch(t, /\bnull\b|\bundefined\b|\bNaN\b|\[object Object\]|^\s*(false|true)\s*$/m, 'junk text on ' + where);
}

await test('For You: categories and post search', async () => {
    await page.locator('.tabbar .nav-home').click();
    await page.locator('.cat-chip', { hasText: 'Dances' }).waitFor();
    await page.locator('.cat-chip', { hasText: 'VRChat' }).click();
    await page.locator('.cat-chip.on', { hasText: 'VRChat' }).waitFor();
    await page.locator('.cat-chip', { hasText: 'All' }).click();
    await page.locator('.slide').first().waitFor();
    await page.getByRole('button', { name: 'Search' }).first().click();
    await page.locator('.sheet input[type=search]').fill('suit');
    await page.locator('.sheet .tile').first().waitFor();
    await shot('05b-search');
    await page.getByRole('button', { name: 'Close' }).click();
});

await test('inbox: activity, then messages with chats and requests', async () => {
    await page.locator('.tabbar .nav-inbox').click();
    await page.locator('.inbox-tab.on', { hasText: 'Activity' }).waitFor();
    await page.getByRole('button', { name: 'Show me what it looks like' }).click();
    await page.locator('.note', { hasText: 'started following you' }).waitFor();
    await page.locator('.note', { hasText: 'booped your post' }).waitFor();
    await shot('11-inbox');
    await noJunkText('activity');
    // Activity is read now; the badge still counts the unread message and the message request.
    await page.locator('.tabbar .nav-inbox .badge', { hasText: '2' }).waitFor();

    await page.locator('.inbox-tab', { hasText: 'Messages' }).click();
    await page.locator('.thread', { hasText: 'Mochi' }).waitFor();
    await shot('11b-messages');
    await page.locator('.filter-chip', { hasText: 'Requests' }).click();
    const scam = page.locator('.thread', { hasText: 'FREE VRC+' });
    await scam.locator('.flag-pill', { hasText: 'Possible scam' }).waitFor();
    await scam.getByText('Careful: several people reported this account').waitFor();
    await noJunkText('requests');
    await shot('11c-requests');
    await scam.getByRole('button', { name: 'Delete' }).click();
    await toastSays('Request deleted');
    await text('No message requests');

    await page.locator('.filter-chip', { hasText: 'Chats' }).click();
    await page.locator('.thread', { hasText: 'Mochi' }).locator('.thread-link').click();
    await page.locator('.dm-page .bubble', { hasText: 'Welcome to FurZone' }).waitFor();
    await page.getByRole('textbox', { name: 'Message' }).fill('hi mochi!! <b>not bold</b>');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('.bubble-row.mine .bubble', { hasText: '<b>not bold</b>' }).waitFor();
    assert.equal(await page.locator('.bubble b').count(), 0, 'messages are text, never HTML');
    // The demo account writes back, live.
    await page.locator('.bubble-row:not(.mine) .bubble').nth(1).waitFor({ timeout: 5000 });
    await shot('11d-conversation');
    await noJunkText('conversation');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Archive chat' }).click();
    await toastSays('Archived');
    await page.locator('.dm-note', { hasText: 'archived' }).waitFor();
    await page.getByRole('button', { name: 'Unarchive' }).click();
    await toastSays('Moved back to Chats');
    await page.locator('.tabbar .nav-inbox .badge').waitFor({ state: 'hidden' });
});

await test('profile: popular posts, insights, and your followers list', async () => {
    await page.locator('.tabbar .nav-me').click();
    await page.locator('.profile-tab', { hasText: 'Popular' }).waitFor();
    await noJunkText('own profile');
    await page.locator('.profile-tab', { hasText: 'Popular' }).click();
    await page.locator('.grid .tile').first().waitFor();
    await page.locator('.profile-tab', { hasText: 'Insights' }).click();
    await page.locator('.insight-card', { hasText: 'Followers' }).waitFor();
    await page.locator('.insight-card', { hasText: 'Hearts' }).waitFor();
    await page.locator('.fan-row', { hasText: 'Mochi' }).waitFor();
    await noJunkText('insights');
    await shot('10b-insights');
    await page.locator('.stats .stat', { hasText: 'follower' }).click();
    await page.locator('.follow-list .person', { hasText: 'Mochi' }).waitFor();
    await shot('10c-followers');
    await page.getByRole('tab', { name: /Following/ }).click();
    await page.locator('.follow-list').waitFor();
    await page.getByRole('tab', { name: /Followers/ }).click();
    const mochi = page.locator('.follow-list .person', { hasText: 'Mochi' });
    await mochi.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
    await toastSays('Removed @mochibun');
    await page.getByRole('dialog', { name: 'Your people' }).getByLabel('Close').click();
});

await test('the Lounge: chat shared with Discord', async () => {
    await page.evaluate(() => (location.hash = '#/inbox/lounge'));
    await page.locator('.lounge-status', { hasText: 'Linked with Discord' }).waitFor();
    await page.locator('.chat-line.from-discord', { hasText: 'Rexy' }).waitFor();
    // The post shared from the feed shows as an "Open post" button.
    await page.locator('.chat-line .post-chip', { hasText: 'Open post' }).first().waitFor();
    await page.getByRole('textbox', { name: 'Message' }).fill('hello lounge 🐾');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('.chat-line.mine', { hasText: 'hello lounge' }).waitFor();
    await page.getByRole('textbox', { name: 'Message' }).fill('second message');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('.chat-line', { hasText: 'second message' }).waitFor();
    // Someone on Discord answers (demo), and it shows up by itself.
    await page.locator('.chat-line.from-discord', { hasText: 'Kiwi' }).last().waitFor();
    await shot('11e-lounge');
    await noJunkText('lounge');
    // Who's here: FurZone people and Discord people.
    await page.getByRole('button', { name: 'Who is here' }).click();
    await page.locator('.who-section', { hasText: 'Discord' }).getByText('Rexy').waitFor();
    await page.locator('.who-section', { hasText: 'FurZone' }).getByText('testfox').first().waitFor();
    await shot('11e2-lounge-people');
    await page.getByRole('button', { name: 'Close' }).click();
    // The owner can check the Discord link.
    await page.locator('.lounge-status').click();
    await page.locator('.link-check.ok').first().waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    const composer = await page.locator('.chat-composer').boundingBox();
    const tabbar = await page.locator('.tabbar').boundingBox();
    assert.ok(composer.y + composer.height <= tabbar.y + 1, 'the message box sits above the tab bar');
});

await test('news: VRChat updates and announcements', async () => {
    await page.locator('.inbox-tab', { hasText: 'News' }).click();
    await page.locator('.news-card.src-vrchat').first().waitFor();
    await page.locator('.news-card.src-furzone').first().waitFor();
    await shot('11f-news');
    await noJunkText('news');
});

await test('private accounts and report labels', async () => {
    await page.evaluate(() => (location.hash = '#/u/shyotter'));
    await page.locator('.profile-id').waitFor();
    await page.locator('.profile-id .lock').waitFor();
    await page.getByRole('button', { name: 'Request', exact: true }).click();
    await page.getByRole('button', { name: 'Requested' }).waitFor();
    await page.evaluate(() => (location.hash = '#/u/freevbux'));
    await page.locator('.profile-flag .flag-pill', { hasText: 'Possible scam' }).waitFor();
    await noJunkText('flagged profile');
    await shot('09b-flagged');
    await page.evaluate(() => (location.hash = '#/settings'));
    await page.getByRole('switch', { name: /Private account/ }).check();
    await toastSays('Your account is private now');
    await page.getByRole('tab', { name: 'People I follow' }).click();
    await toastSays('Saved');
});

await test('appearance: theme, background, calm motion', async () => {
    await page.getByRole('radio', { name: 'Ocean' }).click();
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--violet-rgb').trim()), '59 130 246');
    await page.locator('canvas.particles').waitFor({ state: 'attached' });
    assert.equal(await page.locator('canvas.particles').isVisible(), true);
    await page.getByRole('tab', { name: 'Stars' }).click();
    await page.getByRole('switch', { name: /Calm motion/ }).check();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('calm')), true);
    await shot('12b-appearance');
    await page.getByRole('tab', { name: 'None' }).click();
    assert.equal(await page.locator('canvas.particles').isVisible(), false);
    await page.getByRole('button', { name: 'Reset appearance' }).click();
    await toastSays('Back to the default look');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('calm')), false);
    assert.equal(await page.locator('canvas.particles').isVisible(), true);
    // The feed covers the screen, so the background stops drawing there.
    await page.locator('.tabbar .nav-home').click();
    await page.locator('.slide').first().waitFor();
    assert.equal(await page.locator('canvas.particles').isVisible(), false);
    // Back to a public account for the rest of the tests.
    await page.evaluate(() => (location.hash = '#/settings'));
    await page.getByRole('switch', { name: /Private account/ }).uncheck();
    await page.getByRole('button', { name: 'Make public' }).click();
    await toastSays('Your account is public now');
});

await test('staff: ranks show as badges, and the owner reviews reports, limits and promotes', async () => {
    // In the demo, the first account made is the owner.
    await page.evaluate(() => (location.hash = '#/home'));
    // Staff still see posts from people they blocked (to moderate them): scroll until a mod's post shows.
    await page.locator('.slide').first().waitFor();
    await page.locator('.slides').evaluate(async (el) => {
        for (let i = 0; i < 30 && !el.querySelector('.role-badge.role-mod'); i++) {
            el.scrollTop = el.scrollHeight;
            await new Promise((r) => setTimeout(r, 150));
        }
    });
    await page.locator('.role-badge.role-mod').first().waitFor();
    await page.evaluate(() => (location.hash = '#/settings'));
    await page.locator('.settings-item', { hasText: 'Reports' }).click();
    const card = page.locator('.report-card', { hasText: 'Unpopular opinion' });
    await card.waitFor();
    assert.match(await card.textContent(), /2 reports/);
    await shot('15-staff-reports');
    await card.getByRole('button', { name: 'Looks fine' }).click();
    await toastSays('Reports cleared');
    await text('All clear');

    await page.evaluate(() => (location.hash = '#/u/skysergal'));
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Staff tools' }).click();
    await text('No limits on this account');
    await page.getByText('Turn off posting').click();
    await page.getByPlaceholder('Why? (the person sees this)').fill('cheese spam');
    await shot('16-staff-tools');
    await page.getByRole('button', { name: 'Apply' }).click();
    await toastSays('Limits saved');
    await page.locator('.staff-strip', { hasText: 'Posting turned off' }).waitFor();

    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Staff tools' }).click();
    await text('Posting turned off');
    await page.locator('.staff-section select').nth(1).selectOption('mod');
    await page.getByRole('button', { name: 'Save rank' }).click();
    await toastSays('is now Mod');
    await page.locator('.profile-id .role-badge.role-mod').waitFor();

    await page.evaluate(() => (location.hash = '#/staff/team'));
    await page.locator('.person', { hasText: 'testfox' }).locator('.role-badge.role-owner').waitFor();
    await page.locator('.person', { hasText: 'skysergal' }).locator('.role-badge.role-mod').waitFor();
    await page.evaluate(() => (location.hash = '#/staff/limited'));
    const limited = page.locator('.report-card', { hasText: 'skysergal' });
    await limited.getByText('Posting turned off').waitFor();
    await limited.getByRole('button', { name: 'Lift limits' }).click();
    await toastSays('has no limits now');
    await text('Nobody is banned or limited');
    await page.evaluate(() => (location.hash = '#/staff/log'));
    await text('turned off posting for @skysergal');
    await text('gave @skysergal the rank Mod');
    await shot('17-staff-log');
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

// The Discord bridge and VRChat news logic, with Discord and Steam replaced by fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWebhookUrl, webhookName, webhookPayload, plainText, discordToRows, newestId, syncFromDiscord, checkDiscordLink } from '../supabase/functions/furzone-lounge/logic.js';
import { cleanSteamText, parseSteamNews, newsWebhookPayload, refreshNews } from '../supabase/functions/vrchat-news/logic.js';

const TOKEN = 'abcDEF123_-abcDEF123_-abcDEF123';

test('webhook URLs: only real Discord webhooks', () => {
    assert.deepEqual(parseWebhookUrl(`https://discord.com/api/webhooks/123456789012/${TOKEN}`), { id: '123456789012', token: TOKEN });
    assert.deepEqual(parseWebhookUrl(`https://discordapp.com/api/v10/webhooks/123456789012/${TOKEN}`), { id: '123456789012', token: TOKEN });
    assert.equal(parseWebhookUrl(`http://discord.com/api/webhooks/123456789012/${TOKEN}`), null);
    assert.equal(parseWebhookUrl(`https://discord.com.evil.example/api/webhooks/123456789012/${TOKEN}`), null);
    assert.equal(parseWebhookUrl('https://discord.com/api/webhooks/abc/def'), null);
    assert.equal(parseWebhookUrl(''), null);
});

test('webhook names follow Discord rules, and mentions are always off', () => {
    assert.equal(webhookName('Ember', 'embertail'), 'Ember (FurZone)');
    assert.equal(webhookName('Discord Fox @everyone #1', 'x'), 'Fox everyone 1 (FurZone)');
    assert.equal(webhookName('', 'clyde'), 'FurZone fur (FurZone)');
    assert.ok(webhookName('x'.repeat(200), '').length <= 80);
    assert.ok(!/discord/i.test(webhookName('DISCORD', 'discordfan')));
    const p = webhookPayload('hi @everyone', { display_name: 'Ember', username: 'embertail' }, 'https://x.supabase.co/a.png');
    assert.deepEqual(p.allowed_mentions, { parse: [] });
    assert.equal(p.content, 'hi @everyone');
    assert.equal(p.avatar_url, 'https://x.supabase.co/a.png');
    assert.equal(webhookPayload('a'.repeat(3000), {}, 'javascript:x').content.length, 2000);
    assert.equal(webhookPayload('hi', {}, 'javascript:x').avatar_url, undefined);
});

test('Discord markup becomes readable text', () => {
    const m = {
        content: 'hey <@111> and <@!222> in <#333> <@&444> <:blobwave:555> <a:party:666> <t:0:R>',
        mentions: [{ id: '111', global_name: 'Ember' }, { id: '222', username: 'blitz' }],
        attachments: [{ id: 'a' }]
    };
    assert.equal(plainText(m), 'hey @Ember and @blitz in #channel @role :blobwave: :party: 1970-01-01 00:00 [attachment]');
    assert.equal(plainText({ content: '', sticker_items: [{}] }), '[sticker]');
    assert.equal(plainText({ content: 'x'.repeat(1500) }).length, 1000);
});

test('rows from Discord: skip our own webhook, bots and system messages; oldest first', () => {
    const msgs = [
        { id: '1300000000000001003', type: 0, content: 'third', author: { id: '81234567890123456', username: 'fox', avatar: 'a'.repeat(32) }, timestamp: '2026-10-21T10:03:00Z' },
        { id: '1300000000000001001', type: 0, content: 'echo', webhook_id: '999999', author: { id: '999999', username: 'Ember (FurZone)', bot: true } },
        { id: '1300000000000001002', type: 0, content: 'bot says', author: { id: '7', username: 'MEE6', bot: true } },
        { id: '1300000000000001000', type: 7, content: '', author: { id: '8', username: 'joiner' } },
        { id: '1300000000000000999', type: 0, content: 'first', author: { id: '81234567890123456', global_name: 'Foxy' } }
    ];
    const rows = discordToRows(msgs, '999999');
    assert.deepEqual(rows.map((r) => r.body), ['first', 'third']);
    assert.equal(rows[0].author, 'Foxy');
    assert.match(rows[0].avatar, /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
    assert.equal(rows[1].avatar, `https://cdn.discordapp.com/avatars/81234567890123456/${'a'.repeat(32)}.png?size=64`);
    assert.equal(newestId(msgs, '1300000000000000500'), '1300000000000001003');
    assert.equal(newestId([], '1300000000000000500'), '1300000000000000500');
    assert.equal(newestId([], null), null);
});

function fakeDeps({ claim = { ok: true, last_discord_id: null }, discord }) {
    const calls = [];
    return {
        calls,
        channelId: '123456789',
        webhookId: '999999',
        async rpc(name, args) {
            calls.push([name, args]);
            if (name === 'lounge_claim_sync') return claim ? [claim] : [];
            if (name === 'lounge_ingest') return args.p_rows.length;
            return null;
        },
        async discord(path) {
            calls.push(['GET', path]);
            return discord(path);
        }
    };
}

test('syncing: shared throttle, first run reads only the latest 20, then everything after the bookmark', async () => {
    const skipped = fakeDeps({ claim: null, discord: () => ({ status: 200, json: [] }) });
    assert.deepEqual(await syncFromDiscord(skipped), { skipped: true, added: 0 });
    assert.ok(!skipped.calls.some((c) => c[0] === 'GET'), 'no Discord call when too soon');

    const first = fakeDeps({ discord: () => ({ status: 200, json: [{ id: '1300000000000000050', type: 0, content: 'hi', author: { id: '81234567890123456', username: 'a' } }] }) });
    assert.deepEqual(await syncFromDiscord(first), { added: 1 });
    assert.ok(first.calls.some((c) => c[0] === 'GET' && c[1] === '/channels/123456789/messages?limit=20'));
    assert.equal(first.calls.find((c) => c[0] === 'lounge_ingest')[1].p_last_id, '1300000000000000050');

    const later = fakeDeps({ claim: { ok: true, last_discord_id: '1300000000000000050' }, discord: () => ({ status: 200, json: [] }) });
    assert.deepEqual(await syncFromDiscord(later), { added: 0 });
    assert.ok(later.calls.some((c) => c[1] === '/channels/123456789/messages?limit=50&after=1300000000000000050'));
    assert.equal(later.calls.find((c) => c[0] === 'lounge_ingest')[1].p_last_id, '1300000000000000050', 'bookmark kept');

    assert.deepEqual(await syncFromDiscord(fakeDeps({ discord: () => ({ status: 429, json: {} }) })), { rateLimited: true, added: 0 });
    await assert.rejects(syncFromDiscord(fakeDeps({ discord: () => ({ status: 403, json: {} }) })), /cannot read that channel/);
    await assert.rejects(syncFromDiscord(fakeDeps({ discord: () => ({ status: 404, json: {} }) })), /not found/);
});

const STEAM = {
    appnews: {
        appid: 438100,
        newsitems: [
            {
                gid: '5001', title: 'VRChat 2026.4.2', url: 'https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5001',
                feedname: 'steam_community_announcements', feed_type: 1, date: 1792540800,
                contents: '{STEAM_CLAN_IMAGE}/1/a.png [h2]Fixes[/h2][list][*]Mirrors are faster[*]Fixed &amp; improved [url=https://x]avatars[/url][/list][img]x[/img]<br>Thanks!'
            },
            { gid: '5000', title: 'Review: VRChat is great', url: 'https://pcgamer.example/vrchat', feedname: 'pcgamer', feed_type: 0, date: 1792454400, contents: 'press' },
            { gid: '4999', title: 'Older update', url: 'http://insecure.example', feed_type: 1, date: 1792368000, contents: 'x' }
        ]
    }
};

test('VRChat news: only official announcements, cleaned up, https links only', () => {
    assert.equal(cleanSteamText(STEAM.appnews.newsitems[0].contents), 'Fixes\n\n• Mirrors are faster\n• Fixed & improved avatars\n\nThanks!');
    const items = parseSteamNews(STEAM);
    assert.deepEqual(items.map((i) => i.external_id), ['steam-5001', 'steam-4999']);
    assert.equal(items[0].published_at, new Date(1792540800 * 1000).toISOString());
    assert.equal(items[1].url, 'https://store.steampowered.com/news/app/438100');
    assert.deepEqual(parseSteamNews(null), []);
    const payload = newsWebhookPayload({ ...items[0], body: 'y'.repeat(500) });
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.equal(payload.embeds[0].description.length, 348);
    assert.ok(!/discord/i.test(payload.username));
});

test('VRChat news refresh: throttled, stores new ones, posts at most 3 to Discord', async () => {
    const posted = [];
    const base = {
        async fetchJson() {
            return { status: 200, json: STEAM };
        },
        postWebhook: async (p) => posted.push(p)
    };
    assert.deepEqual(await refreshNews({ ...base, rpc: async (n) => (n === 'news_claim_fetch' ? false : []) }), { skipped: true, added: 0 });
    const fresh = Array.from({ length: 5 }, (_, i) => ({ title: 'U' + i, body: '', url: null, published_at: `2026-10-0${i + 1}T00:00:00Z` }));
    const result = await refreshNews({ ...base, rpc: async (n) => (n === 'news_claim_fetch' ? true : fresh) });
    assert.deepEqual(result, { added: 5 });
    assert.deepEqual(posted.map((p) => p.embeds[0].title), ['U2', 'U3', 'U4']);
    await assert.rejects(refreshNews({ ...base, fetchJson: async () => ({ status: 500 }), rpc: async () => true }), /Steam answered 500/);
});

test('Discord link check: says exactly what is wrong', async () => {
    const CH = '1300000000000000001';
    const hook = { id: '1300000000000000099', token: TOKEN };
    const fake = (answers) => async (path) => {
        for (const [prefix, r] of answers) if (path.startsWith(prefix)) return r;
        return { status: 500, json: null };
    };
    const human = { id: '1300000000000000201', type: 0, author: { id: '1300000000000000300', username: 'rexy' }, content: 'hi' };
    const good = [
        ['/webhooks/', { status: 200, json: { channel_id: CH } }],
        ['/users/@me', { status: 200, json: { username: 'FurZoneBot' } }],
        [`/channels/${CH}/messages`, { status: 200, json: [human] }],
        [`/channels/${CH}`, { status: 200, json: { name: 'lounge' } }]
    ];
    let r = await checkDiscordLink({ webhook: hook, channelId: CH, hasBotToken: true, discord: fake(good) });
    assert.ok(r.every((c) => c.ok), JSON.stringify(r));

    r = await checkDiscordLink({ webhook: hook, channelId: CH, hasBotToken: true, discord: fake([['/users/@me', { status: 401 }], ...good]) });
    assert.match(r.find((c) => !c.ok).text, /bot token is wrong/);

    r = await checkDiscordLink({ webhook: hook, channelId: CH, hasBotToken: true, discord: fake([[`/channels/${CH}/messages`, { status: 200, json: [human] }], [`/channels/${CH}`, { status: 403 }], ...good]) });
    assert.match(r.find((c) => !c.ok).text, /cannot see the channel/);

    r = await checkDiscordLink({ webhook: hook, channelId: CH, hasBotToken: true, discord: fake([[`/channels/${CH}/messages`, { status: 200, json: [{ ...human, content: '' }] }], ...good]) });
    assert.match(r.find((c) => !c.ok).text, /Message Content Intent/);

    r = await checkDiscordLink({ webhook: hook, channelId: CH, hasBotToken: true, discord: fake([['/webhooks/', { status: 200, json: { channel_id: '1300000000000000555' } }], ...good]) });
    assert.match(r.find((c) => !c.ok).text, /different channel/);

    r = await checkDiscordLink({ webhook: null, channelId: '', hasBotToken: false, discord: fake(good) });
    assert.equal(r.filter((c) => !c.ok).length, 2);
});

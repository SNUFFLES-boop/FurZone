// VRChat update announcements, read from VRChat's official Steam news (app 438100). Runs in the Supabase Edge
// Function (Deno) and in Node tests; the network and database are passed in.

export const VRCHAT_STEAM_NEWS =
    'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=438100&count=10&maxlength=0&format=json';

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** Steam's BBCode / HTML news text as plain readable text. */
export function cleanSteamText(raw) {
    return String(raw || '')
        .replace(/\{STEAM_CLAN_IMAGE\}\/\S+/g, '')
        .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, '')
        .replace(/\[previewyoutube[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, '')
        .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
        .replace(/\[\*\]/g, '\n• ')
        .replace(/\[\/?(h[1-6]|p|list|olist|tr|table)\]/gi, '\n')
        .replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (e) => ENTITIES[e] || e)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

/** Steam news JSON -> announcement rows: only VRChat's own announcements, newest first. */
export function parseSteamNews(json) {
    const items = (json && json.appnews && json.appnews.newsitems) || [];
    return items
        .filter((n) => n && n.gid && n.title)
        .filter((n) => n.feed_type === 1 || n.feedname === 'steam_community_announcements')
        .map((n) => ({
            external_id: 'steam-' + String(n.gid),
            title: String(n.title).trim().slice(0, 200),
            body: cleanSteamText(n.contents).slice(0, 1500),
            url: /^https:\/\//.test(n.url || '') ? String(n.url).slice(0, 500) : `https://store.steampowered.com/news/app/438100`,
            published_at: Number(n.date) > 0 ? new Date(Number(n.date) * 1000).toISOString() : null
        }));
}

/** A Discord webhook message announcing one update. */
export function newsWebhookPayload(item) {
    const text = String(item.body || '');
    return {
        username: 'VRChat Updates (FurZone)',
        allowed_mentions: { parse: [] },
        embeds: [
            {
                title: String(item.title).slice(0, 256),
                url: item.url || undefined,
                description: text.length > 350 ? text.slice(0, 347).trimEnd() + '…' : text,
                color: 0x1fd1ed,
                footer: { text: 'VRChat update · via FurZone' },
                timestamp: item.published_at || undefined
            }
        ]
    };
}

/**
 * Checks for new VRChat updates (at most every 30 minutes, for everyone together) and stores them.
 * deps: { rpc(name, args), fetchJson(url) -> { status, json }, postWebhook(payload) | null }
 */
export async function refreshNews(deps) {
    if (!(await deps.rpc('news_claim_fetch', {}))) return { skipped: true, added: 0 };
    const res = await deps.fetchJson(VRCHAT_STEAM_NEWS);
    if (res.status !== 200) throw new Error(`Steam answered ${res.status}.`);
    const fresh = (await deps.rpc('news_ingest', { p_items: parseSteamNews(res.json) })) || [];
    if (deps.postWebhook) {
        // Oldest first, and only a few at once (the very first check shouldn't flood the channel).
        const toPost = [...fresh].sort((a, b) => String(a.published_at).localeCompare(String(b.published_at))).slice(-3);
        for (const item of toPost) await deps.postWebhook(newsWebhookPayload(item));
    }
    return { added: fresh.length };
}

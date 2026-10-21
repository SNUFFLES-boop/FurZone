// The Lounge bridge between FurZone and one Discord channel. Runs in the Supabase Edge Function (Deno) and in
// Node tests. Nothing here talks to the network or the database directly: those are passed in.
//
// FurZone -> Discord: a channel webhook posts each message under the sender's FurZone name and picture.
// Discord -> FurZone: a bot reads new messages from the channel (needs View Channel, Read Message History and
// the Message Content intent). Messages the webhook itself posted are skipped, so nothing echoes back.

export const DISCORD_API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{5,25}$/;

/** { id, token } from a channel webhook URL, or null if it isn't one. */
export function parseWebhookUrl(url) {
    try {
        const u = new URL(String(url || ''));
        if (u.protocol !== 'https:' || !/^(canary\.|ptb\.)?discord(app)?\.com$/.test(u.hostname)) return null;
        const m = u.pathname.match(/^\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([\w-]{20,})\/?$/);
        return m ? { id: m[1], token: m[2] } : null;
    } catch {
        return null;
    }
}

/** A name Discord accepts for a webhook message (1-80 chars, no "discord"/"clyde", no @ # : or code fences). */
export function webhookName(displayName, username) {
    const clean = (s) =>
        String(s || '')
            .replace(/discord|clyde/gi, '')
            .replace(/```|[@#:]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    const base = clean(displayName) || clean(username) || 'FurZone fur';
    const tag = ' (FurZone)';
    return (base.slice(0, 80 - tag.length) + tag).trim();
}

/** What the webhook posts for one FurZone message. Mentions are switched off so nobody can ping @everyone. */
export function webhookPayload(body, profile, avatarUrl) {
    const payload = {
        content: String(body || '').slice(0, 2000),
        username: webhookName(profile && profile.display_name, profile && profile.username),
        allowed_mentions: { parse: [] }
    };
    if (avatarUrl && /^https:\/\//.test(avatarUrl)) payload.avatar_url = avatarUrl;
    return payload;
}

function avatarOf(author) {
    if (!author || !SNOWFLAKE.test(String(author.id || ''))) return '';
    if (author.avatar && /^(a_)?[0-9a-f]{32}$/.test(author.avatar)) {
        return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=64`;
    }
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(author.id) >> 22n) % 6n)}.png`;
}

/** Discord's message markup made readable as plain text: <@123> becomes @name, <#123> #channel, and so on. */
export function plainText(message) {
    const names = new Map((message.mentions || []).map((u) => [String(u.id), u.global_name || u.username || 'someone']));
    let text = String(message.content || '')
        .replace(/<@!?(\d+)>/g, (_, id) => '@' + (names.get(id) || 'someone'))
        .replace(/<@&\d+>/g, '@role')
        .replace(/<#\d+>/g, '#channel')
        .replace(/<a?:(\w+):\d+>/g, ':$1:')
        .replace(/<t:(\d+)(?::\w)?>/g, (_, t) => new Date(Number(t) * 1000).toISOString().slice(0, 16).replace('T', ' '));
    const extras = [];
    if ((message.attachments || []).length) extras.push(message.attachments.length === 1 ? '[attachment]' : `[${message.attachments.length} attachments]`);
    if ((message.sticker_items || []).length) extras.push('[sticker]');
    if (!text.trim() && (message.embeds || []).length) extras.push('[link]');
    text = [text.trim(), ...extras].filter(Boolean).join(' ');
    return text.slice(0, 1000);
}

/** Discord messages -> rows for lounge_ingest, oldest first. Skips our own webhook, bots and system messages. */
export function discordToRows(messages, webhookId) {
    return (messages || [])
        .filter((m) => m && SNOWFLAKE.test(String(m.id || '')))
        .filter((m) => !(webhookId && m.webhook_id === webhookId))
        .filter((m) => !(m.author && m.author.bot))
        .filter((m) => m.type === 0 || m.type === 19 || m.type === undefined)
        .map((m) => ({
            discord_id: String(m.id),
            body: plainText(m),
            author: String((m.author && (m.author.global_name || m.author.username)) || 'Discord user').slice(0, 100),
            avatar: avatarOf(m.author),
            created_at: m.timestamp || null
        }))
        .filter((r) => r.body.trim())
        .sort((a, b) => (BigInt(a.discord_id) < BigInt(b.discord_id) ? -1 : 1));
}

/** The highest message id in a list (the new bookmark), or the old one. */
export function newestId(messages, previous = null) {
    let best = previous && SNOWFLAKE.test(previous) ? BigInt(previous) : null;
    for (const m of messages || []) {
        if (m && SNOWFLAKE.test(String(m.id || ''))) {
            const id = BigInt(m.id);
            if (best === null || id > best) best = id;
        }
    }
    return best === null ? null : String(best);
}

/**
 * Pulls new Discord messages into the Lounge. Shared by everyone: at most one fetch every few seconds.
 * deps: { rpc(name, args), discord(path) -> { status, json }, channelId, webhookId }
 */
export async function syncFromDiscord(deps) {
    const claimed = await deps.rpc('lounge_claim_sync', { min_gap_ms: 3000 });
    const claim = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!claim || !claim.ok) return { skipped: true, added: 0 };
    const after = claim.last_discord_id;
    // First run: start from the latest few messages instead of importing the whole channel history.
    const path = `/channels/${deps.channelId}/messages?limit=${after ? 50 : 20}${after ? `&after=${after}` : ''}`;
    const res = await deps.discord(path);
    if (res.status === 429) return { rateLimited: true, added: 0 };
    if (res.status === 401 || res.status === 403) throw new Error('The Discord bot cannot read that channel. Check its token and permissions.');
    if (res.status === 404) throw new Error('The Discord channel was not found. Check DISCORD_CHANNEL_ID.');
    if (res.status !== 200 || !Array.isArray(res.json)) throw new Error(`Discord answered ${res.status}.`);
    const rows = discordToRows(res.json, deps.webhookId);
    const added = await deps.rpc('lounge_ingest', { p_rows: rows, p_last_id: newestId(res.json, after) });
    return { added: Number(added) || 0 };
}

// Supabase Edge Function: the Lounge (FurZone chat) and its bridge to one Discord channel.
//
// POST { action: 'status' }        -> { sending, reading }  (is the Discord bridge set up?)
// POST { action: 'send', body }    -> the new chat row      (saved as the logged-in person, then sent to Discord)
// POST { action: 'sync' }          -> { added }             (pulls new Discord messages in; shared, rate-limited)
// POST { action: 'check' }         -> { checks: [{ ok, text }] }  (admins: what works and what to fix)
//
// Secrets (Supabase -> Edge Functions -> Secrets), all optional; without them the Lounge is FurZone-only:
//   DISCORD_WEBHOOK_URL   a webhook for the channel (Channel settings -> Integrations -> Webhooks)
//   DISCORD_BOT_TOKEN     a bot in your server that can read that channel (Message Content intent on)
//   DISCORD_CHANNEL_ID    the channel's id (Developer Mode -> right-click the channel -> Copy Channel ID)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DISCORD_API, parseWebhookUrl, webhookPayload, syncFromDiscord, checkDiscordLink } from './logic.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return reply(405, { error: 'POST only' });

    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !who?.user) return reply(401, { error: 'Log in first.' });

    const webhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL') || '';
    const webhook = parseWebhookUrl(webhookUrl);
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN') || '';
    const channelId = (Deno.env.get('DISCORD_CHANNEL_ID') || '').trim();
    const reading = !!(botToken && /^\d{5,25}$/.test(channelId));

    let body: Record<string, unknown> = {};
    try {
        body = await req.json();
    } catch {
        // empty body
    }
    const rpc = async (name: string, args: Record<string, unknown>) => {
        const { data, error } = await admin.rpc(name, args);
        if (error) throw new Error(error.message);
        return data;
    };

    try {
        if (body.action === 'status') return reply(200, { sending: !!webhook, reading });

        if (body.action === 'send') {
            // Saved as the person themselves, so every database rule (limits, bans, rate limits) applies.
            const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
                auth: { persistSession: false },
                global: { headers: { Authorization: `Bearer ${jwt}` } }
            });
            const { data: row, error } = await asUser.from('chat_messages').insert({ body: String(body.body || '') }).select('*').single();
            if (error) return reply(400, { error: error.message });
            if (webhook) {
                const { data: profile } = await admin
                    .from('profiles')
                    .select('username, display_name, avatar_path')
                    .eq('id', who.user.id)
                    .single();
                const avatarUrl = profile?.avatar_path ? admin.storage.from('media').getPublicUrl(profile.avatar_path).data.publicUrl : '';
                const res = await fetch(`${DISCORD_API}/webhooks/${webhook.id}/${webhook.token}?wait=true`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(webhookPayload(row.body, profile, avatarUrl))
                });
                if (res.ok) {
                    const sent = await res.json();
                    if (sent?.id) await rpc('lounge_mark_relayed', { p_id: row.id, p_discord_id: String(sent.id) });
                }
            }
            return reply(200, row);
        }

        if (body.action === 'sync') {
            if (!reading) return reply(200, { added: 0, reading: false });
            const result = await syncFromDiscord({
                rpc,
                channelId,
                webhookId: webhook ? webhook.id : null,
                async discord(path: string) {
                    const res = await fetch(DISCORD_API + path, {
                        headers: { Authorization: `Bot ${botToken}`, 'User-Agent': 'FurZone Lounge (https://github.com/SNUFFLES-boop/FurZone, 1.0)' }
                    });
                    let json = null;
                    try {
                        json = await res.json();
                    } catch {
                        // not JSON
                    }
                    return { status: res.status, json };
                }
            });
            return reply(200, result);
        }

        if (body.action === 'check') {
            const { data: staffRow } = await admin.from('staff').select('role').eq('user_id', who.user.id).maybeSingle();
            if (!staffRow || !['owner', 'admin'].includes(staffRow.role)) return reply(403, { error: 'Only admins can check the Discord link.' });
            const checks = await checkDiscordLink({
                webhook,
                channelId,
                hasBotToken: !!botToken,
                async discord(path: string, { bot }: { bot: boolean }) {
                    const res = await fetch(DISCORD_API + path, {
                        headers: bot ? { Authorization: `Bot ${botToken}`, 'User-Agent': 'FurZone Lounge (https://github.com/SNUFFLES-boop/FurZone, 1.0)' } : {}
                    });
                    let json = null;
                    try {
                        json = await res.json();
                    } catch {
                        // not JSON
                    }
                    return { status: res.status, json };
                }
            });
            return reply(200, { checks });
        }

        return reply(400, { error: 'Unknown action.' });
    } catch (e) {
        return reply(400, { error: e instanceof Error ? e.message : String(e) });
    }
});

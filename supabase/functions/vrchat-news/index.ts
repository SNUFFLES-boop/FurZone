// Supabase Edge Function: VRChat update announcements. Any logged-in person can ask for a refresh; the database
// makes sure Steam is asked at most every 30 minutes for everyone together. New updates are stored in the
// announcements table and, if DISCORD_WEBHOOK_URL is set, also posted to your Discord channel.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { refreshNews } from './logic.js';

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
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !who?.user) return reply(401, { error: 'Log in first.' });

    const webhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL') || '';
    const validWebhook = /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api(\/v\d+)?\/webhooks\/\d+\/[\w-]+$/.test(webhookUrl);
    try {
        const result = await refreshNews({
            async rpc(name: string, args: Record<string, unknown>) {
                const { data, error } = await admin.rpc(name, args);
                if (error) throw new Error(error.message);
                return data;
            },
            async fetchJson(url: string) {
                const res = await fetch(url, { headers: { 'User-Agent': 'FurZone (https://github.com/SNUFFLES-boop/FurZone)' } });
                let json = null;
                try {
                    json = await res.json();
                } catch {
                    // not JSON
                }
                return { status: res.status, json };
            },
            postWebhook: validWebhook
                ? async (payload: unknown) => {
                      await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                  }
                : null
        });
        return reply(200, result);
    } catch (e) {
        return reply(200, { added: 0, error: e instanceof Error ? e.message : String(e) });
    }
});

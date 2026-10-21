// Supabase Edge Function: checks that the logged-in person put their FurZone code in their VRChat bio, then
// marks their VRChat account as connected. Deploy with: supabase functions deploy vrchat-verify
//
// Secrets (Supabase → Edge Functions → Secrets):
//   VRCHAT_BOT_USERNAME, VRCHAT_BOT_PASSWORD  a separate VRChat account used only to read profiles
//   VRCHAT_BOT_TOTP_SECRET                    that account's authenticator-app (2FA) secret
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyVrchat } from './logic.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function reply(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return reply(405, { error: 'POST only' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false }
    });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !who?.user) return reply(401, { error: 'Log in first.' });

    const username = Deno.env.get('VRCHAT_BOT_USERNAME');
    const password = Deno.env.get('VRCHAT_BOT_PASSWORD');
    if (!username || !password) return reply(503, { error: 'VRChat verification is not set up on the server yet.' });

    try {
        const result = await verifyVrchat(who.user.id, {
            userAgent: 'FurZone/1.0 (VRChat account linking; https://github.com/SNUFFLES-boop/FurZone)',
            username,
            password,
            totpSecret: Deno.env.get('VRCHAT_BOT_TOTP_SECRET') || '',
            async rpc(name: string, args: Record<string, unknown>) {
                const { data, error } = await admin.rpc(name, args);
                if (error) throw new Error(error.message);
                return data;
            },
            async http(url: string, init: RequestInit) {
                const res = await fetch(url, init);
                let json = null;
                try {
                    json = await res.json();
                } catch {
                    // not JSON
                }
                return { status: res.status, json, setCookies: res.headers.getSetCookie() };
            }
        });
        return reply(200, result);
    } catch (e) {
        return reply(400, { error: e instanceof Error ? e.message : String(e) });
    }
});

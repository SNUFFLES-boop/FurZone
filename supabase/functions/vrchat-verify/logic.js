// VRChat verification, written so it runs both in the Supabase Edge Function (Deno) and in Node tests.
// Nothing here knows about Supabase or the network: those are passed in.

export const VRCHAT_API = 'https://api.vrchat.cloud/api/1';
export const VRCHAT_ID = /^usr_[0-9a-f-]{36}$/;

// ---------------------------------------------------------------- TOTP (RFC 6238)

function base32Decode(input) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = String(input).toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean) {
        const i = alphabet.indexOf(ch);
        if (i < 0) throw new Error('The TOTP secret is not valid base32.');
        value = (value << 5) | i;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(out);
}

/** The 6-digit code an authenticator app would show for this secret at `timeMs`. */
export async function totp(secretBase32, timeMs = Date.now(), digits = 6, step = 30) {
    const key = await crypto.subtle.importKey('raw', base32Decode(secretBase32), { name: 'HMAC', hash: 'SHA-1' }, false, [
        'sign'
    ]);
    const counter = Math.floor(timeMs / 1000 / step);
    const msg = new Uint8Array(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) {
        msg[i] = c & 0xff;
        c = Math.floor(c / 256);
    }
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
    const offset = mac[mac.length - 1] & 0x0f;
    const bin =
        ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
}

// ---------------------------------------------------------------- checks

/** True when the code is in the person's VRChat bio or status (any case, any spacing around it). */
export function profileHasCode(vrcUser, code) {
    if (!vrcUser || !code) return false;
    const want = String(code).toUpperCase();
    const fields = [vrcUser.bio, vrcUser.statusDescription, ...(Array.isArray(vrcUser.bioLinks) ? vrcUser.bioLinks : [])];
    return fields.some((f) => typeof f === 'string' && f.toUpperCase().includes(want));
}

/** "auth=...; twoFactorAuth=..." from Set-Cookie headers, keeping only VRChat's login cookies. */
export function cookieFrom(setCookies, previous = '') {
    const jar = new Map();
    for (const part of String(previous || '').split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k) jar.set(k, v.join('='));
    }
    for (const header of setCookies || []) {
        const [pair] = String(header).split(';');
        const [k, ...v] = pair.trim().split('=');
        if (k === 'auth' || k === 'twoFactorAuth') jar.set(k, v.join('='));
    }
    return [...jar].filter(([k, v]) => (k === 'auth' || k === 'twoFactorAuth') && v).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ---------------------------------------------------------------- the whole check

/**
 * deps: {
 *   rpc(name, args) -> data            (Supabase service-role RPC)
 *   http(url, init) -> { status, json, setCookies }
 *   username, password, totpSecret, userAgent
 * }
 * Returns { connected: true, handle } or { connected: false, message }.
 */
export async function verifyVrchat(userId, deps) {
    const [pending] = await deps.rpc('vrchat_claim_attempt', { p_user: userId });
    if (!pending) return { connected: false, message: 'Get a new code first.' };
    const { vrchat_user_id: vrcId, code } = pending;
    if (!VRCHAT_ID.test(vrcId)) return { connected: false, message: 'That VRChat user id is not valid.' };

    const headers = (cookie) => ({ 'User-Agent': deps.userAgent, Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) });

    async function login() {
        const basic = btoa(`${encodeURIComponent(deps.username)}:${encodeURIComponent(deps.password)}`);
        const res = await deps.http(`${VRCHAT_API}/auth/user`, {
            headers: { ...headers(''), Authorization: `Basic ${basic}` }
        });
        if (res.status === 429) throw new Error('VRChat is rate limiting us. Try again in a few minutes.');
        if (res.status !== 200) throw new Error('The verification bot could not log in to VRChat.');
        let cookie = cookieFrom(res.setCookies);
        const needs = (res.json && res.json.requiresTwoFactorAuth) || [];
        if (needs.length) {
            if (!needs.includes('totp') || !deps.totpSecret) {
                throw new Error('The verification bot needs authenticator-app 2FA set up.');
            }
            const two = await deps.http(`${VRCHAT_API}/auth/twofactorauth/totp/verify`, {
                method: 'POST',
                headers: { ...headers(cookie), 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: await totp(deps.totpSecret) })
            });
            if (two.status !== 200 || !(two.json && two.json.verified)) {
                throw new Error('The verification bot could not pass VRChat 2FA.');
            }
            cookie = cookieFrom(two.setCookies, cookie);
        }
        await deps.rpc('vrchat_session_set', { p_cookie: cookie });
        return cookie;
    }

    async function fetchUser(cookie) {
        return deps.http(`${VRCHAT_API}/users/${encodeURIComponent(vrcId)}`, { headers: headers(cookie) });
    }

    let cookie = (await deps.rpc('vrchat_session_get', {})) || '';
    let res = cookie ? await fetchUser(cookie) : { status: 401 };
    if (res.status === 401) {
        cookie = await login();
        res = await fetchUser(cookie);
    }
    if (res.status === 404) return { connected: false, message: "Couldn't find that VRChat account." };
    if (res.status === 429) return { connected: false, message: 'VRChat is busy. Try again in a minute.' };
    if (res.status !== 200 || !res.json) return { connected: false, message: `VRChat answered ${res.status}. Try again later.` };
    if (res.json.id && String(res.json.id).toLowerCase() !== vrcId) {
        return { connected: false, message: "VRChat returned a different account. Check the id." };
    }
    if (!profileHasCode(res.json, code)) {
        return {
            connected: false,
            message: `Couldn't find ${code} in your VRChat bio yet. VRChat can take a minute to update — try again.`
        };
    }
    const handle = String(res.json.displayName || '').slice(0, 100);
    await deps.rpc('vrchat_complete', { p_user: userId, p_vrchat_user_id: vrcId, p_handle: handle });
    return { connected: true, handle };
}

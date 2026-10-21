import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totp, profileHasCode, cookieFrom, verifyVrchat } from '../supabase/functions/vrchat-verify/logic.js';

const VRC = 'usr_12345678-1111-2222-3333-444455556666';

test('TOTP matches the RFC 6238 test vectors', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
    assert.equal(await totp(secret, 59 * 1000, 8), '94287082');
    assert.equal(await totp(secret, 1111111109 * 1000, 8), '07081804');
    assert.equal(await totp(secret, 2000000000 * 1000, 8), '69279037');
    assert.equal(await totp(secret, 59 * 1000), '287082');
    assert.equal(await totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59 * 1000), '287082');
    await assert.rejects(totp('not base32!', 0), /base32/);
});

test('finds the code in the bio, status or links, any case', () => {
    assert.ok(profileHasCode({ bio: 'hi!\nfurzone-ABC234 :3' }, 'FURZONE-ABC234'));
    assert.ok(profileHasCode({ bio: '', statusDescription: 'FURZONE-ABC234' }, 'FURZONE-ABC234'));
    assert.ok(profileHasCode({ bioLinks: ['https://x.example/FURZONE-ABC234'] }, 'FURZONE-ABC234'));
    assert.ok(!profileHasCode({ bio: 'FURZONE-ABC23' }, 'FURZONE-ABC234'));
    assert.ok(!profileHasCode(null, 'FURZONE-ABC234'));
    assert.ok(!profileHasCode({ bio: 'x' }, ''));
});

test('keeps only VRChat login cookies', () => {
    assert.equal(cookieFrom(['auth=authcookie_1; Path=/; HttpOnly', 'other=1; Path=/']), 'auth=authcookie_1');
    assert.equal(cookieFrom(['twoFactorAuth=tfa; Path=/'], 'auth=authcookie_1'), 'auth=authcookie_1; twoFactorAuth=tfa');
    assert.equal(cookieFrom([], ''), '');
});

function fakeServer({ cookie = '', user, loginNeeds2fa = true, pending = { vrchat_user_id: VRC, code: 'FURZONE-ABC234' } } = {}) {
    const calls = { rpc: [], http: [] };
    let stored = cookie;
    const deps = {
        username: 'bot@example.com',
        password: 'p@ss:word',
        totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
        userAgent: 'FurZone-test',
        async rpc(name, args) {
            calls.rpc.push([name, args]);
            if (name === 'vrchat_claim_attempt') return pending ? [pending] : [];
            if (name === 'vrchat_session_get') return stored;
            if (name === 'vrchat_session_set') stored = args.p_cookie;
            return null;
        },
        async http(url, init = {}) {
            calls.http.push([url, init]);
            if (url.endsWith('/auth/user')) {
                assert.equal(init.headers.Authorization, 'Basic ' + btoa('bot%40example.com:p%40ss%3Aword'));
                return loginNeeds2fa
                    ? { status: 200, json: { requiresTwoFactorAuth: ['totp', 'otp'] }, setCookies: ['auth=fresh; Path=/'] }
                    : { status: 200, json: { id: 'usr_bot' }, setCookies: ['auth=fresh; Path=/'] };
            }
            if (url.endsWith('/totp/verify')) {
                assert.match(JSON.parse(init.body).code, /^\d{6}$/);
                assert.equal(init.headers.Cookie, 'auth=fresh');
                return { status: 200, json: { verified: true }, setCookies: ['twoFactorAuth=tfa; Path=/'] };
            }
            if (url.includes('/users/')) {
                if (init.headers.Cookie !== 'auth=fresh; twoFactorAuth=tfa' && init.headers.Cookie !== 'auth=fresh') {
                    return { status: 401, json: null };
                }
                return user ? { status: 200, json: user } : { status: 404, json: null };
            }
            throw new Error('unexpected ' + url);
        }
    };
    return { deps, calls, stored: () => stored };
}

test('logs the bot in with 2FA, finds the code and connects', async () => {
    const s = fakeServer({ cookie: 'auth=stale', user: { id: VRC, displayName: 'Foxy', bio: 'hello FURZONE-ABC234' } });
    const result = await verifyVrchat('me', s.deps);
    assert.deepEqual(result, { connected: true, handle: 'Foxy' });
    assert.equal(s.stored(), 'auth=fresh; twoFactorAuth=tfa');
    assert.deepEqual(s.calls.rpc.at(-1), ['vrchat_complete', { p_user: 'me', p_vrchat_user_id: VRC, p_handle: 'Foxy' }]);
    assert.equal(s.calls.http[0][1].headers['User-Agent'], 'FurZone-test');
});

test('reuses a saved login when it still works', async () => {
    const s = fakeServer({ cookie: 'auth=fresh', user: { id: VRC, displayName: 'Foxy', bio: 'FURZONE-ABC234' } });
    assert.equal((await verifyVrchat('me', s.deps)).connected, true);
    assert.equal(s.calls.http.length, 1);
});

test('no code yet, wrong account, missing account', async () => {
    let s = fakeServer({ cookie: 'auth=fresh', user: { id: VRC, displayName: 'Foxy', bio: 'nothing here' } });
    let r = await verifyVrchat('me', s.deps);
    assert.equal(r.connected, false);
    assert.match(r.message, /FURZONE-ABC234/);
    assert.ok(!s.calls.rpc.some(([n]) => n === 'vrchat_complete'));

    s = fakeServer({ cookie: 'auth=fresh', user: { id: 'usr_99999999-1111-2222-3333-444455556666', bio: 'FURZONE-ABC234' } });
    r = await verifyVrchat('me', s.deps);
    assert.equal(r.connected, false);
    assert.ok(!s.calls.rpc.some(([n]) => n === 'vrchat_complete'));

    s = fakeServer({ cookie: 'auth=fresh', user: null });
    r = await verifyVrchat('me', s.deps);
    assert.match(r.message, /Couldn't find that VRChat account/);

    s = fakeServer({ pending: null });
    r = await verifyVrchat('me', s.deps);
    assert.match(r.message, /new code/);
});

test('a bot without authenticator 2FA is reported clearly', async () => {
    const s = fakeServer({ user: { id: VRC, bio: 'FURZONE-ABC234' } });
    s.deps.totpSecret = '';
    await assert.rejects(verifyVrchat('me', s.deps), /2FA/);
});

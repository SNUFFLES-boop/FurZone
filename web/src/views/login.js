import { SERVER_CONFIGURED } from '../config.js';
import { h, icon, toast, errorText, withBusy, field, sheet } from '../ui.js';
import { logo } from '../icons.js';
import { validUsername, passwordStrength } from '../format.js';
import { app } from '../state.js';

const STRENGTH = ['Too short', 'Weak', 'Okay', 'Good', 'Strong'];

/** Where Discord sends people back to: this page, without any #route. */
export function returnUrl() {
    return location.origin + location.pathname;
}

/** Login with Discord, or link Discord to the logged-in account. */
export async function goToDiscord(kind) {
    const backend = app.backend;
    const url = kind === 'link' ? await backend.auth.discordLinkUrl(returnUrl()) : await backend.auth.discordLoginUrl(returnUrl());
    if (url.startsWith('demo:')) return backend.auth.demoDiscord(kind);
    location.assign(url);
}

export function renderLogin(root, { useBackend, createDemoBackend }) {
    let mode = 'signup';
    const live = SERVER_CONFIGURED;

    const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com', required: true, maxlength: 254 });
    const password = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters', required: true, minlength: 8, maxlength: 72 });
    const username = h('input', {
        type: 'text',
        autocomplete: 'username',
        placeholder: 'yourname',
        maxlength: 20,
        autocapitalize: 'none',
        spellcheck: 'false'
    });
    const userHint = h('span', { class: 'field-hint' });
    const meter = h('div', { class: 'meter', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(() => h('span')));
    const meterText = h('span', { class: 'field-hint' });
    const reveal = h('button', { type: 'button', class: 'icon-btn in-field', 'aria-label': 'Show password' }, icon('eye'));
    const submit = h('button', { type: 'submit', class: 'btn primary block lg' });
    const error = h('p', { class: 'form-error', role: 'alert' });
    const forgot = h('button', { type: 'button', class: 'link-btn', text: 'Forgot password?', onclick: () => resetFlow(email.value) });
    const signupOnly = h(
        'div',
        { class: 'signup-only' },
        field('Username', h('div', { class: 'input-wrap' }, h('span', { class: 'prefix', text: '@' }), username), userHint)
    );
    const pwField = field('Password', h('div', { class: 'input-wrap' }, password, reveal), h('div', { class: 'meter-row' }, meter, meterText));

    reveal.onclick = () => {
        const show = password.type === 'password';
        password.type = show ? 'text' : 'password';
        reveal.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
        reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    };

    let checkSeq = 0;
    let checkTimer = 0;
    username.oninput = () => {
        username.value = username.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
        const name = username.value;
        clearTimeout(checkTimer);
        userHint.className = 'field-hint';
        if (!name) return (userHint.textContent = '3–20 letters, numbers or _');
        if (!validUsername(name)) return (userHint.textContent = '3–20 letters, numbers or _');
        userHint.textContent = 'Checking…';
        const seq = ++checkSeq;
        checkTimer = setTimeout(async () => {
            try {
                const ok = await app.backend.auth.usernameAvailable(name);
                if (seq !== checkSeq) return;
                userHint.textContent = ok ? `@${name} is free` : `@${name} is taken`;
                userHint.className = 'field-hint ' + (ok ? 'good' : 'bad');
            } catch {
                if (seq === checkSeq) userHint.textContent = '';
            }
        }, 350);
    };

    password.oninput = () => {
        error.textContent = '';
        const s = passwordStrength(password.value);
        meter.dataset.level = String(password.value ? s : -1);
        meterText.textContent = mode === 'signup' && password.value ? STRENGTH[s] : '';
    };

    const tabs = h('div', { class: 'auth-tabs', role: 'tablist' });
    const form = h(
        'form',
        { class: 'auth-form', novalidate: true },
        signupOnly,
        field('Email', h('div', { class: 'input-wrap' }, email)),
        pwField,
        error,
        submit,
        h('div', { class: 'auth-links' }, forgot)
    );

    function setMode(m) {
        mode = m;
        tabs.replaceChildren(
            ...[
                ['signup', 'Create account'],
                ['login', 'Log in']
            ].map(([v, label]) =>
                h('button', { type: 'button', class: 'auth-tab' + (v === mode ? ' on' : ''), role: 'tab', 'aria-selected': String(v === mode), text: label, onclick: () => setMode(v) })
            )
        );
        signupOnly.hidden = mode !== 'signup';
        forgot.hidden = mode !== 'login';
        password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
        password.placeholder = mode === 'signup' ? 'At least 8 characters' : 'Your password';
        submit.textContent = mode === 'signup' ? 'Create my account' : 'Log in';
        meter.hidden = mode !== 'signup';
        error.textContent = '';
        password.oninput();
    }

    form.onsubmit = (e) => {
        e.preventDefault();
        error.textContent = '';
        const mail = email.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return (error.textContent = 'Enter a valid email.');
        if (mode === 'signup') {
            if (!validUsername(username.value)) return (error.textContent = 'Pick a username: 3–20 letters, numbers or _.');
            if (passwordStrength(password.value) < 1) return (error.textContent = 'Use at least 8 characters for your password.');
        } else if (!password.value) return (error.textContent = 'Enter your password.');
        withBusy(submit, async () => {
            try {
                if (mode === 'signup') {
                    if (!(await app.backend.auth.usernameAvailable(username.value))) {
                        error.textContent = 'That username is taken.';
                        return;
                    }
                    const { needsConfirmation } = await app.backend.auth.signUp(mail, password.value, username.value);
                    if (needsConfirmation) {
                        setMode('login');
                        email.value = mail;
                        toast('Almost there! Confirm the email we sent you, then log in.', 'success', 8000);
                    }
                } else {
                    await app.backend.auth.signIn(mail, password.value);
                }
            } catch (err) {
                error.textContent = errorText(err);
            }
        });
    };

    const discord = h(
        'button',
        {
            type: 'button',
            class: 'btn discord block lg',
            onclick: () =>
                withBusy(discord, async () => {
                    try {
                        await goToDiscord('login');
                    } catch (err) {
                        toast(errorText(err), 'error');
                    }
                })
        },
        icon('discord'),
        'Continue with Discord'
    );

    const startDemo = async () => {
        sessionStorage.setItem('furzone.demo', '1');
        await useBackend(createDemoBackend());
    };

    const card = h(
        'section',
        { class: 'auth-card' },
        !live &&
            h(
                'div',
                { class: 'notice' },
                icon('sparkles'),
                h('div', null, h('strong', { text: 'Demo mode' }), h('p', { text: "The server isn't connected yet, so everything here is a playground that resets when you close the app." }))
            ),
        tabs,
        form,
        h('div', { class: 'or' }, h('span', { text: 'or' })),
        discord,
        h('p', { class: 'fine', text: 'FurZone is for ages 13+ and safe-for-work posts only. Be kind — reports from the community hide rule-breaking posts.' })
    );

    root.append(
        h(
            'div',
            { class: 'auth' },
            h('div', { class: 'auth-bg', 'aria-hidden': 'true' }, Array.from({ length: 12 }, (_, i) => h('span', { class: 'float-paw', style: { '--i': String(i) } }, icon('paw')))),
            h(
                'div',
                { class: 'auth-inner' },
                h('header', { class: 'auth-hero' }, logo(84), h('h1', { text: 'FurZone' }), h('p', { class: 'tagline', text: 'Share your art, suits and VRChat adventures with your pack.' })),
                card
            )
        )
    );

    if (!live && !app.backend) {
        // No server yet: the demo is the only thing that can work, so make it one tap.
        const demo = h('button', { type: 'button', class: 'btn primary block lg', onclick: () => withBusy(demo, startDemo) }, icon('paw'), 'Try the demo');
        card.prepend(demo);
        tabs.hidden = true;
        form.hidden = true;
        discord.hidden = true;
        card.querySelector('.or').hidden = true;
    }
    setMode('signup');
}

function resetFlow(prefill) {
    sheet('Reset password', (body, close) => {
        const email = h('input', { type: 'email', autocomplete: 'email', value: prefill || '', placeholder: 'you@example.com' });
        const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 10, placeholder: '6-digit code' });
        const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (8+ characters)' });
        const msg = h('p', { class: 'form-error', role: 'alert' });
        const step2 = h('div', { hidden: true }, field('Code from the email', code), field('New password', pw));
        const send = h('button', { class: 'btn primary block', text: 'Email me a code' });
        send.onclick = () =>
            withBusy(send, async () => {
                msg.textContent = '';
                try {
                    if (step2.hidden) {
                        await app.backend.auth.sendResetCode(email.value.trim().toLowerCase());
                        step2.hidden = false;
                        send.textContent = 'Set new password';
                        toast('If that email has an account, a code is on its way.', 'success');
                    } else {
                        if (passwordStrength(pw.value) < 1) return (msg.textContent = 'Use at least 8 characters.');
                        await app.backend.auth.resetPassword(email.value.trim().toLowerCase(), code.value.trim(), pw.value);
                        toast('Password changed. Welcome back!', 'success');
                        close();
                    }
                } catch (err) {
                    msg.textContent = errorText(err);
                }
            });
        body.append(field('Email', email), step2, msg, send);
    });
}

// DOM helpers. Everything user-written goes in as text (textContent), never as HTML.
import { icon } from './icons.js';

/**
 * h('div', { class: 'x', text: 'hi', onclick }, ...children). Falsy children are skipped; strings become
 * text nodes. "style" takes an object; "dataset" an object; on* functions become listeners.
 */
export function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
        for (const [k, v] of Object.entries(props)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'text') el.textContent = v;
            else if (k === 'class') el.className = v;
            else if (k === 'style') Object.assign(el.style, v);
            else if (k === 'dataset') Object.assign(el.dataset, v);
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (k === 'ref') v(el);
            else if (v === true) el.setAttribute(k, '');
            else el.setAttribute(k, String(v));
        }
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const c of children) {
        if (c === null || c === undefined || c === false) continue;
        if (Array.isArray(c)) append(el, c);
        else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
}

export { icon };

export function clear(el) {
    while (el.firstChild) el.firstChild.remove();
    return el;
}

/** Round profile picture, or initials on a colour picked from the name. */
export function avatar(user, size = 'md', url) {
    const name = (user && (user.display_name || user.username)) || '?';
    const el = h('span', { class: `avatar avatar-${size}`, 'aria-hidden': 'true' });
    if (url) {
        el.append(h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }));
    } else {
        let hash = 0;
        for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
        el.style.setProperty('--hue', String(hash % 360));
        el.classList.add('avatar-initials');
        el.textContent = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
    }
    return el;
}

// ---------- toasts ----------

let toastHost;
export function toast(message, kind = 'info', ms = 3200) {
    if (!toastHost) {
        toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
        document.body.append(toastHost);
    }
    const el = h(
        'div',
        { class: 'toast toast-' + kind },
        icon(kind === 'error' ? 'close' : kind === 'success' ? 'check' : 'shield'),
        h('span', { text: message })
    );
    toastHost.append(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
        el.classList.remove('in');
        setTimeout(() => el.remove(), 300);
    }, ms);
}

// ---------- sheets (bottom panels) ----------

const openSheets = [];

/** Opens a bottom sheet; returns { el, close }. onClose runs once however it closes. */
export function sheet(title, content, { onClose, tall = false } = {}) {
    const body = h('div', { class: 'sheet-body' });
    const panel = h(
        'div',
        { class: 'sheet' + (tall ? ' sheet-tall' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'sheet-grip' }),
        h(
            'div',
            { class: 'sheet-head' },
            h('h2', { text: title }),
            h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, icon('close'))
        ),
        body
    );
    const scrim = h('div', { class: 'scrim', onclick: (e) => e.target === scrim && close() }, panel);
    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        const i = openSheets.indexOf(api);
        if (i >= 0) openSheets.splice(i, 1);
        scrim.classList.remove('in');
        setTimeout(() => scrim.remove(), 260);
        if (onClose) onClose();
    }
    const api = { el: body, close, panel };
    if (typeof content === 'function') content(body, close);
    else if (content) body.append(content);
    document.body.append(scrim);
    openSheets.push(api);
    requestAnimationFrame(() => scrim.classList.add('in'));
    const first = panel.querySelector('input, textarea, select');
    if (first && !first.matches('[type=file]')) setTimeout(() => first.focus(), 120);
    return api;
}

export function closeTopSheet() {
    const top = openSheets[openSheets.length - 1];
    if (top) {
        top.close();
        return true;
    }
    return false;
}

export function confirmDialog(title, message, { ok = 'OK', danger = false } = {}) {
    return new Promise((resolve) => {
        let answered = false;
        const s = sheet(
            title,
            (body, close) => {
                body.append(
                    h('p', { class: 'muted', text: message }),
                    h(
                        'div',
                        { class: 'row gap' },
                        h('button', { class: 'btn ghost grow', text: 'Cancel', onclick: () => close() }),
                        h('button', {
                            class: 'btn grow ' + (danger ? 'danger' : 'primary'),
                            text: ok,
                            onclick: () => {
                                answered = true;
                                resolve(true);
                                close();
                            }
                        })
                    )
                );
            },
            { onClose: () => !answered && resolve(false) }
        );
        return s;
    });
}

// ---------- small pieces ----------

export function segmented(options, value, onChange, label) {
    return h(
        'div',
        { class: 'segmented', role: 'tablist', 'aria-label': label || '' },
        options.map(([v, text]) =>
            h('button', {
                class: 'seg' + (v === value ? ' on' : ''),
                role: 'tab',
                'aria-selected': String(v === value),
                text,
                onclick: () => v !== value && onChange(v)
            })
        )
    );
}

export function emptyState(iconName, title, text, action) {
    return h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-icon' }, icon(iconName)),
        h('h3', { text: title }),
        text && h('p', { class: 'muted', text }),
        action
    );
}

export function spinner(label = 'Loading') {
    return h('div', { class: 'spinner', role: 'progressbar', 'aria-label': label });
}

export function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input, hint);
}

/** Busy state for a button while a promise runs; returns the promise's result. */
export async function withBusy(button, fn) {
    if (button.disabled) return undefined;
    button.disabled = true;
    button.classList.add('busy');
    try {
        return await fn();
    } finally {
        button.disabled = false;
        button.classList.remove('busy');
    }
}

/** A friendly message for anything the backend throws. */
export function errorText(error) {
    const msg = String((error && (error.message || error.error_description)) || error || '');
    if (/Slow down/i.test(msg)) return msg.replace(/^.*?(Slow down)/i, '$1');
    if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/Email not confirmed/i.test(msg)) return 'Check your inbox and confirm your email first.';
    if (/User already registered/i.test(msg)) return 'There is already an account with that email.';
    if (/duplicate key.*username|username is taken|That username is taken/i.test(msg)) return 'That username is taken.';
    if (/rate limit|too many requests|429/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
    if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Can't reach the server. Check your connection.";
    if (/JWT|session.*(expired|missing)|not logged in/i.test(msg)) return 'Your session ended. Log in again.';
    if (/Database error saving new user/i.test(msg)) return "Couldn't create the account. Try another username.";
    return msg.length && msg.length < 160 ? msg : 'Something went wrong. Try again.';
}

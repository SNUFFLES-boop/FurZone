import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource-variable/inter';
import './styles.css';

import { SERVER_CONFIGURED, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createDemoBackend } from './backend/demo.js';
import { app, setBackend, refreshMe } from './state.js';
import { h, clear, icon, toast, errorText, closeTopSheet } from './ui.js';
import { logo } from './icons.js';
import { renderLogin } from './views/login.js';
import { renderFeed } from './views/feed.js';
import { renderExplore } from './views/explore.js';
import { renderCreate } from './views/create.js';
import { renderInbox } from './views/inbox.js';
import { renderDm } from './views/dm.js';
import { startParticles, particlesForPage } from './particles.js';
import { applyLook } from './look.js';
import { renderProfile } from './views/profile.js';
import { renderPostPage } from './views/post.js';
import { renderSettings } from './views/settings.js';
import { startUpdateChecks } from './views/updates.js';
import { renderStaffPage, renderBanned } from './staff.js';

const root = document.getElementById('app');
let shell = null;
let cleanup = null;
let unsubscribe = null;
let pollTimer = 0;
let stopDms = null;

const TABS = [
    ['home', 'Home', 'home'],
    ['explore', 'Explore', 'compass'],
    ['new', 'Post', 'plus'],
    ['inbox', 'Inbox', 'bell'],
    ['me', 'Profile', 'user']
];

async function boot() {
    applyLook();
    startParticles();
    let backend;
    if (SERVER_CONFIGURED) {
        const { createSupabaseBackend } = await import('./backend/supabase.js');
        backend = createSupabaseBackend(SUPABASE_URL, SUPABASE_ANON_KEY);
        // Coming back from Discord: trade the one-time code for a session, then tidy the address bar.
        if (/[?&#](code|error)=/.test(location.href)) {
            try {
                await backend.auth.finishOAuth(location.href);
            } catch (e) {
                toast(errorText(e), 'error', 6000);
            }
            history.replaceState(null, '', location.pathname + (location.hash.startsWith('#/') ? location.hash : '#/home'));
        }
    } else if (window.__FURZONE_TEST_BACKEND__ === 'demo' || sessionStorage.getItem('furzone.demo') === '1') {
        backend = createDemoBackend();
    }
    if (backend) await useBackend(backend);
    else showLogin();
}

export async function useBackend(backend) {
    if (unsubscribe) unsubscribe();
    setBackend(backend);
    unsubscribe = backend.auth.onChange((event) => {
        if (event === 'SIGNED_OUT') showLogin();
        else if (event === 'SIGNED_IN' && !shell) enter();
    });
    if (await backend.auth.session()) await enter();
    else showLogin();
}

function showLogin() {
    stopView();
    shell = null;
    clearInterval(pollTimer);
    if (stopDms) stopDms();
    stopDms = null;
    clear(root);
    particlesForPage('login');
    renderLogin(root, { useBackend, createDemoBackend });
}

async function enter() {
    try {
        await refreshMe();
    } catch (e) {
        toast(errorText(e), 'error');
        await app.backend.auth.signOut().catch(() => {});
        return showLogin();
    }
    if (app.me.restriction && app.me.restriction.banned) {
        stopView();
        shell = null;
        clear(root);
        renderBanned(root, app.me, () => app.backend.auth.signOut());
        return;
    }
    buildShell();
    if (!location.hash.startsWith('#/') || location.hash === '#/') location.hash = '#/home';
    route();
    startUpdateChecks();
    pollUnread();
    clearInterval(pollTimer);
    // A light check for new notifications while the app is open and visible.
    pollTimer = setInterval(() => document.visibilityState === 'visible' && pollUnread(), 45000);
    // New direct messages arrive live: update the badge and tell an open conversation.
    if (stopDms) stopDms();
    stopDms = app.backend.subscribeDms((msg) => {
        window.dispatchEvent(new CustomEvent('furzone:dm', { detail: msg }));
        pollUnread();
        if (!location.hash.startsWith('#/dm/')) toast('New message 💬', 'info');
    });
}

function buildShell() {
    clear(root);
    const nav = (cls) =>
        h(
            'nav',
            { class: cls, 'aria-label': 'Main' },
            TABS.map(([id, label, ic]) =>
                h(
                    'a',
                    { class: 'nav-item nav-' + id, href: '#/' + id, dataset: { tab: id }, 'aria-label': label },
                    h('span', { class: 'nav-icon' }, icon(ic), id === 'inbox' && h('span', { class: 'badge', hidden: true })),
                    h('span', { class: 'nav-label', text: label })
                )
            )
        );
    const main = h('main', { class: 'view', id: 'view' });
    const side = h(
        'aside',
        { class: 'rail' },
        h('a', { class: 'rail-brand', href: '#/home', 'aria-label': 'FurZone home' }, logo(40), h('span', { text: 'FurZone' })),
        nav('rail-nav'),
        h('div', { class: 'rail-foot' }, h('a', { class: 'nav-item', href: '#/settings' }, h('span', { class: 'nav-icon' }, icon('settings')), h('span', { class: 'nav-label', text: 'Settings' })))
    );
    shell = { main, root: h('div', { class: 'shell' }, side, main, nav('tabbar')) };
    root.append(shell.root);
}

function stopView() {
    if (typeof cleanup === 'function') {
        try {
            cleanup();
        } catch {
            // a view failing to clean up must not block navigation
        }
    }
    cleanup = null;
}

/** The Inbox badge: unread activity + follow requests + unread messages + message requests. */
async function pollUnread() {
    try {
        const [notes, requests, dm] = await Promise.all([
            app.backend.unreadCount(),
            app.backend.followRequestCount().catch(() => 0),
            app.backend.dmCounts().catch(() => ({ unread: 0, requests: 0 }))
        ]);
        app.unreadActivity = notes + requests;
        app.unreadMessages = dm.unread + dm.requests;
        setUnread(app.unreadActivity + app.unreadMessages);
    } catch {
        // offline: try again next time
    }
}

export function setUnread(n) {
    app.unread = n;
    for (const b of document.querySelectorAll('.nav-inbox .badge')) {
        b.hidden = !n;
        b.textContent = n > 99 ? '99+' : String(n);
    }
}

function route() {
    if (!shell) return;
    stopView();
    while (closeTopSheet()) {
        // close any sheet left open by the previous page
    }
    const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    let [page, arg, arg2] = parts;
    if (page === 'me') {
        page = 'u';
        arg = app.me.username;
    }
    const tab = page === 'u' && arg === app.me.username ? 'me' : page === 'dm' ? 'inbox' : page;
    for (const a of root.querySelectorAll('.nav-item')) {
        a.classList.toggle('on', a.dataset.tab === tab);
        if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
    }
    shell.root.dataset.page = page || 'home';
    particlesForPage(page || 'home');
    const view = clear(shell.main);
    view.scrollTop = 0;
    const ctx = { go: (hash) => (location.hash = hash), setUnread: () => pollUnread() };
    try {
        if (page === 'home' || !page) cleanup = renderFeed(view, ctx);
        else if (page === 'explore') cleanup = renderExplore(view, ctx, arg === 'tag' ? arg2 : null);
        else if (page === 'new') cleanup = renderCreate(view, ctx);
        else if (page === 'inbox') cleanup = renderInbox(view, ctx, arg);
        else if (page === 'dm') cleanup = renderDm(view, ctx, arg);
        else if (page === 'u') cleanup = renderProfile(view, ctx, arg);
        else if (page === 'p') cleanup = renderPostPage(view, ctx, arg);
        else if (page === 'settings') cleanup = renderSettings(view, ctx);
        else if (page === 'staff') cleanup = renderStaffPage(view, ctx, arg);
        else location.hash = '#/home';
    } catch (e) {
        view.append(h('p', { class: 'muted pad', text: errorText(e) }));
    }
}

window.addEventListener('hashchange', route);
// Android's back button asks the page first: close a sheet, else go back a page.
window.furzoneBack = () => {
    if (closeTopSheet()) return true;
    if (shell && location.hash !== '#/home') {
        history.back();
        return true;
    }
    return false;
};

boot().catch((e) => {
    clear(root);
    root.append(h('div', { class: 'fatal' }, logo(64), h('p', { text: errorText(e) })));
});

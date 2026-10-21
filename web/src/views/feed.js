import { h, icon, segmented, emptyState, toast, errorText, clear } from '../ui.js';
import { app } from '../state.js';
import { renderSlide } from './postcard.js';

const PAGE = 6;
let lastScope = 'all';

/**
 * A vertical, snap-scrolling list of full-height posts. Shared by the home feed and tag pages.
 * load(before) returns the next page of posts.
 */
export function slideList(container, load, { empty } = {}) {
    const list = h('div', { class: 'slides', tabindex: '0' });
    container.append(list);
    let before = null;
    let done = false;
    let loading = false;
    let active = null;
    const sentinel = h('div', { class: 'slides-more' });

    const visible = new IntersectionObserver(
        (entries) => {
            for (const e of entries) {
                if (e.isIntersecting && e.intersectionRatio > 0.6) {
                    if (active && active !== e.target) active.deactivate();
                    active = e.target;
                    active.activate();
                } else if (e.target === active && e.intersectionRatio < 0.4) {
                    active.deactivate();
                }
            }
        },
        { root: list, threshold: [0, 0.4, 0.6, 1] }
    );
    const near = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && more(), {
        root: list,
        rootMargin: '0px 0px 150% 0px'
    });

    function remove(post, { user } = {}) {
        for (const s of [...list.querySelectorAll('.slide')]) {
            if (s.dataset.id === post.id || (user && s.dataset.user === post.user.id)) {
                visible.unobserve(s);
                s.deactivate && s.deactivate();
                s.remove();
            }
        }
        if (!list.querySelector('.slide') && done) showEmpty();
    }

    function showEmpty() {
        list.replaceChildren(empty ? empty() : emptyState('paw', 'Nothing here yet', ''));
    }

    async function more() {
        if (loading || done) return;
        loading = true;
        sentinel.replaceChildren(h('div', { class: 'spinner' }));
        try {
            const posts = await load(before);
            if (!list.isConnected) return;
            if (posts.length < PAGE) done = true;
            if (posts.length) before = posts[posts.length - 1].created_at;
            for (const p of posts) {
                const slide = renderSlide(p, { onRemoved: remove });
                slide.dataset.user = p.user.id;
                list.insertBefore(slide, sentinel.isConnected ? sentinel : null);
                visible.observe(slide);
            }
            if (!list.querySelector('.slide')) showEmpty();
            else if (done) sentinel.replaceChildren(h('p', { class: 'end-note' }, icon('paw'), "You're all caught up!"));
            else sentinel.replaceChildren();
        } catch (e) {
            sentinel.replaceChildren(
                h('div', { class: 'load-error' }, h('p', { text: errorText(e) }), h('button', { class: 'btn ghost', text: 'Try again', onclick: () => more() }))
            );
        } finally {
            loading = false;
        }
    }

    list.append(sentinel);
    near.observe(sentinel);
    // Arrow keys / j k move between posts on a computer.
    list.addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'j', 'k'].includes(e.key) || e.target.closest('input, textarea')) return;
        e.preventDefault();
        list.scrollBy({ top: (e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1) * list.clientHeight, behavior: 'smooth' });
    });
    more();

    return {
        list,
        destroy() {
            visible.disconnect();
            near.disconnect();
            for (const s of list.querySelectorAll('.slide')) s.deactivate && s.deactivate();
        }
    };
}

export function renderFeed(view) {
    let scope = lastScope;
    let current = null;
    const body = h('div', { class: 'feed-body' });
    const head = h('header', { class: 'feed-head' });

    function draw() {
        head.replaceChildren(
            h('span', { class: 'feed-brand', text: 'Pawst' }),
            segmented(
                [
                    ['all', 'For you'],
                    ['following', 'Following']
                ],
                scope,
                (v) => {
                    scope = lastScope = v;
                    draw();
                },
                'Feed'
            ),
            h('div', { class: 'head-actions' }, h('a', { class: 'icon-btn glass', href: '#/explore', 'aria-label': 'Search' }, icon('search')))
        );
        if (current) current.destroy();
        clear(body);
        current = slideList(body, (before) => app.backend.feed({ scope, before, limit: PAGE }), {
            empty: () =>
                scope === 'following'
                    ? emptyState('user', 'Your Following feed is empty', 'Follow some furs and their posts land here.', h('a', { class: 'btn primary', href: '#/explore', text: 'Find people' }))
                    : emptyState('paw', 'No posts yet', 'Be the very first to post something!', h('a', { class: 'btn primary', href: '#/new', text: 'Create a post' }))
        });
    }

    view.append(h('div', { class: 'feed' }, head, body));
    draw();
    if (app.backend.kind === 'demo' && !sessionStorage.getItem('pawst.demo.hinted')) {
        sessionStorage.setItem('pawst.demo.hinted', '1');
        setTimeout(() => toast('Tip: double-tap a post to boop it 🐾', 'info', 4500), 900);
    }
    return () => current && current.destroy();
}

import { h, icon, emptyState, errorText, spinner, fill } from '../ui.js';
import { app } from '../state.js';
import { renderSlide } from './postcard.js';

export function renderPostPage(view, ctx, id) {
    const body = h('div', { class: 'slides single' }, spinner());
    view.append(
        h(
            'div',
            { class: 'feed' },
            h(
                'header',
                { class: 'feed-head' },
                h('button', { class: 'icon-btn glass', 'aria-label': 'Back', onclick: () => (history.length > 1 ? history.back() : ctx.go('#/home')) }, icon('back')),
                h('span'),
                h('span')
            ),
            body
        )
    );
    let slide = null;
    app.backend
        .post(id)
        .then((post) => {
            if (!body.isConnected) return;
            if (!post) {
                fill(body, emptyState('paw', 'Post not found', 'It may have been deleted, hidden, or posted by someone you blocked.'));
                return;
            }
            slide = renderSlide(post, { onRemoved: () => ctx.go('#/home') });
            fill(body, slide);
            slide.activate();
        })
        .catch((e) => fill(body, h('p', { class: 'form-error pad', text: errorText(e) })));
    return () => slide && slide.deactivate();
}

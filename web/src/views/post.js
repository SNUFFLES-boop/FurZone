import { h, icon, emptyState, errorText, spinner } from '../ui.js';
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
                body.replaceChildren(emptyState('paw', 'Post not found', 'It may have been deleted, hidden, or posted by someone you blocked.'));
                return;
            }
            slide = renderSlide(post, { onRemoved: () => ctx.go('#/home') });
            body.replaceChildren(slide);
            slide.activate();
        })
        .catch((e) => body.replaceChildren(h('p', { class: 'form-error pad', text: errorText(e) })));
    return () => slide && slide.deactivate();
}

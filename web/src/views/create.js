import { h, icon, toast, errorText, withBusy, field } from '../ui.js';
import { app, refreshMe } from '../state.js';
import { mediaKind, prepareImage, checkVideo } from '../format.js';
import { extractTags } from '../backend/shape.js';
import { restrictionText } from '../staff.js';

const QUICK_TAGS = ['art', 'fursuit', 'vrchat', 'sketch', 'commission', 'ych', 'refsheet', 'meme', 'con', 'avatar'];

export function renderCreate(view, ctx) {
    let file = null;
    let kind = null;
    let previewUrl = '';

    const picker = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime', hidden: true });
    const drop = h('button', { type: 'button', class: 'drop', onclick: () => picker.click() });
    const caption = h('textarea', { maxlength: 1000, rows: 4, placeholder: 'Say something about it… add #tags so people find it' });
    const counter = h('span', { class: 'counter', text: '0 / 1000' });
    const tagsLine = h('div', { class: 'tags-preview' });
    const credit = h('input', { type: 'text', maxlength: 80, placeholder: 'Art by @artist (always credit artists!)' });
    const progress = h('div', { class: 'upload-progress', hidden: true }, h('span'));
    const postBtn = h('button', { class: 'btn primary block lg', type: 'submit' }, icon('paw'), 'Post');

    function drawDrop() {
        drop.replaceChildren();
        drop.classList.toggle('has-media', !!file);
        if (!file) {
            drop.append(
                h('span', { class: 'drop-icon' }, icon('image')),
                h('strong', { text: 'Add a picture or video' }),
                h('span', { class: 'muted', text: 'JPG, PNG, WebP, GIF or MP4/WebM/MOV · up to 50 MB, 3 min' })
            );
            return;
        }
        drop.append(
            kind === 'video'
                ? h('video', { src: previewUrl, muted: true, autoplay: true, loop: true, playsinline: true })
                : h('img', { src: previewUrl, alt: 'Preview' }),
            h(
                'span',
                {
                    class: 'remove-media',
                    role: 'button',
                    tabindex: '0',
                    'aria-label': 'Remove',
                    onclick: (e) => {
                        e.stopPropagation();
                        clearMedia();
                    }
                },
                icon('close')
            )
        );
    }

    function clearMedia() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        file = null;
        kind = null;
        previewUrl = '';
        picker.value = '';
        drawDrop();
    }

    picker.onchange = async () => {
        const f = picker.files && picker.files[0];
        if (!f) return;
        try {
            const k = mediaKind(f);
            drop.replaceChildren(h('div', { class: 'spinner' }));
            const ready = k === 'image' ? await prepareImage(f) : await checkVideo(f);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            file = ready;
            kind = k;
            previewUrl = URL.createObjectURL(ready);
        } catch (e) {
            toast(errorText(e), 'error');
        }
        drawDrop();
    };

    caption.oninput = () => {
        counter.textContent = `${caption.value.length} / 1000`;
        const tags = extractTags(caption.value);
        tagsLine.replaceChildren(...tags.map((t) => h('span', { class: 'tag-chip sm', text: '#' + t })));
    };

    const quick = h(
        'div',
        { class: 'quick-tags' },
        QUICK_TAGS.map((t) =>
            h('button', {
                type: 'button',
                class: 'tag-chip sm ghost',
                text: '#' + t,
                onclick: () => {
                    if (extractTags(caption.value).includes(t)) return;
                    caption.value = (caption.value.trimEnd() + ' #' + t).trimStart();
                    caption.oninput();
                }
            })
        )
    );

    const form = h(
        'form',
        { class: 'composer', novalidate: true },
        drop,
        picker,
        field('Caption', caption, h('div', { class: 'row between' }, tagsLine, counter)),
        quick,
        field('Credit', credit),
        progress,
        postBtn,
        h('p', { class: 'fine center', text: 'Safe-for-work only. Photos are resized and their hidden location data is removed before upload.' })
    );

    form.onsubmit = (e) => {
        e.preventDefault();
        if (!file && !caption.value.trim()) return toast('Add a picture, a video or a few words first.', 'error');
        withBusy(postBtn, async () => {
            progress.hidden = !file;
            const bar = progress.firstChild;
            bar.style.transform = 'scaleX(0)';
            try {
                const post = await app.backend.createPost(
                    { caption: caption.value, credit: credit.value, file, mediaType: kind },
                    (f) => (bar.style.transform = `scaleX(${f})`)
                );
                toast('Posted! 🐾', 'success');
                clearMedia();
                caption.value = '';
                credit.value = '';
                refreshMe().catch(() => {});
                ctx.go(`#/p/${post.id}`);
            } catch (err) {
                toast(errorText(err), 'error', 5000);
            } finally {
                progress.hidden = true;
            }
        });
    };

    drawDrop();
    const limits = app.me.restriction;
    const notice =
        limits &&
        (limits.no_posting || limits.no_uploads) &&
        h('p', { class: 'limit-notice' }, icon('ban'), h('span', { text: restrictionText(limits) + (limits.reason ? ` · “${limits.reason}”` : '') }));
    view.append(h('div', { class: 'page create' }, h('h1', { class: 'page-title', text: 'New post' }), notice, form));
    return () => previewUrl && URL.revokeObjectURL(previewUrl);
}

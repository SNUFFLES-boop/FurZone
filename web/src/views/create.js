import { h, icon, toast, errorText, withBusy, field, fill, segmented } from '../ui.js';
import { look, setLook } from '../look.js';
import { app, refreshMe } from '../state.js';
import { mediaKind, prepareImage, checkVideo, qualityLabel, fileSize } from '../format.js';
import { extractTags } from '../backend/shape.js';
import { restrictionText } from '../staff.js';

const QUICK_TAGS = ['skit', 'dance', 'vrchat', 'art', 'fursuit', 'meme', 'music', 'gaming', 'sketch', 'commission', 'ych', 'refsheet', 'con', 'avatar'];

export function renderCreate(view, ctx) {
    let file = null;
    let original = null;
    let kind = null;
    let previewUrl = '';
    let quality = look().upload;
    const qualityRow = h('div', { class: 'quality-row', hidden: true });

    const picker = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime', hidden: true });
    const drop = h('button', { type: 'button', class: 'drop', onclick: () => picker.click() });
    const caption = h('textarea', { maxlength: 1000, rows: 4, placeholder: 'Say something about it… add #tags so people find it' });
    const counter = h('span', { class: 'counter', text: '0 / 1000' });
    const tagsLine = h('div', { class: 'tags-preview' });
    const credit = h('input', { type: 'text', maxlength: 80, placeholder: 'Art by @artist (always credit artists!)' });
    const progress = h('div', { class: 'upload-progress', hidden: true }, h('span'));
    const postBtn = h('button', { class: 'btn primary block lg', type: 'submit' }, icon('paw'), 'Post');

    function drawDrop() {
        fill(drop);
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

    // Standard: up to 2048 px, smaller files. Best: up to 4096 px (4K) at near-full quality. Videos upload as they are.
    async function prepare() {
        if (kind === 'image') {
            return quality === 'best' ? prepareImage(original, 4096, 0.95) : prepareImage(original, 2048, 0.85);
        }
        return checkVideo(original);
    }
    function drawQuality(info) {
        qualityRow.hidden = !file;
        if (!file) return fill(qualityRow);
        if (kind === 'image' && original.type !== 'image/gif') {
            fill(
                qualityRow,
                h('div', { class: 'quality-head' }, icon('sparkles'), h('strong', { text: 'Upload quality' })),
                segmented(
                    [
                        ['standard', 'Standard'],
                        ['best', 'Best quality']
                    ],
                    quality,
                    async (v) => {
                        quality = v;
                        setLook({ upload: v });
                        fill(qualityRow, h('div', { class: 'spinner' }));
                        try {
                            const ready = await prepare();
                            if (previewUrl) URL.revokeObjectURL(previewUrl);
                            file = ready;
                            previewUrl = URL.createObjectURL(ready);
                            drawDrop();
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                        drawQuality();
                    },
                    'Upload quality'
                ),
                h('span', { class: 'quality-info' }, `${file.width} × ${file.height}`, qualityLabel(file.width, file.height) && h('span', { class: 'media-badge q' }, qualityLabel(file.width, file.height)), ` · ${fileSize(file.size)}`)
            );
        } else {
            fill(
                qualityRow,
                h('div', { class: 'quality-head' }, icon('sparkles'), h('strong', { text: kind === 'video' ? 'Video' : 'GIF' }), h('span', { class: 'muted', text: '· uploads in its original quality' })),
                h('span', { class: 'quality-info' }, info || fileSize(file.size))
            );
        }
    }

    function clearMedia() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        original = null;
        file = null;
        kind = null;
        previewUrl = '';
        picker.value = '';
        drawDrop();
        drawQuality();
    }

    let prev = [null, null];
    picker.onchange = async () => {
        const f = picker.files && picker.files[0];
        if (!f) return;
        try {
            const k = mediaKind(f);
            fill(drop, h('div', { class: 'spinner' }));
            prev = [original, kind];
            original = f;
            kind = k;
            const ready = await prepare();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            file = ready;
            previewUrl = URL.createObjectURL(ready);
        } catch (e) {
            toast(errorText(e), 'error');
            [original, kind] = prev;
        }
        drawDrop();
        drawQuality();
        if (kind === 'video' && file) {
            // Show the video's size and length once the browser has read it.
            const probe = document.createElement('video');
            probe.preload = 'metadata';
            probe.muted = true;
            probe.src = previewUrl;
            probe.onloadedmetadata = () => {
                const q = qualityLabel(probe.videoWidth, probe.videoHeight);
                const secs = Math.round(probe.duration || 0);
                drawQuality(`${probe.videoWidth} × ${probe.videoHeight}${q ? ' · ' + q : ''} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · ${fileSize(file.size)}`);
            };
        }
    };

    caption.oninput = () => {
        counter.textContent = `${caption.value.length} / 1000`;
        const tags = extractTags(caption.value);
        fill(tagsLine, ...tags.map((t) => h('span', { class: 'tag-chip sm', text: '#' + t })));
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
        qualityRow,
        picker,
        field('Caption', caption, h('div', { class: 'row between' }, tagsLine, counter)),
        quick,
        field('Credit', credit),
        progress,
        postBtn,
        h('p', { class: 'fine center', text: 'Safe-for-work only. Photos are re-saved before upload, which removes hidden location data.' })
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

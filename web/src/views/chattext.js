// Chat text (Lounge and messages): web links open outside the app, and shared FurZone posts become an
// "Open post" button. Everything else stays plain text.
import { h, icon } from '../ui.js';
import { openExternal } from '../platform.js';

export function chatText(text) {
    const out = [];
    const re = /https:\/\/[^\s<>"]+|furzone:\/\/post\/([A-Za-z0-9_-]{4,60})/gi;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        if (m[1]) {
            const id = m[1];
            out.push(h('a', { class: 'post-chip', href: `#/p/${id}` }, icon('image'), 'Open post'));
            last = m.index + m[0].length;
            continue;
        }
        const url = m[0].replace(/[.,!?)]+$/, '');
        out.push(h('a', { class: 'chat-link', href: url, rel: 'noopener noreferrer nofollow', text: url, onclick: (e) => (e.preventDefault(), openExternal(url)) }));
        last = m.index + url.length;
        re.lastIndex = last;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

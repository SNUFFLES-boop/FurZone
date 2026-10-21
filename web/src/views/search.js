// Search from the For You page: posts (by words or #tag) and people (by name or species).
import { h, icon, sheet, spinner, errorText, emptyState, segmented, fill } from '../ui.js';
import { app } from '../state.js';
import { postTile, personRow } from './explore.js';

let lastTab = 'posts';

export function openSearch() {
    sheet(
        'Search',
        (body) => {
            const input = h('input', { type: 'search', placeholder: 'Search posts, #tags or furs', 'aria-label': 'Search FurZone', maxlength: 60, autocapitalize: 'none', spellcheck: 'false' });
            const tabs = h('div', { class: 'search-tabs' });
            const results = h('div', { class: 'search-results' });
            let seq = 0;
            let timer = 0;

            function drawTabs() {
                fill(tabs, 
                    segmented(
                        [
                            ['posts', 'Posts'],
                            ['people', 'People']
                        ],
                        lastTab,
                        (v) => {
                            lastTab = v;
                            drawTabs();
                            run();
                        },
                        'What to search'
                    )
                );
            }

            function run() {
                clearTimeout(timer);
                const q = input.value.trim();
                if (q.length < 2) {
                    fill(results, h('p', { class: 'muted center pad', text: 'Type at least 2 letters. Try a #tag like #art or #vrchat.' }));
                    return;
                }
                const mine = ++seq;
                fill(results, spinner());
                timer = setTimeout(async () => {
                    try {
                        if (lastTab === 'posts') {
                            const posts = await app.backend.searchPosts(q);
                            if (mine !== seq) return;
                            fill(results, 
                                posts.length ? h('div', { class: 'grid discover' }, posts.map((p, i) => postTile(p, i))) : emptyState('search', 'No posts found', `Nothing matches "${q}" yet.`)
                            );
                        } else {
                            const people = await app.backend.searchUsers(q);
                            if (mine !== seq) return;
                            fill(results, 
                                ...(people.length ? people.map((p) => personRow(p)) : [emptyState('user', 'No one found', `No one matches "${q}".`)])
                            );
                        }
                    } catch (e) {
                        if (mine === seq) fill(results, h('p', { class: 'form-error', text: errorText(e) }));
                    }
                }, 280);
            }

            input.oninput = run;
            drawTabs();
            run();
            body.append(h('label', { class: 'search-box' }, icon('search'), input), tabs, results);
        },
        { tall: true }
    );
}

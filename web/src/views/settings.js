import { h, icon, avatar, toast, errorText, withBusy, field, sheet, confirmDialog, spinner, segmented, fill } from '../ui.js';
import { look, setLook, resetLook, THEMES, BACKGROUNDS, AMOUNTS, TEXT_SIZES } from '../look.js';
import { app, savePref } from '../state.js';
import { passwordStrength } from '../format.js';
import { connectionsSection } from './connect.js';
import { updateSection } from './updates.js';
import { editProfile } from './profile.js';
import { phoneFlow } from './login.js';
import { VERSION } from '../config.js';
import { myRank, roleBadge } from '../staff.js';

export function renderSettings(view) {
    const group = (title, ...rows) => h('section', { class: 'settings-group' }, h('h2', { text: title }), h('div', { class: 'settings-card' }, rows));
    const item = (ic, label, onclick, extra) =>
        h('button', { class: 'settings-item', onclick }, icon(ic), h('span', { class: 'grow', text: label }), extra || icon('chevron', 'faint'));
    const toggle = (ic, label, sub, checked, onchange) => {
        const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch' });
        input.checked = checked;
        input.onchange = () => onchange(input.checked, input);
        return h('label', { class: 'settings-item' }, icon(ic), h('span', { class: 'grow settings-label' }, h('span', { text: label }), sub && h('small', { text: sub })), input);
    };
    /** A labelled row of choices (segmented buttons) inside a settings card. */
    const choice = (ic, label, options, value, onPick) => {
        const holder = h('div', { class: 'settings-choice' });
        const draw = (v) => fill(holder, h('div', { class: 'settings-choice-head' }, icon(ic), h('span', { text: label })), segmented(options, v, (nv) => (onPick(nv), draw(nv)), label));
        draw(value);
        return holder;
    };

    const page = h('div', { class: 'page settings' });
    view.append(page);

    function swatches() {
        const holder = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour theme' });
        const paint = () =>
            fill(
                holder,
                Object.entries(THEMES).map(([key, t]) => {
                    const on = look().theme === key;
                    return h(
                        'button',
                        {
                            class: 'swatch' + (on ? ' on' : ''),
                            role: 'radio',
                            'aria-checked': String(on),
                            style: { '--a': `rgb(${t.colors[0]})`, '--b': `rgb(${t.colors[1]})`, '--c': `rgb(${t.colors[2]})` },
                            onclick: () => (setLook({ theme: key }), paint())
                        },
                        h('span', { class: 'swatch-dot' }, on && icon('check')),
                        h('span', { class: 'swatch-name', text: t.label })
                    );
                })
            );
        paint();
        return holder;
    }

    // Phone number: shown hidden except the last digits; add or change it with a texted code.
    const phoneLabel = h('span', { class: 'muted small' });
    const phoneItem = item('phone', 'Phone number', () => phoneFlow('login', { add: true, onDone: loadPhone }), phoneLabel);
    function loadPhone() {
        if (!app.backend.auth.myPhone) return;
        app.backend.auth
            .myPhone()
            .then((p) => (phoneLabel.textContent = p ? `•••• ${p.slice(-4)}` : 'Add'))
            .catch(() => {});
    }
    loadPhone();

    function draw() {
        const L = look();
        fill(
            page,
            h('h1', { class: 'page-title', text: 'Settings' }),
            h(
                'a',
                { class: 'settings-me', href: `#/u/${app.me.username}` },
                avatar(app.me, 'lg', app.me.avatar_url),
                h('span', null, h('strong', { text: app.me.display_name || app.me.username }), h('span', { class: 'muted', text: '@' + app.me.username })),
                icon('chevron', 'faint')
            ),
            group(
                'Account',
                item('edit', 'Edit profile', () => editProfile(app.me, () => {})),
                item('lock', 'Change password', changePassword),
                phoneItem
            ),
            group(
                'Privacy',
                toggle('lock', 'Private account', 'Only followers you approve can see your posts.', !!app.me.is_private, async (on, input) => {
                    if (!on && !(await confirmDialog('Make your account public?', 'Anyone will be able to see your posts, and everyone waiting for approval becomes a follower.', { ok: 'Make public' }))) {
                        input.checked = true;
                        return;
                    }
                    try {
                        app.me = await app.backend.updatePrivacy({ is_private: on });
                        toast(on ? 'Your account is private now 🔒' : 'Your account is public now', 'success');
                    } catch (e) {
                        input.checked = !on;
                        toast(errorText(e), 'error');
                    }
                }),
                choice(
                    'mail',
                    'Who can message me',
                    [
                        ['everyone', 'Everyone'],
                        ['following', 'People I follow'],
                        ['nobody', 'No one new']
                    ],
                    app.me.dm_policy || 'everyone',
                    async (v) => {
                        try {
                            app.me = await app.backend.updatePrivacy({ dm_policy: v });
                            toast('Saved', 'success');
                        } catch (e) {
                            toast(errorText(e), 'error');
                            draw();
                        }
                    }
                ),
                h(
                    'p',
                    { class: 'settings-note' },
                    icon('shield'),
                    'People you follow can always message you. Messages from anyone else wait in Requests until you accept them, and they can\'t see that you read them.'
                )
            ),
            group('Connected accounts', h('div', { class: 'pad-sm' }, connectionsSection())),
            group(
                'Appearance',
                h('div', { class: 'settings-choice' }, h('div', { class: 'settings-choice-head' }, icon('palette'), h('span', { text: 'Colour theme' })), swatches()),
                choice('sparkles', 'Background', BACKGROUNDS, L.background, (v) => setLook({ background: v })),
                choice('filter', 'How many', AMOUNTS, L.amount, (v) => setLook({ amount: v })),
                choice('edit', 'Text size', TEXT_SIZES.map(([v, label]) => [v, label]), L.text, (v) => setLook({ text: v })),
                toggle('heart', 'Calm motion', 'Fewer animations and a still background. Easier on the eyes and the battery.', L.motion === 'calm', (on) => setLook({ motion: on ? 'calm' : 'full' })),
                item('refresh', 'Reset appearance', () => (resetLook(), draw(), toast('Back to the default look', 'success')), h('span'))
            ),
            group(
                'Videos & pictures',
                toggle('video', 'Play videos automatically', 'In the feed. Tap a video to play it when this is off.', L.autoplay, (on) => setLook({ autoplay: on })),
                choice(
                    'sparkles',
                    'Video loading',
                    [
                        ['best', 'Best quality'],
                        ['saver', 'Data saver']
                    ],
                    L.video,
                    (v) => setLook({ video: v })
                ),
                choice(
                    'image',
                    'Picture uploads',
                    [
                        ['best', 'Best quality (4K)'],
                        ['standard', 'Standard']
                    ],
                    L.upload,
                    (v) => setLook({ upload: v })
                ),
                toggle('volume', 'Play videos with sound', null, !app.muted, (on) => savePref('muted', !on))
            ),
            myRank() >= 1 &&
                group(
                    'Staff',
                    h('a', { class: 'settings-item', href: '#/staff/reports' }, icon('flag'), h('span', { class: 'grow', text: 'Reports' }), roleBadge(app.me.role), icon('chevron', 'faint')),
                    h('a', { class: 'settings-item', href: '#/staff/team' }, icon('shieldCheck'), h('span', { class: 'grow', text: 'Team' }), icon('chevron', 'faint')),
                    myRank() >= 3 && h('a', { class: 'settings-item', href: '#/staff/log' }, icon('copy'), h('span', { class: 'grow', text: 'Staff log' }), icon('chevron', 'faint'))
                ),
            group(
                'Safety',
                item('ban', 'Blocked accounts', blockedList),
                h(
                    'p',
                    { class: 'settings-note' },
                    icon('shield'),
                    'FurZone is safe-for-work only. Report posts that break the rules: five reports hide a post until a moderator checks it. When 3 or more people report an account, everyone sees a warning label on it.'
                )
            ),
            group('App', h('div', { class: 'pad-sm' }, updateSection())),
            group(
                'Session',
                item('logout', 'Log out', async () => {
                    await app.backend.auth.signOut();
                }),
                item('trash', 'Delete my account', deleteAccount, h('span'))
            ),
            h('p', { class: 'fine center', text: `FurZone ${VERSION}${app.backend.kind === 'demo' ? ' · demo mode' : ''}` })
        );
    }
    draw();
}

function changePassword() {
    sheet('Change password', (body, close) => {
        const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, maxlength: 72, placeholder: 'New password (8+ characters)' });
        const pw2 = h('input', { type: 'password', autocomplete: 'new-password', maxlength: 72, placeholder: 'Type it again' });
        const save = h('button', { class: 'btn primary block', text: 'Change password' });
        save.onclick = () =>
            withBusy(save, async () => {
                if (passwordStrength(pw.value) < 1) return toast('Use at least 8 characters.', 'error');
                if (pw.value !== pw2.value) return toast("The two passwords don't match.", 'error');
                try {
                    await app.backend.auth.changePassword(pw.value);
                    toast('Password changed', 'success');
                    close();
                } catch (e) {
                    toast(errorText(e), 'error');
                }
            });
        body.append(field('New password', pw), field('Again', pw2), save);
    });
}

function blockedList() {
    sheet('Blocked accounts', (body) => {
        const list = h('div', { class: 'people' }, spinner());
        body.append(list);
        app.backend
            .blocked()
            .then((people) =>
                fill(list, 
                    ...(people.length
                        ? people.map((p) => {
                              const btn = h('button', { class: 'chip-btn', text: 'Unblock' });
                              const row = h('div', { class: 'person' }, avatar(p, 'md', p.avatar_url), h('span', { class: 'grow' }, h('strong', { text: p.display_name || p.username }), h('span', { class: 'muted', text: ' @' + p.username })), btn);
                              btn.onclick = () =>
                                  withBusy(btn, async () => {
                                      try {
                                          await app.backend.unblock(p.id);
                                          row.remove();
                                          toast(`Unblocked @${p.username}`, 'success');
                                      } catch (e) {
                                          toast(errorText(e), 'error');
                                      }
                                  });
                              return row;
                          })
                        : [h('p', { class: 'muted', text: "You haven't blocked anyone." })])
                )
            )
            .catch((e) => fill(list, h('p', { class: 'form-error', text: errorText(e) })));
    });
}

async function deleteAccount() {
    const ok = await confirmDialog(
        'Delete your account?',
        'Your profile, posts, boops, comments, follows and uploaded pictures are deleted for good. This cannot be undone.',
        { ok: 'Delete everything', danger: true }
    );
    if (!ok) return;
    try {
        await app.backend.auth.deleteAccount();
        toast('Your account was deleted. Take care! 🐾', 'success', 5000);
    } catch (e) {
        toast(errorText(e), 'error');
    }
}

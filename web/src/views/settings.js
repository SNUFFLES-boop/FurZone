import { h, icon, avatar, toast, errorText, withBusy, field, sheet, confirmDialog, spinner } from '../ui.js';
import { app, savePref } from '../state.js';
import { passwordStrength } from '../format.js';
import { connectionsSection } from './connect.js';
import { updateSection } from './updates.js';
import { editProfile } from './profile.js';
import { VERSION } from '../config.js';

export function renderSettings(view) {
    const group = (title, ...rows) => h('section', { class: 'settings-group' }, h('h2', { text: title }), h('div', { class: 'settings-card' }, rows));
    const item = (ic, label, onclick, extra) =>
        h('button', { class: 'settings-item', onclick }, icon(ic), h('span', { class: 'grow', text: label }), extra || icon('chevron', 'faint'));

    const mutedToggle = h('input', { type: 'checkbox', role: 'switch', class: 'switch' });
    mutedToggle.checked = !app.muted;
    mutedToggle.onchange = () => savePref('muted', !mutedToggle.checked);

    view.append(
        h(
            'div',
            { class: 'page settings' },
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
                item('lock', 'Change password', changePassword)
            ),
            group('Connected accounts', h('div', { class: 'pad-sm' }, connectionsSection())),
            group('Safety', item('ban', 'Blocked accounts', blockedList), h('p', { class: 'settings-note' }, icon('shield'), 'FurZone is safe-for-work only. Report posts that break the rules: five reports hide a post until a moderator checks it.')),
            group(
                'App',
                h('label', { class: 'settings-item' }, icon('volume'), h('span', { class: 'grow', text: 'Play videos with sound' }), mutedToggle),
                h('div', { class: 'pad-sm' }, updateSection())
            ),
            group(
                'Session',
                item('logout', 'Log out', async () => {
                    await app.backend.auth.signOut();
                }),
                item('trash', 'Delete my account', deleteAccount, h('span'))
            ),
            h('p', { class: 'fine center', text: `FurZone ${VERSION}${app.backend.kind === 'demo' ? ' · demo mode' : ''}` })
        )
    );
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
                list.replaceChildren(
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
            .catch((e) => list.replaceChildren(h('p', { class: 'form-error', text: errorText(e) })));
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

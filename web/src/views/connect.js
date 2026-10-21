// Linked accounts: Discord (Discord's own login proves it) and VRChat (a code in your VRChat bio, checked
// by the server). The app never writes a connection itself — the server does, after checking.
import { h, icon, toast, errorText, withBusy, field, sheet, confirmDialog, spinner, fill } from '../ui.js';
import { app, refreshMe } from '../state.js';
import { vrchatIdFrom } from '../format.js';
import { goToDiscord } from './login.js';
import { openExternal } from '../platform.js';

export function connectionsSection(onChange) {
    const box = h('div', { class: 'conn-list' }, spinner());

    async function draw() {
        let list = [];
        try {
            list = await app.backend.connections(app.me.id);
        } catch (e) {
            fill(box, h('p', { class: 'form-error', text: errorText(e) }));
            return;
        }
        const find = (p) => list.find((c) => c.provider === p);
        fill(box, row('discord', 'Discord', find('discord')), row('vrchat', 'VRChat', find('vrchat')));
    }

    function row(provider, label, conn) {
        const action = conn
            ? h('button', {
                  type: 'button',
                  class: 'chip-btn',
                  text: 'Unlink',
                  onclick: async () => {
                      if (!(await confirmDialog(`Unlink ${label}?`, `Your ${label} badge goes away. You can connect again any time.`, { ok: 'Unlink', danger: true }))) return;
                      try {
                          await app.backend.unlink(provider);
                          await refreshMe();
                          toast(`${label} unlinked`, 'success');
                          await draw();
                          onChange && onChange();
                      } catch (e) {
                          toast(errorText(e), 'error');
                      }
                  }
              })
            : h('button', {
                  type: 'button',
                  class: 'chip-btn primary',
                  text: 'Connect',
                  onclick: (e) =>
                      provider === 'discord'
                          ? withBusy(e.currentTarget, async () => {
                                try {
                                    await goToDiscord('link');
                                    if (app.backend.kind === 'demo') {
                                        await refreshMe();
                                        await draw();
                                        onChange && onChange();
                                        toast('Discord connected', 'success');
                                    }
                                } catch (err) {
                                    toast(errorText(err), 'error');
                                }
                            })
                          : vrchatFlow(async () => {
                                await refreshMe();
                                await draw();
                                onChange && onChange();
                            })
              });
        return h(
            'div',
            { class: 'conn-row ' + provider },
            h('span', { class: 'conn-logo' }, icon(provider)),
            h(
                'span',
                { class: 'conn-text' },
                h('strong', { text: label }),
                h('span', { class: 'muted', text: conn ? `Connected as ${conn.handle || 'you'}` : 'Not connected' })
            ),
            conn && icon('shieldCheck', 'verified'),
            action
        );
    }

    draw();
    return box;
}

export function vrchatFlow(onDone) {
    sheet(
        'Connect VRChat',
        (body, close) => {
            const steps = h('div', { class: 'steps' });
            body.append(
                h('p', { class: 'muted', text: "VRChat doesn't let other apps log in for you, so we check it like this: you put a short code in your VRChat bio, we look at your public profile, and then your badge says VRChat connected. We never ask for your VRChat password." }),
                steps
            );

            function stepOne() {
                const input = h('input', { type: 'text', placeholder: 'https://vrchat.com/home/user/usr_… or usr_…', autocapitalize: 'none', spellcheck: 'false' });
                const go = h('button', { class: 'btn primary block', text: 'Get my code' });
                const help = h(
                    'button',
                    { type: 'button', class: 'link-btn', onclick: () => openExternal('https://vrchat.com/home') },
                    icon('link'),
                    'Open vrchat.com to copy your profile link'
                );
                go.onclick = () =>
                    withBusy(go, async () => {
                        const id = vrchatIdFrom(input.value);
                        if (!id) return toast('Paste your VRChat profile link — it contains usr_…', 'error');
                        try {
                            const code = await app.backend.startVrchatLink(id);
                            stepTwo(code);
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    });
                fill(steps, 
                    h('div', { class: 'step' }, h('span', { class: 'step-n', text: '1' }), h('div', null, h('strong', { text: 'Your VRChat profile' }), h('p', { class: 'muted', text: 'On vrchat.com, open your profile and copy the address from the address bar.' }))),
                    field('Profile link or user id', input),
                    help,
                    go
                );
            }

            function stepTwo(code) {
                const copy = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy code' }, icon('copy'));
                copy.onclick = async () => {
                    try {
                        await navigator.clipboard.writeText(code);
                        toast('Code copied', 'success');
                    } catch {
                        toast('Select the code and copy it', 'info');
                    }
                };
                const verify = h('button', { class: 'btn primary block', text: "I've added it — check now" });
                const msg = h('p', { class: 'form-error', role: 'alert' });
                verify.onclick = () =>
                    withBusy(verify, async () => {
                        msg.textContent = '';
                        try {
                            const r = await app.backend.verifyVrchat();
                            if (r && r.connected) {
                                toast(`VRChat connected as ${r.handle || 'you'}! You can remove the code from your bio now.`, 'success', 6000);
                                close();
                                onDone && onDone();
                            } else {
                                msg.textContent = (r && r.message) || "Couldn't find the code yet. Try again in a minute.";
                            }
                        } catch (e) {
                            msg.textContent = errorText(e);
                        }
                    });
                fill(steps, 
                    h('div', { class: 'step' }, h('span', { class: 'step-n', text: '2' }), h('div', null, h('strong', { text: 'Add this code to your VRChat bio' }), h('p', { class: 'muted', text: 'vrchat.com → your profile → Edit → Bio. Paste it anywhere and save. It expires in an hour.' }))),
                    h('div', { class: 'code-box' }, h('code', { text: code }), copy),
                    h('button', { type: 'button', class: 'link-btn', onclick: () => openExternal('https://vrchat.com/home') }, icon('link'), 'Open vrchat.com'),
                    msg,
                    verify,
                    h('button', { type: 'button', class: 'link-btn', text: 'Use a different VRChat account', onclick: stepOne })
                );
            }

            stepOne();
        },
        { tall: true }
    );
}

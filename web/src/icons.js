// Line icons (24×24, drawn with the current text colour). Icons in FILLED are solid shapes.
const PATHS = {
    paw:
        'M12 21.2c-3.1 0-5.6-1.7-5.6-4.3 0-2.7 2.6-5.6 5.6-5.6s5.6 2.9 5.6 5.6c0 2.6-2.5 4.3-5.6 4.3zM3.9 10.6a2 2.2 0 1 0 4 0a2 2.2 0 1 0-4 0zM7.6 6a2.1 2.4 0 1 0 4.2 0a2.1 2.4 0 1 0-4.2 0zM12.2 6a2.1 2.4 0 1 0 4.2 0a2.1 2.4 0 1 0-4.2 0zM16.1 10.6a2 2.2 0 1 0 4 0a2 2.2 0 1 0-4 0z',
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
    plus: 'M12 5v14M5 12h14',
    bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
    user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    comment: 'M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.1A8.5 8.5 0 1 1 21 12z',
    share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    close: 'M18 6 6 18M6 6l12 12',
    back: 'M15 18l-6-6 6-6',
    settings:
        'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    image: 'M4 4h16v16H4zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-5-5L5 20',
    video: 'M15 10l5-3v10l-5-3zM3 6h12v12H3z',
    check: 'M20 6 9 17l-5-5',
    copy: 'M8 8h12v12H8zM4 16V4h12',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
    flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
    ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3.1-.4 4.4-1',
    mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.6 7.2',
    chevron: 'M9 18l6-6-6-6',
    refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
    download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    volume: 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
    mute: 'M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6',
    edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    shield: 'M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z',
    shieldCheck: 'M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10zM8.5 12l2.5 2.5 4.5-5',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    hash: 'M5 9h15M4 15h15M10 3 8 21M16 3l-2 18',
    sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
    palette:
        'M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-3.5 3.5H15a2 2 0 0 0-1.4 3.4A1.3 1.3 0 0 1 12 21zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01M17 11h.01',
    discord:
        'M8.5 5.5a14 14 0 0 1 7 0l.7-1.2a15 15 0 0 1 3.6 1.2c2 3.2 2.6 6.6 2.3 10a14 14 0 0 1-4.4 2.3l-1-1.6M8.3 16.2l-1 1.6a14 14 0 0 1-4.4-2.3c-.3-3.4.3-6.8 2.3-10A15 15 0 0 1 8.8 4.3zM9 13a1.3 1.4 0 1 0 0-.01M15 13a1.3 1.4 0 1 0 0-.01M7.5 15.5c3 1.5 6 1.5 9 0',
    vrchat: 'M3 8h18v7a2 2 0 0 1-2 2h-4l-3-3-3 3H5a2 2 0 0 1-2-2zM7.5 12.5a1.5 1.5 0 1 0 0-.01M16.5 12.5a1.5 1.5 0 1 0 0-.01'
};

const FILLED = new Set(['paw']);
const NS = 'http://www.w3.org/2000/svg';

export function icon(name, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon' + (FILLED.has(name) ? ' icon-fill' : '') + (cls ? ' ' + cls : ''));
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', PATHS[name] || PATHS.more);
    svg.appendChild(path);
    return svg;
}

/** The Pawst mark: a paw print in a speech bubble. */
export function logo(size = 72) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('class', 'logo');
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(NS, 'defs');
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', 'pawst-grad');
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '1');
    grad.setAttribute('y2', '1');
    for (const [offset, color] of [
        ['0', '#8b5cf6'],
        ['0.55', '#ec4899'],
        ['1', '#fb923c']
    ]) {
        const stop = document.createElementNS(NS, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', color);
        grad.appendChild(stop);
    }
    defs.appendChild(grad);
    svg.appendChild(defs);
    const bubble = document.createElementNS(NS, 'path');
    bubble.setAttribute('d', 'M32 4C16.5 4 4 14.9 4 28.5c0 7.6 3.9 14.4 10.1 18.9L12 60l13.6-7.2c2.1.4 4.2.7 6.4.7 15.5 0 28-10.9 28-24.5S47.5 4 32 4z');
    bubble.setAttribute('fill', 'url(#pawst-grad)');
    svg.appendChild(bubble);
    const paw = document.createElementNS(NS, 'path');
    paw.setAttribute(
        'd',
        'M32 41c-5 0-9-2.7-9-6.8 0-4.3 4.1-8.9 9-8.9s9 4.6 9 8.9C41 38.3 37 41 32 41zM19 24.5a3.2 3.5 0 1 0 6.4 0a3.2 3.5 0 1 0-6.4 0zM25 17a3.3 3.8 0 1 0 6.6 0a3.3 3.8 0 1 0-6.6 0zM32.4 17a3.3 3.8 0 1 0 6.6 0a3.3 3.8 0 1 0-6.6 0zM38.6 24.5a3.2 3.5 0 1 0 6.4 0a3.2 3.5 0 1 0-6.4 0z'
    );
    paw.setAttribute('fill', '#fff');
    svg.appendChild(paw);
    return svg;
}

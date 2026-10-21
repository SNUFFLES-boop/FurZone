import { defineConfig, loadEnv } from 'vite';

// Content Security Policy: scripts and styles only from the app itself; network only to our Supabase
// project and GitHub (update checks); media only from Supabase storage or local files being uploaded.
function csp(env) {
    let supa = '';
    try {
        supa = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).host : '';
    } catch {
        supa = '';
    }
    const https = supa ? ` https://${supa}` : '';
    const wss = supa ? ` wss://${supa}` : '';
    return [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "font-src 'self' data:",
        `img-src 'self' data: blob:${https}`,
        `media-src 'self' blob:${https}`,
        `connect-src 'self'${https}${wss} https://api.github.com`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-src 'none'"
    ].join('; ');
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    return {
        root: 'web',
        base: './',
        envDir: '..',
        define: {
            __APP_VERSION__: JSON.stringify(process.env.FURZONE_VERSION || '1.0.0')
        },
        build: { outDir: '../dist/web', emptyOutDir: true, sourcemap: false, target: 'es2020', assetsInlineLimit: 0 },
        plugins: [
            {
                name: 'furzone-csp',
                transformIndexHtml: (html) => html.replace('%FURZONE_CSP%', csp(env))
            }
        ]
    };
});

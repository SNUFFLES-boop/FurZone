// Build-time settings (from .env / CI). The anon key is meant to be public: what it can do is limited by the
// database's row level security, not by keeping it secret.
/* global __APP_VERSION__ */
const env = import.meta.env || {};
export const APP_NAME = 'FurZone';
export const SUPABASE_URL = (env.VITE_SUPABASE_URL || '').trim();
export const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY || '').trim();
export const GITHUB_REPO = (env.VITE_GITHUB_REPO || 'SNUFFLES-boop/FurZone').trim();
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0';
export const SERVER_CONFIGURED =
    /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;

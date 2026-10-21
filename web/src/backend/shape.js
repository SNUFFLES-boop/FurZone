// One shape for posts and profiles, whichever backend they came from.

export function normalizeProfile(row, mediaUrl) {
    if (!row) return null;
    return {
        id: row.id || row.user_id,
        username: row.username || '',
        display_name: row.display_name || '',
        pronouns: row.pronouns || '',
        species: row.species || '',
        bio: row.bio || '',
        avatar_path: row.avatar_path || null,
        avatar_url: row.avatar_path ? mediaUrl(row.avatar_path) : '',
        banner_path: row.banner_path || null,
        banner_url: row.banner_path ? mediaUrl(row.banner_path) : '',
        ref_path: row.ref_path || null,
        ref_url: row.ref_path ? mediaUrl(row.ref_path) : '',
        followers_count: Number(row.followers_count) || 0,
        following_count: Number(row.following_count) || 0,
        posts_count: Number(row.posts_count) || 0,
        connections: Array.isArray(row.connections) ? row.connections : [],
        role: row.role || null,
        flag: row.flag || null,
        is_private: !!row.is_private,
        dm_policy: row.dm_policy || 'everyone',
        restriction: normalizeRestriction(row.restriction),
        created_at: row.created_at || null
    };
}

/** A moderator's limits on an account, only while they're still in force. */
export function normalizeRestriction(r) {
    if (!r || (r.until && Date.parse(r.until) <= Date.now())) return null;
    return {
        banned: !!r.banned,
        no_posting: !!r.no_posting,
        no_comments: !!r.no_comments,
        no_uploads: !!r.no_uploads,
        no_profile_edits: !!r.no_profile_edits,
        reason: r.reason || '',
        until: r.until || null
    };
}

export function normalizePost(row, mediaUrl) {
    return {
        id: row.id,
        user: {
            id: row.user_id,
            username: row.username || '',
            display_name: row.display_name || '',
            avatar_url: row.avatar_path ? mediaUrl(row.avatar_path) : '',
            species: row.species || '',
            pronouns: row.pronouns || '',
            connections: Array.isArray(row.connections) ? row.connections : [],
            role: row.role || null
        },
        caption: row.caption || '',
        credit: row.credit || '',
        tags: Array.isArray(row.tags) ? row.tags : [],
        media_path: row.media_path || null,
        media_url: row.media_path ? mediaUrl(row.media_path) : '',
        media_type: row.media_type || null,
        boops: Number(row.boops_count) || 0,
        comments: Number(row.comments_count) || 0,
        views: Number(row.views_count) || 0,
        created_at: row.created_at,
        booped: !!row.booped,
        following: !!row.following
    };
}

const EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov'
};

export const ALLOWED_MEDIA = Object.keys(EXT);
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** media/<user id>/<kind>-<time>-<random>.<ext>: only the owner's folder, names nobody can guess. */
export function mediaPath(userId, kind, mime) {
    const ext = EXT[mime] || 'bin';
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    return `${userId}/${kind}-${Date.now()}-${rand}.${ext}`;
}

/** Hashtags the same way the database reads them: lower-case, unique, at most 10. */
export function extractTags(caption) {
    const out = [];
    for (const m of String(caption || '').matchAll(/#([A-Za-z0-9_]{1,30})/g)) {
        const t = m[1].toLowerCase();
        if (!out.includes(t)) out.push(t);
        if (out.length === 10) break;
    }
    return out;
}

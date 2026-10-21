import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionParts, vrchatIdFrom, passwordStrength, validUsername, compactCount, timeAgo } from '../web/src/format.js';
import { extractTags } from '../web/src/backend/shape.js';
import { parseRelease } from '../web/src/platform.js';

test('captions split into text, #tags and @mentions', () => {
    assert.deepEqual(captionParts('Hi @Mochibun! New #Art <b>x</b>'), [
        { type: 'text', value: 'Hi ' },
        { type: 'mention', value: 'mochibun', label: '@Mochibun' },
        { type: 'text', value: '! New ' },
        { type: 'tag', value: 'art', label: '#Art' },
        { type: 'text', value: ' <b>x</b>' }
    ]);
    assert.deepEqual(captionParts(''), []);
});

test('tags match the database: lower-case, unique, max 10', () => {
    assert.deepEqual(extractTags('#Fursuit #fursuit #VRChat'), ['fursuit', 'vrchat']);
    assert.equal(extractTags(Array.from({ length: 15 }, (_, i) => '#t' + i).join(' ')).length, 10);
});

test('VRChat ids from links or plain ids', () => {
    const id = 'usr_c1644b5b-3ca4-45b4-97c6-a2a0de70d469';
    assert.equal(vrchatIdFrom(`https://vrchat.com/home/user/${id.toUpperCase()}`), id);
    assert.equal(vrchatIdFrom(id), id);
    assert.equal(vrchatIdFrom('https://vrchat.com/home/user/nope'), '');
});

test('usernames, passwords, counts, times', () => {
    assert.ok(validUsername('fox_123'));
    assert.ok(!validUsername('Fox'));
    assert.ok(!validUsername('ab'));
    assert.equal(passwordStrength('short'), 0);
    assert.equal(passwordStrength('Sup3r-Secret-Paws'), 4);
    assert.equal(compactCount(1234), '1.2K');
    assert.equal(compactCount(2500000), '2.5M');
    assert.equal(timeAgo(Date.now() - 3 * 3600 * 1000), '3h');
});

test('updates: only releases with a checksum are offered', () => {
    const sha = 'a'.repeat(64);
    const release = {
        tag_name: 'v1.0.42',
        body: 'Fixes\n\nsha256 FurZone_Setup.exe: ' + 'b'.repeat(64),
        assets: [
            { name: 'FurZone.apk', browser_download_url: 'https://github.com/x/FurZone.apk', size: 10, digest: 'sha256:' + sha },
            { name: 'FurZone_Setup.exe', browser_download_url: 'https://github.com/x/FurZone_Setup.exe', size: 20 }
        ]
    };
    assert.deepEqual(parseRelease(release, 'android'), {
        versionCode: 42, version: '1.0.42', notes: 'Fixes', url: 'https://github.com/x/FurZone.apk', sha256: sha, size: 10
    });
    assert.equal(parseRelease(release, 'windows').sha256, 'b'.repeat(64));
    assert.equal(parseRelease({ ...release, body: '', assets: [release.assets[1]] }, 'windows'), null);
    assert.equal(parseRelease({ ...release, tag_name: 'latest' }, 'android'), null);
    assert.equal(parseRelease({ ...release, prerelease: true }, 'android'), null);
});

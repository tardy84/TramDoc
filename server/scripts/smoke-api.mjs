#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(serverDir, '..');

const apiBaseUrl = process.env.SMOKE_API_BASE_URL || 'http://localhost:3005';
const username = process.env.SMOKE_ADMIN_USERNAME || process.env.ADMIN_USERNAME;
const password = process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
const fixturePath = process.env.SMOKE_EPUB_PATH
    ? path.resolve(process.cwd(), process.env.SMOKE_EPUB_PATH)
    : path.resolve(repoRoot, 'test/Dia dang tran gian - Thomas More.epub');
const voice = process.env.SMOKE_TTS_VOICE || 'vbee-n_hn_male_ngankechuyen_ytstable_vc';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function getSegmentContentHash(segment, voice) {
    return createHash('sha256')
        .update(JSON.stringify({ content: segment.content, role: segment.role, voice }))
        .digest('hex');
}

async function readBody(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const body = await readBody(response);
    if (!response.ok) {
        throw new Error(`${options.method || 'GET'} ${url} failed: ${response.status} ${JSON.stringify(body)}`);
    }
    return body;
}

if (!username || !password) {
    throw new Error('Missing smoke credentials. Set SMOKE_ADMIN_USERNAME and SMOKE_ADMIN_PASSWORD.');
}

let bookId;
try {
    const login = await requestJson(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    assert(typeof login.token === 'string' && login.token.length > 0, 'Login did not return a token');

    const form = new FormData();
    form.set('jobId', `smoke_${Date.now()}`);
    form.set('book', await openAsBlob(fixturePath, { type: 'application/epub+zip' }), path.basename(fixturePath));

    const upload = await requestJson(`${apiBaseUrl}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${login.token}` },
        body: form,
    });
    bookId = upload.bookId;
    assert(Number.isInteger(bookId), 'Upload did not return a numeric bookId');

    const book = await requestJson(`${apiBaseUrl}/api/books/${bookId}`, {
        headers: { Authorization: `Bearer ${login.token}` },
    });
    const chapter = [...book.chapters]
        .filter(item => Array.isArray(item.segments) && item.segments.length > 0)
        .sort((a, b) => a.segments.length - b.segments.length)[0];
    assert(chapter, 'Uploaded fixture has no chapter with segments');

    chapter.segments.sort((a, b) => a.orderIndex - b.orderIndex);

    const audioDir = path.resolve(serverDir, 'audio');
    await mkdir(audioDir, { recursive: true });
    await Promise.all(chapter.segments.map((segment, index) => {
        const fileName = `${bookId}_${chapter.id}_${voice}_${index}.mp3`;
        const filePath = path.join(audioDir, fileName);
        const metadataPath = `${filePath}.json`;
        return Promise.all([
            writeFile(filePath, Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00])),
            writeFile(metadataPath, JSON.stringify({
                contentHash: getSegmentContentHash(segment, voice),
                orderIndex: segment.orderIndex,
                role: segment.role,
                voice,
                generatedAt: new Date().toISOString(),
            }, null, 2)),
        ]);
    }));

    const tts = await requestJson(`${apiBaseUrl}/api/books/${bookId}/chapters/${chapter.id}/tts`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${login.token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ voice }),
    });
    assert(Array.isArray(tts.audioFiles) && tts.audioFiles.length === chapter.segments.length, 'TTS did not return expected audio files');
    assert(!tts.audioFiles[0].includes(login.token), 'Signed audio URL leaked the login JWT');

    const signedUrl = new URL(tts.audioFiles[0], apiBaseUrl);
    const unsignedUrl = new URL(signedUrl);
    unsignedUrl.searchParams.delete('token');

    const unsignedResponse = await fetch(unsignedUrl);
    assert(unsignedResponse.status === 401, `Unsigned audio request should return 401, got ${unsignedResponse.status}`);

    const signedResponse = await fetch(signedUrl);
    assert(signedResponse.ok, `Signed audio request should succeed, got ${signedResponse.status}`);

    console.log(`Smoke API passed: upload book ${bookId}, signed audio route OK.`);
} finally {
    if (bookId) {
        try {
            const login = await requestJson(`${apiBaseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            await fetch(`${apiBaseUrl}/api/books/${bookId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${login.token}` },
            });
        } catch (error) {
            console.warn(`Smoke cleanup failed for book ${bookId}:`, error.message);
        }
    }
}

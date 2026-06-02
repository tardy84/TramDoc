import { openDB, DBSchema, IDBPDatabase } from 'idb';
import axios from 'axios';
import { DEFAULT_OFFLINE_TTS_QUALITY, OfflineTtsQuality, resolveApiUrl } from '../constants';
import { Book, Chapter } from '../types';
import { generateTTS } from './apiService';

interface OfflineBook extends DBSchema {
    books: {
        key: number;
        value: {
            id: number;
            title: string;
            author?: string;
            coverImageUrl?: string;
            chapters: Chapter[];
            downloadedAt: number;
            cover?: Blob; // Store actual image data
        };
    };
    audio: {
        key: string; // Composite key: bookId_chapterId_voice_quality_segmentId
        value: {
            key: string;
            bookId: number;
            chapterId: number;
            voice: string;
            quality?: OfflineTtsQuality;
            segmentId: number;
            audioBlob: Blob;
        };
    };
    chapterAudioStatus: {
        key: string;
        value: ChapterOfflineStatus;
    };
}

let dbPromise: Promise<IDBPDatabase<OfflineBook>>;

export type ChapterOfflineStatusValue = 'not_downloaded' | 'downloading' | 'partial' | 'downloaded' | 'failed';

export interface ChapterOfflineStatus {
    key: string;
    bookId: number;
    chapterId: number;
    voice: string;
    quality: OfflineTtsQuality;
    totalSegments: number;
    downloadedSegments: number;
    failedSegments: number;
    status: ChapterOfflineStatusValue;
    downloadedAt?: number;
    updatedAt: number;
}

export const initDB = () => {
    if (!dbPromise) {
        dbPromise = openDB<OfflineBook>('audiobook-db', 3, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('books')) {
                    db.createObjectStore('books', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('audio')) {
                    db.createObjectStore('audio', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('chapterAudioStatus')) {
                    db.createObjectStore('chapterAudioStatus', { keyPath: 'key' });
                }
            },
        });
    }
    return dbPromise;
};

const buildLegacyAudioKey = (bookId: number, chapterId: number, voice: string, segmentIndex: number) =>
    `${bookId}_${chapterId}_${voice}_${segmentIndex}`;

const buildAudioKey = (bookId: number, chapterId: number, voice: string, quality: OfflineTtsQuality, segmentIndex: number) =>
    `${bookId}_${chapterId}_${voice}_${quality}_${segmentIndex}`;

const buildChapterStatusKey = (bookId: number, chapterId: number, voice: string, quality: OfflineTtsQuality) =>
    `${bookId}_${chapterId}_${voice}_${quality}`;

const getEmptyChapterStatus = (
    bookId: number,
    chapterId: number,
    voice: string,
    quality: OfflineTtsQuality
): ChapterOfflineStatus => ({
    key: buildChapterStatusKey(bookId, chapterId, voice, quality),
    bookId,
    chapterId,
    voice,
    quality,
    totalSegments: 0,
    downloadedSegments: 0,
    failedSegments: 0,
    status: 'not_downloaded',
    updatedAt: Date.now(),
});

const hasAudioMagicBytes = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const ascii = Array.from(bytes)
        .map(byte => String.fromCharCode(byte))
        .join('');

    return ascii.startsWith('ID3') ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ||
        ascii.startsWith('RIFF') ||
        ascii.includes('ftyp') ||
        ascii.startsWith('OggS');
};

const isLikelyPlayableAudioBlob = async (blob: Blob) => {
    const type = blob.type.toLowerCase();
    if (type.includes('json') || type.includes('text') || type.includes('html')) return false;
    if (blob.size <= 1024) return false;
    return await hasAudioMagicBytes(blob);
};

const normalizeAudioBlob = (blob: Blob) => {
    if (blob.type.toLowerCase().startsWith('audio/')) return blob;
    return new Blob([blob], { type: 'audio/mpeg' });
};

const OFFLINE_DOWNLOAD_RETRY_DELAYS_MS = [1500, 3000, 6000, 10000, 15000, 20000];
const OFFLINE_TTS_REQUEST_RETRY_DELAYS_MS = [3000, 6000, 10000];

const getDownloadErrorMessage = (error: unknown) => {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        if (status) return `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
        return error.message;
    }

    return error instanceof Error ? error.message : String(error);
};

const isRetryableDownloadError = (error: unknown) => {
    if (axios.isAxiosError(error)) {
        if (error.code === 'ERR_CANCELED') return false;
        const status = error.response?.status;
        if (!status) return true;
        return status === 408 ||
            status === 409 ||
            status === 425 ||
            status === 429 ||
            status >= 500;
    }

    return true;
};

const sleepWithAbort = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
        reject(new Error('Offline audio download cancelled'));
        return;
    }

    const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
    }, ms);

    function onAbort() {
        clearTimeout(timeout);
        reject(new Error('Offline audio download cancelled'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
});

const downloadAudioBlobWithRetry = async (fileUrl: string, segmentIndex: number, signal?: AbortSignal) => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= OFFLINE_DOWNLOAD_RETRY_DELAYS_MS.length; attempt++) {
        try {
            const res = await axios.get(resolveApiUrl(fileUrl), { responseType: 'blob', signal });
            if (!await isLikelyPlayableAudioBlob(res.data)) {
                throw new Error(`Invalid audio response (${res.data.type || 'unknown'}, ${res.data.size} bytes)`);
            }
            return normalizeAudioBlob(res.data);
        } catch (error) {
            if (signal?.aborted) throw error;
            lastError = error;

            const shouldRetry = attempt < OFFLINE_DOWNLOAD_RETRY_DELAYS_MS.length &&
                isRetryableDownloadError(error);
            if (!shouldRetry) throw error;

            const delayMs = OFFLINE_DOWNLOAD_RETRY_DELAYS_MS[attempt];
            console.warn(
                `[Offline] Segment ${segmentIndex} audio chưa sẵn sàng (${getDownloadErrorMessage(error)}). ` +
                `Thử lại sau ${Math.round(delayMs / 1000)}s.`
            );
            await sleepWithAbort(delayMs, signal);
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Audio download failed');
};

const generateChapterAudioFilesWithRetry = async (
    bookId: number,
    chapterId: number,
    voice: string,
    quality: OfflineTtsQuality,
    signal?: AbortSignal
) => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= OFFLINE_TTS_REQUEST_RETRY_DELAYS_MS.length; attempt++) {
        try {
            return await generateTTS(bookId, chapterId, voice, 0, quality, signal);
        } catch (error) {
            if (signal?.aborted) throw error;
            lastError = error;

            // Vbee can bill on submit, so do not auto-resubmit a failed chapter
            // bootstrap request. Segment downloads still retry signed /audio URLs.
            const shouldRetry = !voice.startsWith('vbee-') &&
                attempt < OFFLINE_TTS_REQUEST_RETRY_DELAYS_MS.length &&
                isRetryableDownloadError(error);
            if (!shouldRetry) throw error;

            const delayMs = OFFLINE_TTS_REQUEST_RETRY_DELAYS_MS[attempt];
            console.warn(
                `[Offline] TTS bootstrap chưa sẵn sàng (${getDownloadErrorMessage(error)}). ` +
                `Thử lại sau ${Math.round(delayMs / 1000)}s.`
            );
            await sleepWithAbort(delayMs, signal);
        }
    }

    throw lastError instanceof Error ? lastError : new Error('TTS bootstrap failed');
};

const getChapterAudioRecords = async (
    db: IDBPDatabase<OfflineBook>,
    bookId: number,
    chapterId: number,
    voice: string,
    quality: OfflineTtsQuality
) => {
    const audio = await db.getAll('audio');
    return audio.filter(item => {
        const itemQuality = item.quality ?? DEFAULT_OFFLINE_TTS_QUALITY;
        return item.bookId === bookId &&
            item.chapterId === chapterId &&
            item.voice === voice &&
            itemQuality === quality;
    });
};

const reconcileChapterOfflineStatus = async (
    db: IDBPDatabase<OfflineBook>,
    status: ChapterOfflineStatus
): Promise<ChapterOfflineStatus> => {
    const records = await getChapterAudioRecords(db, status.bookId, status.chapterId, status.voice, status.quality);
    let validRecords = 0;
    let usageBytes = 0;

    for (const record of records) {
        if (await isLikelyPlayableAudioBlob(record.audioBlob)) {
            validRecords++;
            usageBytes += record.audioBlob.size;
        } else {
            await db.delete('audio', record.key);
        }
    }

    const totalSegments = status.totalSegments || validRecords;
    const nextStatus: ChapterOfflineStatusValue = validRecords === 0
        ? 'not_downloaded'
        : totalSegments > 0 && validRecords >= totalSegments
            ? 'downloaded'
            : 'partial';

    if (
        status.status !== nextStatus ||
        status.downloadedSegments !== validRecords ||
        status.totalSegments !== totalSegments
    ) {
        const next = {
            ...status,
            totalSegments,
            downloadedSegments: validRecords,
            failedSegments: nextStatus === 'partial' ? Math.max(0, totalSegments - validRecords) : 0,
            status: nextStatus,
            downloadedAt: nextStatus === 'downloaded' ? (status.downloadedAt || Date.now()) : undefined,
            updatedAt: Date.now(),
        };
        await db.put('chapterAudioStatus', next);
        return next;
    }

    if (usageBytes === 0 && status.status !== 'not_downloaded') {
        const next = {
            ...status,
            downloadedSegments: 0,
            failedSegments: 0,
            status: 'not_downloaded' as ChapterOfflineStatusValue,
            downloadedAt: undefined,
            updatedAt: Date.now(),
        };
        await db.put('chapterAudioStatus', next);
        return next;
    }

    return status;
};

export const saveBookOffline = async (book: Book) => {
    const db = await initDB();

    // Download cover image if exists
    let coverBlob: Blob | undefined;
    if (book.coverImageUrl) {
        try {
            const res = await axios.get(resolveApiUrl(book.coverImageUrl), { responseType: 'blob' });
            coverBlob = res.data;
        } catch (e) {
            console.error('Failed to download cover', e);
        }
    }

    await db.put('books', {
        ...book,
        downloadedAt: Date.now(),
        cover: coverBlob
    });
    console.log(`[Offline] Book ${book.title} saved metadata.`);
};

export const saveChapterAudio = async (
    bookId: number,
    chapterId: number,
    voice: string,
    quality: OfflineTtsQuality,
    audioFiles: string[],
    onProgress?: (completed: number, total: number) => void,
    signal?: AbortSignal
) => {
    const db = await initDB();
    const total = audioFiles.filter(Boolean).length;
    let completed = 0;
    let failed = 0;
    let nextIndex = 0;
    const concurrency = voice.startsWith('vbee-') ? 4 : 1;

    await setChapterOfflineStatus({
        key: buildChapterStatusKey(bookId, chapterId, voice, quality),
        bookId,
        chapterId,
        voice,
        quality,
        totalSegments: total,
        downloadedSegments: 0,
        failedSegments: 0,
        status: 'downloading',
        updatedAt: Date.now(),
    });

    const updateProgress = async () => {
        onProgress?.(completed, total);
        await setChapterOfflineStatus({
            key: buildChapterStatusKey(bookId, chapterId, voice, quality),
            bookId,
            chapterId,
            voice,
            quality,
            totalSegments: total,
            downloadedSegments: completed,
            failedSegments: failed,
            status: completed === total ? 'downloaded' : failed > 0 ? 'partial' : 'downloading',
            downloadedAt: completed === total ? Date.now() : undefined,
            updatedAt: Date.now(),
        });
    };

    const downloadNext = async () => {
        const i = nextIndex++;
        if (i >= audioFiles.length) return false;
        if (signal?.aborted) throw new Error('Offline audio download cancelled');
        const fileUrl = audioFiles[i];
        if (!fileUrl) return true;
        const key = buildAudioKey(bookId, chapterId, voice, quality, i);

        try {
            const existingRecord = await db.get('audio', key);
            const legacyRecord = quality === DEFAULT_OFFLINE_TTS_QUALITY
                ? await db.get('audio', buildLegacyAudioKey(bookId, chapterId, voice, i))
                : undefined;
            const existingRecordValid = existingRecord ? await isLikelyPlayableAudioBlob(existingRecord.audioBlob) : false;
            const legacyRecordValid = legacyRecord ? await isLikelyPlayableAudioBlob(legacyRecord.audioBlob) : false;
            if (existingRecord && !existingRecordValid) {
                await db.delete('audio', key);
            }
            if (legacyRecord && !legacyRecordValid) {
                await db.delete('audio', legacyRecord.key);
            }
            if (existingRecordValid || legacyRecordValid) {
                completed++;
                await updateProgress();
                return true;
            }

            const audioBlob = await downloadAudioBlobWithRetry(fileUrl, i, signal);
            await db.put('audio', {
                key, // Matches keyPath
                bookId,
                chapterId,
                voice,
                quality,
                segmentId: i,
                audioBlob
            });
            completed++;
        } catch (e) {
            if (signal?.aborted) throw e;
            failed++;
            console.error(`Failed to download audio segment ${i}`, e);
        }
        await updateProgress();
        return true;
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, audioFiles.length) }, async () => {
        while (await downloadNext()) {
            // Keep pulling work until the chapter queue is exhausted.
        }
    }));

    const status: ChapterOfflineStatusValue = completed === total
        ? 'downloaded'
        : completed > 0
            ? 'partial'
            : 'failed';
    await setChapterOfflineStatus({
        key: buildChapterStatusKey(bookId, chapterId, voice, quality),
        bookId,
        chapterId,
        voice,
        quality,
        totalSegments: total,
        downloadedSegments: completed,
        failedSegments: failed,
        status,
        downloadedAt: status === 'downloaded' ? Date.now() : undefined,
        updatedAt: Date.now(),
    });

    console.log(`[Offline] Chapter ${chapterId} audio saved.`);
    return { completed, total, failed };
};

export const downloadChapterAudioOffline = async (
    bookId: number,
    chapterId: number,
    voice: string,
    quality: OfflineTtsQuality = DEFAULT_OFFLINE_TTS_QUALITY,
    onProgress?: (completed: number, total: number) => void,
    signal?: AbortSignal
) => {
    const { audioFiles } = await generateChapterAudioFilesWithRetry(bookId, chapterId, voice, quality, signal);
    return saveChapterAudio(bookId, chapterId, voice, quality, audioFiles, onProgress, signal);
};

export const getOfflineBook = async (bookId: number) => {
    const db = await initDB();
    return await db.get('books', bookId);
};

export const getOfflineAudio = async (
    bookId: number,
    chapterId: number,
    voice: string,
    segmentIndex: number,
    quality: OfflineTtsQuality = DEFAULT_OFFLINE_TTS_QUALITY
) => {
    const db = await initDB();
    const key = buildAudioKey(bookId, chapterId, voice, quality, segmentIndex);
    const record = await db.get('audio', key);
    if (record && !await isLikelyPlayableAudioBlob(record.audioBlob)) {
        await db.delete('audio', key);
        return undefined;
    }
    if (!record && quality === DEFAULT_OFFLINE_TTS_QUALITY) {
        const legacyKey = buildLegacyAudioKey(bookId, chapterId, voice, segmentIndex);
        const legacyRecord = await db.get('audio', legacyKey);
        if (legacyRecord && !await isLikelyPlayableAudioBlob(legacyRecord.audioBlob)) {
            await db.delete('audio', legacyKey);
            return undefined;
        }
        return legacyRecord ? normalizeAudioBlob(legacyRecord.audioBlob) : undefined;
    }
    return record ? normalizeAudioBlob(record.audioBlob) : undefined;
};

export const deleteOfflineAudioSegment = async (
    bookId: number,
    chapterId: number,
    voice: string,
    segmentIndex: number,
    quality: OfflineTtsQuality = DEFAULT_OFFLINE_TTS_QUALITY
) => {
    const db = await initDB();
    await db.delete('audio', buildAudioKey(bookId, chapterId, voice, quality, segmentIndex));
    if (quality === DEFAULT_OFFLINE_TTS_QUALITY) {
        await db.delete('audio', buildLegacyAudioKey(bookId, chapterId, voice, segmentIndex));
    }

    const status = await db.get('chapterAudioStatus', buildChapterStatusKey(bookId, chapterId, voice, quality));
    if (status) {
        await reconcileChapterOfflineStatus(db, status);
    }
};

export const getAnyOfflineAudio = async (
    bookId: number,
    chapterId: number,
    segmentIndex: number,
    excludedKeys: string[] = []
) => {
    const db = await initDB();
    const audio = await db.getAll('audio');
    let record: OfflineBook['audio']['value'] | undefined;
    for (const item of audio) {
        if (
            item.bookId === bookId &&
            item.chapterId === chapterId &&
            item.segmentId === segmentIndex &&
            !excludedKeys.includes(item.key) &&
            await isLikelyPlayableAudioBlob(item.audioBlob)
        ) {
            record = item;
            break;
        }
    }

    if (!record) return null;
    return {
        audioBlob: normalizeAudioBlob(record.audioBlob),
        key: record.key,
        voice: record.voice,
        quality: record.quality ?? DEFAULT_OFFLINE_TTS_QUALITY,
    };
};

export const getAllOfflineBooks = async () => {
    const db = await initDB();
    return await db.getAll('books');
};

export const isBookOffline = async (bookId: number) => {
    const db = await initDB();
    const book = await db.get('books', bookId);
    return !!book;
}

export const deleteOfflineBook = async (bookId: number) => {
    const db = await initDB();
    await db.delete('books', bookId);

    // Delete all audio segments for this book
    const tx = db.transaction('audio', 'readwrite');
    const store = tx.objectStore('audio');
    let cursor = await store.openCursor();
    while (cursor) {
        if (cursor.value.bookId === bookId) {
            await cursor.delete();
        }
        cursor = await cursor.continue();
    }
    await tx.done;
    const statusTx = db.transaction('chapterAudioStatus', 'readwrite');
    const statusStore = statusTx.objectStore('chapterAudioStatus');
    let statusCursor = await statusStore.openCursor();
    while (statusCursor) {
        if (statusCursor.value.bookId === bookId) {
            await statusCursor.delete();
        }
        statusCursor = await statusCursor.continue();
    }
    await statusTx.done;
    console.log(`[Offline] Book ${bookId} and its audio deleted.`);
};

export const deleteOfflineVoice = async (
    bookId: number,
    voice: string,
    quality?: OfflineTtsQuality
) => {
    const db = await initDB();
    const tx = db.transaction('audio', 'readwrite');
    const store = tx.objectStore('audio');
    let cursor = await store.openCursor();
    while (cursor) {
        const recordQuality = cursor.value.quality ?? DEFAULT_OFFLINE_TTS_QUALITY;
        if (
            cursor.value.bookId === bookId &&
            cursor.value.voice === voice &&
            (!quality || recordQuality === quality)
        ) {
            await cursor.delete();
        }
        cursor = await cursor.continue();
    }
    await tx.done;

    const statusTx = db.transaction('chapterAudioStatus', 'readwrite');
    const statusStore = statusTx.objectStore('chapterAudioStatus');
    let statusCursor = await statusStore.openCursor();
    while (statusCursor) {
        if (
            statusCursor.value.bookId === bookId &&
            statusCursor.value.voice === voice &&
            (!quality || statusCursor.value.quality === quality)
        ) {
            await statusCursor.delete();
        }
        statusCursor = await statusCursor.continue();
    }
    await statusTx.done;
};

export const getChapterOfflineStatus = async (
    bookId: number,
    chapterId: number,
    voice: string,
    quality: OfflineTtsQuality = DEFAULT_OFFLINE_TTS_QUALITY
) => {
    const db = await initDB();
    const status = await db.get('chapterAudioStatus', buildChapterStatusKey(bookId, chapterId, voice, quality));
    return status
        ? await reconcileChapterOfflineStatus(db, status)
        : getEmptyChapterStatus(bookId, chapterId, voice, quality);
};

export const setChapterOfflineStatus = async (status: ChapterOfflineStatus) => {
    const db = await initDB();
    await db.put('chapterAudioStatus', { ...status, updatedAt: status.updatedAt || Date.now() });
};

export const listBookChapterOfflineStatuses = async (
    bookId: number,
    voice: string,
    quality: OfflineTtsQuality = DEFAULT_OFFLINE_TTS_QUALITY
) => {
    const db = await initDB();
    const statuses = await db.getAll('chapterAudioStatus');
    const matchingStatuses = statuses.filter(status =>
        status.bookId === bookId &&
        status.voice === voice &&
        status.quality === quality
    );
    return await Promise.all(matchingStatuses.map(status => reconcileChapterOfflineStatus(db, status)));
};

export const deleteOfflineChapterAudio = async (
    bookId: number,
    chapterId: number,
    voice: string,
    quality: OfflineTtsQuality = DEFAULT_OFFLINE_TTS_QUALITY
) => {
    const db = await initDB();
    const tx = db.transaction('audio', 'readwrite');
    const store = tx.objectStore('audio');
    let cursor = await store.openCursor();
    while (cursor) {
        const recordQuality = cursor.value.quality ?? DEFAULT_OFFLINE_TTS_QUALITY;
        if (
            cursor.value.bookId === bookId &&
            cursor.value.chapterId === chapterId &&
            cursor.value.voice === voice &&
            recordQuality === quality
        ) {
            await cursor.delete();
        }
        cursor = await cursor.continue();
    }
    await tx.done;
    await db.delete('chapterAudioStatus', buildChapterStatusKey(bookId, chapterId, voice, quality));
};

export const getOfflineChapterStorageUsage = async (
    bookId: number,
    chapterId: number,
    voice: string,
    quality: OfflineTtsQuality = DEFAULT_OFFLINE_TTS_QUALITY
) => {
    const db = await initDB();
    const records = await getChapterAudioRecords(db, bookId, chapterId, voice, quality);
    return records.reduce((total, item) => total + item.audioBlob.size, 0);
};

export const getOfflineVoiceStorageUsage = async (
    bookId: number,
    voice: string,
    quality?: OfflineTtsQuality
) => {
    const db = await initDB();
    const audio = await db.getAll('audio');
    return audio.reduce((total, item) => {
        const itemQuality = item.quality ?? DEFAULT_OFFLINE_TTS_QUALITY;
        if (item.bookId !== bookId || item.voice !== voice) return total;
        if (quality && itemQuality !== quality) return total;
        return total + item.audioBlob.size;
    }, 0);
};

export const getOfflineStorageUsage = async () => {
    const db = await initDB();
    let totalSize = 0;

    // Estimate size from audio blobs
    const audio = await db.getAll('audio');
    audio.forEach(a => {
        totalSize += a.audioBlob.size;
    });

    // Estimate size from covers
    const books = await db.getAll('books');
    books.forEach(b => {
        if (b.cover) totalSize += b.cover.size;
    });

    return totalSize;
};

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import axios from 'axios';
import { API_BASE_URL } from '../constants';

interface OfflineBook extends DBSchema {
    books: {
        key: number;
        value: {
            id: number;
            title: string;
            author?: string;
            coverImageUrl?: string;
            chapters: any[];
            downloadedAt: number;
            cover?: Blob; // Store actual image data
        };
    };
    audio: {
        key: string; // Composite key: bookId_chapterId_segmentId
        value: {
            key: string;
            bookId: number;
            chapterId: number;
            segmentId: number;
            audioBlob: Blob;
        };
    };
}

let dbPromise: Promise<IDBPDatabase<OfflineBook>>;

export const initDB = () => {
    if (!dbPromise) {
        dbPromise = openDB<OfflineBook>('audiobook-db', 1, {
            upgrade(db) {
                db.createObjectStore('books', { keyPath: 'id' });
                db.createObjectStore('audio', { keyPath: 'key' });
            },
        });
    }
    return dbPromise;
};

export const saveBookOffline = async (book: any) => {
    const db = await initDB();

    // Download cover image if exists
    let coverBlob: Blob | undefined;
    if (book.coverImageUrl) {
        try {
            const res = await axios.get(`${API_BASE_URL}${book.coverImageUrl}`, { responseType: 'blob' });
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

export const saveChapterAudio = async (bookId: number, chapterId: number, audioFiles: string[]) => {
    const db = await initDB();

    for (let i = 0; i < audioFiles.length; i++) {
        const fileUrl = audioFiles[i];
        try {
            const res = await axios.get(`${API_BASE_URL}${fileUrl}`, { responseType: 'blob' });
            const key = `${bookId}_${chapterId}_${i}`;
            await db.put('audio', {
                key, // Matches keyPath
                bookId,
                chapterId,
                segmentId: i,
                audioBlob: res.data
            });
        } catch (e) {
            console.error(`Failed to download audio segment ${i}`, e);
        }
    }
    console.log(`[Offline] Chapter ${chapterId} audio saved.`);
};

export const getOfflineBook = async (bookId: number) => {
    const db = await initDB();
    return await db.get('books', bookId);
};

export const getOfflineAudio = async (bookId: number, chapterId: number, segmentIndex: number) => {
    const db = await initDB();
    const key = `${bookId}_${chapterId}_${segmentIndex}`;
    const record = await db.get('audio', key);
    return record?.audioBlob;
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
    console.log(`[Offline] Book ${bookId} and its audio deleted.`);
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

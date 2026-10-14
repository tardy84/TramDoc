import axios from 'axios';
import { API_BASE_URL, OfflineTtsQuality } from '../constants';
import { Book, Bookmark } from '../types';

// Centralised API base. Browser dev falls back to the Vite proxy at the current origin;
// Capacitor/iOS release builds must set VITE_API_URL to the public HTTPS API origin.
const api = axios.create({
    baseURL: `${API_BASE_URL}/api`
});

// Request Interceptor: Attach JWT Token if available
api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    response => response,
    error => {
        if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403) && localStorage.getItem('token')) {
            localStorage.removeItem('token');
            localStorage.removeItem('audiobook_token');
            localStorage.removeItem('user');
            window.dispatchEvent(new Event('tramdoc-auth-expired'));
        }

        return Promise.reject(error);
    }
);

// --- Book Management APIs ---

export const uploadBook = async (file: File, jobId?: string): Promise<{ message: string, bookId: number }> => {
    const formData = new FormData();
    formData.append('book', file);
    if (jobId) {
        formData.append('jobId', jobId);
    }
    const response = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

export const getUploadStatus = async (jobId: string): Promise<{ progress: number, status: string, error?: string }> => {
    const response = await api.get(`/upload-status/${jobId}`);
    return response.data;
};

export const getAllBooks = async (): Promise<Book[]> => {
    const response = await api.get('/books');
    return response.data;
};

export const getBook = async (id: number): Promise<Book> => {
    const response = await api.get(`/books/${id}`);
    return response.data;
};

export const deleteBook = async (id: number): Promise<void> => {
    await api.delete(`/books/${id}`);
};

export interface ReanalyzeTtsHintsResult {
    bookId: number;
    totalSegments: number;
    updatedSegments: number;
    skippedSegments: number;
    toneCounts: Record<string, number>;
}

export const reanalyzeBookTtsHints = async (id: number, force = false): Promise<ReanalyzeTtsHintsResult> => {
    const response = await api.post(`/books/${id}/reanalyze-tts-hints${force ? '?force=1' : ''}`);
    return response.data;
};

// --- Progress Sync APIs ---

export const saveProgress = async (bookId: number, chapterIndex: number, segmentIndex: number): Promise<void> => {
    await api.post(`/progress/${bookId}`, { chapterIndex, segmentIndex });
};

export const getProgress = async (bookId: number): Promise<{ chapterIndex: number; segmentIndex: number }> => {
    const response = await api.get(`/progress/${bookId}`);
    return response.data;
};

// --- Bookmark APIs ---

export const getBookmarks = async (bookId: number): Promise<Bookmark[]> => {
    const response = await api.get(`/books/${bookId}/bookmarks`);
    return response.data;
};

export const createBookmark = async (data: { bookId: number, chapterId: number, segmentId: number, previewText: string, note?: string }): Promise<Bookmark> => {
    const response = await api.post('/bookmarks', data);
    return response.data;
};

export const deleteBookmark = async (id: number): Promise<void> => {
    await api.delete(`/bookmarks/${id}`);
};

// --- TTS Trigger API ---
// Note: Actual streaming is handled by signed /audio/:filename URLs in HTMLAudioElement.
// This is to trigger the generation endpoint or cache verification.
export const generateTTS = async (
    bookId: number,
    chapterId: number,
    voice: string,
    startSegmentIndex?: number,
    quality?: OfflineTtsQuality,
    signal?: AbortSignal
): Promise<{ audioFiles: string[] }> => {
    const response = await api.post(
        `/books/${bookId}/chapters/${chapterId}/tts`,
        { voice, startSegmentIndex, quality },
        { signal, timeout: 60000 }
    );
    return response.data;
};


export type TtsBookJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TtsBookJobProgress {
    jobId: string;
    userId: number;
    bookId: number;
    voice: string;
    mode: 'missing' | 'force';
    quality?: OfflineTtsQuality;
    status: TtsBookJobStatus;
    totalSegments: number;
    cachedSegments: number;
    generatedSegments: number;
    failedSegments: number;
    skippedSegments: number;
    currentChapterId?: number;
    currentChapterTitle?: string;
    currentSegmentIndex?: number;
    error?: string;
    createdAt: string;
    updatedAt: string;
    cancelledAt?: string;
    completedAt?: string;
}

export interface TtsBookCacheChapterStatus {
    chapterId: number;
    title: string;
    total: number;
    cached: number;
    stale: number;
    missing: number;
    skipped: number;
    characters?: number;
    missingCharacters?: number;
    /** Cached audio generated with older prosody hints (tone/pace/pitch). */
    hintsStale?: number;
    hintsStaleIndexes?: number[];
}

/** What a full-book generation would cost, in the units we can actually measure. */
export interface TtsCostEstimate {
    /** Speakable characters still needing audio. */
    characters: number;
    estimatedSeconds: number | null;
    /** Null when the provider has no published per-character rate. */
    ratePerMillionChars: number | null;
    /** Null when the provider has no published per-character rate. */
    estimatedCostUsd: number | null;
    /** True when the audio length came from this voice's already-measured audio. */
    secondsFromMeasuredAudio: boolean;
    rateSource: string | null;
}

export interface TtsBookCacheStatus {
    total: number;
    cached: number;
    stale: number;
    missing: number;
    skipped: number;
    characters?: number;
    missingCharacters?: number;
    /** Cached segments whose audio was generated with older prosody hints. */
    hintsStale?: number;
    estimate?: TtsCostEstimate;
    chapters: TtsBookCacheChapterStatus[];
}

/** Per-chapter cache health for the current voice (drives the stale-hints notice). */
export interface TtsChapterCacheStatus {
    total: number;
    cached: number;
    stale: number;
    missing: number;
    hintsStale: number;
    hintsStaleIndexes: number[];
    missingIndexes: number[];
    characters: number;
}

export interface TtsSegmentMarks {
    version: 1;
    source: 'provider-timepoints' | 'provider-subtitle' | 'estimated';
    durationMs: number;
    sentences: Array<{ text: string; charStart: number; charEnd: number; startMs: number; endMs: number }>;
    /** Real word timings when the provider returned them (google/minimax only). */
    words?: Array<{ text: string; charStart: number; charEnd: number; startMs: number; endMs: number }>;
}

export interface TtsChapterMarksEntry {
    orderIndex: number;
    segmentId: number;
    provider: string;
    timingCapable: boolean;
    status: 'ready' | 'missing' | 'unknown';
    source: string | null;
    durationMs: number | null;
    /** Audio file backing these marks (also the offline cache key). */
    audioFile?: string;
    marks: TtsSegmentMarks | null;
}

/** Sentence timing marks for one chapter + voice (reader highlighting). */
export const getChapterTtsMarks = async (
    bookId: number,
    chapterId: number,
    voice: string,
    options: { quality?: OfflineTtsQuality; expressive?: boolean } = {}
): Promise<TtsChapterMarksEntry[]> => {
    const response = await api.get(`/books/${bookId}/chapters/${chapterId}/tts/marks`, {
        params: { voice, quality: options.quality, expressive: options.expressive ? 1 : undefined },
    });
    return response.data?.segments ?? [];
};

/**
 * Ask the server to pre-generate upcoming segments so playback does not stall.
 * Bounded server-side (2 segments for Vbee/MiniMax/Grok, 6 otherwise) and cache-aware,
 * so calling this is safe to repeat. Fire-and-forget: never blocks playback.
 */
export const warmChapterTts = async (
    bookId: number,
    chapterId: number,
    voice: string,
    options: {
        fromSegmentIndex?: number;
        segmentIndexes?: number[];
        quality?: OfflineTtsQuality;
        expressive?: boolean;
    } = {}
): Promise<{ cached: number[]; queued: number[] }> => {
    const response = await api.post(
        `/books/${bookId}/chapters/${chapterId}/tts/warm`,
        {
            voice,
            fromSegmentIndex: options.fromSegmentIndex,
            segmentIndexes: options.segmentIndexes,
            quality: options.quality,
            expressive: options.expressive,
        },
        { timeout: 15000 }
    );
    return { cached: response.data?.cached ?? [], queued: response.data?.queued ?? [] };
};

/** Cache health of one chapter for a voice, including which segments need regenerating. */
export const getChapterTtsStatus = async (
    bookId: number,
    chapterId: number,
    voice: string,
    options: { expressive?: boolean } = {}
): Promise<TtsChapterCacheStatus> => {
    const response = await api.get(`/books/${bookId}/chapters/${chapterId}/tts/status`, {
        params: { voice, expressive: options.expressive ? 1 : undefined },
    });
    return response.data;
};

/** Regenerate one segment's audio (used when its cached audio predates new prosody hints). */
export const regenerateSegmentTts = async (
    bookId: number,
    chapterId: number,
    voice: string,
    segmentIndex: number,
    options: { expressive?: boolean } = {}
): Promise<{ generated: boolean }> => {
    const response = await api.post(
        `/books/${bookId}/chapters/${chapterId}/tts/regenerate`,
        { voice, segmentIndex, expressive: options.expressive },
        { timeout: 120000 }
    );
    return { generated: Boolean(response.data?.generated) };
};

export const startBookTtsJob = async (
    bookId: number,
    voice: string,
    mode: 'missing' | 'force' = 'missing',
    confirmExpensiveProvider = false,
    quality?: OfflineTtsQuality
): Promise<TtsBookJobProgress> => {
    const response = await api.post(`/books/${bookId}/tts/jobs`, { voice, mode, confirmExpensiveProvider, quality });
    return response.data;
};

export const getBookTtsJob = async (bookId: number, jobId: string): Promise<TtsBookJobProgress> => {
    const response = await api.get(`/books/${bookId}/tts/jobs/${jobId}`);
    return response.data;
};

export const cancelBookTtsJob = async (bookId: number, jobId: string): Promise<TtsBookJobProgress> => {
    const response = await api.post(`/books/${bookId}/tts/jobs/${jobId}/cancel`);
    return response.data;
};

export const getBookTtsStatus = async (bookId: number, voice: string, quality?: OfflineTtsQuality): Promise<TtsBookCacheStatus> => {
    const response = await api.get(`/books/${bookId}/tts/status`, { params: { voice, quality } });
    return response.data;
};

export default {
    uploadBook,
    getUploadStatus,
    getAllBooks,
    getBook,
    deleteBook,
    reanalyzeBookTtsHints,
    saveProgress,
    getProgress,
    getBookmarks,
    createBookmark,
    deleteBookmark,
    generateTTS,
    startBookTtsJob,
    getBookTtsJob,
    cancelBookTtsJob,
    getBookTtsStatus,
    getChapterTtsMarks,
    getChapterTtsStatus,
    warmChapterTts,
    regenerateSegmentTts
};

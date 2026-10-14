import axios from 'axios';
import { API_BASE_URL, OfflineTtsQuality } from '../constants';
import { Book, Bookmark } from '../types';

const BYPASS_AUTH = import.meta.env.VITE_BYPASS_AUTH === '1';
const LOCAL_AUTH_TOKEN = 'local-auth-bypass';

// Centralised API base. Browser dev falls back to the Vite proxy at the current origin;
// Capacitor/iOS release builds must set VITE_API_URL to the public HTTPS API origin.
const api = axios.create({
    baseURL: `${API_BASE_URL}/api`
});

// Request Interceptor: Attach JWT Token if available
api.interceptors.request.use(config => {
    const token = BYPASS_AUTH ? LOCAL_AUTH_TOKEN : localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    response => response,
    error => {
        if (!BYPASS_AUTH && axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403) && localStorage.getItem('token')) {
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
    signal?: AbortSignal,
    expressive = false
): Promise<{ audioFiles: string[] }> => {
    const response = await api.post(
        `/books/${bookId}/chapters/${chapterId}/tts`,
        { voice, startSegmentIndex, quality, expressive },
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
    expressive?: boolean;
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
}

export interface TtsBookCacheStatus {
    total: number;
    cached: number;
    stale: number;
    missing: number;
    skipped: number;
    chapters: TtsBookCacheChapterStatus[];
}

export interface TtsSegmentMarks {
    version: 1;
    source: 'provider-timepoints' | 'provider-subtitle' | 'estimated';
    durationMs: number;
    sentences: Array<{ text: string; charStart: number; charEnd: number; startMs: number; endMs: number }>;
}

export interface TtsChapterMarksEntry {
    orderIndex: number;
    segmentId: number;
    provider: string;
    timingCapable: boolean;
    status: 'ready' | 'missing' | 'unknown';
    source: string | null;
    durationMs: number | null;
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

export const startBookTtsJob = async (
    bookId: number,
    voice: string,
    mode: 'missing' | 'force' = 'missing',
    confirmExpensiveProvider = false,
    quality?: OfflineTtsQuality,
    expressive = false
): Promise<TtsBookJobProgress> => {
    const response = await api.post(`/books/${bookId}/tts/jobs`, { voice, mode, confirmExpensiveProvider, quality, expressive });
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
    getChapterTtsMarks
};

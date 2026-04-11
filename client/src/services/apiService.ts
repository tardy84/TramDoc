import axios from 'axios';
import { Book, Bookmark } from '../types';

// Centralised API Base configuration (Relying on Vite Proxy configured at /api)
const api = axios.create({
    baseURL: '/api'
});

// Request Interceptor: Attach JWT Token if available
api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

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
// Note: Actual streaming is handled by direct /audio/:filename src paths in HTMLAudioElement.
// This is to trigger the generation endpoint or cache verification.
export const generateTTS = async (bookId: number, chapterId: number, voice: string): Promise<{ audioFiles: string[] }> => {
    const response = await api.post(`/books/${bookId}/chapters/${chapterId}/tts`, { voice });
    return response.data;
};

export default {
    uploadBook,
    getUploadStatus,
    getAllBooks,
    getBook,
    deleteBook,
    saveProgress,
    getProgress,
    getBookmarks,
    createBookmark,
    deleteBookmark,
    generateTTS
};

import axios from 'axios';
import { API_BASE_URL } from '../constants';

interface ApiErrorPayload {
    error?: string;
    message?: string;
}

export function getErrorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError<ApiErrorPayload>(error)) {
        if (!error.response) {
            return `Không kết nối được server (${API_BASE_URL}). Kiểm tra mạng và API backend.`;
        }

        return error.response?.data?.error || error.response?.data?.message || error.message || fallback;
    }

    if (error instanceof Error) {
        return error.message;
    }

    return fallback;
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

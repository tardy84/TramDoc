export type ThemeMode = 'midnight' | 'sepia' | 'emerald' | 'oled' | 'dark';

export interface User {
    id: number;
    email: string;
    name: string;
    avatarUrl?: string;
    role: string;
}

export interface Segment {
    id: number;
    content: string;
    role: string;
    orderIndex: number;
}

export interface Chapter {
    id: number;
    title: string;
    orderIndex: number;
    segments: Segment[];
    isTableOfContents?: boolean;
    audioFiles?: string[];
}

export interface Book {
    id: number;
    title: string;
    author: string;
    coverImageUrl?: string; // Changed from Blob to string URI mapping directly to /covers/
    progress?: number;
    lastRead?: number;
    chapters: Chapter[];
    currentText?: string;
}

export interface Bookmark {
    id: number;
    bookId: number;
    chapterId: number;
    segmentId: number;
    previewText: string;
    note?: string; // Optional user note
    createdAt: string; // ISO date string from Server
    // Joined relational data
    chapter?: {
        title: string;
        orderIndex: number;
    };
}

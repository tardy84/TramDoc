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
    coverImageUrl?: string;
    cover?: Blob; // Offline cover blob
    createdAt: string;
    chapters: Chapter[];
    progress?: number;
    currentText?: string;
    lastRead?: number;
}

export interface Bookmark {
    id: number;
    bookId: number;
    chapterId: number;
    segmentId: number;
    previewText: string;
    note?: string;
    createdAt: string;
    chapter: {
        title: string;
        orderIndex: number;
    };
}

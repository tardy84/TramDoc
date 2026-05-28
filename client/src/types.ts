export type ThemeMode = 'midnight' | 'sepia' | 'emerald' | 'oled' | 'dark';

export interface User {
    id: number;
    email: string;
    username?: string;
    name?: string;
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

export interface ThemeStyles {
    container: string;
    text: string;
    card: string;
    active: string;
    header: string;
    btn: string;
    backBtn: string;
    paper: string;
}

export interface AdminBook extends Book {
    user?: {
        name?: string | null;
        email?: string | null;
    };
    _count?: {
        chapters?: number;
    };
}

export interface AdminUser extends User {
    books: AdminBook[];
    _count: {
        books: number;
    };
    createdAt: string;
}

export interface RecentUser extends User {
    createdAt: string;
}

export interface AdminStats {
    userCount: number;
    bookCount: number;
    chapterCount: number;
    segmentCount: number;
    recentUsers: RecentUser[];
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

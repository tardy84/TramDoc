import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import multer from 'multer';
import fs from 'fs/promises';
import { authenticateJWT, AuthRequest } from '../middleware/auth.js';
import { EpubProcessor } from '../services/epubProcessor.js';

const router = Router();
const prisma = new PrismaClient();
const epubProcessor = new EpubProcessor();

// Upload configuration
const upload = multer({ dest: 'uploads/' });

// Simple in-memory store for upload progress
interface UploadJob {
    progress: number;
    status: string;
    error?: string;
}
export const uploadJobs: Record<string, UploadJob> = {};

// EPUB upload and processing
router.post('/upload', authenticateJWT, upload.single('book'), async (req: AuthRequest, res: Response) => {
    const jobId = req.body.jobId as string;
    const userId = req.user.id;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        if (jobId) {
            uploadJobs[jobId] = { progress: 0, status: 'Starting processing...' };
        }

        // Process the EPUB file with progress reporting
        const bookId = await epubProcessor.processEpub(req.file.path, (progress: number, status: string) => {
            if (jobId) {
                uploadJobs[jobId] = { progress, status };
            }
        });

        // Link book to user
        await prisma.book.update({
            where: { id: bookId },
            data: { userId }
        });

        if (jobId) {
            uploadJobs[jobId] = { progress: 100, status: 'Complete' };
        }

        res.json({ message: 'EPUB processed successfully', bookId });
    } catch (error: any) {
        console.error('Error processing EPUB:', error);
        if (jobId) {
            uploadJobs[jobId] = { progress: 0, status: 'Error', error: error.message };
        }
        res.status(500).json({ error: error.message });
    }
});

// Get upload status
router.get('/upload-status/:jobId', (req: Request, res: Response) => {
    const jobId = req.params.jobId as string;
    const job = uploadJobs[jobId];

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);

    if (job.progress === 100 || job.status === 'Error') {
        setTimeout(() => delete uploadJobs[jobId], 30000);
    }
});

// Get all books for CURRENT user
router.get('/books', authenticateJWT, async (req: AuthRequest, res: Response) => {
    const books = await prisma.book.findMany({
        where: { userId: req.user.id },
        include: {
            chapters: { include: { segments: true }, orderBy: { orderIndex: 'asc' } },
            userProgress: true
        }
    });

    const transformedBooks = books.map(book => {
        const progressRecord = book.userProgress[0];
        let progressPercent = 0;

        if (progressRecord && book.chapters.length > 0) {
            // Calculate progress based on segments for maximum accuracy
            let totalSegments = 0;
            let completedSegments = 0;

            book.chapters.forEach((chapter, index) => {
                const chapterSegments = chapter.segments.length;
                totalSegments += chapterSegments;

                if (index < progressRecord.chapterIndex) {
                    completedSegments += chapterSegments;
                } else if (index === progressRecord.chapterIndex) {
                    completedSegments += progressRecord.segmentIndex;
                }
            });

            if (totalSegments > 0) {
                progressPercent = Math.round((completedSegments / totalSegments) * 100);
            }

            // Ensure bounds
            progressPercent = Math.min(100, Math.max(0, progressPercent));
        }

        let currentText = "";
        if (progressRecord && book.chapters[progressRecord.chapterIndex]?.segments[progressRecord.segmentIndex]) {
            currentText = book.chapters[progressRecord.chapterIndex].segments[progressRecord.segmentIndex].content;
        }

        return {
            ...book,
            coverImageUrl: book.coverImagePath ? `/covers/${path.basename(book.coverImagePath)}` : (book.coverUrl || null),
            progress: progressPercent,
            currentText: currentText.substring(0, 150),
            lastRead: progressRecord?.updatedAt.getTime() || 0
        };
    });

    res.json(transformedBooks);
});

// Get a single book
router.get('/books/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const bookId = parseInt(req.params.id as string);
        const book = await prisma.book.findFirst({
            where: { id: bookId, userId: req.user.id },
            include: {
                chapters: { include: { segments: true }, orderBy: { orderIndex: 'asc' } }
            }
        });

        if (!book) return res.status(404).json({ error: 'Book not found' });

        res.json({
            ...book,
            coverImageUrl: book.coverImagePath ? `/covers/${path.basename(book.coverImagePath)}` : (book.coverUrl || null)
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a book
router.delete('/books/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const bookId = parseInt(req.params.id as string);
        const book = await prisma.book.findFirst({
            where: { id: bookId, userId: req.user.id }
        });

        if (!book) return res.status(404).json({ error: 'Book not found' });

        await prisma.book.delete({ where: { id: bookId } });

        if (book.coverImagePath) {
            fs.unlink(book.coverImagePath).catch(() => { });
        }

        res.json({ message: 'Book deleted successfully', bookId });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Progress Sync Endpoints ---

router.post('/progress/:bookId', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const bookId = parseInt(req.params.bookId as string);
        const userId = req.user.id;
        const { chapterIndex, segmentIndex } = req.body;
        const progress = await prisma.userProgress.upsert({
            where: { userId_bookId: { userId, bookId } },
            update: { chapterIndex, segmentIndex },
            create: { userId, bookId, chapterIndex, segmentIndex }
        });
        res.json(progress);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/progress/:bookId', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const progress = await prisma.userProgress.findUnique({
            where: { userId_bookId: { userId, bookId: parseInt(req.params.bookId) } }
        });
        res.json(progress || { chapterIndex: 0, segmentIndex: 0 });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Bookmark Endpoints
router.get('/books/:bookId/bookmarks', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const bookId = parseInt(req.params.bookId as string);
        const bookmarks = await prisma.bookmark.findMany({
            where: { bookId, chapter: { book: { userId: req.user.id } } },
            orderBy: { createdAt: 'desc' },
            include: { chapter: { select: { title: true, orderIndex: true } } }
        });
        res.json(bookmarks);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/bookmarks', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { bookId, chapterId, segmentId, previewText, note } = req.body;

        const bookmark = await prisma.bookmark.create({
            data: { bookId: parseInt(bookId), chapterId: parseInt(chapterId), segmentId: parseInt(segmentId), previewText, note }
        });
        res.json(bookmark);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a bookmark
router.delete('/bookmarks/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        await prisma.bookmark.delete({ where: { id } });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import prisma from '../lib/prisma.js';
import { authenticateJWT } from '../middleware/auth.js';
import { generateSegment } from '../lib/audioGenerator.js';

const router = express.Router();

// Simple in-memory store for upload progress
interface UploadJob {
    progress: number;
    status: string;
    error?: string;
}
const uploadJobs: Record<string, UploadJob> = {};

// EPUB Upload Status
router.get('/upload-status/:jobId', (req, res) => {
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
router.get('/', authenticateJWT, async (req: any, res) => {
    try {
        const books = await prisma.book.findMany({
            where: { userId: req.user.id },
            include: {
                chapters: { include: { segments: true }, orderBy: { orderIndex: 'asc' } },
                userProgress: { where: { userId: req.user.id } }
            }
        });

        const transformedBooks = books.map((book: any) => {
            const progressRecord = book.userProgress[0];
            let progressPercent = 0;

            if (progressRecord && book.chapters.length > 0) {
                let totalSegments = 0;
                let completedSegments = 0;

                book.chapters.forEach((chapter: any, index: number) => {
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
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get a single book
router.get('/:id', authenticateJWT, async (req: any, res) => {
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
router.delete('/:id', authenticateJWT, async (req: any, res) => {
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

// Generate TTS for a specific book chapter
router.post('/:bookId/chapters/:chapterId/tts', authenticateJWT, async (req: any, res) => {
    try {
        const { bookId, chapterId } = req.params;
        const chapter = await prisma.chapter.findFirst({
            where: {
                id: parseInt(chapterId as string),
                bookId: parseInt(bookId as string),
            },
            include: { segments: { orderBy: { orderIndex: 'asc' } } },
        });

        if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

        await fs.mkdir('audio', { recursive: true });

        const { voice } = req.body;
        const timestamp = Date.now();
        const audioFiles: string[] = [];
        let allCached = true;

        for (let i = 0; i < chapter.segments.length; i++) {
            const fileName = `${bookId}_${chapterId}_${voice}_${i}.mp3`;
            const filePath = `audio/${fileName}`;
            try {
                await fs.access(filePath);
                audioFiles.push(`/audio/${fileName}?t=${timestamp}`);
            } catch {
                allCached = false;
                audioFiles.push(`/audio/${fileName}?t=${timestamp}`);
            }
        }

        if (allCached) return res.json({ audioFiles });

        const PRELOAD_COUNT = 1;
        for (let i = 0; i < PRELOAD_COUNT; i++) {
            const fileName = `${bookId}_${chapterId}_${voice}_${i}.mp3`;
            const filePath = `audio/${fileName}`;
            try {
                await fs.access(filePath);
            } catch {
                await generateSegment(parseInt(bookId as string), parseInt(chapterId as string), i, voice);
            }
        }

        const remainingStartIndex = PRELOAD_COUNT;
        if (chapter.segments.length > remainingStartIndex) {
            (async () => {
                const CONCURRENCY = 5;
                for (let i = remainingStartIndex; i < chapter.segments.length; i += CONCURRENCY) {
                    const batch = chapter.segments.slice(i, i + CONCURRENCY);
                    await Promise.all(batch.map(async (_: any, index: number) => {
                        const globalIndex = i + index;
                        await generateSegment(parseInt(bookId as string), parseInt(chapterId as string), globalIndex, voice);
                    }));
                }
            })();
        }

        res.json({ audioFiles });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Progress Sync Endpoints ---

router.post('/progress/:bookId', authenticateJWT, async (req: any, res) => {
    try {
        const bookId = parseInt(req.params.bookId as string);
        const { chapterIndex, segmentIndex } = req.body;
        const progress = await prisma.userProgress.upsert({
            where: { userId_bookId: { userId: req.user.id, bookId } },
            update: { chapterIndex, segmentIndex },
            create: { userId: req.user.id, bookId, chapterIndex, segmentIndex }
        });
        res.json(progress);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/progress/:bookId', authenticateJWT, async (req: any, res) => {
    try {
        const progress = await prisma.userProgress.findUnique({
            where: { userId_bookId: { userId: req.user.id, bookId: parseInt(req.params.bookId) } }
        });
        res.json(progress || { chapterIndex: 0, segmentIndex: 0 });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Bookmark Endpoints
router.get('/:bookId/bookmarks', authenticateJWT, async (req: any, res) => {
    try {
        const bookId = parseInt(req.params.bookId as string);
        const bookmarks = await prisma.bookmark.findMany({
            where: { bookId, book: { userId: req.user.id } },
            orderBy: { createdAt: 'desc' },
            include: { chapter: { select: { title: true, orderIndex: true } } }
        });
        res.json(bookmarks);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/bookmarks', authenticateJWT, async (req: any, res) => {
    try {
        const { bookId, chapterId, segmentId, previewText, note } = req.body;
        const book = await prisma.book.findFirst({ where: { id: parseInt(bookId), userId: req.user.id } });
        if (!book) return res.status(403).json({ error: 'Forbidden' });

        const bookmark = await prisma.bookmark.create({
            data: { bookId: parseInt(bookId), chapterId: parseInt(chapterId), segmentId: parseInt(segmentId), previewText, note }
        });
        res.json(bookmark);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/bookmarks/:id', authenticateJWT, async (req: any, res) => {
    try {
        const id = parseInt(req.params.id as string);
        await prisma.bookmark.delete({ where: { id } });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Export the internal bits needed by index.ts
export { uploadJobs };
export default router;

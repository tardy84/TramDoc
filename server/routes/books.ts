import { Router, Request, Response, NextFunction } from 'express';
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
const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
        if (path.extname(file.originalname).toLowerCase() !== '.epub') {
            return cb(new Error('Chỉ hỗ trợ file EPUB'));
        }
        cb(null, true);
    }
});

const uploadBook = upload.single('book');
const handleBookUpload = (req: Request, res: Response, next: NextFunction) => {
    uploadBook(req, res, (error: any) => {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File EPUB quá lớn. Vui lòng chọn file tối đa 50MB.' });
        }
        if (error) {
            return res.status(400).json({ error: error.message || 'Upload failed' });
        }
        next();
    });
};

// Simple in-memory store for upload progress
interface UploadJob {
    progress: number;
    status: string;
    error?: string;
}
export const uploadJobs: Record<string, UploadJob> = {};

function parsePositiveInt(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;

    const text = String(value);
    if (!/^\d+$/.test(text)) return null;

    const id = Number(text);
    return Number.isInteger(id) && id > 0 ? id : null;
}

// EPUB upload and processing
router.post('/upload', authenticateJWT, handleBookUpload, async (req: AuthRequest, res: Response) => {
    const jobId = req.body.jobId as string;
    const userId = req.user.id;
    let tempFilePath: string | undefined;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        tempFilePath = req.file.path;

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
    } finally {
        if (tempFilePath) {
            fs.unlink(tempFilePath).catch(() => { });
        }
    }
});

// Get upload status
router.get('/upload-status/:jobId', authenticateJWT, (req: Request, res: Response) => {
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
            userProgress: { where: { userId: req.user.id } }
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
        const bookId = parsePositiveInt(req.params.id);
        if (!bookId) {
            return res.status(400).json({ error: 'Book ID không hợp lệ' });
        }

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
        const bookId = parsePositiveInt(req.params.id);
        if (!bookId) {
            return res.status(400).json({ error: 'Book ID không hợp lệ' });
        }

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
        const bookId = parsePositiveInt(req.params.bookId);
        const userId = req.user.id;
        const { chapterIndex, segmentIndex } = req.body;

        if (!bookId || !Number.isInteger(chapterIndex) || !Number.isInteger(segmentIndex) || chapterIndex < 0 || segmentIndex < 0) {
            return res.status(400).json({ error: 'Dữ liệu tiến độ không hợp lệ' });
        }

        const book = await prisma.book.findFirst({ where: { id: bookId, userId }, select: { id: true } });
        if (!book) return res.status(404).json({ error: 'Book not found' });

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
        const bookId = parsePositiveInt(req.params.bookId);
        if (!bookId) {
            return res.status(400).json({ error: 'Book ID không hợp lệ' });
        }

        const book = await prisma.book.findFirst({ where: { id: bookId, userId }, select: { id: true } });
        if (!book) return res.status(404).json({ error: 'Book not found' });

        const progress = await prisma.userProgress.findUnique({
            where: { userId_bookId: { userId, bookId } }
        });
        res.json(progress || { chapterIndex: 0, segmentIndex: 0 });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Bookmark Endpoints
router.get('/books/:bookId/bookmarks', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const bookId = parsePositiveInt(req.params.bookId);
        if (!bookId) {
            return res.status(400).json({ error: 'Book ID không hợp lệ' });
        }

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
        const bookId = parsePositiveInt(req.body.bookId);
        const chapterId = parsePositiveInt(req.body.chapterId);
        const segmentId = parsePositiveInt(req.body.segmentId);
        const { previewText, note } = req.body;

        if (!bookId || !chapterId || !segmentId || typeof previewText !== 'string' || previewText.length === 0) {
            return res.status(400).json({ error: 'Dữ liệu bookmark không hợp lệ' });
        }

        const segment = await prisma.textSegment.findFirst({
            where: {
                id: segmentId,
                chapterId,
                chapter: { bookId, book: { userId: req.user.id } }
            },
            select: { id: true }
        });

        if (!segment) return res.status(404).json({ error: 'Segment not found' });

        const bookmark = await prisma.bookmark.create({
            data: { bookId, chapterId, segmentId, previewText, note }
        });
        res.json(bookmark);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a bookmark
router.delete('/bookmarks/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const id = parsePositiveInt(req.params.id);
        if (!id) {
            return res.status(400).json({ error: 'Bookmark ID không hợp lệ' });
        }

        const bookmark = await prisma.bookmark.findFirst({
            where: { id, chapter: { book: { userId: req.user.id } } },
            select: { id: true }
        });

        if (!bookmark) return res.status(404).json({ error: 'Bookmark not found' });

        await prisma.bookmark.delete({ where: { id } });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

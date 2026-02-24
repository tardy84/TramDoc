import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { EpubProcessor } from './services/epubProcessor.js';
import { GoogleTTSService } from './services/googleTTS.js';
import fs from 'fs/promises';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';

// Load env from absolute path to be safe on VPS
const envPath = path.resolve(process.cwd(), '.env');
const result = dotenv.config({ path: envPath });

const app = express();
// Priority: 1. Env Var, 2. Relative fallback
const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: databaseUrl,
        },
    },
    log: ['error', 'warn'],
});
const epubProcessor = new EpubProcessor();
const ttsService = new GoogleTTSService();
const port = process.env.PORT || 3005;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';

console.log('--- Server Startup ---');
console.log('CWD:', process.cwd());
console.log('Env Path tried:', envPath);
if (result.error) {
    console.error('Dotenv Error:', result.error.message);
} else {
    console.log('.env loaded. Keys:', Object.keys(result.parsed || {}).join(', '));
}
console.log('DATABASE_URL acting:', databaseUrl);
console.log('---------------------');

// --- GLOBALS & IDENTITY ---
const SERVER_ID = `VPS-Prod-${new Date().toISOString()}`;

app.get('/ping', (req, res) => {
    res.send('pong');
});

app.use((req, res, next) => {
    res.setHeader('X-Server-Identity', SERVER_ID);
    next();
});

// Explicit database check on startup
async function checkDatabase() {
    try {
        console.log(`[Startup] 🆔 Server ID: ${SERVER_ID}`);
        console.log('[Startup] 🔍 Verifying Database tables...');
        const tables: any = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table';`);
        const tableNames = tables.map((t: any) => t.name);
        console.log('[Startup] Found tables:', tableNames.join(', '));
        if (tableNames.includes('User')) {
            console.log('[Startup] ✅ Connection healthy: User table exists.');
        } else {
            console.error('[Startup] ❌ CRITICAL: User table MISSING in the current database!');
        }
    } catch (error: any) {
        console.error('[Startup] ❌ Database connection failed:', error.message);
    }
}
checkDatabase();

// --- AUTH MIDDLEWARE ---
const authenticateJWT = (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
            if (err) {
                console.error(`[Auth] JWT Error: ${err.message} (${req.method} ${req.originalUrl})`);
                console.error(`[Auth] Header: ${authHeader}`);
                return res.sendStatus(403);
            }
            req.user = user;
            console.log(`[Auth] User authenticated: ${user.email} (${user.id})`);
            next();
        });
    } else {
        console.warn('[Auth] No Authorization header provided');
        res.sendStatus(401);
    }
};

// --- PASSPORT GOOGLE SETUP ---
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'missing-id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'missing-secret',
    callbackURL: "/api/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
        if (!user) {
            user = await prisma.user.create({
                data: {
                    googleId: profile.id,
                    email: profile.emails?.[0].value || '',
                    name: profile.displayName,
                    avatarUrl: profile.photos?.[0].value
                }
            });
        }
        return done(null, user);
    } catch (error) {
        return done(error as Error);
    }
}));

passport.serializeUser((user: any, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user);
    } catch (error) {
        done(error);
    }
});

app.use(cors());
app.use(express.json());
app.use(session({
    secret: 'secret-session',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));
app.use(passport.initialize());
app.use(passport.session());

// Upload configuration
const upload = multer({ dest: 'uploads/' });

// --- STATIC FILES ---
app.use('/covers', express.static(path.join(process.cwd(), 'uploads/covers')));

// Basic health check
// Simple in-memory store for upload progress
interface UploadJob {
    progress: number;
    status: string;
    error?: string;
}
const uploadJobs: Record<string, UploadJob> = {};

// --- AUTH ENDPOINTS ---

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ error: 'Email already exists' });

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { email, passwordHash, name }
        });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (error: any) {
        console.error('[Auth Register Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(`[Auth Login] Attempting login for: ${email}`);
        const user = await prisma.user.findUnique({ where: { email } });
        console.log(`[Auth Login] User search complete. Found: ${!!user}`);

        if (!user || !user.passwordHash) {
            console.warn(`[Auth Login] Invalid user or missing password hash for: ${email}`);
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        console.log(`[Auth Login] Verifying password...`);
        const validPassword = await bcrypt.compare(password, user.passwordHash);
        console.log(`[Auth Login] Password verification result: ${validPassword}`);

        if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (error: any) {
        console.error('[Auth Login Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Me
app.get('/api/auth/me', authenticateJWT, async (req: any, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, role: user.role });
});

// Change Password (Self)
app.patch('/api/auth/change-password', authenticateJWT, async (req: any, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });

        if (!user || !user.passwordHash) {
            return res.status(400).json({ error: 'User not found or using social login' });
        }

        const validPassword = await bcrypt.compare(oldPassword, user.passwordHash);
        if (!validPassword) return res.status(400).json({ error: 'Mật khẩu cũ không chính xác' });

        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: newPasswordHash }
        });

        res.json({ success: true, message: 'Đổi mật khẩu thành công' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Google Auth
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/api/auth/google/callback', passport.authenticate('google', { session: false }), (req: any, res) => {
    const token = jwt.sign({ id: req.user.id, email: req.user.email }, JWT_SECRET);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth-success?token=${token}`);
});

// --- ADMIN MIDDLEWARE ---
const authenticateAdmin = (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, async (err: any, decoded: any) => {
            if (err) return res.sendStatus(403);
            const user = await prisma.user.findUnique({ where: { id: (decoded as any).id } });
            if (user?.role === 'ADMIN') {
                req.user = user;
                next();
            } else {
                res.status(403).json({ error: 'Admin access required' });
            }
        });
    } else {
        res.sendStatus(401);
    }
};

// --- ADMIN ENDPOINTS ---
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const userCount = await prisma.user.count();
        const bookCount = await prisma.book.count();
        const chapterCount = await prisma.chapter.count();
        const segmentCount = await prisma.textSegment.count();
        const recentUsers = await prisma.user.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: { id: true, email: true, name: true, createdAt: true, avatarUrl: true }
        });
        res.json({ userCount, bookCount, chapterCount, segmentCount, recentUsers });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            include: {
                books: { select: { id: true, title: true } },
                _count: { select: { books: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(users);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/books', authenticateAdmin, async (req, res) => {
    try {
        const books = await prisma.book.findMany({
            include: {
                user: { select: { name: true, email: true } },
                _count: { select: { chapters: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        const transformedBooks = books.map(book => ({
            ...book,
            coverImageUrl: book.coverImagePath ? `/covers/${path.basename(book.coverImagePath)}` : (book.coverUrl || null)
        }));
        res.json(transformedBooks);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (id === (req.user as any).id) {
            return res.status(400).json({ error: 'Cannot delete yourself' });
        }
        await prisma.user.delete({ where: { id } });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/admin/users/:id/password', authenticateAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { newPassword } = req.body;

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id },
            data: { passwordHash }
        });

        res.json({ success: true, message: 'Reset mật khẩu thành công' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/books/:id', authenticateAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const book = await prisma.book.findUnique({ where: { id } });
        if (!book) return res.status(404).json({ error: 'Book not found' });

        await prisma.book.delete({ where: { id } });

        if (book.coverImagePath) {
            fs.unlink(book.coverImagePath).catch(() => { });
        }

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/books/bulk-delete', authenticateAdmin, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) return res.status(400).json({ error: 'IDs must be an array' });

        const books = await prisma.book.findMany({
            where: { id: { in: ids.map(id => parseInt(id.toString())) } }
        });

        await prisma.book.deleteMany({
            where: { id: { in: ids.map(id => parseInt(id.toString())) } }
        });

        // Cleanup files
        for (const book of books) {
            if (book.coverImagePath) {
                fs.unlink(book.coverImagePath).catch(() => { });
            }
        }

        res.json({ success: true, count: books.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});


// EPUB upload and processing
app.post('/api/upload', authenticateJWT, upload.single('book'), async (req: any, res: Response) => {
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
app.get('/api/upload-status/:jobId', (req: Request, res: Response) => {
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
app.get('/api/books', authenticateJWT, async (req: any, res: Response) => {
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
app.get('/api/books/:id', authenticateJWT, async (req: any, res: Response) => {
    try {
        const bookId = parseInt(req.params.id as string);
        console.log(`[API] Fetching book ${bookId} for user ${req.user?.id}`);
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
app.delete('/api/books/:id', authenticateJWT, async (req: any, res: Response) => {
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

app.post('/api/progress/:bookId', authenticateJWT, async (req: any, res: Response) => {
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

app.get('/api/progress/:bookId', authenticateJWT, async (req: any, res: Response) => {
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
app.get('/api/books/:bookId/bookmarks', authenticateJWT, async (req: any, res: Response) => {
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

app.post('/api/bookmarks', authenticateJWT, async (req: any, res: Response) => {
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

// Delete a bookmark
app.delete('/api/bookmarks/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        await prisma.bookmark.delete({ where: { id } });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Generate TTS for a specific book chapter
app.post('/api/books/:bookId/chapters/:chapterId/tts', async (req: Request, res: Response) => {
    try {
        const { bookId, chapterId } = req.params;

        const chapter = await prisma.chapter.findFirst({
            where: {
                id: parseInt(chapterId as string),
                bookId: parseInt(bookId as string),
            },
            include: { segments: { orderBy: { orderIndex: 'asc' } } },
        });

        if (!chapter) {
            return res.status(404).json({ error: 'Chapter not found' });
        }

        await fs.mkdir('audio', { recursive: true });

        // CACHE DISABLED - To allow voice/engine changes
        // TODO: Re-enable cache with voice settings in cache key
        const { voice } = req.body;
        const timestamp = Date.now();
        const audioFiles: string[] = [];
        let allCached = true;

        // 1. Check if audio files for THIS VOICE already exist
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

        if (allCached) {
            console.log(`[TTS Cache] ✅ Using cached audio for book ${bookId}, chapter ${chapterId}, voice ${voice}`);
            return res.json({ audioFiles });
        }

        // 2. Generate missing segments
        console.log(`[TTS] Generating missing audio for book ${bookId}, chapter ${chapterId} with voice ${voice}`);
        const PRELOAD_COUNT = 3;

        for (let i = 0; i < PRELOAD_COUNT; i++) {
            const fileName = `${bookId}_${chapterId}_${voice}_${i}.mp3`;
            const filePath = `audio/${fileName}`;
            try {
                await fs.access(filePath);
            } catch {
                await generateSegment(parseInt(req.params.bookId as string), parseInt(req.params.chapterId as string), i, voice);
            }
        }

        // 3. Background segments
        const remainingStartIndex = PRELOAD_COUNT;
        if (chapter.segments.length > remainingStartIndex) {
            (async () => {
                const CONCURRENCY = 5;
                for (let i = remainingStartIndex; i < chapter.segments.length; i += CONCURRENCY) {
                    const batch = chapter.segments.slice(i, i + CONCURRENCY);
                    await Promise.all(batch.map(async (_, index) => {
                        const globalIndex = i + index;
                        await generateSegment(parseInt(req.params.bookId as string), parseInt(req.params.chapterId as string), globalIndex, voice);
                    }));
                }
            })();
        }

        res.json({ audioFiles });
    } catch (error: any) {
        console.error('Error generating TTS:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper for generating a specific segment (Deduped + Safe)
const generatingFiles = new Set<string>();

async function generateSegment(bookId: number, chapterId: number, segmentIndex: number, voice: string): Promise<boolean> {
    const fileName = `${bookId}_${chapterId}_${voice}_${segmentIndex}.mp3`;
    const filePath = path.join(process.cwd(), 'audio', fileName);

    // 1. Check if already exists
    try {
        await fs.access(filePath);
        return true; // Exists
    } catch {
        // Continue
    }

    // 2. Check if currently generating (Dedup)
    if (generatingFiles.has(fileName)) {
        console.log(`[Audio] ⏳ File ${fileName} is already being generated. Waiting...`);
        // Wait for it to finish (poll every 500ms, max 30s)
        const MAX_WAIT = 60; // 30s / 0.5s
        let attempts = 0;

        while (generatingFiles.has(fileName) && attempts < MAX_WAIT) {
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }

        // After waiting, check if file exists
        try {
            await fs.access(filePath);
            console.log(`[Audio] ✅ File ${fileName} ready after wait.`);
            return true;
        } catch {
            console.error(`[Audio] ❌ File ${fileName} not found after waiting.`);
            return false;
        }
    }

    generatingFiles.add(fileName);

    try {
        // Fetch DB Segment
        const segment = await prisma.textSegment.findFirst({
            where: { chapterId, orderIndex: segmentIndex }
        });

        if (!segment) {
            generatingFiles.delete(fileName);
            return false;
        }

        const buffer = await ttsService.synthesize(
            segment.content,
            segment.role as any,
            voice
        );

        await fs.writeFile(filePath, buffer);
        console.log(`[Audio] ✅ Generated: ${fileName}`);
        return true;
    } catch (error) {
        console.error(`[Audio] ❌ Failed to generate ${fileName}:`, error);
        return false;
    } finally {
        generatingFiles.delete(fileName);
    }
}

// Dynamic Audio Serving (On-Demand Generation + Lookahead)
app.get('/audio/:filename', async (req: Request, res: Response) => {
    const { filename } = req.params as { filename: string };
    const filePath = path.join(process.cwd(), 'audio', filename);

    // Parse filename info
    const baseName: string = filename.split('.')[0];
    const parts = baseName.split('_');
    // Removing query params from filename if present in request param (express usually handles this, 
    // but client sends ?t=..., express :filename does NOT include query string. So this is safe.)

    // Basic existence check
    try {
        await fs.access(filePath);
        return res.sendFile(filePath);
    } catch {
        // File missing
    }

    let bookId, chapterId, segmentIndex, voice: string;

    if (parts.length === 4) {
        bookId = parseInt(parts[0]);
        chapterId = parseInt(parts[1]);
        voice = parts[2];
        segmentIndex = parseInt(parts[3]);
    } else if (parts.length === 3) {
        bookId = parseInt(parts[0]);
        chapterId = parseInt(parts[1]);
        segmentIndex = parseInt(parts[2]);
        voice = 'vi-VN-Wavenet-B'; // Default legacy voice
    } else {
        return res.status(400).send('Invalid');
    }

    console.log(`[Audio] ⚠️ Cache Miss: ${filename} (Voice: ${voice}). Generating on-demand...`);

    try {
        // 1. Generate requested file (Blocking)
        await generateSegment(bookId, chapterId, segmentIndex, voice);

        // 2. Lookahead: Trigger generation for next 3 segments (Non-Blocking)
        (async () => {
            console.log(`[Audio] 🔮 Triggering lookahead for segments ${segmentIndex + 1}..${segmentIndex + 3} with voice ${voice}`);
            await generateSegment(bookId, chapterId, segmentIndex + 1, voice);
            await generateSegment(bookId, chapterId, segmentIndex + 2, voice);
            await generateSegment(bookId, chapterId, segmentIndex + 3, voice);
        })();

        // 3. Serve file
        res.sendFile(filePath);
    } catch (error) {
        res.status(500).send('Gen Failed');
    }
});

app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Server is running on port ${port} (All interfaces)`);
});

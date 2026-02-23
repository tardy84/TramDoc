import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import dotenv from 'dotenv';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';

import prisma from './lib/prisma.js';
import epubProcessor from './lib/epub.js';
import { authenticateJWT } from './middleware/auth.js';

// Route Imports
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import bookRoutes, { uploadJobs } from './routes/books.js';
import audioRoutes from './routes/audio.js';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
const port = process.env.PORT || 3005;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';

// Explicit database check on startup
async function checkDatabase() {
    try {
        console.log('[Startup] 🔍 Verifying Database connection...');
        const tables: any = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table';`);
        const tableNames = tables.map((t: any) => t.name);
        console.log('[Startup] Found tables:', tableNames.join(', '));
        if (tableNames.includes('User')) {
            console.log('[Startup] ✅ Connection healthy.');
        } else {
            console.error('[Startup] ❌ CRITICAL: User table MISSING!');
        }
    } catch (error: any) {
        console.error('[Startup] ❌ Database connection failed:', error.message);
    }
}
checkDatabase();

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

passport.serializeUser((user: any, done) => done(null, user.id));
passport.deserializeUser(async (id: number, done) => {
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user);
    } catch (error) {
        done(error);
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(session({
    secret: 'secret-session',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));
app.use(passport.initialize());
app.use(passport.session());

// Static Files
app.use('/covers', express.static(path.join(process.cwd(), 'uploads/covers')));

// Upload Config
const upload = multer({ dest: 'uploads/' });

// --- ROUTES ---

// Health Check
app.get('/ping', (req, res) => res.send('pong'));

// Auth Routes
app.use('/api/auth', authRoutes);

// Admin Routes
app.use('/api/admin', adminRoutes);

// Book Routes
app.use('/api/books', bookRoutes);

// Special Upload Route (due to multer middleware)
app.post('/api/upload', authenticateJWT, upload.single('book'), async (req: any, res: Response) => {
    const jobId = req.body.jobId as string;
    const userId = req.user.id;

    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        if (jobId) uploadJobs[jobId] = { progress: 0, status: 'Starting processing...' };

        const bookId = await epubProcessor.processEpub(req.file.path, (progress: number, status: string) => {
            if (jobId) uploadJobs[jobId] = { progress, status };
        });

        await prisma.book.update({ where: { id: bookId }, data: { userId } });

        if (jobId) uploadJobs[jobId] = { progress: 100, status: 'Complete' };

        res.json({ message: 'EPUB processed successfully', bookId });
    } catch (error: any) {
        console.error('Error processing EPUB:', error);
        if (jobId) uploadJobs[jobId] = { progress: 0, status: 'Error', error: error.message };
        res.status(500).json({ error: error.message });
    }
});

// Audio Serving Route
app.use('/audio', audioRoutes);

app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});

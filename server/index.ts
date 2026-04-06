import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Import New Routers
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import booksRouter from './routes/books.js';
import ttsRouter from './routes/tts.js';

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

const port = process.env.PORT || 3005;

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

// Setup App and CORS
app.use(cors());
app.use(express.json());

// --- STATIC FILES ---
app.use('/covers', express.static(path.join(process.cwd(), 'uploads/covers')));

// --- MOUNT ROUTERS ---
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
// Note: Books API isn't completely under "/api/books" prefix on all its routes (like /api/upload, /api/progress/:bookId).
// So mounting it directly under /api allows the router to handle these naturally.
app.use('/api', booksRouter);

// The TTS router also maps things on /api inside, so mount it properly.
// Similarly, the dynamic audio generation route is completely root-level ('/audio/:filename')
app.use('/api', ttsRouter); // Handles `/api/books/:bookId/chapters/:chapterId/tts`
app.use('/', ttsRouter);    // Handles `/audio/:filename`

app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Server is running on port ${port} (All interfaces)`);
});

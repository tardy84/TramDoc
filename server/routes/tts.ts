import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs/promises';
import { authenticateJWT, AuthRequest } from '../middleware/auth.js';
import { GoogleTTSService } from '../services/googleTTS.js';
import { AzureTTSService } from '../services/azureTTS.js';

const router = Router();
const prisma = new PrismaClient();
const googleTTS = new GoogleTTSService();
const azureTTS = new AzureTTSService();

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

        const ttsService = voice.startsWith('azure-') ? azureTTS : googleTTS;

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

// Generate TTS for a specific book chapter
router.post('/books/:bookId/chapters/:chapterId/tts', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { bookId, chapterId } = req.params;

        const chapter = await prisma.chapter.findFirst({
            where: {
                id: parseInt(chapterId as string),
                bookId: parseInt(bookId as string),
                book: { userId: req.user.id }
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
                const DELAY_BETWEEN_BATCHES = 0;

                for (let i = remainingStartIndex; i < chapter.segments.length; i += CONCURRENCY) {
                    const batch = chapter.segments.slice(i, i + CONCURRENCY);
                    await Promise.all(batch.map(async (_, index) => {
                        const globalIndex = i + index;
                        await generateSegment(parseInt(req.params.bookId as string), parseInt(req.params.chapterId as string), globalIndex, voice);
                    }));

                    if (DELAY_BETWEEN_BATCHES > 0) {
                        await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
                    }
                }
            })();
        }

        res.json({ audioFiles });
    } catch (error: any) {
        console.error('Error generating TTS:', error);
        res.status(500).json({ error: error.message });
    }
});

// Dynamic Audio Serving (On-Demand Generation + Lookahead)
router.get('/audio/:filename', async (req: Request, res: Response) => {
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

export default router;

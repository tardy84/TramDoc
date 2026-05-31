import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authenticateJWT, AuthRequest } from '../middleware/auth.js';
import { JWT_SECRET } from '../config/env.js';
import { GoogleTTSService } from '../services/googleTTS.js';
import { AzureTTSService } from '../services/azureTTS.js';
import { MiniMaxTTSService } from '../services/minimaxTTS.js';
import { GeminiTTSService } from '../services/geminiTTS.js';
import { VbeeTTSService } from '../services/vbeeTTS.js';

const router = Router();
const prisma = new PrismaClient();
const googleTTS = new GoogleTTSService();
const azureTTS = new AzureTTSService();
const minimaxTTS = new MiniMaxTTSService();
const geminiTTS = new GeminiTTSService();
const vbeeTTS = new VbeeTTSService();

// Helper for generating a specific segment (Deduped + Safe)
const generatingFiles = new Set<string>();
const providerWarnings = new Set<string>();
const audioDir = path.resolve(process.cwd(), 'audio');
const AUDIO_TOKEN_TTL = '15m';
const TTS_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const TTS_RATE_LIMIT_MAX_REQUESTS = 20;
const TTS_GENERATION_MAX_ATTEMPTS = 2;
const TTS_GENERATION_RETRY_DELAY_MS = 750;
const VBEE_LOOKAHEAD_COUNT = 2;
const VBEE_SHORT_SEGMENT_MAX_CHARS = 140;
const VBEE_SHORT_RUN_MIN_SEGMENTS = 3;
const VBEE_SHORT_RUN_LOOKAHEAD_COUNT = 5;
const VBEE_SHORT_RUN_EARLY_WARMUP_COUNT = 2;
const ttsRequests = new Map<number, { count: number; resetAt: number }>();

interface AudioAccessClaims {
    userId: number;
    bookId?: number;
    chapterId?: number;
}

interface SegmentForAudioCache {
    content: string;
    role: string;
    orderIndex: number;
}

function isSafeVoice(voice: unknown): voice is string {
    return typeof voice === 'string' &&
        voice.length > 0 &&
        voice.length <= 120 &&
        /^[A-Za-z0-9._-]+$/.test(voice) &&
        !voice.includes('..');
}

function buildAudioFileName(bookId: number, chapterId: number, voice: string, segmentIndex: number): string {
    return `${bookId}_${chapterId}_${voice}_${segmentIndex}.mp3`;
}

function buildAudioMetadataFileName(audioFileName: string): string {
    return `${audioFileName}.json`;
}

function resolveAudioPath(fileName: string): string | null {
    if (!/^[A-Za-z0-9._-]+\.mp3$/.test(fileName) || fileName.includes('..')) {
        return null;
    }

    const resolved = path.resolve(audioDir, fileName);
    if (!resolved.startsWith(`${audioDir}${path.sep}`)) {
        return null;
    }

    return resolved;
}

function resolveAudioMetadataPath(audioFileName: string): string | null {
    const metadataFileName = buildAudioMetadataFileName(audioFileName);
    if (!/^[A-Za-z0-9._-]+\.mp3\.json$/.test(metadataFileName) || metadataFileName.includes('..')) {
        return null;
    }

    const resolved = path.resolve(audioDir, metadataFileName);
    if (!resolved.startsWith(`${audioDir}${path.sep}`)) {
        return null;
    }

    return resolved;
}

function getSegmentContentHash(segment: SegmentForAudioCache, voice: string): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify({ content: segment.content, role: segment.role, voice }))
        .digest('hex');
}

async function isSegmentAudioCached(filePath: string, metadataPath: string, segment: SegmentForAudioCache, voice: string): Promise<boolean> {
    try {
        const [metadataRaw] = await Promise.all([
            fs.readFile(metadataPath, 'utf8'),
            fs.access(filePath),
        ]);
        const metadata = JSON.parse(metadataRaw) as { contentHash?: unknown };
        return metadata.contentHash === getSegmentContentHash(segment, voice);
    } catch {
        return false;
    }
}

async function writeAudioMetadata(metadataPath: string, segment: SegmentForAudioCache, voice: string): Promise<void> {
    await fs.writeFile(metadataPath, JSON.stringify({
        contentHash: getSegmentContentHash(segment, voice),
        orderIndex: segment.orderIndex,
        role: segment.role,
        voice,
        generatedAt: new Date().toISOString(),
    }, null, 2));
}

async function deleteAudioCache(fileName: string): Promise<void> {
    const filePath = resolveAudioPath(fileName);
    const metadataPath = resolveAudioMetadataPath(fileName);
    if (!filePath || !metadataPath) return;

    await Promise.all([
        fs.unlink(filePath).catch(() => { }),
        fs.unlink(metadataPath).catch(() => { }),
    ]);
}

async function doesFileExist(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function parsePositiveInt(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;

    const text = String(value);
    if (!/^\d+$/.test(text)) return null;

    const id = Number(text);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function parseNonNegativeInt(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;

    const text = String(value);
    if (!/^\d+$/.test(text)) return null;

    const id = Number(text);
    return Number.isInteger(id) && id >= 0 ? id : null;
}

function getStartSegmentIndex(value: unknown, segmentCount: number): number | null {
    if (value === undefined) return 0;

    const index = parseNonNegativeInt(value);
    if (index === null || index >= segmentCount) return null;

    return index;
}

function getTokenFromRequest(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice('Bearer '.length);
    }

    const queryToken = req.query.token;
    return typeof queryToken === 'string' ? queryToken : null;
}

function createAudioToken(userId: number, bookId: number, chapterId: number): string {
    return jwt.sign({ purpose: 'audio', userId, bookId, chapterId }, JWT_SECRET, { expiresIn: AUDIO_TOKEN_TTL });
}

function getAudioAccessClaims(req: Request): AudioAccessClaims | null {
    const token = getTokenFromRequest(req);
    if (!token) return null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (decoded?.purpose === 'audio') {
            if (!Number.isInteger(decoded.userId) || !Number.isInteger(decoded.bookId) || !Number.isInteger(decoded.chapterId)) {
                return null;
            }
            return { userId: decoded.userId, bookId: decoded.bookId, chapterId: decoded.chapterId };
        }

        return Number.isInteger(decoded?.id) ? { userId: decoded.id } : null;
    } catch {
        return null;
    }
}

function appendAudioToken(url: string, token: string): string {
    return `${url}&token=${encodeURIComponent(token)}`;
}

function isTtsRateLimited(userId: number): boolean {
    const now = Date.now();
    const current = ttsRequests.get(userId);
    if (!current || current.resetAt <= now) {
        ttsRequests.set(userId, { count: 1, resetAt: now + TTS_RATE_LIMIT_WINDOW_MS });
        return false;
    }

    current.count += 1;
    return current.count > TTS_RATE_LIMIT_MAX_REQUESTS;
}

function getSafeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getLookaheadSegmentIndexes(startIndex: number, segmentCount: number, count: number): number[] {
    const indexes: number[] = [];
    for (let i = startIndex + 1; i < segmentCount && indexes.length < count; i++) {
        indexes.push(i);
    }
    return indexes;
}

function getShortSegmentRunLength(segments: SegmentForAudioCache[], startIndex: number): number {
    let count = 0;
    for (let i = startIndex; i < segments.length; i++) {
        if (segments[i].content.trim().length > VBEE_SHORT_SEGMENT_MAX_CHARS) break;
        count++;
    }
    return count;
}

function getVbeeLookaheadCount(segments: SegmentForAudioCache[], startIndex: number): number {
    const shortRunLength = getShortSegmentRunLength(segments, startIndex);
    return shortRunLength >= VBEE_SHORT_RUN_MIN_SEGMENTS ? VBEE_SHORT_RUN_LOOKAHEAD_COUNT : VBEE_LOOKAHEAD_COUNT;
}

async function generateSegmentsInBackground(bookId: number, chapterId: number, voice: string, indexes: number[], concurrency: number, delayBetweenBatches: number) {
    (async () => {
        for (let i = 0; i < indexes.length; i += concurrency) {
            const batch = indexes.slice(i, i + concurrency);
            await Promise.all(batch.map(index => generateSegment(bookId, chapterId, index, voice)));

            if (delayBetweenBatches > 0) {
                await delay(delayBetweenBatches);
            }
        }
    })();
}

function getMissingProviderConfig(voice: string): string | null {
    if (voice.startsWith('azure-')) {
        if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) return 'Azure Speech is not configured';
        return null;
    }
    if (voice.startsWith('minimax-')) {
        if (!process.env.MINIMAX_API_KEY) return 'MiniMax is not configured';
        return null;
    }
    if (voice.startsWith('gemini-')) {
        if (!process.env.GEMINI_API_KEY) return 'Gemini TTS is not configured';
        return null;
    }
    if (voice.startsWith('vbee-')) {
        if (!process.env.VBEE_APP_ID || !process.env.VBEE_TOKEN) return 'Vbee TTS is not configured';
        return null;
    }
    if (!process.env.GOOGLE_TTS_API_KEY && !process.env.GOOGLE_CLOUD_API_KEY) return 'Google Cloud TTS is not configured';
    return null;
}

async function generateSegment(bookId: number, chapterId: number, segmentIndex: number, voice: string): Promise<boolean> {
    if (!isSafeVoice(voice) || !Number.isInteger(bookId) || !Number.isInteger(chapterId) || !Number.isInteger(segmentIndex) || segmentIndex < 0) {
        return false;
    }

    const fileName = buildAudioFileName(bookId, chapterId, voice, segmentIndex);
    const filePath = resolveAudioPath(fileName);
    const metadataPath = resolveAudioMetadataPath(fileName);
    if (!filePath || !metadataPath) return false;

    const segment = await prisma.textSegment.findFirst({
        where: { chapterId, orderIndex: segmentIndex, chapter: { bookId } },
        select: { content: true, role: true, orderIndex: true },
    });

    if (!segment) {
        return false;
    }

    // 1. Check if already exists for the current segment content/voice
    if (await isSegmentAudioCached(filePath, metadataPath, segment, voice)) {
        return true; // Exists
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

        // After waiting, check if the generated file matches the current segment content
        if (await isSegmentAudioCached(filePath, metadataPath, segment, voice)) {
            console.log(`[Audio] ✅ File ${fileName} ready after wait.`);
            return true;
        }

        console.error(`[Audio] ❌ File ${fileName} not found or stale after waiting.`);
        return false;
    }

    const missingProviderConfig = getMissingProviderConfig(voice);
    if (missingProviderConfig) {
        const warningKey = `${voice}:${missingProviderConfig}`;
        if (!providerWarnings.has(warningKey)) {
            console.warn(`[Audio] ⚠️ ${missingProviderConfig}. Voice requested: ${voice}`);
            providerWarnings.add(warningKey);
        }
        return false;
    }

    generatingFiles.add(fileName);

    try {
        const ttsService = voice.startsWith('vbee-') ? vbeeTTS : voice.startsWith('minimax-') ? minimaxTTS : voice.startsWith('azure-') ? azureTTS : voice.startsWith('gemini-') ? geminiTTS : googleTTS;

        let buffer: Buffer | null = null;
        const maxAttempts = voice.startsWith('vbee-') ? 1 : TTS_GENERATION_MAX_ATTEMPTS;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                buffer = await ttsService.synthesize(
                    segment.content,
                    segment.role as any,
                    voice
                );
                break;
            } catch (error) {
                if (attempt >= maxAttempts) throw error;
                console.warn(`[Audio] ⚠️ Retry ${attempt}/${maxAttempts - 1} for ${fileName}: ${getSafeErrorMessage(error)}`);
                await delay(TTS_GENERATION_RETRY_DELAY_MS * attempt);
            }
        }

        if (!buffer) return false;

        await fs.mkdir(audioDir, { recursive: true });
        await fs.writeFile(filePath, buffer);
        await writeAudioMetadata(metadataPath, segment, voice);
        console.log(`[Audio] ✅ Generated: ${fileName}`);
        return true;
    } catch (error) {
        console.error(`[Audio] ❌ Failed to generate ${fileName}: ${getSafeErrorMessage(error)}`);
        return false;
    } finally {
        generatingFiles.delete(fileName);
    }
}

// Inspect TTS cache health for a chapter/voice
router.get('/books/:bookId/chapters/:chapterId/tts/status', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const parsedBookId = parsePositiveInt(req.params.bookId);
        const parsedChapterId = parsePositiveInt(req.params.chapterId);
        if (!parsedBookId || !parsedChapterId) {
            return res.status(400).json({ error: 'Book hoặc chapter ID không hợp lệ' });
        }

        const voice = req.query.voice;
        if (!isSafeVoice(voice)) {
            return res.status(400).json({ error: 'Giọng đọc không hợp lệ' });
        }

        const chapter = await prisma.chapter.findFirst({
            where: {
                id: parsedChapterId,
                bookId: parsedBookId,
                book: { userId: req.user.id }
            },
            include: { segments: { orderBy: { orderIndex: 'asc' } } },
        });

        if (!chapter) {
            return res.status(404).json({ error: 'Chapter not found' });
        }

        let cached = 0;
        let stale = 0;
        let missing = 0;

        for (let i = 0; i < chapter.segments.length; i++) {
            const segment = chapter.segments[i];
            const fileName = buildAudioFileName(parsedBookId, parsedChapterId, voice, i);
            const filePath = resolveAudioPath(fileName);
            const metadataPath = resolveAudioMetadataPath(fileName);
            if (!filePath || !metadataPath) return res.status(400).json({ error: 'Tên file audio không hợp lệ' });

            if (await isSegmentAudioCached(filePath, metadataPath, segment, voice)) {
                cached++;
            } else if (await doesFileExist(filePath)) {
                stale++;
            } else {
                missing++;
            }
        }

        return res.json({ total: chapter.segments.length, cached, stale, missing });
    } catch (error: any) {
        console.error('Error reading TTS status:', getSafeErrorMessage(error));
        return res.status(500).json({ error: error.message });
    }
});

// Force regenerate TTS cache for one segment, or for a whole chapter when segmentIndex is omitted
router.post('/books/:bookId/chapters/:chapterId/tts/regenerate', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const parsedBookId = parsePositiveInt(req.params.bookId);
        const parsedChapterId = parsePositiveInt(req.params.chapterId);
        if (!parsedBookId || !parsedChapterId) {
            return res.status(400).json({ error: 'Book hoặc chapter ID không hợp lệ' });
        }

        const { voice } = req.body;
        if (!isSafeVoice(voice)) {
            return res.status(400).json({ error: 'Giọng đọc không hợp lệ' });
        }

        const chapter = await prisma.chapter.findFirst({
            where: {
                id: parsedChapterId,
                bookId: parsedBookId,
                book: { userId: req.user.id }
            },
            include: { segments: { orderBy: { orderIndex: 'asc' } } },
        });

        if (!chapter) {
            return res.status(404).json({ error: 'Chapter not found' });
        }

        if (isTtsRateLimited(req.user.id)) {
            return res.status(429).json({ error: 'Bạn tạo audio quá nhiều lần. Vui lòng thử lại sau.' });
        }

        const segmentIndex = req.body.segmentIndex === undefined ? null : parseNonNegativeInt(req.body.segmentIndex);
        if (req.body.segmentIndex !== undefined && segmentIndex === null) {
            return res.status(400).json({ error: 'Segment index không hợp lệ' });
        }

        if (segmentIndex !== null) {
            if (segmentIndex >= chapter.segments.length) {
                return res.status(404).json({ error: 'Segment not found' });
            }

            const fileName = buildAudioFileName(parsedBookId, parsedChapterId, voice, segmentIndex);
            await deleteAudioCache(fileName);
            const generated = await generateSegment(parsedBookId, parsedChapterId, segmentIndex, voice);
            return res.json({ scope: 'segment', segmentIndex, generated });
        }

        if (voice.startsWith('vbee-')) {
            return res.status(400).json({
                error: 'Không hỗ trợ tạo lại cả chapter bằng Vbee để tránh tốn credit. Vui lòng tạo lại từng đoạn nếu cần.'
            });
        }

        for (let i = 0; i < chapter.segments.length; i++) {
            const fileName = buildAudioFileName(parsedBookId, parsedChapterId, voice, i);
            await deleteAudioCache(fileName);
        }

        const startIndex = getStartSegmentIndex(req.body.startSegmentIndex, chapter.segments.length);
        if (startIndex === null) {
            return res.status(400).json({ error: 'Start segment index không hợp lệ' });
        }

        const preloaded: number[] = [];
        if (await generateSegment(parsedBookId, parsedChapterId, startIndex, voice)) {
            preloaded.push(startIndex);
        }

        const CONCURRENCY = voice.startsWith('vbee-') ? 2 : 5;
        const DELAY_BETWEEN_BATCHES = voice.startsWith('vbee-') ? 500 : 0;
        const backgroundIndexes = Array.from({ length: chapter.segments.length }, (_, index) => index)
            .filter(index => index !== startIndex);
        generateSegmentsInBackground(parsedBookId, parsedChapterId, voice, backgroundIndexes, CONCURRENCY, DELAY_BETWEEN_BATCHES);

        return res.json({ scope: 'chapter', total: chapter.segments.length, preloaded, background: backgroundIndexes.length > 0 });
    } catch (error: any) {
        console.error('Error regenerating TTS:', getSafeErrorMessage(error));
        return res.status(500).json({ error: error.message });
    }
});

// Generate TTS for a specific book chapter
router.post('/books/:bookId/chapters/:chapterId/tts', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const parsedBookId = parsePositiveInt(req.params.bookId);
        const parsedChapterId = parsePositiveInt(req.params.chapterId);
        if (!parsedBookId || !parsedChapterId) {
            return res.status(400).json({ error: 'Book hoặc chapter ID không hợp lệ' });
        }

        const chapter = await prisma.chapter.findFirst({
            where: {
                id: parsedChapterId,
                bookId: parsedBookId,
                book: { userId: req.user.id }
            },
            include: { segments: { orderBy: { orderIndex: 'asc' } } },
        });

        if (!chapter) {
            return res.status(404).json({ error: 'Chapter not found' });
        }

        await fs.mkdir(audioDir, { recursive: true });

        const { voice } = req.body;
        if (!isSafeVoice(voice)) {
            return res.status(400).json({ error: 'Giọng đọc không hợp lệ' });
        }

        const timestamp = Date.now();
        const audioToken = createAudioToken(req.user.id, parsedBookId, parsedChapterId);
        const audioFiles = chapter.segments.map((_, i) => {
            const fileName = buildAudioFileName(parsedBookId, parsedChapterId, voice, i);
            return appendAudioToken(`/audio/${fileName}?t=${timestamp}`, audioToken);
        });

        if (chapter.segments.length === 0) {
            return res.json({ audioFiles });
        }

        const startSegmentIndex = getStartSegmentIndex(req.body.startSegmentIndex, chapter.segments.length);
        if (startSegmentIndex === null) {
            return res.status(400).json({ error: 'Start segment index không hợp lệ' });
        }

        // Only validate the segment the reader needs now. Scanning every segment's
        // audio+metadata blocks first playback on long chapters.
        const currentSegment = chapter.segments[startSegmentIndex];
        const currentFileName = buildAudioFileName(parsedBookId, parsedChapterId, voice, startSegmentIndex);
        const currentFilePath = resolveAudioPath(currentFileName);
        const currentMetadataPath = resolveAudioMetadataPath(currentFileName);
        if (!currentFilePath || !currentMetadataPath) {
            return res.status(400).json({ error: 'Tên file audio không hợp lệ' });
        }

        const currentCached = await isSegmentAudioCached(currentFilePath, currentMetadataPath, currentSegment, voice);
        if (currentCached) {
            if (voice.startsWith('vbee-')) {
                const lookaheadIndexes = getLookaheadSegmentIndexes(startSegmentIndex, chapter.segments.length, getVbeeLookaheadCount(chapter.segments, startSegmentIndex));
                generateSegmentsInBackground(parsedBookId, parsedChapterId, voice, lookaheadIndexes, 1, 500);
            }
            console.log(`[TTS Cache] ✅ Using cached audio for book ${parsedBookId}, chapter ${parsedChapterId}, segment ${startSegmentIndex}, voice ${voice}`);
            return res.json({ audioFiles });
        }

        if (isTtsRateLimited(req.user.id)) {
            return res.status(429).json({ error: 'Bạn tạo audio quá nhiều lần. Vui lòng thử lại sau.' });
        }

        // 2. Generate the current reading segment first so resume/change-voice starts fast.
        // For runs of very short dialogue segments, start the next Vbee jobs early
        // while the current segment is still generating. This smooths playback gaps
        // without preloading whole chapters.
        const vbeeLookaheadCount = voice.startsWith('vbee-') ? getVbeeLookaheadCount(chapter.segments, startSegmentIndex) : 12;
        const earlyWarmupIndexes = voice.startsWith('vbee-') && vbeeLookaheadCount > VBEE_LOOKAHEAD_COUNT
            ? getLookaheadSegmentIndexes(startSegmentIndex, chapter.segments.length, VBEE_SHORT_RUN_EARLY_WARMUP_COUNT)
            : [];
        if (earlyWarmupIndexes.length > 0) {
            generateSegmentsInBackground(parsedBookId, parsedChapterId, voice, earlyWarmupIndexes, 1, 250);
        }

        console.log(`[TTS] Generating audio for book ${parsedBookId}, chapter ${parsedChapterId}, segment ${startSegmentIndex} with voice ${voice}`);
        await generateSegment(parsedBookId, parsedChapterId, startSegmentIndex, voice);

        // 3. Background lookahead near the current reading position.
        const CONCURRENCY = voice.startsWith('vbee-') ? 1 : 5;
        const DELAY_BETWEEN_BATCHES = voice.startsWith('vbee-') ? 500 : 0;
        const lookaheadIndexes = getLookaheadSegmentIndexes(startSegmentIndex, chapter.segments.length, vbeeLookaheadCount)
            .filter(index => !earlyWarmupIndexes.includes(index));
        generateSegmentsInBackground(parsedBookId, parsedChapterId, voice, lookaheadIndexes, CONCURRENCY, DELAY_BETWEEN_BATCHES);

        res.json({ audioFiles });
    } catch (error: any) {
        console.error('Error generating TTS:', getSafeErrorMessage(error));
        res.status(500).json({ error: error.message });
    }
});

router.post('/vbee-callback', (req: Request, res: Response) => {
    const result = req.body?.result;
    const requestId = typeof result?.request_id === 'string' ? result.request_id : undefined;
    const status = typeof result?.status === 'string' ? result.status : undefined;

    if (requestId || status) {
        console.log(`[VbeeTTS] Callback received${requestId ? ` for ${requestId}` : ''}${status ? ` (${status})` : ''}`);
    }

    res.json({ success: true });
});

// Dynamic Audio Serving (On-Demand Generation + Lookahead)
router.get('/audio/:filename', async (req: Request, res: Response) => {
    const { filename } = req.params as { filename: string };
    const filePath = resolveAudioPath(filename);
    if (!filePath) {
        return res.status(400).send('Invalid');
    }

    // Parse filename info
    const baseName: string = filename.split('.')[0];
    const parts = baseName.split('_');
    // Removing query params from filename if present in request param (express usually handles this, 
    // but client sends ?t=..., express :filename does NOT include query string. So this is safe.)

    let bookId: number | null = null;
    let chapterId: number | null = null;
    let segmentIndex: number | null = null;
    let voice = '';

    // Parse: {bookId}_{chapterId}_{voice}_{segmentIndex}.mp3
    // Voice can contain underscores (e.g. vbee-n_hn_male_xxx), so we extract
    // first part = bookId, last part = segmentIndex, middle = chapterId + voice
    if (parts.length >= 4) {
        bookId = parsePositiveInt(parts[0]);
        segmentIndex = parseNonNegativeInt(parts[parts.length - 1]);
        // Second part is chapterId, everything between part[1] and part[last-1] is voice
        chapterId = parsePositiveInt(parts[1]);
        voice = parts.slice(2, parts.length - 1).join('_');
    } else if (parts.length === 3) {
        bookId = parsePositiveInt(parts[0]);
        chapterId = parsePositiveInt(parts[1]);
        segmentIndex = parseNonNegativeInt(parts[2]);
        voice = 'vi-VN-Wavenet-B'; // Default legacy voice
    } else {
        return res.status(400).send('Invalid');
    }

    if (!bookId || !chapterId || segmentIndex === null || !isSafeVoice(voice)) {
        return res.status(400).send('Invalid');
    }

    const audioAccess = getAudioAccessClaims(req);
    if (!audioAccess) {
        return res.sendStatus(401);
    }

    if (audioAccess.bookId !== undefined && (audioAccess.bookId !== bookId || audioAccess.chapterId !== chapterId)) {
        return res.status(403).send('Forbidden');
    }

    const segment = await prisma.textSegment.findFirst({
        where: { chapterId, orderIndex: segmentIndex, chapter: { bookId, book: { userId: audioAccess.userId } } },
        select: { content: true, role: true, orderIndex: true },
    });
    if (!segment) {
        return res.status(404).send('Not found');
    }

    const metadataPath = resolveAudioMetadataPath(filename);
    if (!metadataPath) {
        return res.status(400).send('Invalid');
    }

    // Serve only if cache matches current segment content/voice.
    if (await isSegmentAudioCached(filePath, metadataPath, segment, voice)) {
        return res.sendFile(filePath);
    }

    console.log(`[Audio] ⚠️ Cache Miss: ${filename} (Voice: ${voice}). Generating on-demand...`);

    try {
        // 1. Generate requested file (Blocking)
        const generated = await generateSegment(bookId, chapterId, segmentIndex, voice);
        if (!generated) {
            return res.status(503).send('TTS provider unavailable or audio generation failed');
        }

        // 2. Lookahead for cheaper/non-Vbee providers only. Vbee bills per submitted
        // segment, so /audio cache misses must not fan out into extra credit usage.
        if (!voice.startsWith('vbee-')) {
            (async () => {
                console.log(`[Audio] 🔮 Triggering lookahead for segments ${segmentIndex + 1}..${segmentIndex + 3} with voice ${voice}`);
                await generateSegment(bookId, chapterId, segmentIndex + 1, voice);
                await generateSegment(bookId, chapterId, segmentIndex + 2, voice);
                await generateSegment(bookId, chapterId, segmentIndex + 3, voice);
            })();
        }

        // 3. Serve file
        return res.sendFile(filePath);
    } catch (error) {
        res.status(500).send('Gen Failed');
    }
});

export default router;

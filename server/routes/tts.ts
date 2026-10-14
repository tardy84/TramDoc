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
import { GrokTTSService } from '../services/grokTTS.js';
import { MINIMAX_NATURAL_PROFILE_ID, isSupportedGrokVoice, resolveTtsVoice, ResolvedTtsVoice } from '../services/ttsVoiceCatalog.js';
import { renderTtsText } from '../services/ttsTextRenderer.js';
import {
    isUsableMarks,
    estimateSentenceMarks,
    type SegmentMarks,
} from '../services/ttsAlignment.js';
import { trySynthesizeWithTiming, TIMING_CAPABLE_PROVIDERS } from '../services/ttsTiming.js';
import { probeDurationMs } from '../services/audioDuration.js';
import {
    cancelTtsBookJob,
    createTtsBookJob,
    getTtsBookJob,
    isTtsBookJobCancelled,
    updateTtsBookJob,
} from '../services/ttsBookJobs.js';

const router = Router();
const prisma = new PrismaClient();
const googleTTS = new GoogleTTSService();
const azureTTS = new AzureTTSService();
const minimaxTTS = new MiniMaxTTSService();
const geminiTTS = new GeminiTTSService();
const vbeeTTS = new VbeeTTSService();
const grokTTS = new GrokTTSService();

// Helper for generating a specific segment (Deduped + Safe)
const generatingFiles = new Set<string>();
const providerWarnings = new Set<string>();
const audioDir = path.resolve(process.cwd(), 'audio');
const AUDIO_TOKEN_TTL = '2h';
const TTS_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const TTS_RATE_LIMIT_MAX_REQUESTS = 500;
const TTS_GENERATION_MAX_ATTEMPTS = 2;
const TTS_GENERATION_RETRY_DELAY_MS = 750;
const TTS_GENERATING_FILE_WAIT_INTERVAL_MS = 500;
const TTS_GENERATING_FILE_WAIT_TIMEOUT_MS = 2 * 60 * 1000;
const VBEE_LOOKAHEAD_COUNT = 4;
const VBEE_SHORT_SEGMENT_MAX_CHARS = 140;
const VBEE_SHORT_RUN_MIN_SEGMENTS = 3;
const VBEE_SHORT_RUN_LOOKAHEAD_COUNT = 5;
const VBEE_SHORT_RUN_EARLY_WARMUP_COUNT = 3;
const GROK_TTS_CACHE_VERSION = 'grok-tts-voice-id-v2';
const ttsRequests = new Map<number, { count: number; resetAt: number }>();
type OfflineTtsQuality = 'low' | 'standard' | 'high';
const DEFAULT_OFFLINE_TTS_QUALITY: OfflineTtsQuality = 'standard';
const OFFLINE_TTS_BITRATES: Record<OfflineTtsQuality, number> = {
    low: 32000,
    standard: 64000,
    high: 128000,
};

interface AudioAccessClaims {
    userId: number;
    bookId?: number;
    chapterId?: number;
}

interface SegmentForAudioCache {
    id?: number;
    content: string;
    role: string;
    orderIndex: number;
    ttsHints?: string | null;
}

function isSafeVoice(voice: unknown): voice is string {
    return typeof voice === 'string' &&
        voice.length > 0 &&
        voice.length <= 160 &&
        /^[A-Za-z0-9._-]+$/.test(voice) &&
        !voice.includes('..');
}

function getVoiceValidationError(voice: unknown): string | null {
    if (!isSafeVoice(voice)) return 'Giọng đọc không hợp lệ';
    if (voice.startsWith('grok-') && !isSupportedGrokVoice(voice)) {
        return 'Grok chỉ hỗ trợ giọng Nam/Nữ đã cấu hình';
    }
    return null;
}

function isSupportedVoiceRequest(voice: unknown): voice is string {
    return getVoiceValidationError(voice) === null;
}

function buildAudioFileName(bookId: number, chapterId: number, voice: string, segmentIndex: number): string {
    return `${bookId}_${chapterId}_${voice}_${segmentIndex}.mp3`;
}

/**
 * Build a per-segment audio filename using the safe request voice from the
 * client. The per-segment cacheVoice is resolved by `resolveTtsVoice()` so
 * that multi-voice profiles (e.g. `minimax-profile-vietnamese-natural-v1`)
 * produce distinct filenames for narrator vs. female dialogue segments
 * within the same chapter.
 */
function buildSegmentAudioIdentity(
    requestVoice: string,
    segment: SegmentForAudioCache,
    quality?: OfflineTtsQuality,
    expressive = false
) {
    const resolved = resolveTtsVoice(requestVoice, segment.role);
    const cacheVoice = getQualityCacheVoice(resolved, quality);
    const rendered = renderTtsText({
        content: segment.content,
        ttsHints: segment.ttsHints,
        provider: resolved.provider,
        expressive,
    });
    const cacheMaterial = JSON.stringify({
        segmentId: segment.id ?? null,
        provider: resolved.provider,
        providerCacheVersion: resolved.provider === 'grok' ? GROK_TTS_CACHE_VERSION : null,
        providerVoiceId: resolved.provider === 'grok' ? resolved.providerVoiceId : null,
        cacheVoice,
        expressive,
        rendererVersion: rendered.rendererVersion,
        text: rendered.text,
    });
    const cacheHash = crypto.createHash('sha256').update(cacheMaterial).digest('hex').slice(0, 16);
    return {
        resolved,
        cacheVoice,
        rendered,
        fileCacheVoice: `${cacheVoice}-${expressive ? 'ex1' : 'ex0'}-h-${cacheHash}`,
    };
}

function buildSegmentAudioFileName(
    bookId: number,
    chapterId: number,
    requestVoice: string,
    segment: SegmentForAudioCache,
    quality?: OfflineTtsQuality,
    expressive = false
): string {
    const identity = buildSegmentAudioIdentity(requestVoice, segment, quality, expressive);
    return buildAudioFileName(bookId, chapterId, identity.fileCacheVoice, segment.orderIndex);
}

function selectTtsService(provider: ResolvedTtsVoice['provider']) {
    switch (provider) {
        case 'vbee':
            return vbeeTTS;
        case 'minimax':
            return minimaxTTS;
        case 'grok':
            return grokTTS;
        case 'azure':
            return azureTTS;
        case 'gemini':
            return geminiTTS;
        case 'google':
        default:
            return googleTTS;
    }
}

function providerSupportsOfflineBitrate(provider: ResolvedTtsVoice['provider']): boolean {
    return provider === 'minimax';
}

function getQualityCacheVoice(resolved: ResolvedTtsVoice, quality?: OfflineTtsQuality): string {
    if (!quality || !providerSupportsOfflineBitrate(resolved.provider)) return resolved.cacheVoice;
    return `${resolved.cacheVoice}-q-${quality}`;
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

async function writeAudioMetadata(
    metadataPath: string,
    segment: SegmentForAudioCache,
    cacheVoice: string,
    requestVoice?: string,
    providerVoiceId?: string,
    quality?: OfflineTtsQuality,
    expressive = false,
    receivedMarks?: { marks: SegmentMarks | null; provider: string } | null
): Promise<void> {
    const existing = await readAudioMetadata(metadataPath);
    const marks = receivedMarks?.marks ?? existing?.marks ?? null;
    await fs.writeFile(metadataPath, JSON.stringify({
        contentHash: getSegmentContentHash(segment, cacheVoice),
        orderIndex: segment.orderIndex,
        role: segment.role,
        // `voice` is kept for backward-compat with existing cache files and
        // any external inspectors. For multi-voice profiles, `voice` is the
        // per-segment cacheVoice. `requestVoice` is the safe ID the client
        // originally selected and is what we need to drive regeneration.
        voice: cacheVoice,
        requestVoice: requestVoice ?? cacheVoice,
        providerVoiceId: providerVoiceId ?? null,
        quality: quality ?? null,
        expressive,
        // Sentence timing for reader highlighting. `marksSource` tells the client
        // whether the timeline is exact (provider) or derived (estimated).
        marks,
        marksSource: marks?.source ?? receivedMarks?.provider ?? null,
        durationMs: marks?.durationMs ?? existing?.durationMs ?? null,
        hintsHash: getSegmentHintsHash(segment),
        generatedAt: new Date().toISOString(),
    }, null, 2));
}

function getSegmentHintsHash(segment: Pick<SegmentForAudioCache, 'ttsHints'>): string | null {
    const raw = (segment as { ttsHints?: string | null }).ttsHints;
    if (raw === undefined || raw === null || raw === '') return null;
    return crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 16);
}

interface StoredAudioMetadata {
    marks?: SegmentMarks | null;
    marksSource?: string | null;
    durationMs?: number | null;
    hintsHash?: string | null;
    contentHash?: string;
}

async function readAudioMetadata(metadataPath: string): Promise<StoredAudioMetadata | null> {
    try {
        const raw = await fs.readFile(metadataPath, 'utf8');
        const parsed = JSON.parse(raw) as StoredAudioMetadata;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Marks for one cached segment: reuse stored marks, otherwise build an estimated
 * timeline from the real audio duration and persist it so offline playback and
 * later requests get highlighting without re-probing.
 */
async function ensureSegmentMarks(
    filePath: string,
    metadataPath: string,
    segment: SegmentForAudioCache,
    content: string,
    cacheVoice: string
): Promise<{ marks: SegmentMarks | null; source: string | null; durationMs: number | null }> {
    const existing = await readAudioMetadata(metadataPath);
    if (existing && isUsableMarks(existing.marks ?? undefined)) {
        return {
            marks: existing.marks as SegmentMarks,
            source: existing.marksSource ?? (existing.marks as SegmentMarks).source,
            durationMs: existing.durationMs ?? (existing.marks as SegmentMarks).durationMs,
        };
    }

    const durationMs = await probeDurationMs(filePath);
    if (!durationMs) return { marks: null, source: null, durationMs: null };

    const marks = estimateSentenceMarks(content, durationMs);
    await writeAudioMetadata(metadataPath, segment, cacheVoice, undefined, undefined, undefined, false, {
        marks,
        provider: marks.source,
    });
    return { marks, source: marks.source, durationMs };
}

function parseExpressiveFromFileVoice(voice: string): boolean {
    return /-ex1-h-[a-f0-9]{16}$/.test(voice);
}

function getRequestVoiceFallbackFromFileVoice(voice: string): string {
    const withoutRendererSuffix = voice.replace(/-ex[01]-h-[a-f0-9]{16}$/, '');
    if (withoutRendererSuffix.startsWith(`${MINIMAX_NATURAL_PROFILE_ID}-`)) {
        return MINIMAX_NATURAL_PROFILE_ID;
    }
    return withoutRendererSuffix;
}

async function readAudioMetadataRequest(metadataPath: string, fallbackVoice: string): Promise<{ requestVoice: string; quality?: OfflineTtsQuality; expressive: boolean }> {
    const fallbackRequestVoice = getRequestVoiceFallbackFromFileVoice(fallbackVoice);
    try {
        const raw = await fs.readFile(metadataPath, 'utf8');
        const metadata = JSON.parse(raw) as { requestVoice?: unknown; quality?: unknown; expressive?: unknown };
        const requestVoice = typeof metadata.requestVoice === 'string' && isSafeVoice(metadata.requestVoice)
            ? metadata.requestVoice
            : fallbackRequestVoice;
        return {
            requestVoice,
            quality: parseOfflineTtsQuality(metadata.quality),
            expressive: parseExpressiveFlag(metadata.expressive) || parseExpressiveFromFileVoice(fallbackVoice),
        };
    } catch {
        // fall through
    }
    return { requestVoice: fallbackRequestVoice, expressive: parseExpressiveFromFileVoice(fallbackVoice) };
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

function parseOfflineTtsQuality(value: unknown): OfflineTtsQuality | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return value === 'low' || value === 'standard' || value === 'high' ? value : undefined;
}

function parseExpressiveFlag(value: unknown): boolean {
    return value === true || value === 'true' || value === '1';
}

function hasInvalidOfflineTtsQuality(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '' && parseOfflineTtsQuality(value) === undefined;
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

function isSpeakableSegmentContent(content: string): boolean {
    const normalized = content
        .replace(/[\s\u00a0]+/g, '')
        .replace(/[*＊✱✲✳✴✻✼✽·•●○◆◇■□_—–~….-]+/g, '');
    return /[\p{L}\p{N}]/u.test(normalized);
}


async function getChapterWithSegmentsForUser(bookId: number, chapterId: number, userId: number) {
    return prisma.chapter.findFirst({
        where: { id: chapterId, bookId, book: { userId } },
        include: { segments: { orderBy: { orderIndex: 'asc' } } },
    });
}

async function getBookChaptersWithSegmentsForUser(bookId: number, userId: number) {
    return prisma.chapter.findMany({
        where: { bookId, book: { userId } },
        orderBy: { orderIndex: 'asc' },
        include: { segments: { orderBy: { orderIndex: 'asc' } } },
    });
}

async function isSegmentCachedForVoice(bookId: number, chapterId: number, voice: string, segment: SegmentForAudioCache, quality?: OfflineTtsQuality, expressive = false): Promise<boolean> {
    const fileName = buildSegmentAudioFileName(bookId, chapterId, voice, segment, quality, expressive);
    const filePath = resolveAudioPath(fileName);
    const metadataPath = resolveAudioMetadataPath(fileName);
    if (!filePath || !metadataPath) return false;
    const identity = buildSegmentAudioIdentity(voice, segment, quality, expressive);
    return isSegmentAudioCached(filePath, metadataPath, segment, identity.fileCacheVoice);
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

async function generateSegmentsInBackground(bookId: number, chapterId: number, voice: string, indexes: number[], concurrency: number, delayBetweenBatches: number, quality?: OfflineTtsQuality, expressive = false) {
    (async () => {
        for (let i = 0; i < indexes.length; i += concurrency) {
            const batch = indexes.slice(i, i + concurrency);
            await Promise.all(batch.map(index => generateSegment(bookId, chapterId, index, voice, quality, expressive)));

            if (delayBetweenBatches > 0) {
                await delay(delayBetweenBatches);
            }
        }
    })();
}

function getBookJobDelayMs(voice: string): number {
    if (voice.startsWith('vbee-')) return 750;
    if (voice.startsWith('minimax-')) return 250;
    if (voice.startsWith('grok-')) return 250;
    return 0;
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
    if (voice.startsWith('grok-')) {
        if (!process.env.XAI_API_KEY) return 'Grok TTS is not configured';
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

async function generateSegment(bookId: number, chapterId: number, segmentIndex: number, voice: string, quality?: OfflineTtsQuality, expressive = false): Promise<boolean> {
    if (getVoiceValidationError(voice) || !Number.isInteger(bookId) || !Number.isInteger(chapterId) || !Number.isInteger(segmentIndex) || segmentIndex < 0) {
        return false;
    }

    const segment = await prisma.textSegment.findFirst({
        where: { chapterId, orderIndex: segmentIndex, chapter: { bookId } },
        select: { id: true, content: true, role: true, orderIndex: true, ttsHints: true },
    });

    if (!segment) {
        return false;
    }

    if (!isSpeakableSegmentContent(segment.content)) {
        console.log(`[Audio] ⏭️ Skipping non-speech segment ${segmentIndex} for book ${bookId}, chapter ${chapterId}`);
        return true;
    }

    // Resolve the per-segment provider voice. This is what makes multi-voice
    // profiles work: the same `voice` request can map to a different raw
    // MiniMax voice_id and a different cache filename per segment role.
    const identity = buildSegmentAudioIdentity(voice, segment, quality, expressive);
    const { resolved, rendered, fileCacheVoice } = identity;
    const fileName = buildAudioFileName(bookId, chapterId, fileCacheVoice, segmentIndex);
    const filePath = resolveAudioPath(fileName);
    const metadataPath = resolveAudioMetadataPath(fileName);
    if (!filePath || !metadataPath) return false;

    // 1. Check if already exists for the current segment content/cacheVoice
    if (await isSegmentAudioCached(filePath, metadataPath, segment, fileCacheVoice)) {
        return true; // Exists
    }

    // 2. Check if currently generating (Dedup)
    if (generatingFiles.has(fileName)) {
        console.log(`[Audio] ⏳ File ${fileName} is already being generated. Waiting...`);
        const maxAttempts = Math.ceil(TTS_GENERATING_FILE_WAIT_TIMEOUT_MS / TTS_GENERATING_FILE_WAIT_INTERVAL_MS);
        let attempts = 0;

        while (generatingFiles.has(fileName) && attempts < maxAttempts) {
            await delay(TTS_GENERATING_FILE_WAIT_INTERVAL_MS);
            attempts++;
        }

        // After waiting, check if the generated file matches the current segment content
        if (await isSegmentAudioCached(filePath, metadataPath, segment, fileCacheVoice)) {
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
        const ttsService = selectTtsService(resolved.provider);

        let buffer: Buffer | null = null;
        let receivedMarks: { marks: SegmentMarks | null; provider: string } | null = null;
        const synthOptions = quality && providerSupportsOfflineBitrate(resolved.provider)
            ? { bitrate: OFFLINE_TTS_BITRATES[quality] }
            : undefined;
        const maxAttempts = resolved.provider === 'vbee' ? 1 : TTS_GENERATION_MAX_ATTEMPTS;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // For MiniMax, pass the raw `voice_id`; for other providers
                // the safe request voice doubles as the provider voice ID.
                const providerVoiceArg = resolved.provider === 'minimax'
                    ? resolved.providerVoiceId
                    : resolved.providerVoiceId;

                // Providers with a native timing path (google marks, minimax subtitle)
                // return audio AND sentence marks from this single call — no extra synthesis.
                if (TIMING_CAPABLE_PROVIDERS.has(resolved.provider)) {
                    const timed = await trySynthesizeWithTiming(
                        resolved.provider,
                        rendered.text,
                        segment.role as any,
                        providerVoiceArg,
                        synthOptions
                    );
                    if (timed) {
                        buffer = timed.buffer;
                        receivedMarks = { marks: timed.marks, provider: timed.marks ? 'provider' : 'pending' };
                        break;
                    }
                }

                buffer = await ttsService.synthesize(
                    rendered.text,
                    segment.role as any,
                    providerVoiceArg,
                    synthOptions
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

        // Attach sentence timing: provider marks when they line up with the text we
        // render, otherwise an estimated timeline over the real audio duration.
        const spokenMatchesContent = rendered.text.trim() === segment.content.trim();
        const providerMarks = spokenMatchesContent && isUsableMarks(receivedMarks?.marks ?? undefined)
            ? (receivedMarks!.marks as SegmentMarks)
            : null;
        const probedDurationMs = await probeDurationMs(filePath);
        let finalMarks: { marks: SegmentMarks | null; provider: string } | null = null;
        if (providerMarks && probedDurationMs) {
            const last = providerMarks.sentences[providerMarks.sentences.length - 1];
            if (last && providerMarks.durationMs !== probedDurationMs) {
                last.endMs = Math.max(last.startMs + 1, probedDurationMs);
                providerMarks.durationMs = probedDurationMs;
            }
            finalMarks = { marks: providerMarks, provider: providerMarks.source };
        } else if (probedDurationMs) {
            finalMarks = {
                marks: estimateSentenceMarks(segment.content, probedDurationMs),
                provider: 'estimated',
            };
        }

        await writeAudioMetadata(
            metadataPath,
            segment,
            fileCacheVoice,
            resolved.requestVoice,
            resolved.providerVoiceId,
            quality,
            expressive,
            finalMarks
        );
        console.log(`[Audio] ✅ Generated: ${fileName}${finalMarks ? ` (marks: ${finalMarks.provider})` : ''}`);
        return true;
    } catch (error) {
        console.error(`[Audio] ❌ Failed to generate ${fileName}: ${getSafeErrorMessage(error)}`);
        return false;
    } finally {
        generatingFiles.delete(fileName);
    }
}


async function runBookTtsJob(jobId: string): Promise<void> {
    const job = getTtsBookJob(jobId);
    if (!job) return;

    updateTtsBookJob(jobId, { status: 'running' });
    const chapters = await getBookChaptersWithSegmentsForUser(job.bookId, job.userId);
    const delayMs = getBookJobDelayMs(job.voice);
    const expressive = job.expressive === true;

    for (const chapter of chapters) {
        for (const segment of chapter.segments) {
            if (isTtsBookJobCancelled(jobId)) return;
            if (!isSpeakableSegmentContent(segment.content)) continue;

            updateTtsBookJob(jobId, {
                currentChapterId: chapter.id,
                currentChapterTitle: chapter.title,
                currentSegmentIndex: segment.orderIndex,
            });

            const cached = job.mode === 'missing'
                ? await isSegmentCachedForVoice(job.bookId, chapter.id, job.voice, segment, job.quality, expressive)
                : false;

            if (cached) {
                const current = getTtsBookJob(jobId);
                if (!current) return;
                updateTtsBookJob(jobId, { cachedSegments: current.cachedSegments + 1 });
                continue;
            }

            if (job.mode === 'force') {
                await deleteAudioCache(buildSegmentAudioFileName(job.bookId, chapter.id, job.voice, segment, job.quality, expressive));
            }

            const generated = await generateSegment(job.bookId, chapter.id, segment.orderIndex, job.voice, job.quality, expressive);
            const current = getTtsBookJob(jobId);
            if (!current) return;
            if (generated) {
                updateTtsBookJob(jobId, { generatedSegments: current.generatedSegments + 1 });
            } else {
                updateTtsBookJob(jobId, { failedSegments: current.failedSegments + 1 });
            }

            if (delayMs > 0) await delay(delayMs);
        }
    }

    const finalJob = getTtsBookJob(jobId);
    if (finalJob?.status !== 'cancelled') {
        if (finalJob && finalJob.failedSegments > 0) {
            updateTtsBookJob(jobId, {
                status: 'failed',
                error: `Không tạo được ${finalJob.failedSegments} đoạn audio.`,
            });
        } else {
            updateTtsBookJob(jobId, { status: 'completed', completedAt: new Date().toISOString() });
        }
    }
}

router.get('/books/:bookId/tts/status', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const parsedBookId = parsePositiveInt(req.params.bookId);
        if (!parsedBookId) return res.status(400).json({ error: 'Book ID không hợp lệ' });

        const voice = req.query.voice;
        if (!isSupportedVoiceRequest(voice)) {
            return res.status(400).json({ error: getVoiceValidationError(voice) || 'Giọng đọc không hợp lệ' });
        }
        if (hasInvalidOfflineTtsQuality(req.query.quality)) return res.status(400).json({ error: 'Chất lượng offline không hợp lệ' });
        const quality = parseOfflineTtsQuality(req.query.quality);
        const expressive = parseExpressiveFlag(req.query.expressive);

        const chapters = await getBookChaptersWithSegmentsForUser(parsedBookId, req.user.id);
        if (chapters.length === 0) {
            const book = await prisma.book.findFirst({
                where: { id: parsedBookId, userId: req.user.id },
                select: { id: true },
            });
            if (!book) return res.status(404).json({ error: 'Book not found' });
        }

        const totals = { total: 0, cached: 0, stale: 0, missing: 0, skipped: 0 };
        const chapterStatuses = [];

        for (const chapter of chapters) {
            const chapterStatus = {
                chapterId: chapter.id,
                title: chapter.title,
                total: 0,
                cached: 0,
                stale: 0,
                missing: 0,
                skipped: 0,
            };

            for (const segment of chapter.segments) {
                if (!isSpeakableSegmentContent(segment.content)) {
                    chapterStatus.skipped++;
                    totals.skipped++;
                    continue;
                }

                chapterStatus.total++;
                totals.total++;

                const fileName = buildSegmentAudioFileName(parsedBookId, chapter.id, voice, segment, quality, expressive);
                const filePath = resolveAudioPath(fileName);
                const metadataPath = resolveAudioMetadataPath(fileName);
                if (!filePath || !metadataPath) return res.status(400).json({ error: 'Tên file audio không hợp lệ' });

                const identity = buildSegmentAudioIdentity(voice, segment, quality, expressive);
                if (await isSegmentAudioCached(filePath, metadataPath, segment, identity.fileCacheVoice)) {
                    chapterStatus.cached++;
                    totals.cached++;
                } else if (await doesFileExist(filePath)) {
                    chapterStatus.stale++;
                    totals.stale++;
                } else {
                    chapterStatus.missing++;
                    totals.missing++;
                }
            }

            chapterStatuses.push(chapterStatus);
        }

        return res.json({ ...totals, chapters: chapterStatuses });
    } catch (error: any) {
        console.error('Error reading book TTS status:', getSafeErrorMessage(error));
        return res.status(500).json({ error: error.message });
    }
});

router.post('/books/:bookId/tts/jobs', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const parsedBookId = parsePositiveInt(req.params.bookId);
        if (!parsedBookId) return res.status(400).json({ error: 'Book ID không hợp lệ' });

        const { voice } = req.body;
        if (!isSupportedVoiceRequest(voice)) {
            return res.status(400).json({ error: getVoiceValidationError(voice) || 'Giọng đọc không hợp lệ' });
        }
        if (hasInvalidOfflineTtsQuality(req.body.quality)) return res.status(400).json({ error: 'Chất lượng offline không hợp lệ' });
        const quality = parseOfflineTtsQuality(req.body.quality) ?? DEFAULT_OFFLINE_TTS_QUALITY;
        const expressive = parseExpressiveFlag(req.body.expressive);

        if ((voice.startsWith('vbee-') || voice.startsWith('minimax-') || voice.startsWith('grok-')) && req.body.confirmExpensiveProvider !== true) {
            return res.status(400).json({
                error: 'Tạo toàn bộ sách bằng Vbee/MiniMax/Grok có thể chậm và tốn quota. Vui lòng xác nhận trước khi chạy.'
            });
        }

        const mode = req.body.mode === 'force' ? 'force' : 'missing';
        const book = await prisma.book.findFirst({
            where: { id: parsedBookId, userId: req.user.id },
            select: { id: true },
        });
        if (!book) return res.status(404).json({ error: 'Book not found' });

        const chapters = await getBookChaptersWithSegmentsForUser(parsedBookId, req.user.id);
        const totalSegments = chapters.reduce(
            (sum, chapter) => sum + chapter.segments.filter(segment => isSpeakableSegmentContent(segment.content)).length,
            0
        );
        const skippedSegments = chapters.reduce(
            (sum, chapter) => sum + chapter.segments.filter(segment => !isSpeakableSegmentContent(segment.content)).length,
            0
        );

        const job = createTtsBookJob({
            jobId: crypto.randomUUID(),
            userId: req.user.id,
            bookId: parsedBookId,
            voice,
            mode,
            quality,
            expressive,
            totalSegments,
            cachedSegments: 0,
            generatedSegments: 0,
            failedSegments: 0,
            skippedSegments,
        });

        runBookTtsJob(job.jobId).catch(error => {
            console.error(`[TTS Book Job] ${job.jobId} failed`, error);
            updateTtsBookJob(job.jobId, { status: 'failed', error: getSafeErrorMessage(error) });
        });

        return res.status(202).json(job);
    } catch (error: any) {
        console.error('Error starting book TTS job:', getSafeErrorMessage(error));
        return res.status(500).json({ error: error.message });
    }
});

router.get('/books/:bookId/tts/jobs/:jobId', authenticateJWT, async (req: AuthRequest, res: Response) => {
    const parsedBookId = parsePositiveInt(req.params.bookId);
    if (!parsedBookId) return res.status(400).json({ error: 'Book ID không hợp lệ' });
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';

    const job = getTtsBookJob(jobId);
    if (!job || job.bookId !== parsedBookId) return res.status(404).json({ error: 'Job not found' });
    if (job.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    return res.json(job);
});

router.post('/books/:bookId/tts/jobs/:jobId/cancel', authenticateJWT, async (req: AuthRequest, res: Response) => {
    const parsedBookId = parsePositiveInt(req.params.bookId);
    if (!parsedBookId) return res.status(400).json({ error: 'Book ID không hợp lệ' });
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';

    const job = getTtsBookJob(jobId);
    if (!job || job.bookId !== parsedBookId) return res.status(404).json({ error: 'Job not found' });
    if (job.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const cancelled = cancelTtsBookJob(job.jobId);
    return res.json(cancelled ?? job);
});

// Inspect TTS cache health for a chapter/voice
router.get('/books/:bookId/chapters/:chapterId/tts/status', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const parsedBookId = parsePositiveInt(req.params.bookId);
        const parsedChapterId = parsePositiveInt(req.params.chapterId);
        if (!parsedBookId || !parsedChapterId) {
            return res.status(400).json({ error: 'Book hoặc chapter ID không hợp lệ' });
        }

        const voice = req.query.voice;
        if (!isSupportedVoiceRequest(voice)) {
            return res.status(400).json({ error: getVoiceValidationError(voice) || 'Giọng đọc không hợp lệ' });
        }
        const expressive = parseExpressiveFlag(req.query.expressive);

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
        let hintsStale = 0;

        for (let i = 0; i < chapter.segments.length; i++) {
            const segment = chapter.segments[i];
            const fileName = buildSegmentAudioFileName(parsedBookId, parsedChapterId, voice, segment, undefined, expressive);
            const filePath = resolveAudioPath(fileName);
            const metadataPath = resolveAudioMetadataPath(fileName);
            if (!filePath || !metadataPath) return res.status(400).json({ error: 'Tên file audio không hợp lệ' });

            const identity = buildSegmentAudioIdentity(voice, segment, undefined, expressive);
            if (await isSegmentAudioCached(filePath, metadataPath, segment, identity.fileCacheVoice)) {
                cached++;
                // Audio is reused, but the prosody hints it was generated with may have
                // changed (tone/pace/pitch). Report it instead of silently playing stale audio.
                const metadata = await readAudioMetadata(metadataPath);
                const currentHintsHash = getSegmentHintsHash(segment);
                if (metadata && currentHintsHash && metadata.hintsHash && metadata.hintsHash !== currentHintsHash) {
                    hintsStale++;
                }
            } else if (await doesFileExist(filePath)) {
                stale++;
            } else {
                missing++;
            }
        }

        return res.json({ total: chapter.segments.length, cached, stale, missing, hintsStale });
    } catch (error: any) {
        console.error('Error reading TTS status:', getSafeErrorMessage(error));
        return res.status(500).json({ error: error.message });
    }
});

// Sentence timing marks for reader highlighting (chapter × voice).
// Providers with native timing (google marks, minimax subtitle) store exact marks
// at generation time; everything else gets an estimated timeline from the real
// audio duration. Marks are cached in the audio sidecar so offline playback works.
router.get('/books/:bookId/chapters/:chapterId/tts/marks', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const parsedBookId = parsePositiveInt(req.params.bookId);
        const parsedChapterId = parsePositiveInt(req.params.chapterId);
        if (!parsedBookId || !parsedChapterId) {
            return res.status(400).json({ error: 'Book hoặc chapter ID không hợp lệ' });
        }

        const voice = req.query.voice;
        if (!isSupportedVoiceRequest(voice)) {
            return res.status(400).json({ error: getVoiceValidationError(voice) || 'Giọng đọc không hợp lệ' });
        }
        if (hasInvalidOfflineTtsQuality(req.query.quality)) return res.status(400).json({ error: 'Chất lượng offline không hợp lệ' });
        const quality = parseOfflineTtsQuality(req.query.quality);
        const expressive = parseExpressiveFlag(req.query.expressive);

        const chapter = await prisma.chapter.findFirst({
            where: { id: parsedChapterId, bookId: parsedBookId, book: { userId: req.user.id } },
            include: { segments: { orderBy: { orderIndex: 'asc' } } },
        });
        if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

        const entries: Array<{
            orderIndex: number;
            segmentId: number;
            provider: string;
            timingCapable: boolean;
            status: 'ready' | 'missing' | 'unknown';
            source: string | null;
            durationMs: number | null;
            /** Audio file backing these marks (also the offline cache key). */
            audioFile: string;
            marks: SegmentMarks | null;
        }> = [];

        for (const segment of chapter.segments) {
            if (!isSpeakableSegmentContent(segment.content)) continue;
            const identity = buildSegmentAudioIdentity(voice, segment, quality, expressive);
            const fileName = buildAudioFileName(parsedBookId, parsedChapterId, identity.fileCacheVoice, segment.orderIndex);
            const filePath = resolveAudioPath(fileName);
            const metadataPath = resolveAudioMetadataPath(fileName);
            const provider = identity.resolved.provider;
            if (!filePath || !metadataPath) continue;

            if (!(await doesFileExist(filePath))) {
                entries.push({
                    orderIndex: segment.orderIndex,
                    segmentId: segment.id,
                    provider,
                    timingCapable: TIMING_CAPABLE_PROVIDERS.has(provider),
                    status: 'missing',
                    source: null,
                    durationMs: null,
                    audioFile: fileName,
                    marks: null,
                });
                continue;
            }

            const { marks, source, durationMs } = await ensureSegmentMarks(
                filePath,
                metadataPath,
                segment,
                segment.content,
                identity.fileCacheVoice
            );

            entries.push({
                orderIndex: segment.orderIndex,
                segmentId: segment.id,
                provider,
                timingCapable: TIMING_CAPABLE_PROVIDERS.has(provider),
                status: marks ? 'ready' : 'unknown',
                source,
                durationMs,
                audioFile: fileName,
                marks,
            });
        }

        return res.json({ chapterId: parsedChapterId, voice, quality: quality ?? null, expressive, segments: entries });
    } catch (error: any) {
        console.error('Error building TTS marks:', getSafeErrorMessage(error));
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
        if (!isSupportedVoiceRequest(voice)) {
            return res.status(400).json({ error: getVoiceValidationError(voice) || 'Giọng đọc không hợp lệ' });
        }
        const expressive = parseExpressiveFlag(req.body.expressive);

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

            const fileName = buildSegmentAudioFileName(parsedBookId, parsedChapterId, voice, chapter.segments[segmentIndex], undefined, expressive);
            await deleteAudioCache(fileName);
            const generated = await generateSegment(parsedBookId, parsedChapterId, segmentIndex, voice, undefined, expressive);
            return res.json({ scope: 'segment', segmentIndex, generated });
        }

        if (voice.startsWith('vbee-')) {
            return res.status(400).json({
                error: 'Không hỗ trợ tạo lại cả chapter bằng Vbee để tránh tốn credit. Vui lòng tạo lại từng đoạn nếu cần.'
            });
        }

        for (let i = 0; i < chapter.segments.length; i++) {
            const fileName = buildSegmentAudioFileName(parsedBookId, parsedChapterId, voice, chapter.segments[i], undefined, expressive);
            await deleteAudioCache(fileName);
        }

        const startIndex = getStartSegmentIndex(req.body.startSegmentIndex, chapter.segments.length);
        if (startIndex === null) {
            return res.status(400).json({ error: 'Start segment index không hợp lệ' });
        }

        const preloaded: number[] = [];
        if (await generateSegment(parsedBookId, parsedChapterId, startIndex, voice, undefined, expressive)) {
            preloaded.push(startIndex);
        }

        const CONCURRENCY = voice.startsWith('vbee-') ? 2 : 5;
        const DELAY_BETWEEN_BATCHES = voice.startsWith('vbee-') ? 500 : 0;
        const backgroundIndexes = Array.from({ length: chapter.segments.length }, (_, index) => index)
            .filter(index => index !== startIndex);
        generateSegmentsInBackground(parsedBookId, parsedChapterId, voice, backgroundIndexes, CONCURRENCY, DELAY_BETWEEN_BATCHES, undefined, expressive);

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
        if (!isSupportedVoiceRequest(voice)) {
            return res.status(400).json({ error: getVoiceValidationError(voice) || 'Giọng đọc không hợp lệ' });
        }
        if (hasInvalidOfflineTtsQuality(req.body.quality)) {
            return res.status(400).json({ error: 'Chất lượng offline không hợp lệ' });
        }
        const quality = parseOfflineTtsQuality(req.body.quality);
        const expressive = parseExpressiveFlag(req.body.expressive);

        const timestamp = Date.now();
        const audioToken = createAudioToken(req.user.id, parsedBookId, parsedChapterId);
        const audioFiles = chapter.segments.map((segment) => {
            if (!isSpeakableSegmentContent(segment.content)) {
                return '';
            }

            const fileName = buildSegmentAudioFileName(parsedBookId, parsedChapterId, voice, segment, quality, expressive);
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
        if (!isSpeakableSegmentContent(currentSegment.content)) {
            const lookaheadIndexes = getLookaheadSegmentIndexes(startSegmentIndex, chapter.segments.length, voice.startsWith('vbee-') ? getVbeeLookaheadCount(chapter.segments, startSegmentIndex) : 12);
            generateSegmentsInBackground(parsedBookId, parsedChapterId, voice, lookaheadIndexes, voice.startsWith('vbee-') ? 1 : 5, voice.startsWith('vbee-') ? 500 : 0, quality, expressive);
            console.log(`[TTS] ⏭️ Start segment ${startSegmentIndex} is non-speech; returning URLs for client-side skip.`);
            return res.json({ audioFiles });
        }

        const currentFileName = buildSegmentAudioFileName(parsedBookId, parsedChapterId, voice, currentSegment, quality, expressive);
        const currentFilePath = resolveAudioPath(currentFileName);
        const currentMetadataPath = resolveAudioMetadataPath(currentFileName);
        if (!currentFilePath || !currentMetadataPath) {
            return res.status(400).json({ error: 'Tên file audio không hợp lệ' });
        }

        const currentIdentity = buildSegmentAudioIdentity(voice, currentSegment, quality, expressive);
        const currentCached = await isSegmentAudioCached(currentFilePath, currentMetadataPath, currentSegment, currentIdentity.fileCacheVoice);
        if (currentCached) {
            if (voice.startsWith('vbee-')) {
                const lookaheadIndexes = getLookaheadSegmentIndexes(startSegmentIndex, chapter.segments.length, getVbeeLookaheadCount(chapter.segments, startSegmentIndex));
                generateSegmentsInBackground(parsedBookId, parsedChapterId, voice, lookaheadIndexes, 1, 500, quality, expressive);
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
            generateSegmentsInBackground(parsedBookId, parsedChapterId, voice, earlyWarmupIndexes, 1, 250, quality, expressive);
        }

        console.log(`[TTS] Generating audio for book ${parsedBookId}, chapter ${parsedChapterId}, segment ${startSegmentIndex} with voice ${voice}`);
        const generated = await generateSegment(parsedBookId, parsedChapterId, startSegmentIndex, voice, quality, expressive);
        if (!generated) {
            return res.status(503).json({ error: 'Không tạo được audio cho đoạn hiện tại. Kiểm tra provider/quota rồi thử lại.' });
        }

        // 3. Background lookahead near the current reading position.
        const CONCURRENCY = voice.startsWith('vbee-') ? 1 : 5;
        const DELAY_BETWEEN_BATCHES = voice.startsWith('vbee-') ? 500 : 0;
        const lookaheadIndexes = getLookaheadSegmentIndexes(startSegmentIndex, chapter.segments.length, vbeeLookaheadCount)
            .filter(index => !earlyWarmupIndexes.includes(index));
        generateSegmentsInBackground(parsedBookId, parsedChapterId, voice, lookaheadIndexes, CONCURRENCY, DELAY_BETWEEN_BATCHES, quality, expressive);

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
        select: { id: true, content: true, role: true, orderIndex: true, ttsHints: true },
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

    // For regeneration we need the safe *request* voice the client originally
    // selected (e.g. a profile id). It is stored in metadata for multi-voice
    // profiles where `voice` parsed from the filename is a per-segment
    // cacheVoice and cannot be re-resolved on its own.
    const metadataRequest = await readAudioMetadataRequest(metadataPath, voice);
    const { requestVoice } = metadataRequest;

    console.log(`[Audio] ⚠️ Cache Miss: ${filename} (Voice: ${voice}). Generating on-demand...`);

    try {
        // 1. Generate requested file (Blocking)
        const generated = await generateSegment(bookId, chapterId, segmentIndex, requestVoice, metadataRequest.quality, metadataRequest.expressive);
        if (!generated) {
            return res.status(503).send('TTS provider unavailable or audio generation failed');
        }

        // 2. Lookahead for cheaper/non-Vbee providers only. Vbee bills per submitted
        // segment, so /audio cache misses must not fan out into extra credit usage.
        // Use the original request voice (profile/single voice), not the parsed
        // per-segment cacheVoice from the filename.
        if (!requestVoice.startsWith('vbee-')) {
            (async () => {
                console.log(`[Audio] 🔮 Triggering lookahead for segments ${segmentIndex + 1}..${segmentIndex + 3} with voice ${requestVoice}`);
                await generateSegment(bookId, chapterId, segmentIndex + 1, requestVoice, metadataRequest.quality, metadataRequest.expressive);
                await generateSegment(bookId, chapterId, segmentIndex + 2, requestVoice, metadataRequest.quality, metadataRequest.expressive);
                await generateSegment(bookId, chapterId, segmentIndex + 3, requestVoice, metadataRequest.quality, metadataRequest.expressive);
            })();
        }

        // 3. Serve file
        return res.sendFile(filePath);
    } catch (error) {
        res.status(500).send('Gen Failed');
    }
});

export default router;

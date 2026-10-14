/**
 * Provider timing paths — get sentence/word marks from providers we already use,
 * without adding any new vendor SDK.
 *
 *   google  : one synthesis call with SSML <mark> tags + enableTimePointing
 *   minimax : one synthesis call with subtitle_enable, subtitle file fetched and parsed
 *
 * Both return `null` when the provider does not give usable timing, and the caller
 * then falls back to the plain `synthesize()` path plus estimated marks
 * (see `ttsAlignment.ts`). Audio is never lost: a successful synthesis always
 * returns the buffer, even when its timing payload is unusable.
 */
import axios from 'axios';
import { GOOGLE_TTS_API_URL, resolveGoogleVoice } from './googleTTS.js';
import { marksFromSubtitleEntries, marksFromTimepoints, splitIntoSentences, type SegmentMarks } from './ttsAlignment.js';

export interface TimedSynthesisResult {
    buffer: Buffer;
    marks: SegmentMarks | null;
}

const MINIMAX_API_URL = 'https://api.minimax.io/v1/t2a_v2';
const TIMEOUT_MS = 120_000;

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** Build SSML that places one <mark> before each sentence so Google returns exact timepoints. */
export function buildMarkedSsml(text: string): { ssml: string; markNames: string[] } | null {
    const sentences = splitIntoSentences(text);
    if (!sentences.length) return null;
    const markNames = sentences.map((_, i) => `s${i}`);
    const body = sentences
        .map((sentence, i) => `<mark name="${markNames[i]}"/>${escapeXml(sentence.text)}`)
        .join(' ');
    return { ssml: `<speak>${body}</speak>`, markNames };
}

async function synthesizeGoogleWithTiming(
    text: string,
    role: 'narrator' | 'male' | 'female',
    voiceOverride: string | undefined,
    options?: { bitrate?: number }
): Promise<TimedSynthesisResult | null> {
    const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey || !apiKey.startsWith('AIza')) return null;

    const marked = buildMarkedSsml(text);
    if (!marked) return null;
    const voice = resolveGoogleVoice(role, voiceOverride);

    const response = await axios.post(
        `${GOOGLE_TTS_API_URL}?key=${apiKey}`,
        {
            input: { ssml: marked.ssml },
            voice: {
                languageCode: voice.languageCode,
                name: voice.name,
                ssmlGender: voice.ssmlGender,
            },
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: voice.speakingRate || 1.0,
                pitch: voice.pitch || 0,
            },
            enableTimePointing: ['SSML_MARK'],
        },
        { timeout: TIMEOUT_MS }
    );

    const audioContent = response.data?.audioContent;
    if (!audioContent) return null;
    const buffer = Buffer.from(audioContent, 'base64');

    const timepoints = Array.isArray(response.data?.timepoints) ? response.data.timepoints : [];
    const marks = marksFromTimepoints(text, timepoints, approximateDurationFromBuffer(buffer));
    void options;
    return { buffer, marks };
}

async function synthesizeMiniMaxWithTiming(
    text: string,
    voiceId: string,
    options?: { bitrate?: number }
): Promise<TimedSynthesisResult | null> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) return null;

    const response = await axios.post(
        MINIMAX_API_URL,
        {
            model: 'speech-2.8-hd',
            text,
            stream: false,
            subtitle_enable: true,
            voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
            audio_setting: {
                sample_rate: 32000,
                bitrate: options?.bitrate ?? 128000,
                format: 'mp3',
                channel: 1,
            },
        },
        {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: TIMEOUT_MS,
        }
    );

    if (response.data?.base_resp && response.data.base_resp.status_code !== 0) return null;
    const hexAudio = response.data?.data?.audio;
    if (!hexAudio) return null;
    const buffer = Buffer.from(hexAudio, 'hex');

    const subtitleUrl = response.data?.data?.subtitle_file;
    if (!subtitleUrl || typeof subtitleUrl !== 'string') return { buffer, marks: null };

    try {
        const subtitle = await axios.get(subtitleUrl, { timeout: 30_000, responseType: 'text' });
        const entries = parseSubtitlePayload(subtitle.data);
        if (!entries) return { buffer, marks: null };
        const marks = marksFromSubtitleEntries(text, entries, approximateDurationFromBuffer(buffer));
        return { buffer, marks };
    } catch {
        return { buffer, marks: null };
    }
}

/** MiniMax (and others) mix JSON arrays and line-based CSV-ish subtitle files. */
export function parseSubtitlePayload(raw: unknown): Array<Record<string, unknown>> | null {
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        try {
            return parseSubtitlePayload(JSON.parse(trimmed));
        } catch {
            const lines = trimmed.split(/\r?\n/).filter(Boolean);
            const entries: Array<Record<string, unknown>> = [];
            for (const line of lines) {
                const match = line.match(/^\s*([\d.]+)\s*[,;\t]\s*([\d.]+)\s*[,;\t]\s*(.+?)\s*$/);
                if (!match) continue;
                entries.push({ start_time: Number(match[1]), end_time: Number(match[2]), text: match[3] });
            }
            return entries.length ? entries : null;
        }
    }
    if (Array.isArray(raw)) {
        const entries = raw.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
        return entries.length ? entries : null;
    }
    if (raw && typeof raw === 'object') {
        const container = raw as Record<string, unknown>;
        for (const key of ['sentences', 'words', 'segments', 'items', 'subtitles']) {
            const value = container[key];
            if (Array.isArray(value) && value.length) return parseSubtitlePayload(value);
        }
    }
    return null;
}

/**
 * Last-resort duration estimate from the MP3 payload itself, used only when a
 * provider returns marks but we have no file on disk to probe (the caller
 * re-runs the real probe after writing the file, which then wins).
 */
function approximateDurationFromBuffer(buffer: Buffer): number {
    // Assume the 128 kbps mono output we request; refined later by ffprobe.
    return Math.round((buffer.length * 8) / 128);
}

export type TimingProvider = 'google' | 'minimax' | 'azure' | 'vbee' | 'gemini' | 'grok' | string;

/** Attempt a timing-capable synthesis. Returns null when the provider cannot do it. */
export async function trySynthesizeWithTiming(
    provider: TimingProvider,
    text: string,
    role: 'narrator' | 'male' | 'female',
    providerVoiceId: string | undefined,
    options?: { bitrate?: number }
): Promise<TimedSynthesisResult | null> {
    try {
        if (provider === 'google') {
            return await synthesizeGoogleWithTiming(text, role, providerVoiceId, options);
        }
        if (provider === 'minimax') {
            if (!providerVoiceId) return null;
            return await synthesizeMiniMaxWithTiming(text, providerVoiceId, options);
        }
        return null;
    } catch (error) {
        console.warn(`[TtsTiming] ${provider} timing path unavailable: ${(error as Error)?.message}`);
        return null;
    }
}

/** Providers with a native timing path today (used for status/telemetry). */
export const TIMING_CAPABLE_PROVIDERS: ReadonlySet<string> = new Set(['google', 'minimax']);
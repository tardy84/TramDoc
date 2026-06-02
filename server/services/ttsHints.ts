export type TtsTone =
    | 'neutral'
    | 'warm'
    | 'formal'
    | 'reflective'
    | 'sad'
    | 'suspense'
    | 'tense'
    | 'excited'
    | 'angry'
    | 'whisper'
    | 'question';

export type TtsPace = 'normal' | 'slow' | 'fast';
export type TtsPitch = 'normal' | 'low' | 'high';
export type TtsHintSource = 'rules-v1' | 'manual' | 'unknown';

export interface TtsHints {
    version: 1;
    tone: TtsTone;
    pace: TtsPace;
    pitch: TtsPitch;
    pauseBeforeMs: number;
    pauseAfterMs: number;
    intensity: number;
    confidence: number;
    source: TtsHintSource;
    isDialogue?: boolean;
    isSceneBreak?: boolean;
    reason?: string[];
}

export const DEFAULT_TTS_HINTS: TtsHints = {
    version: 1,
    tone: 'neutral',
    pace: 'normal',
    pitch: 'normal',
    pauseBeforeMs: 0,
    pauseAfterMs: 0,
    intensity: 0,
    confidence: 0.5,
    source: 'rules-v1',
};

export function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export function serializeTtsHints(hints: TtsHints): string {
    return JSON.stringify({
        ...hints,
        pauseBeforeMs: Math.max(0, Math.round(hints.pauseBeforeMs || 0)),
        pauseAfterMs: Math.max(0, Math.round(hints.pauseAfterMs || 0)),
        intensity: clamp01(hints.intensity),
        confidence: clamp01(hints.confidence),
    });
}

export function parseTtsHints(value: string | null | undefined): TtsHints {
    if (!value) return DEFAULT_TTS_HINTS;

    try {
        const parsed = JSON.parse(value) as Partial<TtsHints>;
        return {
            ...DEFAULT_TTS_HINTS,
            ...parsed,
            version: 1,
            tone: parsed.tone || DEFAULT_TTS_HINTS.tone,
            pace: parsed.pace || DEFAULT_TTS_HINTS.pace,
            pitch: parsed.pitch || DEFAULT_TTS_HINTS.pitch,
            pauseBeforeMs: Math.max(0, Math.round(parsed.pauseBeforeMs || 0)),
            pauseAfterMs: Math.max(0, Math.round(parsed.pauseAfterMs || 0)),
            intensity: clamp01(parsed.intensity ?? DEFAULT_TTS_HINTS.intensity),
            confidence: clamp01(parsed.confidence ?? DEFAULT_TTS_HINTS.confidence),
            source: parsed.source || DEFAULT_TTS_HINTS.source,
        };
    } catch {
        return DEFAULT_TTS_HINTS;
    }
}

/**
 * TTS cost metering.
 *
 * The reader needs to tell the user what a full-book job will consume BEFORE it runs.
 * Two things are needed for that: how much text we are about to speak, and what the
 * provider charges.
 *
 * - Text length is a fact from the database (speakable characters), always available.
 * - Audio length is estimated from characters-per-second. When the book already has
 *   cached audio with a measured duration in its sidecar, we use the observed rate of
 *   that same voice instead of a generic constant, so the estimate reflects the real
 *   reading speed (and the real speech-rate hints) of this book.
 * - Rates are USD per 1,000,000 characters. Only providers whose public list price is
 *   known have a rate; anything else reports `ratePerMillionChars: null` and the UI
 *   shows characters/minutes without a dollar figure (better than inventing a number).
 *
 * Operators can override/extend the table without a code change:
 *   TTS_COST_RATES_JSON='{"vbee": {"usdPerMillionChars": 12, "label": "Vbee (hợp đồng)"}}'
 */

export interface TtsCostRate {
    usdPerMillionChars: number;
    /** Where the number comes from — surfaced in the API so the UI can label it. */
    source: string;
}

export interface TtsCostEstimate {
    characters: number;
    /** Null when the voice's provider has no known rate. */
    estimatedSeconds: number | null;
    /** Null when the voice's provider has no known rate. */
    ratePerMillionChars: number | null;
    /** Null when the voice's provider has no known rate. */
    estimatedCostUsd: number | null;
    /** True when the seconds figure came from this voice's measured cached audio. */
    secondsFromMeasuredAudio: boolean;
    rateSource: string | null;
}

/** Fallback narration speed for Vietnamese at the app's default rate (~15 chars/sec). */
export const DEFAULT_CHARS_PER_SECOND = 15;

/**
 * Public list prices, USD per 1M characters. Google Neural2/WaveNet and Azure Neural
 * are the providers with published per-character pricing; the Vietnamese Vbee tier,
 * MiniMax and Gemini TTS are billed differently (credits / tokens), so they are
 * intentionally absent until a real rate is configured.
 */
const DEFAULT_RATES: Record<string, TtsCostRate> = {
    google: {
        usdPerMillionChars: 16,
        source: 'Google Cloud TTS list price (Neural2/WaveNet)',
    },
    azure: {
        usdPerMillionChars: 15,
        source: 'Azure AI Speech list price (Neural)',
    },
};

function loadRates(): Record<string, TtsCostRate> {
    const raw = process.env.TTS_COST_RATES_JSON;
    if (!raw) return { ...DEFAULT_RATES };
    try {
        const parsed = JSON.parse(raw) as Record<string, { usdPerMillionChars?: unknown; source?: unknown }>;
        const merged: Record<string, TtsCostRate> = { ...DEFAULT_RATES };
        for (const [provider, value] of Object.entries(parsed)) {
            const rate = Number(value?.usdPerMillionChars);
            if (!Number.isFinite(rate) || rate < 0) continue;
            merged[provider] = {
                usdPerMillionChars: rate,
                source: typeof value?.source === 'string' && value.source ? value.source : 'TTS_COST_RATES_JSON',
            };
        }
        return merged;
    } catch (error) {
        console.warn('[TTS cost] Ignoring malformed TTS_COST_RATES_JSON:', (error as Error).message);
        return { ...DEFAULT_RATES };
    }
}

/**
 * Provider for a request voice. Must stay in sync with `resolveTtsVoice()` in
 * ttsVoiceCatalog.ts: anything that is not a prefixed provider voice is a Google
 * Cloud voice (e.g. `vi-VN-Wavenet-B`).
 */
export function resolveProviderFromVoice(voice: string): string {
    if (voice.startsWith('vbee-')) return 'vbee';
    if (voice.startsWith('azure-')) return 'azure';
    if (voice.startsWith('gemini-')) return 'gemini';
    if (voice.startsWith('grok-')) return 'grok';
    if (voice.startsWith('minimax-')) return 'minimax';
    return 'google';
}

export function getTtsRate(voice: string): TtsCostRate | null {
    const provider = resolveProviderFromVoice(voice);
    return loadRates()[provider] ?? null;
}

/** Speakable characters: whitespace and decoration are not sent to the provider in a meaningful way. */
export function countSpeakableCharacters(texts: Iterable<string>): number {
    let total = 0;
    for (const text of texts) {
        if (!text) continue;
        total += text.replace(/[\s\u00a0]+/g, '').length;
    }
    return total;
}

export interface BuildCostEstimateInput {
    voice: string;
    characters: number;
    /** Measured seconds of audio already cached for this book/voice, when known. */
    measuredSeconds?: number;
    /** Speakable characters covered by `measuredSeconds`, when known. */
    measuredCharacters?: number;
}

export function buildTtsCostEstimate({
    voice,
    characters,
    measuredSeconds = 0,
    measuredCharacters = 0,
}: BuildCostEstimateInput): TtsCostEstimate {
    const rate = getTtsRate(voice);

    let charsPerSecond = DEFAULT_CHARS_PER_SECOND;
    let secondsFromMeasuredAudio = false;
    const usableMeasured = measuredSeconds > 0 && measuredCharacters > 0;
    if (usableMeasured) {
        const observed = measuredCharacters / measuredSeconds;
        // Guard against absurd rates from a bad/partial probe (0.5–60 chars/sec covers
        // every real narration speed we produce, including sped-up playback).
        if (observed >= 0.5 && observed <= 60) {
            charsPerSecond = observed;
            secondsFromMeasuredAudio = true;
        }
    }

    const estimatedSeconds = characters > 0 ? Math.round(characters / charsPerSecond) : null;

    return {
        characters,
        estimatedSeconds,
        ratePerMillionChars: rate ? rate.usdPerMillionChars : null,
        estimatedCostUsd: rate ? Number(((characters / 1_000_000) * rate.usdPerMillionChars).toFixed(4)) : null,
        secondsFromMeasuredAudio,
        rateSource: rate ? rate.source : null,
    };
}
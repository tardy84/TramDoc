/**
 * TTS voice catalog.
 *
 * Maps safe public voice IDs (used in URLs, filenames, cache keys, and
 * client UI) to provider-specific raw voice IDs (e.g. MiniMax `voice_id`
 * values that may contain spaces and parentheses and must NEVER appear
 * in filenames).
 *
 * The resolver is also the single source of truth for the multi-voice
 * profile `minimax-profile-vietnamese-natural-v1` that picks a concrete
 * voice per `TextSegment.role`.
 */

export type SegmentRole =
    | 'narrator'
    | 'heading'
    | 'male'
    | 'female'
    | 'child'
    | string;

export type TtsProvider =
    | 'vbee'
    | 'minimax'
    | 'grok'
    | 'azure'
    | 'gemini'
    | 'google';

export interface ResolvedTtsVoice {
    /** Voice ID as requested by the client / URL. Safe to use as cache key prefix. */
    requestVoice: string;
    /** Voice ID to embed in audio filenames and metadata. Safe characters only. */
    cacheVoice: string;
    /** Provider implementation to call. */
    provider: TtsProvider;
    /** Raw provider voice ID to pass to the provider SDK / HTTP API. */
    providerVoiceId: string;
}

/**
 * Safe MiniMax public voice IDs -> raw MiniMax `voice_id` values.
 * The raw IDs may contain spaces, parentheses, and other non-`[A-Za-z0-9._-]`
 * characters. They must never be embedded in filenames or URLs.
 */
const MINIMAX_SINGLE_VOICES: Record<string, string> = {
    'minimax-male-qn-qingse': 'male-qn-qingse',
    'minimax-mandarin-news-anchor': 'Chinese (Mandarin)_News_Anchor',
    'minimax-mandarin-gentleman': 'Chinese (Mandarin)_Gentleman',
    'minimax-mandarin-mature-woman': 'Chinese (Mandarin)_Mature_Woman',
    'minimax-vietnamese-kindhearted-girl': 'Vietnamese_kindhearted_girl',
};

const GROK_SINGLE_VOICES: Record<string, string> = {
    'grok-eve': 'eve',
    'grok-ara': 'ara',
    'grok-rex': 'rex',
    'grok-sal': 'sal',
    'grok-leo': 'leo',
    // Rollback aliases for any client/localStorage values saved during the
    // custom-voice experiment. xAI rejected those custom IDs for the current
    // production API key, so route them back to built-in voices.
    'grok-vietnamese-female': 'ara',
    'grok-vietnamese-male': 'sal',
};

export function isSupportedGrokVoice(requestVoice: string): boolean {
    return Object.prototype.hasOwnProperty.call(GROK_SINGLE_VOICES, requestVoice);
}

/**
 * First user-approved multi-voice profile. Maps each `TextSegment.role`
 * to one of the safe public MiniMax voice IDs from `MINIMAX_SINGLE_VOICES`.
 */
const MINIMAX_NATURAL_PROFILE: Record<string, string> = {
    narrator: 'minimax-male-qn-qingse',
    heading: 'minimax-mandarin-news-anchor',
    male: 'minimax-mandarin-gentleman',
    female: 'minimax-mandarin-mature-woman',
    child: 'minimax-male-qn-qingse',
};

export const MINIMAX_NATURAL_PROFILE_ID = 'minimax-profile-vietnamese-natural-v1';

const SAFE_VOICE_PATTERN = /^[A-Za-z0-9._-]+$/;

function isSafeVoiceId(value: string): boolean {
    return value.length > 0 && value.length <= 160 && SAFE_VOICE_PATTERN.test(value);
}

export function resolveTtsVoice(requestVoice: string, role: SegmentRole): ResolvedTtsVoice {
    if (typeof requestVoice !== 'string' || !isSafeVoiceId(requestVoice)) {
        // Defensive: callers should already have validated via isSafeVoice().
        // Treat unknown requests as Google default to preserve prior behavior.
        return {
            requestVoice,
            cacheVoice: requestVoice,
            provider: 'google',
            providerVoiceId: requestVoice,
        };
    }

    // Multi-voice profile: pick a concrete MiniMax voice by role.
    if (requestVoice === MINIMAX_NATURAL_PROFILE_ID) {
        const roleKey = String(role);
        const safeRoleKey = isSafeVoiceId(roleKey) ? roleKey : 'unknown';
        const safeVoice = MINIMAX_NATURAL_PROFILE[roleKey] || MINIMAX_NATURAL_PROFILE.narrator;
        const providerVoiceId = MINIMAX_SINGLE_VOICES[safeVoice];
        return {
            requestVoice,
            cacheVoice: `${requestVoice}-${safeRoleKey}-${safeVoice}`,
            provider: 'minimax',
            providerVoiceId,
        };
    }

    // Single-voice MiniMax selections.
    if (Object.prototype.hasOwnProperty.call(MINIMAX_SINGLE_VOICES, requestVoice)) {
        return {
            requestVoice,
            cacheVoice: requestVoice,
            provider: 'minimax',
            providerVoiceId: MINIMAX_SINGLE_VOICES[requestVoice],
        };
    }

    // Single-voice Grok selections. Keep public IDs safe and map to raw xAI
    // voice IDs only at the provider boundary.
    if (isSupportedGrokVoice(requestVoice)) {
        return {
            requestVoice,
            cacheVoice: requestVoice,
            provider: 'grok',
            providerVoiceId: GROK_SINGLE_VOICES[requestVoice],
        };
    }
    if (requestVoice.startsWith('grok-')) {
        // Keep unknown Grok-like IDs away from Google fallback. Public routes
        // reject these, and the provider rejects anything except raw ara/sal.
        return {
            requestVoice,
            cacheVoice: requestVoice,
            provider: 'grok',
            providerVoiceId: requestVoice,
        };
    }

    // Existing providers: preserve previous behavior. The request voice is
    // passed through as both the cache key and the provider voice ID.
    if (requestVoice.startsWith('vbee-')) {
        return { requestVoice, cacheVoice: requestVoice, provider: 'vbee', providerVoiceId: requestVoice };
    }
    if (requestVoice.startsWith('azure-')) {
        return { requestVoice, cacheVoice: requestVoice, provider: 'azure', providerVoiceId: requestVoice };
    }
    if (requestVoice.startsWith('gemini-')) {
        return { requestVoice, cacheVoice: requestVoice, provider: 'gemini', providerVoiceId: requestVoice };
    }

    return { requestVoice, cacheVoice: requestVoice, provider: 'google', providerVoiceId: requestVoice };
}

export function isMiniMaxNaturalProfile(voice: string): boolean {
    return voice === MINIMAX_NATURAL_PROFILE_ID;
}

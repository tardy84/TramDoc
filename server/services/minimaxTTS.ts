import axios from 'axios';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_API_URL = 'https://api.minimax.io/v1/t2a_v2';

export class MiniMaxTTSService {
    private defaultVoice = 'male-qn-qingse';

    async synthesize(
        text: string,
        role: 'narrator' | 'male' | 'female' | string,
        voiceOverride?: string,
        options?: { bitrate?: number }
    ): Promise<Buffer> {
        // When the caller supplies `voiceOverride`, it is treated as the
        // *raw* MiniMax `voice_id` (resolved upstream by `ttsVoiceCatalog`).
        // This decouples the provider call from safe UI/cache IDs.
        const voiceId = voiceOverride || this.getDefaultVoiceForRole(role);

        try {
            const response = await axios.post(
                MINIMAX_API_URL,
                {
                    model: 'speech-2.8-hd',
                    text: text,
                    stream: false,
                    voice_setting: {
                        voice_id: voiceId,
                        speed: 1.0,
                        vol: 1.0,
                        pitch: 0
                    },
                    audio_setting: {
                        sample_rate: 32000,
                        bitrate: options?.bitrate ?? 128000,
                        format: 'mp3',
                        channel: 1
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data && response.data.base_resp && response.data.base_resp.status_code !== 0) {
                throw new Error(`MiniMax API Error: ${response.data.base_resp.status_msg}`);
            }

            const hexAudio = response.data.data.audio;
            if (!hexAudio) {
               throw new Error('No audio data received from MiniMax');
            }

            return Buffer.from(hexAudio, 'hex');
        } catch (error: any) {
             console.error('[MiniMaxTTS] Error:', error?.response?.data || error.message);
             throw error;
        }
    }

    /**
     * Pick a sensible default raw MiniMax `voice_id` for a given role.
     * Used only when no `voiceOverride` is supplied (i.e. the caller has
     * not run `resolveTtsVoice` upstream). Keeps prior single-voice
     * behaviour without changing the public method signature.
     */
    private getDefaultVoiceForRole(role: 'narrator' | 'male' | 'female' | string): string {
        if (role === 'female') return 'Chinese (Mandarin)_Mature_Woman';
        if (role === 'male') return 'Chinese (Mandarin)_Gentleman';
        return 'male-qn-qingse';
    }

    async synthesizeSegments(
        segments: Array<{ content: string; role: 'narrator' | 'male' | 'female' }>,
        voiceOverride?: string
    ): Promise<Buffer[]> {
        console.log(`[MiniMaxTTS] Starting parallel generation for ${segments.length} segments...`);
        const startTime = Date.now();

        // MiniMax rate limit might apply, but we use parallel map similarly to Google.
        const audioBuffers = await Promise.all(
            segments.map(segment => this.synthesize(segment.content, segment.role, voiceOverride))
        );

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[MiniMaxTTS] ✅ Generated ${segments.length} segments in ${duration}s (parallel)`);

        return audioBuffers;
    }
}

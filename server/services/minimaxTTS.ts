import axios from 'axios';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_API_URL = 'https://api.minimax.io/v1/t2a_v2';

export class MiniMaxTTSService {
    private defaultVoice = 'male-qn-qingse';

    async synthesize(
        text: string,
        role: 'narrator' | 'male' | 'female',
        voiceOverride?: string
    ): Promise<Buffer> {
        let voiceId = this.defaultVoice;
        
        if (voiceOverride) {
            // Loại bỏ tiền tố 'minimax-' nếu được pass vào từ voice string
            voiceId = voiceOverride.replace('minimax-', '');
        } else {
            if (role === 'female') {
                voiceId = 'female-shaonv';
            } else if (role === 'male') {
                voiceId = 'male-qn-qingse';
            }
        }

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
                        bitrate: 128000,
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

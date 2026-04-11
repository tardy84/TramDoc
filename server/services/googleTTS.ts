import axios from 'axios';
import { MiniMaxTTSService } from './minimaxTTS.js';

const googleFallbackTTS = new MiniMaxTTSService();
const TTS_API_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

interface VoiceConfig {
    languageCode: string;
    name: string;
    ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL';
    pitch?: number;
    speakingRate?: number;
}

export class GoogleTTSService {
    private voiceMap: Record<string, VoiceConfig> = {
        'vi-VN-Wavenet-A': { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-A', ssmlGender: 'FEMALE', pitch: 1.0, speakingRate: 1.05 }, // Mai Chi - Trẻ trung, rành mạch
        'vi-VN-Wavenet-B': { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-B', ssmlGender: 'MALE', pitch: 0, speakingRate: 1.0 },    // Anh Quân - Tiêu chuẩn, tin cậy
    };

    private defaultVoice = 'vi-VN-Wavenet-B';

    /** Resolve Google TTS API key from runtime env (supports GOOGLE_TTS_API_KEY and GOOGLE_CLOUD_API_KEY) */
    private getApiKey(): string | undefined {
        return process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_CLOUD_API_KEY;
    }

    async synthesize(
        text: string,
        role: 'narrator' | 'male' | 'female',
        voiceOverride?: string
    ): Promise<Buffer> {
        const apiKey = this.getApiKey();

        // Priority: voiceOverride -> role map -> default
        const voiceName = voiceOverride || (role === 'narrator' ? this.defaultVoice : null);
        const voice = this.voiceMap[voiceName || ''] ||
            (role === 'male' ? this.voiceMap['vi-VN-Wavenet-B'] :
                role === 'female' ? this.voiceMap['vi-VN-Wavenet-A'] :
                    this.voiceMap[this.defaultVoice]);

        try {
            // Try Google Cloud TTS if key is available (AIza... = Gemini, but here we use it for Cloud TTS v1)
            if (apiKey && apiKey.startsWith('AIza')) {
                const response = await axios.post(
                    `${TTS_API_URL}?key=${apiKey}`,
                    {
                        input: { text },
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
                    }
                );
                return Buffer.from(response.data.audioContent, 'base64');
            }
            throw new Error('Google Cloud API Key broken or missing. Falling back to Gemini.');
        } catch (e: any) {
            // Transparently fallback to MiniMax TTS for "fixing" the service
            console.log(`[GoogleTTS] Fallback to MiniMax for voice ${voice.name} due to error/key`);
            const minimaxRole = voice.ssmlGender === 'FEMALE' ? 'female' : 'male';
            return googleFallbackTTS.synthesize(text, minimaxRole as any);
        }
    }

    async synthesizeSegments(
        segments: Array<{ content: string; role: 'narrator' | 'male' | 'female' }>,
        voiceOverride?: string
    ): Promise<Buffer[]> {
        console.log(`[TTS] Starting parallel generation for ${segments.length} segments...`);
        const startTime = Date.now();

        const audioBuffers = await Promise.all(
            segments.map(segment => this.synthesize(segment.content, segment.role, voiceOverride))
        );

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[TTS] ✅ Generated ${segments.length} segments in ${duration}s (parallel)`);

        return audioBuffers;
    }
}

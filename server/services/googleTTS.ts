import axios from 'axios';

const GOOGLE_CLOUD_API_KEY = process.env.GOOGLE_CLOUD_API_KEY;
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
        'vi-VN-Wavenet-C': { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-C', ssmlGender: 'FEMALE', pitch: -1.5, speakingRate: 0.95 }, // Thùy Chi - Trầm ấm, tự sự
        'vi-VN-Wavenet-D': { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-D', ssmlGender: 'MALE', pitch: 2.0, speakingRate: 1.15 },  // Minh Quang - Giọng nam trẻ, năng động (Dùng gốc D + Pitch cao)
        'vi-VN-Neural2-A': { languageCode: 'vi-VN', name: 'vi-VN-Neural2-A', ssmlGender: 'FEMALE', pitch: 0, speakingRate: 1.0 },    // Hà Phương - Trong trẻo, tự nhiên
        'vi-VN-Neural2-D': { languageCode: 'vi-VN', name: 'vi-VN-Neural2-D', ssmlGender: 'MALE', pitch: -2.5, speakingRate: 0.85 } // Hoàng Long - Giọng nam già, quyền lực (Dùng gốc D + Pitch rất thấp)
    };

    private defaultVoice = 'vi-VN-Wavenet-B';

    async synthesize(
        text: string,
        role: 'narrator' | 'male' | 'female',
        voiceOverride?: string
    ): Promise<Buffer> {
        // Priority: voiceOverride -> role map -> default
        const voiceName = voiceOverride || (role === 'narrator' ? this.defaultVoice : null);
        const voice = this.voiceMap[voiceName || ''] ||
            (role === 'male' ? this.voiceMap['vi-VN-Wavenet-B'] :
                role === 'female' ? this.voiceMap['vi-VN-Wavenet-A'] :
                    this.voiceMap[this.defaultVoice]);

        const response = await axios.post(
            `${TTS_API_URL}?key=${GOOGLE_CLOUD_API_KEY}`,
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

        // Google returns base64 encoded audio
        return Buffer.from(response.data.audioContent, 'base64');
    }

    async synthesizeSegments(
        segments: Array<{ content: string; role: 'narrator' | 'male' | 'female' }>,
        voiceOverride?: string
    ): Promise<Buffer[]> {
        // Process all segments in parallel for much faster generation
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

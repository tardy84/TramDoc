import axios from 'axios';

const GOOGLE_CLOUD_API_KEY = process.env.GOOGLE_CLOUD_API_KEY;
const TTS_API_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

interface VoiceConfig {
    languageCode: string;
    name: string;
    ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL';
}

export class GoogleTTSService {
    private voiceMap: Record<string, VoiceConfig> = {
        narrator: {
            languageCode: 'vi-VN',
            name: 'vi-VN-Wavenet-A',
            ssmlGender: 'FEMALE',
        },
        male: {
            languageCode: 'vi-VN',
            name: 'vi-VN-Chirp3-HD-Achird',
            ssmlGender: 'MALE',
        },
        female: {
            languageCode: 'vi-VN',
            name: 'vi-VN-Chirp3-HD-Achernar',
            ssmlGender: 'FEMALE',
        }
    };

    async synthesize(
        text: string,
        role: 'narrator' | 'male' | 'female',
        voiceOverride?: string
    ): Promise<Buffer> {
        let voice: VoiceConfig;

        if (voiceOverride) {
            voice = {
                languageCode: 'vi-VN',
                name: voiceOverride,
                ssmlGender: 'FEMALE'
            };
        } else {
            voice = this.voiceMap[role] || this.voiceMap['narrator'];
        }

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
                    audioEncoding: 'MP3', // Mobile/Browser compatible
                    speakingRate: 1.0,
                    pitch: 0,
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

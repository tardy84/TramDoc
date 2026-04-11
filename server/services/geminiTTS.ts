import axios from 'axios';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-native-audio-latest:generateContent';

export class GeminiTTSService {
    private voiceMap: Record<string, string> = {
        'gemini-Puck': 'Puck',   // Male
        'gemini-Aoede': 'Aoede', // Female
        'gemini-Charon': 'Charon',
        'gemini-Kore': 'Kore',
        'gemini-Fenrir': 'Fenrir'
    };

    private defaultVoice = 'gemini-Puck';

    async synthesize(
        text: string,
        role: 'narrator' | 'male' | 'female',
        voiceOverride?: string
    ): Promise<Buffer> {
        let voiceName = 'Puck';
        
        if (voiceOverride && voiceOverride.startsWith('gemini-')) {
            voiceName = this.voiceMap[voiceOverride] || 'Puck';
        } else {
            if (role === 'female') {
                voiceName = 'Aoede';
            } else if (role === 'male') {
                voiceName = 'Puck';
            }
        }

        try {
            const response = await axios.post(
                `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
                {
                    contents: [{ parts: [{ text }] }],
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: voiceName
                                }
                            }
                        }
                    }
                }
            );

            const parts = response.data.candidates[0].content.parts;
            for (const p of parts) {
                if (p.inlineData && p.inlineData.mimeType.startsWith('audio/')) {
                    // Gemini returns base64 encoded audio
                    return Buffer.from(p.inlineData.data, 'base64');
                }
            }
            
            throw new Error('No audio found in Gemini response');
        } catch (error: any) {
            console.error('[GeminiTTS] Error:', error.response?.data || error.message);
            throw error;
        }
    }

    async synthesizeSegments(
        segments: Array<{ content: string; role: 'narrator' | 'male' | 'female' }>,
        voiceOverride?: string
    ): Promise<Buffer[]> {
        console.log(`[GeminiTTS] Starting parallel generation for ${segments.length} segments...`);
        const startTime = Date.now();

        const audioBuffers = await Promise.all(
            segments.map(segment => this.synthesize(segment.content, segment.role, voiceOverride))
        );

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[GeminiTTS] ✅ Generated ${segments.length} segments in ${duration}s`);

        return audioBuffers;
    }
}

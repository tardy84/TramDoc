const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_TTS_API_URL = process.env.XAI_TTS_API_URL || 'https://api.x.ai/v1/tts';

type GrokTtsOptions = {
    bitrate?: number;
};

export class GrokTTSService {
    async synthesize(
        text: string,
        _role: 'narrator' | 'male' | 'female' | string,
        voiceOverride?: string,
        options?: GrokTtsOptions
    ): Promise<Buffer> {
        if (!XAI_API_KEY) {
            throw new Error('Grok TTS is not configured on the server (missing XAI_API_KEY).');
        }

        const voiceId = voiceOverride ?? 'ara';
        const supportedVoiceIds = new Set(['eve', 'ara', 'rex', 'sal', 'leo']);
        if (!supportedVoiceIds.has(voiceId)) {
            throw new Error(`Unsupported Grok voice: ${voiceId}`);
        }

        const response = await fetch(XAI_TTS_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${XAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                voice_id: voiceId,
                language: 'vi',
                output_format: {
                    codec: 'mp3',
                    sample_rate: 24000,
                    bit_rate: options?.bitrate ?? 128000,
                },
            }),
        });

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || '';

        if (!response.ok) {
            const errorText = buffer.toString('utf8').slice(0, 1000);
            throw new Error(`Grok TTS failed: HTTP ${response.status} ${errorText}`);
        }

        if (!contentType.startsWith('audio/')) {
            const errorText = buffer.toString('utf8').slice(0, 500);
            throw new Error(`Grok TTS expected audio/*, got ${contentType}: ${errorText}`);
        }

        return buffer;
    }
}

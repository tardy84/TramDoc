import axios from 'axios';

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;
const AZURE_API_URL = `https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

export class AzureTTSService {
    async synthesize(
        text: string,
        role: 'narrator' | 'male' | 'female',
        voiceOverride?: string
    ): Promise<Buffer> {
        // Default Azure voices for Vietnamese if not specified
        // voiceOverride should look like 'azure-vi-VN-HoaiMyNeural'
        let voiceName = 'vi-VN-HoaiMyNeural'; // Default Female
        if (role === 'male') voiceName = 'vi-VN-NamMinhNeural';

        if (voiceOverride && voiceOverride.startsWith('azure-')) {
            voiceName = voiceOverride.replace('azure-', '');
        }

        console.log(`[AzureTTS] Synthesizing with voice: ${voiceName}`);

        try {
            const response = await axios.post(
                AZURE_API_URL,
                `<speak version='1.0' xml:lang='vi-VN'>
                    <voice xml:lang='vi-VN' xml:gender='${role === 'male' ? 'Male' : 'Female'}' name='${voiceName}'>
                        ${text}
                    </voice>
                </speak>`,
                {
                    headers: {
                        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
                        'Content-Type': 'application/ssml+xml',
                        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
                        'User-Agent': 'TramDoc'
                    },
                    responseType: 'arraybuffer'
                }
            );

            return Buffer.from(response.data);
        } catch (error: any) {
            console.error('[AzureTTS] Error:', error.response?.data?.toString() || error.message);
            throw new Error(`Azure TTS failed: ${error.message}`);
        }
    }
}

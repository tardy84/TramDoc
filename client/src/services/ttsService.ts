/**
 * Client-side TTS Service
 * Calls Azure and Google Cloud TTS APIs directly from the app
 * API keys stored in localStorage (acceptable for personal use)
 */

// ===== API Key Management =====

export function getApiKeys() {
    return {
        azureKey: import.meta.env.VITE_AZURE_SPEECH_KEY || localStorage.getItem('tts_azure_key') || '',
        azureRegion: import.meta.env.VITE_AZURE_SPEECH_REGION || localStorage.getItem('tts_azure_region') || 'southeastasia',
        googleKey: import.meta.env.VITE_GOOGLE_CLOUD_API_KEY || localStorage.getItem('tts_google_key') || '',
        minimaxKey: import.meta.env.VITE_MINIMAX_API_KEY || localStorage.getItem('tts_minimax_key') || '',
        geminiKey: import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('tts_gemini_key') || '',
    };
}

export function setApiKeys(keys: { azureKey?: string; azureRegion?: string; googleKey?: string; minimaxKey?: string; geminiKey?: string }) {
    if (keys.azureKey !== undefined) localStorage.setItem('tts_azure_key', keys.azureKey);
    if (keys.azureRegion !== undefined) localStorage.setItem('tts_azure_region', keys.azureRegion);
    if (keys.googleKey !== undefined) localStorage.setItem('tts_google_key', keys.googleKey);
    if (keys.minimaxKey !== undefined) localStorage.setItem('tts_minimax_key', keys.minimaxKey);
    if (keys.geminiKey !== undefined) localStorage.setItem('tts_gemini_key', keys.geminiKey);
}

export function hasApiKeys(voice: string): boolean {
    const keys = getApiKeys();
    if (voice.startsWith('gemini-')) return !!(keys.geminiKey || keys.googleKey);
    if (voice.startsWith('minimax-')) return !!keys.minimaxKey;
    if (voice.startsWith('azure-')) return !!(keys.azureKey && keys.azureRegion);
    return !!keys.googleKey; // Google voices
}

// ===== Voice Config =====

const googleVoiceMap: Record<string, { languageCode: string; name: string; ssmlGender: string; pitch: number; speakingRate: number }> = {
    'vi-VN-Wavenet-A': { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-A', ssmlGender: 'FEMALE', pitch: 1.0, speakingRate: 1.05 },
    'vi-VN-Wavenet-B': { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-B', ssmlGender: 'MALE', pitch: 0, speakingRate: 1.0 },
    'vi-VN-Wavenet-C': { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-C', ssmlGender: 'FEMALE', pitch: -1.5, speakingRate: 0.95 },
    'vi-VN-Wavenet-D': { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-D', ssmlGender: 'MALE', pitch: 2.0, speakingRate: 1.15 },
    'vi-VN-Neural2-A': { languageCode: 'vi-VN', name: 'vi-VN-Neural2-A', ssmlGender: 'FEMALE', pitch: 0, speakingRate: 1.0 },
    'vi-VN-Neural2-D': { languageCode: 'vi-VN', name: 'vi-VN-Neural2-D', ssmlGender: 'MALE', pitch: -2.5, speakingRate: 0.85 },
};

// ===== Synthesize =====

export async function synthesize(text: string, voice: string, signal?: AbortSignal): Promise<Blob> {
    if (!text || typeof text !== 'string') {
        // Return a tiny silent MP3 for empty/undefined segments
        return new Blob([], { type: 'audio/mpeg' });
    }
    if (voice.startsWith('gemini-')) {
        return synthesizeGemini(text, voice, signal);
    }
    if (voice.startsWith('minimax-')) {
        return synthesizeMinimax(text, voice, signal);
    }
    if (voice.startsWith('azure-')) {
        return synthesizeAzure(text, voice, signal);
    }
    return synthesizeGoogle(text, voice, signal);
}

async function synthesizeAzure(text: string, voice: string, signal?: AbortSignal): Promise<Blob> {
    const { azureKey, azureRegion } = getApiKeys();
    if (!azureKey || !azureRegion) throw new Error('Chưa cấu hình Azure API key');

    const voiceName = voice.replace('azure-', '');
    const url = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const ssml = `<speak version='1.0' xml:lang='vi-VN'>
        <voice xml:lang='vi-VN' name='${voiceName}'>
            ${escapeXml(text)}
        </voice>
    </speak>`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Ocp-Apim-Subscription-Key': azureKey,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
            'User-Agent': 'TramDoc'
        },
        body: ssml,
        signal
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Azure TTS lỗi (${response.status}): ${errorText}`);
    }

    return await response.blob();
}

async function synthesizeGoogle(text: string, voice: string, signal?: AbortSignal): Promise<Blob> {
    const { googleKey } = getApiKeys();
    if (!googleKey) throw new Error('Chưa cấu hình Google Cloud API key');

    const voiceConfig = googleVoiceMap[voice] || googleVoiceMap['vi-VN-Wavenet-B'];
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { text },
                voice: {
                    languageCode: voiceConfig.languageCode,
                    name: voiceConfig.name,
                    ssmlGender: voiceConfig.ssmlGender,
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: voiceConfig.speakingRate,
                    pitch: voiceConfig.pitch,
                },
            }),
            signal
        });

        if (!response.ok) {
            throw new Error(`Google TTS lỗi HTTP`);
        }

        const data = await response.json();
        const binaryString = atob(data.audioContent);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes], { type: 'audio/mpeg' });
    } catch (e) {
        console.warn(`[GoogleTTS Client] Lỗi API, tự động chuyển qua MiniMax.`, e);
        // Fallback to Minimax
        const minimaxVoice = voiceConfig.ssmlGender === 'FEMALE' ? 'minimax-female-shaonv' : 'minimax-male-qn-qingse';
        return synthesizeMinimax(text, minimaxVoice, signal);
    }
}

function escapeXml(text: string): string {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

async function synthesizeMinimax(text: string, voice: string, signal?: AbortSignal): Promise<Blob> {
    const { minimaxKey } = getApiKeys();
    if (!minimaxKey) throw new Error('Chưa cấu hình MiniMax API key');

    const voiceId = voice.replace('minimax-', '');
    const url = 'https://api.minimax.io/v1/t2a_v2';

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${minimaxKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
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
        }),
        signal
    });

    if (!response.ok) {
        throw new Error(`MiniMax TTS lỗi HTTP: ${response.status}`);
    }

    const data = await response.json();
    if (data.base_resp && data.base_resp.status_code !== 0) {
        throw new Error(`MiniMax TTS lỗi API: ${data.base_resp.status_msg}`);
    }

    const hexString = data.data.audio;
    if (!hexString) {
        throw new Error('Không có audio data từ MiniMax');
    }

    const bytes = new Uint8Array(hexString.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
    }
    return new Blob([bytes], { type: 'audio/mpeg' });
}

async function synthesizeGemini(text: string, voice: string, signal?: AbortSignal): Promise<Blob> {
    const { geminiKey, googleKey } = getApiKeys();
    const apiKey = geminiKey || googleKey;
    if (!apiKey) throw new Error('Chưa cấu hình Gemini/Google API key');

    const voiceName = voice.replace('gemini-', '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-native-audio-latest:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
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
            }),
            signal
        });

        if (!response.ok) {
            throw new Error(`Gemini TTS lỗi HTTP`);
        }

        const data = await response.json();
        const parts = data.candidates[0].content.parts;
        for (const p of parts) {
            if (p.inlineData && p.inlineData.mimeType.startsWith('audio/')) {
                const binaryString = atob(p.inlineData.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                return new Blob([bytes], { type: 'audio/wav' }); 
            }
        }
        throw new Error('Gemini TTS: Không có dữ liệu audio');
    } catch (e) {
        console.warn(`[GeminiTTS Client] Lỗi API, tự động chuyển qua MiniMax.`, e);
        const minimaxVoice = voiceName === 'Aoede' ? 'minimax-female-shaonv' : 'minimax-male-qn-qingse';
        return synthesizeMinimax(text, minimaxVoice, signal);
    }
}


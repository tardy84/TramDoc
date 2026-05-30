import axios from 'axios';

const VBEE_APP_ID = process.env.VBEE_APP_ID;
const VBEE_TOKEN = process.env.VBEE_TOKEN;
const VBEE_API_URL = 'https://vbee.vn/api/v1/tts';

// Vbee requires a callback URL, but Trạm Đọc still polls for the final audio.
const VBEE_CALLBACK_URL = process.env.VBEE_CALLBACK_URL || 'https://localhost/vbee-callback';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 40; // 40 * 1.5s = 60s max wait
const SUBMIT_RETRY_ATTEMPTS = 2;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetriableSubmitError(error: any): boolean {
    const status = error?.response?.status;
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export class VbeeTTSService {
    async synthesize(
        text: string,
        role: 'narrator' | 'male' | 'female',
        voiceOverride?: string
    ): Promise<Buffer> {
        if (!VBEE_APP_ID || !VBEE_TOKEN) {
            throw new Error('Vbee TTS is not configured on the server (missing VBEE_APP_ID/VBEE_TOKEN).');
        }

        // voiceOverride looks like 'vbee-n_hn_male_ngankechuyen_ytstable_vc'
        let voiceCode = 'n_hn_male_ngankechuyen_ytstable_vc'; // Default
        if (voiceOverride && voiceOverride.startsWith('vbee-')) {
            voiceCode = voiceOverride.replace('vbee-', '');
        }

        console.log(`[VbeeTTS] Synthesizing ${text.length} chars with voice: ${voiceCode}`);

        // Step 1: Submit TTS request
        let submitResponse;
        for (let attempt = 0; attempt <= SUBMIT_RETRY_ATTEMPTS; attempt++) {
            try {
                submitResponse = await axios.post(
                    VBEE_API_URL,
                    {
                        app_id: VBEE_APP_ID,
                        callback_url: VBEE_CALLBACK_URL,
                        input_text: text,
                        voice_code: voiceCode,
                        audio_type: 'mp3',
                        speed_rate: '1.0',
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${VBEE_TOKEN}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 15000,
                    }
                );
                break;
            } catch (error: any) {
                if (!isRetriableSubmitError(error) || attempt === SUBMIT_RETRY_ATTEMPTS) {
                    throw new Error(`Vbee TTS submit failed: ${error?.response?.status || error.message}`);
                }

                console.warn(`[VbeeTTS] Submit retry ${attempt + 1}/${SUBMIT_RETRY_ATTEMPTS} after ${error?.response?.status || error.message}`);
                await sleep((attempt + 1) * 1000);
            }
        }

        if (!submitResponse || submitResponse.data.status !== 1) {
            throw new Error(`Vbee TTS submit failed: ${submitResponse?.data?.error_message || 'Unknown error'}`);
        }

        const requestId = submitResponse.data.result.request_id;
        console.log(`[VbeeTTS] Request submitted: ${requestId}`);

        // Step 2: Poll until SUCCESS or FAILURE
        let audioLink: string | null = null;

        for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

            try {
                const pollResponse = await axios.get(
                    `${VBEE_API_URL}/${requestId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${VBEE_TOKEN}`,
                        },
                    }
                );

                const result = pollResponse.data.result;

                if (result.status === 'SUCCESS' && result.audio_link) {
                    audioLink = result.audio_link;
                    console.log(`[VbeeTTS] ✅ Ready after ${(attempt + 1) * POLL_INTERVAL_MS / 1000}s: ${requestId}`);
                    break;
                }

                if (result.status === 'FAILURE') {
                    throw new Error(`Vbee TTS failed for request ${requestId}`);
                }

                // Still IN_PROGRESS, continue polling
                if (attempt % 4 === 3) {
                    console.log(`[VbeeTTS] ⏳ Still processing ${requestId} (${result.progress || 0}%)...`);
                }
            } catch (pollError: any) {
                if (pollError.message?.includes('Vbee TTS failed')) throw pollError;
                console.warn(`[VbeeTTS] Poll error (attempt ${attempt + 1}):`, pollError.message);
            }
        }

        if (!audioLink) {
            throw new Error(`Vbee TTS timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s for request ${requestId}`);
        }

        // Step 3: Download audio file
        const audioResponse = await axios.get(audioLink, {
            responseType: 'arraybuffer',
            timeout: 15000,
        });

        console.log(`[VbeeTTS] ✅ Downloaded ${(audioResponse.data.byteLength / 1024).toFixed(1)}KB audio`);
        return Buffer.from(audioResponse.data);
    }
}

/**
 * Local MiniMax voice smoke test.
 *
 * Hits the MiniMax T2A HTTP endpoint once per approved Vietnamese-profile
 * voice and writes the resulting MP3 hex payload to a local temp dir.
 * Use this to verify provider credentials and per-voice audio quality
 * before wiring up the multi-voice profile in the UI.
 *
 * Usage:
 *   MINIMAX_API_KEY=*** npm run smoke:minimax
 *
 * The script:
 *   - Reads `process.env.MINIMAX_API_KEY` only. The key is never logged
 *     and never written to disk.
 *   - Generates a short Vietnamese text for each of the 4 raw voices in
 *     the user-approved Vietnamese Natural profile.
 *   - Saves outputs to `server/tmp/minimax-smoke/` (gitignored).
 *
 * Exits 0 on full success, non-zero if any voice fails.
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_API_URL = 'https://api.minimax.io/v1/t2a_v2';
const MINIMAX_TTS_MODEL = process.env.MINIMAX_TTS_MODEL || 'speech-2.8-turbo';

interface VoiceSample {
    rawVoiceId: string;
    label: string;
    text: string;
}

const SAMPLES: VoiceSample[] = [
    {
        rawVoiceId: 'male-qn-qingse',
        label: 'Nam kể chuyện',
        text: 'Đêm hôm ấy, trăng mờ tỏ trên đỉnh núi và gió thổi nhẹ qua rừng trúc.',
    },
    {
        rawVoiceId: 'Chinese (Mandarin)_News_Anchor',
        label: 'Trang trọng / Phát thanh',
        text: 'Chương một. Mở đầu câu chuyện bằng một giọng đọc trang trọng, rõ ràng.',
    },
    {
        rawVoiceId: 'Chinese (Mandarin)_Gentleman',
        label: 'Nam thoại',
        text: 'Anh nói: "Chúng ta hãy bước tiếp, còn nhiều điều phía trước đang chờ."',
    },
    {
        rawVoiceId: 'Chinese (Mandarin)_Mature_Woman',
        label: 'Nữ thoại',
        text: 'Cô nói nhỏ nhẹ: "Hãy cẩn thận, đường xa lắm, đừng vội mà gặp nguy hiểm."',
    },
];

async function synthesizeOne(sample: VoiceSample): Promise<{ bytes: number; sampleRate?: number; bitrate?: number; format?: string }> {
    if (!MINIMAX_API_KEY) {
        throw new Error('MINIMAX_API_KEY is not set');
    }

    const response = await axios.post(
        MINIMAX_API_URL,
        {
            model: MINIMAX_TTS_MODEL,
            text: sample.text,
            stream: false,
            voice_setting: {
                voice_id: sample.rawVoiceId,
                speed: 1.0,
                vol: 1.0,
                pitch: 0,
            },
            audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: 'mp3',
                channel: 1,
            },
            language_boost: 'Vietnamese',
        },
        {
            headers: {
                Authorization: `Bearer ${MINIMAX_API_KEY}`,
                'Content-Type': 'application/json',
            },
            // Cap response size defensively; MiniMax clips rarely exceed 1 MB.
            maxContentLength: 4 * 1024 * 1024,
        }
    );

    if (response.data?.base_resp?.status_code !== 0) {
        throw new Error(`MiniMax API error: ${response.data?.base_resp?.status_msg ?? 'unknown'}`);
    }

    const hexAudio: string | undefined = response.data?.data?.audio;
    if (!hexAudio) {
        throw new Error('MiniMax returned no audio data');
    }

    const buffer = Buffer.from(hexAudio, 'hex');
    const outDir = path.resolve(process.cwd(), 'tmp', 'minimax-smoke');
    await fs.mkdir(outDir, { recursive: true });
    const safeFileName = sample.rawVoiceId.replace(/[^A-Za-z0-9._-]/g, '_');
    const outPath = path.join(outDir, `${safeFileName}.mp3`);
    await fs.writeFile(outPath, buffer);

    return {
        bytes: buffer.length,
        sampleRate: response.data?.data?.sample_rate,
        bitrate: response.data?.data?.bitrate,
        format: response.data?.data?.format,
    };
}

async function main(): Promise<void> {
    if (!MINIMAX_API_KEY) {
        console.error('[MiniMax Smoke] MINIMAX_API_KEY is not set; skipping.');
        process.exitCode = 0;
        return;
    }

    console.log(`[MiniMax Smoke] Generating ${SAMPLES.length} voice samples with ${MINIMAX_TTS_MODEL}...`);
    let allOk = true;

    for (const sample of SAMPLES) {
        try {
            const meta = await synthesizeOne(sample);
            console.log(JSON.stringify({
                voice: sample.rawVoiceId,
                label: sample.label,
                bytes: meta.bytes,
                sampleRate: meta.sampleRate,
                bitrate: meta.bitrate,
                format: meta.format,
            }));
        } catch (error) {
            allOk = false;
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[MiniMax Smoke] ❌ ${sample.label} (${sample.rawVoiceId}): ${message}`);
        }
    }

    if (!allOk) {
        process.exitCode = 1;
        return;
    }

    console.log(`[MiniMax Smoke] ✅ All ${SAMPLES.length} samples generated.`);
}

main();

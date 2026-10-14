/**
 * Smoke test for TTS sentence marks — no provider API calls, no cost.
 *
 * Verifies the pieces that must be right before the reader can highlight text:
 *   1. real audio duration probing (ffprobe + MP3 frame fallback)
 *   2. estimated timeline covers every character exactly once, monotonic, ends at duration
 *   3. provider timepoints -> exact marks
 *   4. subtitle payload parsing (JSON array, wrapper object, CSV-ish text)
 *
 * Run: npm run smoke:tts-marks
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    splitIntoSentences,
    estimateSentenceMarks,
    marksFromTimepoints,
    marksFromSubtitleEntries,
    isUsableMarks,
} from '../services/ttsAlignment.js';
import { probeDurationMs, probeMp3DurationMs } from '../services/audioDuration.js';
import { parseSubtitlePayload, buildMarkedSsml } from '../services/ttsTiming.js';

const SAMPLE = 'Trời hôm nay đẹp lạ thường. Gió thổi nhẹ qua hàng cây, mang theo mùi cỏ non. '
    + 'Cô bé ngồi bên cửa sổ, tay cầm cuốn sách cũ. "Chương này hay quá!" — cô nói một mình. '
    + 'Rồi cô đọc tiếp, chậm rãi và rõ ràng, như thể đang kể cho ai đó nghe.';

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
    if (condition) {
        console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
    } else {
        failures += 1;
        console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function run(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 30_000 }, (error) => (error ? reject(error) : resolve()));
    });
}

async function makeSineMp3(seconds: number): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tramdoc-marks-'));
    const file = path.join(dir, 'sine.mp3');
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-b:a', '128k', file]);
    return file;
}

async function main() {
    console.log('TTS marks smoke test\n');

    console.log('1) sentence splitting');
    const sentences = splitIntoSentences(SAMPLE);
    check('produces multiple sentences', sentences.length >= 4, `${sentences.length} sentences`);
    const reconstructed = sentences.map(s => SAMPLE.slice(s.charStart, s.charEnd)).join('|');
    check(
        'offsets slice back to the original text',
        sentences.every(s => SAMPLE.slice(s.charStart, s.charEnd) === s.text)
        && reconstructed.replace(/\|/g, '').replace(/\s/g, '').length > 0,
        `${reconstructed.length} chars across slices`
    );

    console.log('\n2) audio duration probing');
    const mp3 = await makeSineMp3(2.5);
    const probed = await probeDurationMs(mp3);
    check('ffprobe/mp3 walker returns ~2500ms', probed !== null && Math.abs(probed - 2500) < 250, `${probed}ms`);
    const viaFrames = await probeMp3DurationMs(mp3);
    check('pure MP3 frame walker agrees', viaFrames !== null && Math.abs(viaFrames - 2500) < 250, `${viaFrames}ms`);

    console.log('\n3) estimated timeline');
    const marks = estimateSentenceMarks(SAMPLE, probed ?? 2500);
    check('marks are usable', isUsableMarks(marks));
    check('monotonic and non-overlapping', marks.sentences.every((s, i) =>
        i === 0 || s.startMs >= marks.sentences[i - 1].endMs - 1));
    check('starts at 0 and ends at duration', marks.sentences[0].startMs === 0
        && marks.sentences[marks.sentences.length - 1].endMs === Math.round(probed ?? 2500));
    check('every character is covered exactly once', (() => {
        let cursor = 0;
        for (const s of marks.sentences) {
            if (s.charStart < cursor) return false;
            cursor = s.charEnd;
        }
        return cursor <= SAMPLE.length;
    })(), `covered ${marks.sentences[marks.sentences.length - 1].charEnd}/${SAMPLE.length}`);

    console.log('\n4) provider timepoints (google marks shape)');
    const ssml = buildMarkedSsml(SAMPLE);
    check('SSML contains one mark per sentence', Boolean(ssml) && (ssml?.markNames.length ?? 0) === sentences.length);
    const timepoints = (ssml?.markNames ?? []).map((markName, i) => ({ markName, timeSeconds: i * 0.7 }));
    const exact = marksFromTimepoints(SAMPLE, timepoints, 2800);
    check('exact marks from timepoints', isUsableMarks(exact) && exact?.source === 'provider-timepoints');
    check('first mark starts at 0ms', exact?.sentences[0].startMs === 0);
    check('second mark starts at 700ms', exact?.sentences[1]?.startMs === 700, `${exact?.sentences[1]?.startMs}ms`);

    console.log('\n5) subtitle payload parsing');
    const jsonArray = parseSubtitlePayload(JSON.stringify([{ text: 'Trời', start_time: 0, end_time: 300 }]));
    check('JSON array of words parses', Array.isArray(jsonArray) && jsonArray.length === 1);
    const wrapped = parseSubtitlePayload({ words: [{ text: 'Trời', start: 0, end: 0.3 }] });
    check('wrapped {words:[...]} parses', Array.isArray(wrapped) && wrapped.length === 1);
    const csv = parseSubtitlePayload('0.0,0.3,Trời\n0.3,0.9,hôm nay\n');
    check('CSV-ish lines parse', Array.isArray(csv) && csv.length === 2, `${csv?.length} entries`);
    const fromWords = marksFromSubtitleEntries(SAMPLE, (wrapped ?? []) as Array<Record<string, unknown>>, 2500);
    check('word entries map onto sentence marks', isUsableMarks(fromWords));

    await fs.rm(path.dirname(mp3), { recursive: true, force: true });

    console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error('smoke test crashed:', error);
    process.exit(1);
});

void fileURLToPath;
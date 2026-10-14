/**
 * Audio duration probing without new dependencies.
 *
 * 1. `ffprobe` when present (VPS + dev machines have it).
 * 2. Pure-Node MP3 frame walk (works on CBR and VBR by summing frame durations).
 *
 * Used by the alignment estimator to place sentence marks on the real timeline.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';

const MPEG_VERSIONS = ['2.5', 'x', '2', '1'];
const SAMPLE_RATES: Record<string, number[]> = {
    '1': [44100, 48000, 32000],
    '2': [22050, 24000, 16000],
    '2.5': [11025, 12000, 8000],
};
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

export async function probeDurationMs(filePath: string): Promise<number | null> {
    const viaFfprobe = await probeWithFfprobe(filePath);
    if (viaFfprobe !== null) return viaFfprobe;
    return probeMp3DurationMs(filePath);
}

function probeWithFfprobe(filePath: string): Promise<number | null> {
    return new Promise((resolve) => {
        execFile(
            'ffprobe',
            ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
            { timeout: 15_000, windowsHide: true },
            (error, stdout) => {
                if (error) return resolve(null);
                const seconds = Number(String(stdout).trim());
                if (!Number.isFinite(seconds) || seconds <= 0) return resolve(null);
                resolve(Math.round(seconds * 1000));
            }
        );
    });
}

/** Walk MPEG audio frames and sum their durations. Returns null when unparsable. */
export async function probeMp3DurationMs(filePath: string): Promise<number | null> {
    let buf: Buffer;
    try {
        buf = await fs.readFile(filePath);
    } catch {
        return null;
    }
    let offset = skipId3v2(buf);
    let totalSeconds = 0;
    let frames = 0;
    let frameErrorsInARow = 0;

    while (offset + 4 <= buf.length) {
        const header = buf.readUInt32BE(offset);
        // Unsigned compare: `header & 0xffe00000` yields a negative int32 in JS, so
        // comparing it against the unsigned literal would always be false.
        if ((header >>> 21) !== 0x7ff) {
            // Resync: look for the next plausible frame header.
            offset += 1;
            if (++frameErrorsInARow > 4096) break;
            continue;
        }
        frameErrorsInARow = 0;

        const versionBits = (header >> 19) & 0b11;
        const version = MPEG_VERSIONS[versionBits];
        const layerBits = (header >> 17) & 0b11;
        const bitrateIdx = (header >> 12) & 0b1111;
        const rateIdx = (header >> 10) & 0b11;
        const padding = (header >> 9) & 0b1;

        if (version === 'x' || layerBits !== 0b01 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) {
            offset += 1;
            if (++frameErrorsInARow > 4096) break;
            continue;
        }

        const table = version === '1' ? BITRATES_V1_L3 : BITRATES_V2_L3;
        const bitrateKbps = table[bitrateIdx];
        const sampleRate = SAMPLE_RATES[version]?.[rateIdx];
        if (!bitrateKbps || !sampleRate) {
            offset += 1;
            continue;
        }

        const isV1 = version === '1';
        const samplesPerFrame = isV1 ? 1152 : 576;
        const frameLength = Math.floor(((isV1 ? 144000 : 72000) * bitrateKbps) / sampleRate) + padding;
        if (frameLength <= 4) {
            offset += 1;
            continue;
        }

        totalSeconds += samplesPerFrame / sampleRate;
        frames += 1;
        offset += frameLength;
    }

    if (!frames) return null;
    return Math.round(totalSeconds * 1000);
}

function skipId3v2(buf: Buffer): number {
    if (buf.length < 10) return 0;
    if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0; // "ID3"
    const size =
        ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    return 10 + size;
}
import path from 'path';
import fs from 'fs/promises';

const audioDir = path.resolve(process.cwd(), 'audio');
const coverDir = path.resolve(process.cwd(), 'uploads/covers');

export async function cleanupBookFiles(bookId: number, coverImagePath?: string | null): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    const safeCoverPath = resolveCoverPath(coverImagePath);
    if (safeCoverPath) {
        tasks.push(fs.unlink(safeCoverPath).catch(() => { }));
    }

    tasks.push(cleanupBookAudioFiles(bookId));

    await Promise.all(tasks);
}

function resolveCoverPath(coverImagePath?: string | null): string | null {
    if (!coverImagePath) return null;

    const resolved = path.resolve(process.cwd(), coverImagePath);
    if (!resolved.startsWith(`${coverDir}${path.sep}`)) {
        return null;
    }

    return resolved;
}

async function cleanupBookAudioFiles(bookId: number): Promise<void> {
    const prefix = `${bookId}_`;

    try {
        const entries = await fs.readdir(audioDir);
        await Promise.all(entries
            .filter(fileName => fileName.startsWith(prefix) && fileName.endsWith('.mp3'))
            .map(fileName => fs.unlink(path.join(audioDir, fileName)).catch(() => { }))
        );
    } catch {
        // Audio cache directory may not exist in fresh installs.
    }
}

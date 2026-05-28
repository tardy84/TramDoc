import path from 'path';
import fs from 'fs/promises';

const audioDir = path.resolve(process.cwd(), 'audio');

export async function cleanupBookFiles(bookId: number, coverImagePath?: string | null): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    if (coverImagePath) {
        tasks.push(fs.unlink(coverImagePath).catch(() => { }));
    }

    tasks.push(cleanupBookAudioFiles(bookId));

    await Promise.all(tasks);
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

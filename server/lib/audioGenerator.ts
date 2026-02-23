import path from 'path';
import fs from 'fs/promises';
import prisma from './prisma.js';
import ttsService from './tts.js';

const generatingFiles = new Set<string>();

export async function generateSegment(bookId: number, chapterId: number, segmentIndex: number, voice: string): Promise<boolean> {
    const fileName = `${bookId}_${chapterId}_${voice}_${segmentIndex}.mp3`;
    const filePath = path.join(process.cwd(), 'audio', fileName);

    // 1. Check if already exists
    try {
        await fs.access(filePath);
        return true;
    } catch {
        // Continue
    }

    // 2. Check if currently generating (Dedup)
    if (generatingFiles.has(fileName)) {
        const MAX_WAIT = 60;
        let attempts = 0;

        while (generatingFiles.has(fileName) && attempts < MAX_WAIT) {
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }

        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    generatingFiles.add(fileName);

    try {
        const segment = await prisma.textSegment.findFirst({
            where: { chapterId, orderIndex: segmentIndex }
        });

        if (!segment) {
            generatingFiles.delete(fileName);
            return false;
        }

        const buffer = await ttsService.synthesize(
            segment.content,
            segment.role as any,
            voice
        );

        await fs.writeFile(filePath, buffer);
        console.log(`[Audio] ✅ Generated: ${fileName}`);
        return true;
    } catch (error) {
        console.error(`[Audio] ❌ Failed to generate ${fileName}:`, error);
        return false;
    } finally {
        generatingFiles.delete(fileName);
    }
}

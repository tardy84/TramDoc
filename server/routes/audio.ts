import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { generateSegment } from '../lib/audioGenerator.js';

const router = express.Router();

router.get('/:filename', async (req, res) => {
    const { filename } = req.params as { filename: string };
    const filePath = path.join(process.cwd(), 'audio', filename);
    const baseName = filename.split('.')[0];
    const parts = baseName.split('_');

    try {
        await fs.access(filePath);
        return res.sendFile(filePath);
    } catch {
        // Cache miss
    }

    let bookId, chapterId, segmentIndex, voice: string;

    if (parts.length === 4) {
        bookId = parseInt(parts[0]);
        chapterId = parseInt(parts[1]);
        voice = parts[2];
        segmentIndex = parseInt(parts[3]);
    } else if (parts.length === 3) {
        bookId = parseInt(parts[0]);
        chapterId = parseInt(parts[1]);
        segmentIndex = parseInt(parts[2]);
        voice = 'vi-VN-Wavenet-B';
    } else {
        return res.status(400).send('Invalid');
    }

    console.log(`[Audio] ⚠️ Cache Miss: ${filename}. Generating on-demand...`);

    try {
        await generateSegment(bookId, chapterId, segmentIndex, voice);

        // Lookahead
        (async () => {
            await generateSegment(bookId, chapterId, segmentIndex + 1, voice);
            await generateSegment(bookId, chapterId, segmentIndex + 2, voice);
            await generateSegment(bookId, chapterId, segmentIndex + 3, voice);
        })();

        res.sendFile(filePath);
    } catch (error) {
        res.status(500).send('Gen Failed');
    }
});

export default router;

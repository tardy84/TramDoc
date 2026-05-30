import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { EpubProcessor } from '../services/epubProcessor.js';

interface FixtureExpectation {
    file: string;
    minChapters: number;
    minSegments: number;
    expectedFirstTitle?: string;
}

const fixtures: FixtureExpectation[] = [
    {
        file: '../test/Trại Súc Vật - George Orwell & Phạm Minh Ngọc (dịch).epub',
        minChapters: 10,
        minSegments: 700,
        expectedFirstTitle: 'Lời tựa',
    },
    {
        file: '../test/Dia dang tran gian - Thomas More.epub',
        minChapters: 12,
        minSegments: 1000,
        expectedFirstTitle: 'GIỚI THIỆU',
    },
];

const prisma = new PrismaClient();
const processor = new EpubProcessor();

function assertCondition(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function isDecorativeSeparator(text: string): boolean {
    const normalized = text.trim();
    return /^(?:[-–—_*~•·\s]){3,}$/.test(normalized) ||
        /^(?:[-–—_*~•·\s]*o+[-–—_*~•·\s]*){2,}$/i.test(normalized);
}

async function cleanupBook(bookId: number, coverImagePath?: string | null) {
    await prisma.book.delete({ where: { id: bookId } }).catch(() => { });
    if (coverImagePath) {
        await fs.unlink(coverImagePath).catch(() => { });
    }
}

try {
    for (const fixture of fixtures) {
        const fixturePath = path.resolve(process.cwd(), fixture.file);
        await fs.access(fixturePath);

        let bookId: number | null = null;
        let coverImagePath: string | null | undefined;

        try {
            bookId = await processor.processEpub(fixturePath);
            const book = await prisma.book.findUnique({
                where: { id: bookId },
                include: {
                    chapters: {
                        include: { segments: true },
                        orderBy: { orderIndex: 'asc' },
                    },
                },
            });

            assertCondition(book, `Book ${bookId} was not found after processing`);
            coverImagePath = book.coverImagePath;

            const segments = book.chapters.flatMap(chapter => chapter.segments.map(segment => segment.content));
            const emptyChapters = book.chapters.filter(chapter => chapter.segments.length === 0);
            const maxSegmentLength = Math.max(...segments.map(segment => segment.length));
            const decorativeSegments = segments.filter(isDecorativeSeparator);

            assertCondition(book.chapters.length >= fixture.minChapters, `${path.basename(fixture.file)} parsed too few chapters: ${book.chapters.length}`);
            assertCondition(segments.length >= fixture.minSegments, `${path.basename(fixture.file)} parsed too few segments: ${segments.length}`);
            assertCondition(emptyChapters.length === 0, `${path.basename(fixture.file)} produced empty chapters: ${emptyChapters.map(chapter => chapter.title).join(', ')}`);
            assertCondition(maxSegmentLength <= 700, `${path.basename(fixture.file)} produced overlong TTS segment: ${maxSegmentLength}`);
            assertCondition(decorativeSegments.length === 0, `${path.basename(fixture.file)} kept decorative segments: ${decorativeSegments.slice(0, 3).join(' | ')}`);
            if (fixture.expectedFirstTitle) {
                assertCondition(book.chapters[0]?.title === fixture.expectedFirstTitle, `${path.basename(fixture.file)} first chapter title mismatch: ${book.chapters[0]?.title}`);
            }

            console.log(JSON.stringify({
                fixture: path.basename(fixture.file),
                title: book.title,
                chapters: book.chapters.length,
                segments: segments.length,
                maxSegmentLength,
                firstTitles: book.chapters.slice(0, 5).map(chapter => chapter.title),
            }));
        } finally {
            if (bookId) {
                await cleanupBook(bookId, coverImagePath);
            }
        }
    }
} finally {
    await prisma.$disconnect();
}

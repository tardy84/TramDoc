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

            // Surface role distribution so we can see whether multi-voice
            // profile segments (narrator / heading / male / female / child)
            // are actually being produced. Don't fail on absence of male/
            // female/child — some fixtures have no dialogue — but fail if
            // every segment has an empty/invalid role string.
            const roleCounts = await prisma.textSegment.groupBy({
                by: ['role'],
                where: { chapter: { bookId: book.id } },
                _count: { role: true },
            });
            const totalRoleSegments = roleCounts.reduce((sum, entry) => sum + entry._count.role, 0);
            const validRoles = roleCounts.filter(entry => typeof entry.role === 'string' && entry.role.length > 0);
            assertCondition(validRoles.length > 0, `${path.basename(fixture.file)} produced no valid role labels`);
            assertCondition(totalRoleSegments === segments.length, `${path.basename(fixture.file)} role count mismatch: ${totalRoleSegments} vs ${segments.length}`);
            console.log('[EPUB Smoke] role counts:', roleCounts.map(entry => ({ role: entry.role, count: entry._count.role })));

            const sampledSegments = await prisma.textSegment.findMany({
                where: { chapter: { bookId: book.id } },
                orderBy: { id: 'asc' },
                take: 50,
                select: { role: true, ttsHints: true },
            });
            assertCondition(sampledSegments.length > 0, `${path.basename(fixture.file)} produced no sampled segments`);

            let hintsWithJson = 0;
            for (const segment of sampledSegments) {
                assertCondition(typeof segment.role === 'string' && segment.role.length > 0, `${path.basename(fixture.file)} produced sampled segment without role`);
                if (!segment.ttsHints) continue;

                const parsed = JSON.parse(segment.ttsHints) as { version?: unknown; tone?: unknown; pace?: unknown; confidence?: unknown };
                assertCondition(parsed.version === 1, `${path.basename(fixture.file)} ttsHints version mismatch`);
                assertCondition(typeof parsed.tone === 'string' && parsed.tone.length > 0, `${path.basename(fixture.file)} ttsHints missing tone`);
                assertCondition(typeof parsed.pace === 'string' && parsed.pace.length > 0, `${path.basename(fixture.file)} ttsHints missing pace`);
                assertCondition(typeof parsed.confidence === 'number', `${path.basename(fixture.file)} ttsHints missing confidence`);
                hintsWithJson++;
            }

            const minHints = Math.ceil(sampledSegments.length * 0.8);
            assertCondition(hintsWithJson >= minHints, `${path.basename(fixture.file)} ttsHints coverage too low: ${hintsWithJson}/${sampledSegments.length}`);
            console.log(`[smoke-epub] ttsHints coverage: ${hintsWithJson}/${sampledSegments.length} sampled segments`);
        } finally {
            if (bookId) {
                await cleanupBook(bookId, coverImagePath);
            }
        }
    }
} finally {
    await prisma.$disconnect();
}

import { Prisma, PrismaClient } from '@prisma/client';
import { inferProsody, SegmentRole } from './epubProsodyAnalyzer.js';
import { serializeTtsHints } from './ttsHints.js';

export interface ReanalyzeBookTtsHintsResult {
    bookId: number;
    totalSegments: number;
    updatedSegments: number;
    skippedSegments: number;
    toneCounts: Record<string, number>;
}

export interface ReanalyzeBookTtsHintsOptions {
    force?: boolean;
    batchSize?: number;
}

const VALID_SEGMENT_ROLES = new Set<SegmentRole>(['narrator', 'heading', 'male', 'female', 'child']);
const DEFAULT_BATCH_SIZE = 100;

export async function reanalyzeBookTtsHints(
    prisma: PrismaClient,
    bookId: number,
    userId: number,
    options: ReanalyzeBookTtsHintsOptions = {}
): Promise<ReanalyzeBookTtsHintsResult> {
    const book = await prisma.book.findFirst({
        where: { id: bookId, userId },
        select: { id: true },
    });
    if (!book) throw new Error('Book not found');

    const segments = await prisma.textSegment.findMany({
        where: { chapter: { bookId } },
        orderBy: [
            { chapter: { orderIndex: 'asc' } },
            { orderIndex: 'asc' },
        ],
        select: { id: true, content: true, role: true, ttsHints: true },
    });

    let updatedSegments = 0;
    let skippedSegments = 0;
    const toneCounts: Record<string, number> = {};
    let previousRole: SegmentRole | undefined;
    let previousText: string | undefined;
    const pendingUpdates: Prisma.PrismaPromise<unknown>[] = [];
    const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, 500));

    const flushUpdates = async () => {
        if (pendingUpdates.length === 0) return;
        await prisma.$transaction(pendingUpdates.splice(0, pendingUpdates.length));
    };

    for (const segment of segments) {
        if (segment.ttsHints && !options.force) {
            skippedSegments += 1;
            previousRole = normalizeSegmentRole(segment.role);
            previousText = segment.content;
            continue;
        }

        const initialRole = normalizeSegmentRole(segment.role);
        const result = inferProsody(segment.content, initialRole, { previousRole, previousText });
        toneCounts[result.hints.tone] = (toneCounts[result.hints.tone] || 0) + 1;

        pendingUpdates.push(prisma.textSegment.update({
            where: { id: segment.id },
            data: {
                role: result.role,
                ttsHints: serializeTtsHints(result.hints),
            },
        }));

        updatedSegments += 1;
        previousRole = result.role;
        previousText = segment.content;

        if (pendingUpdates.length >= batchSize) {
            await flushUpdates();
        }
    }

    await flushUpdates();

    return {
        bookId,
        totalSegments: segments.length,
        updatedSegments,
        skippedSegments,
        toneCounts,
    };
}

function normalizeSegmentRole(role: string | null | undefined): SegmentRole {
    return role && VALID_SEGMENT_ROLES.has(role as SegmentRole)
        ? role as SegmentRole
        : 'narrator';
}

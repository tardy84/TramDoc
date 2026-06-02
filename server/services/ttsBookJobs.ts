export type TtsBookJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TtsBookJobProgress {
    jobId: string;
    userId: number;
    bookId: number;
    voice: string;
    mode: 'missing' | 'force';
    quality?: 'low' | 'standard' | 'high';
    expressive?: boolean;
    status: TtsBookJobStatus;
    totalSegments: number;
    cachedSegments: number;
    generatedSegments: number;
    failedSegments: number;
    skippedSegments: number;
    currentChapterId?: number;
    currentChapterTitle?: string;
    currentSegmentIndex?: number;
    error?: string;
    createdAt: string;
    updatedAt: string;
    cancelledAt?: string;
    completedAt?: string;
}

const jobs = new Map<string, TtsBookJobProgress>();
const cancelledJobs = new Set<string>();

export function createTtsBookJob(input: Omit<TtsBookJobProgress, 'createdAt' | 'updatedAt' | 'status'>): TtsBookJobProgress {
    const now = new Date().toISOString();
    const job: TtsBookJobProgress = {
        ...input,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
    };
    jobs.set(job.jobId, job);
    return job;
}

export function getTtsBookJob(jobId: string): TtsBookJobProgress | undefined {
    return jobs.get(jobId);
}

export function updateTtsBookJob(jobId: string, patch: Partial<TtsBookJobProgress>): TtsBookJobProgress | undefined {
    const current = jobs.get(jobId);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    jobs.set(jobId, next);
    return next;
}

export function cancelTtsBookJob(jobId: string): TtsBookJobProgress | undefined {
    cancelledJobs.add(jobId);
    return updateTtsBookJob(jobId, { status: 'cancelled', cancelledAt: new Date().toISOString() });
}

export function isTtsBookJobCancelled(jobId: string): boolean {
    return cancelledJobs.has(jobId);
}

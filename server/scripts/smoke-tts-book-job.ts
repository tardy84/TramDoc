import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { spawn, type ChildProcess } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import {
    cancelTtsBookJob,
    createTtsBookJob,
    getTtsBookJob,
    isTtsBookJobCancelled,
    updateTtsBookJob,
} from '../services/ttsBookJobs.js';

const execFileAsync = promisify(execFile);

async function smokeInMemoryJobStore() {
    const job = createTtsBookJob({
        jobId: 'smoke-job-1',
        userId: 1,
        bookId: 1,
        voice: 'minimax-profile-vietnamese-natural-v1',
        mode: 'missing',
        totalSegments: 3,
        cachedSegments: 0,
        generatedSegments: 0,
        failedSegments: 0,
        skippedSegments: 1,
    });

    assert.equal(job.status, 'queued');
    assert.equal(getTtsBookJob(job.jobId)?.jobId, job.jobId);

    const running = updateTtsBookJob(job.jobId, { status: 'running', generatedSegments: 1 });
    assert.equal(running?.status, 'running');
    assert.equal(running?.generatedSegments, 1);

    const cancelled = cancelTtsBookJob(job.jobId);
    assert.equal(cancelled?.status, 'cancelled');
    assert.equal(isTtsBookJobCancelled(job.jobId), true);
}

async function waitForServer(port: number, server: ChildProcess) {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (server.exitCode !== null) {
            throw new Error(`Smoke server exited early with code ${server.exitCode}`);
        }

        try {
            const res = await fetch(`http://127.0.0.1:${port}/ping`);
            if (res.ok) return;
        } catch {
            // retry
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error('Smoke server did not start in time');
}

async function readJson(res: Response) {
    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

async function waitForJob(base: string, bookId: number, jobId: string, status: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
        const res = await fetch(`${base}/books/${bookId}/tts/jobs/${jobId}`);
        assert.equal(res.status, 200);
        const job = await readJson(res);
        if (job.status === status) return job;
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Job ${jobId} did not reach ${status}`);
}

async function seedSmokeBook(databaseUrl: string) {
    process.env.DATABASE_URL = databaseUrl;
    const prisma = new PrismaClient();
    try {
        await prisma.user.upsert({
            where: { id: 1 },
            update: { email: 'local@tramdoc.dev', role: 'ADMIN', name: 'Trạm Đọc Local' },
            create: {
                id: 1,
                email: 'local@tramdoc.dev',
                passwordHash: 'local-auth-bypass',
                role: 'ADMIN',
                name: 'Trạm Đọc Local',
            },
        });

        const book = await prisma.book.create({ data: { title: 'Smoke Book', author: 'Codex', userId: 1 } });
        const chapter = await prisma.chapter.create({ data: { title: 'Chương smoke', orderIndex: 0, bookId: book.id } });
        await prisma.textSegment.createMany({
            data: [
                { chapterId: chapter.id, orderIndex: 0, role: 'narrator', content: 'Một đoạn kiểm thử ngắn.' },
                { chapterId: chapter.id, orderIndex: 1, role: 'narrator', content: '***' },
            ],
        });

        return book.id;
    } finally {
        await prisma.$disconnect();
    }
}

async function smokeRoutes() {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tramdoc-tts-job-'));
    const databaseUrl = `file:${path.join(tmpDir, 'smoke.db')}`;
    const port = 33205 + Math.floor(Math.random() * 1000);
    const env = {
        ...process.env,
        DATABASE_URL: databaseUrl,
        JWT_SECRET: 'local-smoke-secret',
        TRAMDOC_BYPASS_AUTH: '1',
        PORT: String(port),
        GOOGLE_TTS_API_KEY: '',
        GOOGLE_CLOUD_API_KEY: '',
        AZURE_SPEECH_KEY: '',
        AZURE_SPEECH_REGION: '',
        MINIMAX_API_KEY: '',
        GEMINI_API_KEY: '',
        VBEE_APP_ID: '',
        VBEE_TOKEN: '',
    };

    let server: ChildProcess | null = null;
    try {
        await execFileAsync('npx', ['prisma', 'db', 'push', '--skip-generate'], { env });
        const bookId = await seedSmokeBook(databaseUrl);

        server = spawn('npx', ['tsx', 'index.ts'], {
            cwd: process.cwd(),
            env,
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        await waitForServer(port, server);

        const base = `http://127.0.0.1:${port}/api`;
        let res = await fetch(`${base}/books/${bookId}/tts/status?voice=../bad`);
        assert.equal(res.status, 400);

        res = await fetch(`${base}/books/9999/tts/status?voice=minimax-profile-vietnamese-natural-v1`);
        assert.equal(res.status, 404);

        res = await fetch(`${base}/books/${bookId}/tts/status?voice=minimax-profile-vietnamese-natural-v1`);
        assert.equal(res.status, 200);
        const status = await readJson(res);
        assert.equal(status.total, 1);
        assert.equal(status.cached, 0);
        assert.equal(status.missing, 1);
        assert.equal(status.skipped, 1);
        assert.equal(status.chapters[0].total, 1);

        res = await fetch(`${base}/books/${bookId}/tts/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice: '../bad' }),
        });
        assert.equal(res.status, 400);

        res = await fetch(`${base}/books/9999/tts/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice: 'minimax-profile-vietnamese-natural-v1', confirmExpensiveProvider: true }),
        });
        assert.equal(res.status, 404);

        res = await fetch(`${base}/books/${bookId}/tts/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice: 'vbee-n_hn_male_ngankechuyen_ytstable_vc', mode: 'missing' }),
        });
        assert.equal(res.status, 400);

        res = await fetch(`${base}/books/${bookId}/tts/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice: 'minimax-profile-vietnamese-natural-v1', mode: 'missing' }),
        });
        assert.equal(res.status, 400);

        res = await fetch(`${base}/books/${bookId}/tts/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice: 'minimax-profile-vietnamese-natural-v1', quality: 'huge', confirmExpensiveProvider: true }),
        });
        assert.equal(res.status, 400);

        res = await fetch(`${base}/books/${bookId}/tts/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice: 'minimax-profile-vietnamese-natural-v1', mode: 'missing', quality: 'standard', confirmExpensiveProvider: true }),
        });
        assert.equal(res.status, 202);
        const job = await readJson(res);
        assert.equal(typeof job.jobId, 'string');
        assert.equal(job.quality, 'standard');

        const failedJob = await waitForJob(base, bookId, job.jobId, 'failed');
        assert.equal(failedJob.failedSegments, 1);
        assert.match(failedJob.error, /Không tạo được 1 đoạn audio/);

        res = await fetch(`${base}/books/${bookId}/tts/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice: 'minimax-profile-vietnamese-natural-v1', mode: 'missing', confirmExpensiveProvider: true }),
        });
        assert.equal(res.status, 202);
        const cancellableJob = await readJson(res);
        assert.equal(typeof cancellableJob.jobId, 'string');

        res = await fetch(`${base}/books/${bookId}/tts/jobs/${cancellableJob.jobId}`);
        assert.equal(res.status, 200);
        const polled = await readJson(res);
        assert.equal(polled.jobId, cancellableJob.jobId);

        res = await fetch(`${base}/books/${bookId}/tts/jobs/${cancellableJob.jobId}/cancel`, { method: 'POST' });
        assert.equal(res.status, 200);
        const cancelled = await readJson(res);
        assert.equal(cancelled.status, 'cancelled');
    } finally {
        if (server) server.kill();
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

await smokeInMemoryJobStore();
await smokeRoutes();
console.log('[smoke-tts-book-job] ok');

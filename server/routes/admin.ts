import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { authenticateAdmin, AuthRequest } from '../middleware/auth.js';
import { cleanupBookFiles } from '../services/bookFileCleanup.js';

const router = Router();
const prisma = new PrismaClient();

function parsePositiveInt(value: string): number | null {
    if (!/^\d+$/.test(value)) return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function parsePositiveIntArray(value: unknown): number[] | null {
    if (!Array.isArray(value)) return null;

    const ids = value.map(id => parsePositiveInt(String(id)));
    if (ids.some(id => id === null)) return null;

    return Array.from(new Set(ids as number[]));
}

// --- ADMIN ENDPOINTS ---
router.get('/stats', authenticateAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const userCount = await prisma.user.count();
        const bookCount = await prisma.book.count();
        const chapterCount = await prisma.chapter.count();
        const segmentCount = await prisma.textSegment.count();
        const recentUsers = await prisma.user.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: { id: true, email: true, name: true, createdAt: true, avatarUrl: true }
        });
        res.json({ userCount, bookCount, chapterCount, segmentCount, recentUsers });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/users', authenticateAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            include: {
                books: { select: { id: true, title: true } },
                _count: { select: { books: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(users);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/books', authenticateAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const books = await prisma.book.findMany({
            include: {
                user: { select: { name: true, email: true } },
                _count: { select: { chapters: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        const transformedBooks = books.map(book => ({
            ...book,
            coverImageUrl: book.coverImagePath ? `/covers/${path.basename(book.coverImagePath)}` : (book.coverUrl || null)
        }));
        res.json(transformedBooks);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/users/:id', authenticateAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const id = parsePositiveInt(req.params.id as string);
        if (!id) {
            return res.status(400).json({ error: 'ID người dùng không hợp lệ' });
        }

        if (id === req.user?.id) {
            return res.status(400).json({ error: 'Cannot delete yourself' });
        }
        await prisma.user.delete({ where: { id } });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/users/:id/password', authenticateAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const id = parsePositiveInt(req.params.id as string);
        if (!id) {
            return res.status(400).json({ error: 'ID người dùng không hợp lệ' });
        }

        const { newPassword } = req.body;
        if (typeof newPassword !== 'string' || newPassword.length === 0) {
            return res.status(400).json({ error: 'Mật khẩu mới không hợp lệ' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id },
            data: { passwordHash }
        });

        res.json({ success: true, message: 'Reset mật khẩu thành công' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/books/:id', authenticateAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const id = parsePositiveInt(req.params.id as string);
        if (!id) {
            return res.status(400).json({ error: 'ID sách không hợp lệ' });
        }

        const book = await prisma.book.findUnique({ where: { id } });
        if (!book) return res.status(404).json({ error: 'Book not found' });

        await prisma.book.delete({ where: { id } });

        await cleanupBookFiles(id, book.coverImagePath);

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/books/bulk-delete', authenticateAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const { ids } = req.body;
        const parsedIds = parsePositiveIntArray(ids);
        if (!parsedIds) return res.status(400).json({ error: 'Danh sách ID sách không hợp lệ' });

        const books = await prisma.book.findMany({
            where: { id: { in: parsedIds } }
        });

        await prisma.book.deleteMany({
            where: { id: { in: parsedIds } }
        });

        // Cleanup files
        for (const book of books) {
            await cleanupBookFiles(book.id, book.coverImagePath);
        }

        res.json({ success: true, count: books.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

import express from 'express';
import path from 'path';
import prisma from '../lib/prisma.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/stats', authenticateAdmin, async (req, res) => {
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

router.get('/users', authenticateAdmin, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            include: {
                _count: { select: { books: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(users);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/books', authenticateAdmin, async (req, res) => {
    try {
        const books = await prisma.book.findMany({
            include: {
                user: { select: { name: true, email: true } },
                _count: { select: { chapters: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        const transformedBooks = books.map((book: any) => ({
            ...book,
            coverImageUrl: book.coverImagePath ? `/covers/${path.basename(book.coverImagePath)}` : (book.coverUrl || null)
        }));
        res.json(transformedBooks);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/users/:id', authenticateAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (id === (req.user as any).id) {
            return res.status(400).json({ error: 'Cannot delete yourself' });
        }
        await prisma.user.delete({ where: { id } });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

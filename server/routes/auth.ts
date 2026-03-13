import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { authenticateJWT, AuthRequest } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';

// Login (Strictly using .env configurations)
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const envUser = process.env.ADMIN_USERNAME;
        const envPass = process.env.ADMIN_PASSWORD;

        if (username === envUser && password === envPass) {
            const passwordHash = await bcrypt.hash(password, 10);
            
            // Upsert User ID 1 to ensure referential integrity for uploads and books
            const user = await prisma.user.upsert({
                where: { id: 1 },
                update: { email: username, passwordHash, role: 'ADMIN', name: 'Admin' },
                create: { id: 1, email: username, passwordHash, role: 'ADMIN', name: 'Admin' }
            });

            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
            return res.json({ token, user: { id: user.id, username: user.email, name: user.name, role: user.role } });
        }

        return res.status(400).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
    } catch (error: any) {
        console.error('[Auth Login Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Me
router.get('/me', authenticateJWT, async (req: AuthRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, role: user.role });
});

// Change Password (Self)
router.patch('/change-password', authenticateJWT, async (req: AuthRequest, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });

        if (!user || !user.passwordHash) {
            return res.status(400).json({ error: 'User not found or using social login' });
        }

        const validPassword = await bcrypt.compare(oldPassword, user.passwordHash);
        if (!validPassword) return res.status(400).json({ error: 'Mật khẩu cũ không chính xác' });

        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: newPasswordHash }
        });

        res.json({ success: true, message: 'Đổi mật khẩu thành công' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

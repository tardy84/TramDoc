import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { authenticateJWT, AuthRequest } from '../middleware/auth.js';
import { JWT_SECRET } from '../config/env.js';

const router = Router();
const prisma = new PrismaClient();

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function getLoginRateLimitKey(req: AuthRequest): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
        return forwardedFor.split(',')[0].trim();
    }

    return req.ip || 'unknown';
}

function getActiveLoginAttempt(key: string): { count: number; resetAt: number } | null {
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (!current || current.resetAt <= now) return null;
    return current;
}

function isLoginRateLimited(key: string): boolean {
    const current = getActiveLoginAttempt(key);
    return Boolean(current && current.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
}

function recordFailedLoginAttempt(key: string): void {
    const now = Date.now();
    const current = getActiveLoginAttempt(key);
    if (!current) {
        loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS });
        return;
    }

    current.count += 1;
}

// Login (Strictly using .env configurations)
router.post('/login', async (req, res) => {
    try {
        const rateLimitKey = getLoginRateLimitKey(req);
        const { username, password } = req.body;
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Tên đăng nhập hoặc mật khẩu không hợp lệ' });
        }

        const envUser = process.env.ADMIN_USERNAME;
        const envPass = process.env.ADMIN_PASSWORD;
        if (!envUser || !envPass) {
            return res.status(503).json({ error: 'Đăng nhập chưa được cấu hình' });
        }

        const validCredentials = username === envUser && password === envPass;
        if (validCredentials) {
            loginAttempts.delete(rateLimitKey);
            const passwordHash = await bcrypt.hash(password, 10);

            // Upsert User ID 1 to ensure referential integrity for uploads and books
            const user = await prisma.user.upsert({
                where: { id: 1 },
                update: { email: username, passwordHash, role: 'ADMIN', name: 'Admin' },
                create: { id: 1, email: username, passwordHash, role: 'ADMIN', name: 'Admin' }
            });

            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
            return res.json({ token, user: { id: user.id, email: user.email, username: user.email, name: user.name, role: user.role } });
        }

        if (isLoginRateLimited(rateLimitKey)) {
            return res.status(429).json({ error: 'Bạn thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.' });
        }

        recordFailedLoginAttempt(rateLimitKey);
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
        if (typeof oldPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length === 0) {
            return res.status(400).json({ error: 'Mật khẩu không hợp lệ' });
        }

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

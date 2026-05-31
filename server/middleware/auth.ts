import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { JWT_SECRET } from '../config/env.js';

const prisma = new PrismaClient();
const LOCAL_AUTH_BYPASS_USER_ID = 1;

export interface AuthRequest extends Request {
    user?: any;
}

function isLocalAuthBypassEnabled(): boolean {
    return process.env.TRAMDOC_BYPASS_AUTH === '1';
}

async function getOrCreateLocalBypassUser() {
    return prisma.user.upsert({
        where: { id: LOCAL_AUTH_BYPASS_USER_ID },
        update: { email: 'local@tramdoc.dev', role: 'ADMIN', name: 'Trạm Đọc Local' },
        create: {
            id: LOCAL_AUTH_BYPASS_USER_ID,
            email: 'local@tramdoc.dev',
            passwordHash: 'local-auth-bypass',
            role: 'ADMIN',
            name: 'Trạm Đọc Local'
        }
    });
}

interface JwtUserPayload {
    id: number;
    email?: string;
}

function getBearerToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;

    const token = authHeader.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
}

function isJwtUserPayload(value: unknown): value is JwtUserPayload {
    return typeof value === 'object' &&
        value !== null &&
        Number.isInteger((value as JwtUserPayload).id);
}

export const authenticateJWT = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (isLocalAuthBypassEnabled()) {
        try {
            req.user = await getOrCreateLocalBypassUser();
            return next();
        } catch (err: any) {
            console.error('[Auth] Local auth bypass user setup failed:', err.message);
            return res.sendStatus(500);
        }
    }

    const token = getBearerToken(req);
    if (!token) {
        console.warn('[Auth] No Authorization header provided');
        return res.sendStatus(401);
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!isJwtUserPayload(decoded)) {
            return res.sendStatus(403);
        }

        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user) {
            return res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.' });
        }

        req.user = user;
        return next();
    } catch (err: any) {
        if (err?.name !== 'JsonWebTokenError' && err?.name !== 'TokenExpiredError') {
            console.error('[Auth] User lookup failed:', err.message);
            return res.sendStatus(500);
        }
        console.error(`[Auth] JWT Error: ${err.message} (${req.method} ${req.originalUrl})`);
        return res.sendStatus(403);
    }
};

export const authenticateAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (isLocalAuthBypassEnabled()) {
        try {
            req.user = await getOrCreateLocalBypassUser();
            return next();
        } catch (err: any) {
            console.error('[Auth] Local admin bypass user setup failed:', err.message);
            return res.sendStatus(500);
        }
    }

    const token = getBearerToken(req);
    if (!token) {
        return res.sendStatus(401);
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!isJwtUserPayload(decoded)) {
            return res.sendStatus(403);
        }

        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        req.user = user;
        return next();
    } catch (error: any) {
        if (error?.name !== 'JsonWebTokenError' && error?.name !== 'TokenExpiredError') {
            console.error('[Auth] Admin authentication failed:', error.message);
        }
        return res.sendStatus(403);
    }
};

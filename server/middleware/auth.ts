import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { JWT_SECRET } from '../config/env.js';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
    user?: any;
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

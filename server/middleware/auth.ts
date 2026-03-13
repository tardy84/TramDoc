import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticateJWT = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
            if (err) {
                console.error(`[Auth] JWT Error: ${err.message} (${req.method} ${req.originalUrl})`);
                console.error(`[Auth] Header: ${authHeader}`);
                return res.sendStatus(403);
            }
            req.user = user;
            console.log(`[Auth] User authenticated: ${user.email} (${user.id})`);
            next();
        });
    } else {
        console.warn('[Auth] No Authorization header provided');
        res.sendStatus(401);
    }
};

export const authenticateAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, async (err: any, decoded: any) => {
            if (err) return res.sendStatus(403);
            const user = await prisma.user.findUnique({ where: { id: (decoded as any).id } });
            if (user?.role === 'ADMIN') {
                req.user = user;
                next();
            } else {
                res.status(403).json({ error: 'Admin access required' });
            }
        });
    } else {
        res.sendStatus(401);
    }
};

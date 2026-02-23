import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';

export const authenticateJWT = (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
            if (err) {
                console.error(`[Auth] JWT Error: ${err.message} (${req.method} ${req.originalUrl})`);
                return res.sendStatus(403);
            }
            req.user = user;
            next();
        });
    } else {
        res.sendStatus(401);
    }
};

export const authenticateAdmin = (req: any, res: Response, next: NextFunction) => {
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

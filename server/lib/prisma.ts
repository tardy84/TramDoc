import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: databaseUrl,
        },
    },
    log: ['error', 'warn'],
});

export default prisma;

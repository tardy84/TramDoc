-- Add missing role column expected by the Prisma schema and auth/admin routes.
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';

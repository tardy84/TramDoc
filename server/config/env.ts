import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    dotenv.config();
}

export function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export const JWT_SECRET = getRequiredEnv('JWT_SECRET');

export const JWT_LEGACY_SECRETS = (process.env.JWT_LEGACY_SECRETS || '')
    .split(',')
    .map(secret => secret.trim())
    .filter(secret => secret.length > 0 && secret !== JWT_SECRET);

export const JWT_VERIFY_SECRETS = [JWT_SECRET, ...JWT_LEGACY_SECRETS];

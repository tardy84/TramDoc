#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, '..');
const publicDir = path.join(clientDir, 'ios/App/App/public');

const forbiddenPatterns = [
    /VITE_AZURE_SPEECH_KEY/,
    /VITE_GOOGLE_CLOUD_API_KEY/,
    /VITE_MINIMAX_API_KEY/,
    /VITE_GEMINI_API_KEY/,
    /VBEE_TOKEN/,
    /JWT_SECRET/,
    /replace-with-random-local-secret/,
    /replace-with-local-password/,
];

async function listFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listFiles(fullPath);
        return fullPath;
    }));
    return files.flat();
}

const files = (await listFiles(publicDir)).filter(file => /\.(html|js|css|json|map|txt)$/i.test(file));
const findings = [];

for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
            findings.push(`${path.relative(clientDir, file)} matched ${pattern}`);
        }
    }
}

if (findings.length > 0) {
    console.error('iOS bundle audit failed:');
    findings.forEach(finding => console.error(`- ${finding}`));
    process.exit(1);
}

console.log(`iOS bundle audit passed (${files.length} files scanned).`);

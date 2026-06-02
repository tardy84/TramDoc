import fs from 'fs/promises';
import path from 'path';
import { GrokTTSService } from '../services/grokTTS.js';

const outDir = path.resolve(process.cwd(), 'tmp', 'grok-ara-sal-smoke');
const service = new GrokTTSService();

const samples = [
    { voice: 'ara', slug: 'ara', text: 'Đây là giọng Ara của Grok cho Trạm Đọc. [pause] Sếp nghe thử xem có hợp đọc truyện không.' },
    { voice: 'sal', slug: 'sal', text: 'Đây là giọng Sal của Grok cho Trạm Đọc. [pause] Giọng này dùng để đọc sách dài và hội thoại.' },
];

await fs.mkdir(outDir, { recursive: true });

for (const sample of samples) {
    const buffer = await service.synthesize(sample.text, 'narrator', sample.voice);
    const file = path.join(outDir, `grok-${sample.slug}.mp3`);
    await fs.writeFile(file, buffer);
    console.log(JSON.stringify({ voice: sample.voice, file, bytes: buffer.length }));
}

console.log('[smoke-grok-voices] PASS');

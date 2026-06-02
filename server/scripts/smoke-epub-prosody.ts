import { inferProsody } from '../services/epubProsodyAnalyzer.js';

const cases = [
    { text: 'Chương Một', role: 'heading' as const, expectTone: 'formal', expectRole: 'heading' },
    { text: '“Đừng lại gần,” cô thì thầm.', role: 'narrator' as const, expectTone: 'whisper', expectRole: 'female' },
    { text: '“Cút đi!” hắn quát.', role: 'narrator' as const, expectTone: 'angry', expectRole: 'male' },
    { text: 'Bên ngoài, tiếng chân dừng lại trước cửa.', role: 'narrator' as const, expectTone: 'suspense', expectRole: 'narrator' },
    { text: 'Nàng thở dài, nước mắt lặng lẽ rơi.', role: 'narrator' as const, expectTone: 'sad', expectRole: 'female' },
];

for (const c of cases) {
    const result = inferProsody(c.text, c.role, { isHeading: c.role === 'heading' });
    console.log(c.text, result);
    if (result.role !== c.expectRole || result.hints.tone !== c.expectTone) {
        throw new Error(`Unexpected result for ${c.text}: ${JSON.stringify(result)}`);
    }
}

console.log('[smoke-epub-prosody] PASS');

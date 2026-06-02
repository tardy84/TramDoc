import { DEFAULT_TTS_HINTS, TtsHints } from './ttsHints.js';

export type SegmentRole = 'narrator' | 'heading' | 'male' | 'female' | 'child';

export interface ProsodyContext {
    isHeading?: boolean;
    tagName?: string;
    blockClass?: string;
    blockId?: string;
    previousText?: string;
    previousRole?: SegmentRole;
}

export interface ProsodyResult {
    role: SegmentRole;
    hints: TtsHints;
}

type ToneMatch = Exclude<TtsHints['tone'], 'neutral' | 'warm' | 'formal'>;

const FEMALE_MARKERS = [
    'nang noi', 'co noi', 'ba noi', 'me noi', 'chi noi', 'giong nang', 'giong co',
    'nang thi tham', 'co thi tham', 'nang tho dai', 'co tho dai',
];
const MALE_MARKERS = [
    'chang noi', 'anh noi', 'ong noi', 'bo noi', 'cha noi', 'han noi', 'giong ong', 'giong han',
    'han quat', 'ong quat', 'anh quat',
];
const WHISPER_MARKERS = ['thi tham', 'noi nho', 'khe noi', 'ri ram'];
const ANGRY_MARKERS = ['gao', 'het', 'quat', 'gian', 'cau', 'gam len'];
const SAD_MARKERS = ['khoc', 'nuoc mat', 'tho dai', 'buon', 'dau don', 'co don', 'tiec nuoi'];
const SUSPENSE_MARKERS = ['im lang', 'bong toi', 'lanh gay', 'rung minh', 'mau', 'chet', 'dao', 'sung', 'tieng chan', 'canh cua', 'len lut'];
const EXCITED_MARKERS = ['lao toi', 'chay', 'duoi theo', 'vut', 'no tung', 'vo tung', 'nhanh'];
const QUESTION_MARKERS = ['hoi', 'tai sao', 'vi sao', 'sao lai'];

export function inferProsody(text: string, initialRole: SegmentRole, context: ProsodyContext = {}): ProsodyResult {
    const normalized = normalizeForComparison(text);
    const reasons: string[] = [];
    let role = initialRole;
    const hints: TtsHints = { ...DEFAULT_TTS_HINTS, reason: reasons };

    if (context.isHeading || role === 'heading') {
        return {
            role: 'heading',
            hints: {
                ...hints,
                tone: 'formal',
                pace: 'slow',
                pitch: 'normal',
                pauseBeforeMs: 300,
                pauseAfterMs: 800,
                intensity: 0.35,
                confidence: 0.95,
                reason: ['heading'],
            },
        };
    }

    const isDialogue = hasDialogueMarker(text);
    if (isDialogue) {
        hints.isDialogue = true;
        hints.confidence = Math.max(hints.confidence, 0.7);
        reasons.push('dialogue-marker');
    }

    const speakerRole = inferSpeakerRole(normalized);
    if (speakerRole) {
        role = speakerRole;
        hints.confidence = Math.max(hints.confidence, 0.82);
        reasons.push(`speaker-${speakerRole}`);
    }

    applyEmotionRules(normalized, hints, reasons);
    applyPunctuationRules(text, hints, reasons);
    applyHtmlContextRules(context, hints, reasons);

    if (isDialogue && role === 'narrator' && context.previousRole && context.previousRole !== 'heading') {
        role = context.previousRole;
        hints.confidence = Math.max(hints.confidence, 0.62);
        reasons.push('dialogue-previous-role-carry');
    }

    hints.reason = reasons;
    return { role, hints };
}

function hasDialogueMarker(text: string): boolean {
    const trimmed = text.trim();
    return /[“”"‘’]/.test(trimmed) || /^[-–—]\s+/.test(trimmed);
}

function inferSpeakerRole(normalized: string): SegmentRole | null {
    if (FEMALE_MARKERS.some(marker => normalized.includes(marker))) return 'female';
    if (MALE_MARKERS.some(marker => normalized.includes(marker))) return 'male';
    return null;
}

function applyEmotionRules(normalized: string, hints: TtsHints, reasons: string[]): void {
    const matches: ToneMatch[] = [];

    if (WHISPER_MARKERS.some(marker => normalized.includes(marker))) {
        matches.push('whisper');
        reasons.push('emotion-whisper');
    }
    if (ANGRY_MARKERS.some(marker => normalized.includes(marker))) {
        matches.push('angry');
        reasons.push('emotion-angry');
    }
    if (SUSPENSE_MARKERS.some(marker => normalized.includes(marker))) {
        matches.push('suspense');
        reasons.push('emotion-suspense');
    }
    if (SAD_MARKERS.some(marker => normalized.includes(marker))) {
        matches.push('sad');
        reasons.push('emotion-sad');
    }
    if (EXCITED_MARKERS.some(marker => normalized.includes(marker))) {
        matches.push('excited');
        reasons.push('emotion-excited');
    }
    if (QUESTION_MARKERS.some(marker => normalized.includes(marker))) {
        matches.push('question');
        reasons.push('emotion-question');
    }

    const tone = pickTone(matches);
    if (!tone) return;

    hints.tone = tone;
    hints.confidence = Math.max(hints.confidence, 0.82);
    hints.intensity = Math.max(hints.intensity, tone === 'whisper' ? 0.45 : tone === 'sad' ? 0.35 : 0.6);

    if (tone === 'whisper') {
        hints.pace = 'slow';
        hints.pitch = 'low';
    } else if (tone === 'angry' || tone === 'excited') {
        hints.pace = 'fast';
        hints.pitch = tone === 'angry' ? 'low' : 'high';
    } else if (tone === 'sad' || tone === 'suspense' || tone === 'question') {
        hints.pace = tone === 'question' ? 'normal' : 'slow';
        hints.pitch = tone === 'suspense' ? 'low' : 'normal';
        hints.pauseAfterMs = Math.max(hints.pauseAfterMs, tone === 'suspense' ? 450 : 300);
    }
}

function applyPunctuationRules(text: string, hints: TtsHints, reasons: string[]): void {
    const hasEllipsis = /…|\.\.\./.test(text);
    if (hasEllipsis) {
        hints.pauseAfterMs = Math.max(hints.pauseAfterMs, hints.tone === 'suspense' ? 500 : 300);
        if (hints.tone === 'neutral') hints.tone = 'reflective';
        hints.pace = hints.pace === 'fast' ? 'normal' : 'slow';
        hints.confidence = Math.max(hints.confidence, 0.68);
        reasons.push('punctuation-ellipsis');
    }

    if (text.includes('?')) {
        if (hints.tone === 'neutral' || hints.tone === 'reflective') hints.tone = 'question';
        hints.confidence = Math.max(hints.confidence, 0.72);
        hints.pauseAfterMs = Math.max(hints.pauseAfterMs, 250);
        reasons.push('punctuation-question');
    }

    if (text.includes('!')) {
        hints.intensity = Math.max(hints.intensity, 0.65);
        if (hints.tone !== 'angry' && hints.tone !== 'whisper') hints.tone = 'excited';
        hints.pace = hints.tone === 'whisper' ? 'slow' : 'fast';
        hints.confidence = Math.max(hints.confidence, 0.72);
        reasons.push('punctuation-exclamation');
    }
}

function applyHtmlContextRules(context: ProsodyContext, hints: TtsHints, reasons: string[]): void {
    const marker = [context.tagName, context.blockClass, context.blockId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (context.tagName?.toLowerCase() === 'blockquote' || /blockquote|quote/.test(marker)) {
        if (hints.tone === 'neutral') hints.tone = 'reflective';
        hints.pace = hints.pace === 'fast' ? 'normal' : 'slow';
        hints.pauseBeforeMs = Math.max(hints.pauseBeforeMs, 300);
        hints.pauseAfterMs = Math.max(hints.pauseAfterMs, 500);
        hints.confidence = Math.max(hints.confidence, 0.72);
        reasons.push('html-blockquote');
    }

    if (/scene-break|separator|divider/.test(marker)) {
        hints.isSceneBreak = true;
        hints.pauseAfterMs = Math.max(hints.pauseAfterMs, 700);
        hints.confidence = Math.max(hints.confidence, 0.75);
        reasons.push('html-scene-break');
    }
}

function pickTone(matches: ToneMatch[]): ToneMatch | null {
    const priority: ToneMatch[] = ['whisper', 'angry', 'suspense', 'sad', 'excited', 'question', 'reflective'];
    return priority.find(tone => matches.includes(tone)) || null;
}

function normalizeForComparison(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

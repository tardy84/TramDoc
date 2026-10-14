/**
 * TTS alignment — sentence-level timing marks for reader highlighting.
 *
 * Why this exists: the reader can only highlight a whole segment today, so
 * there is no "follow the voice" behaviour inside a paragraph. Providers we
 * already use give us timing in different ways:
 *
 *   - google  : native timepoints when SSML contains <mark> (exact, per sentence)
 *   - minimax : subtitle_enable returns word/sentence timestamps (exact when available)
 *   - others  : no timing at all (azure REST, vbee poll, gemini)
 *
 * For providers without native timing we derive an *estimated* timeline from the
 * real audio duration (ffprobe) distributed over sentences by character weight.
 * That keeps highlighting provider-agnostic without adding any new vendor SDK.
 */

export type MarksSource = 'provider-timepoints' | 'provider-subtitle' | 'estimated';

export interface SentenceMark {
    /** Sentence text exactly as it appears in the segment content. */
    text: string;
    /** Character offsets inside the segment content (UTF-16 indices). */
    charStart: number;
    charEnd: number;
    startMs: number;
    endMs: number;
}

export interface WordMark {
    text: string;
    charStart: number;
    charEnd: number;
    startMs: number;
    endMs: number;
}

export interface SegmentMarks {
    version: 1;
    source: MarksSource;
    /** Total audio duration used to build the timeline. */
    durationMs: number;
    sentences: SentenceMark[];
    /** Only present when the provider returned real word timings. */
    words?: WordMark[];
}

export interface SplitSentence {
    text: string;
    charStart: number;
    charEnd: number;
}

const MAX_SENTENCE_CHARS = 240;
const MIN_SENTENCE_CHARS = 12;
/** Extra weight for closing punctuation so pauses land on sentence ends. */
const TERMINAL_PUNCT_RE = /[.!?…]["'”’)\]]*$/;
const SOFT_BREAK_RE = /[,;:]["'”’)\]]*$/;

/**
 * Split text into sentences while keeping exact character offsets.
 * Vietnamese-aware: handles terminal punctuation, dialogue dashes, and very long
 * comma chains (which would otherwise time badly in one block).
 */
export function splitIntoSentences(content: string): SplitSentence[] {
    const text = content ?? '';
    const out: SplitSentence[] = [];
    let start = 0;

    const pushRange = (from: number, to: number) => {
        let s = from;
        let e = to;
        while (s < e && /\s/.test(text[s])) s++;
        while (e > s && /\s/.test(text[e - 1])) e--;
        if (e <= s) return;
        const slice = text.slice(s, e);
        if (!slice.replace(/\s/g, '').length) return;
        const last = out[out.length - 1];
        // Merge fragments that are too short to time sensibly.
        if (last && (slice.length < MIN_SENTENCE_CHARS || last.text.length < MIN_SENTENCE_CHARS)) {
            last.text = text.slice(last.charStart, e);
            last.charEnd = e;
            return;
        }
        out.push({ text: slice, charStart: s, charEnd: e });
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        // Hard boundary: terminal punctuation followed by whitespace/end.
        if ('.!?…'.includes(ch)) {
            let j = i + 1;
            while (j < text.length && '"\')]”’'.includes(text[j])) j++;
            if (j >= text.length || /\s/.test(text[j])) {
                pushRange(start, j);
                start = j;
                i = j - 1;
                continue;
            }
        }

        // Dialogue dash at line start is a boundary in Vietnamese fiction.
        if (ch === '\n') {
            const rest = text.slice(i + 1).replace(/^[ \t]+/, '');
            if (rest.startsWith('—') || rest.startsWith('–')) {
                pushRange(start, i);
                start = i + 1;
                continue;
            }
            // Bare newline: break only when the current run is long enough.
            if (i - start >= MIN_SENTENCE_CHARS) {
                pushRange(start, i);
                start = i + 1;
            }
        }
    }
    pushRange(start, text.length);

    // Second pass: break up any sentence that is still too long.
    const bounded: SplitSentence[] = [];
    for (const s of out) {
        if (s.text.length <= MAX_SENTENCE_CHARS) {
            bounded.push(s);
            continue;
        }
        let cursor = s.charStart;
        for (const piece of splitLongRange(text, s.charStart, s.charEnd)) {
            bounded.push(piece);
            cursor = piece.charEnd;
        }
        void cursor;
    }
    return bounded.length ? bounded : [{ text: text.trim(), charStart: 0, charEnd: text.length }];
}

function splitLongRange(text: string, from: number, to: number): SplitSentence[] {
    const parts: SplitSentence[] = [];
    let start = from;
    let best = -1;
    for (let i = from; i < to; i++) {
        const sliceLen = i - start;
        if (SOFT_BREAK_RE.test(text.slice(start, i + 1))) best = i + 1;
        if (sliceLen >= MAX_SENTENCE_CHARS) {
            const cut = best > start ? best : i + 1;
            if (cut - start >= MIN_SENTENCE_CHARS) {
                parts.push({ text: text.slice(start, cut).trim(), charStart: start, charEnd: cut });
                start = cut;
                best = -1;
            }
        }
    }
    if (start < to) {
        const tail = text.slice(start, to).trim();
        if (tail.length) parts.push({ text: tail, charStart: start, charEnd: to });
    }
    return parts;
}

function weightOf(sentence: SplitSentence): number {
    const trimmed = sentence.text.trim();
    let w = trimmed.length;
    if (TERMINAL_PUNCT_RE.test(trimmed)) w += 7;      // pause at sentence end
    else if (SOFT_BREAK_RE.test(trimmed)) w += 3;     // smaller pause
    if (trimmed.length < 24) w += 6;                  // short lines are spoken slower relative to length
    return Math.max(w, 1);
}

/**
 * Build an estimated, monotonic sentence timeline over a known audio duration.
 * Deterministic: same text + duration always yields the same marks.
 */
export function estimateSentenceMarks(
    content: string,
    durationMs: number,
    options: { leadInMs?: number; tailMs?: number } = {}
): SegmentMarks {
    const sentences = splitIntoSentences(content);
    const leadIn = Math.max(0, options.leadInMs ?? 0);
    const tail = Math.max(0, options.tailMs ?? 0);
    const usable = Math.max(0, durationMs - leadIn - tail);
    const totalWeight = sentences.reduce((sum, s) => sum + weightOf(s), 0) || 1;

    const marks: SentenceMark[] = [];
    let cursorMs = leadIn;
    sentences.forEach((sentence, index) => {
        const share = index === sentences.length - 1
            ? (leadIn + usable) - cursorMs
            : (usable * weightOf(sentence)) / totalWeight;
        const startMs = Math.round(cursorMs);
        const endMs = Math.round(cursorMs + Math.max(share, 1));
        cursorMs += share;
        marks.push({
            text: sentence.text,
            charStart: sentence.charStart,
            charEnd: sentence.charEnd,
            startMs,
            endMs,
        });
    });

    return { version: 1, source: 'estimated', durationMs: Math.round(durationMs), sentences: marks };
}

/**
 * Convert provider timepoints (e.g. Google SSML <mark> results) into marks.
 * `timepoints[i]` corresponds to the i-th mark we sent, which we build in the
 * same sentence order as `splitIntoSentences`.
 */
export function marksFromTimepoints(
    content: string,
    timepoints: Array<{ markName?: string; timeSeconds?: number }>,
    durationMs: number
): SegmentMarks | null {
    const sentences = splitIntoSentences(content);
    if (!timepoints.length || timepoints.length !== sentences.length) return null;

    const marks: SentenceMark[] = [];
    for (let i = 0; i < sentences.length; i++) {
        const startMs = Math.round(Number(timepoints[i]?.timeSeconds ?? NaN) * 1000);
        if (!Number.isFinite(startMs)) return null;
        const nextRaw = i + 1 < sentences.length ? Number(timepoints[i + 1]?.timeSeconds ?? NaN) * 1000 : durationMs;
        const endMs = Number.isFinite(nextRaw) ? Math.round(nextRaw) : durationMs;
        marks.push({
            text: sentences[i].text,
            charStart: sentences[i].charStart,
            charEnd: sentences[i].charEnd,
            startMs,
            endMs: Math.max(endMs, startMs + 1),
        });
    }
    return { version: 1, source: 'provider-timepoints', durationMs: Math.round(durationMs), sentences: marks };
}

/**
 * Normalise a provider subtitle payload (MiniMax style) into marks.
 * Accepts either word entries or sentence entries; unknown shapes return null so
 * the caller can fall back to the estimator.
 */
export function marksFromSubtitleEntries(
    content: string,
    entries: Array<Record<string, unknown>>,
    durationMs: number
): SegmentMarks | null {
    if (!Array.isArray(entries) || !entries.length) return null;
    const words: WordMark[] = [];
    let searchFrom = 0;

    for (const entry of entries) {
        const rawText = String(entry.text ?? entry.word ?? entry.content ?? '').trim();
        if (!rawText) continue;
        const startMs = toMs(entry.start_time ?? entry.startTime ?? entry.start ?? entry.begin);
        const endMs = toMs(entry.end_time ?? entry.endTime ?? entry.end ?? entry.stop);
        if (startMs === null || endMs === null) return null;

        const at = content.indexOf(rawText, searchFrom);
        const charStart = at >= 0 ? at : searchFrom;
        const charEnd = charStart + rawText.length;
        searchFrom = charEnd;
        words.push({ text: rawText, charStart, charEnd, startMs, endMs: Math.max(endMs, startMs + 1) });
    }
    if (!words.length) return null;

    const sentences = splitIntoSentences(content);
    const marks: SentenceMark[] = sentences.map((sentence) => {
        const inRange = words.filter(w => w.charEnd > sentence.charStart && w.charStart < sentence.charEnd);
        const startMs = inRange.length ? inRange[0].startMs : 0;
        const endMs = inRange.length ? inRange[inRange.length - 1].endMs : durationMs;
        return {
            text: sentence.text,
            charStart: sentence.charStart,
            charEnd: sentence.charEnd,
            startMs,
            endMs: Math.max(endMs, startMs + 1),
        };
    });

    return { version: 1, source: 'provider-subtitle', durationMs: Math.round(durationMs), sentences: marks, words };
}

function toMs(value: unknown): number | null {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    // Providers mix seconds and milliseconds; treat < 1000 as seconds.
    return Math.round(n < 1000 ? n * 1000 : n);
}

export function isUsableMarks(marks: SegmentMarks | null | undefined): marks is SegmentMarks {
    if (!marks || marks.version !== 1) return false;
    if (!Array.isArray(marks.sentences) || !marks.sentences.length) return false;
    let last = -1;
    for (const s of marks.sentences) {
        if (!Number.isFinite(s.startMs) || !Number.isFinite(s.endMs)) return false;
        if (s.endMs < s.startMs) return false;
        if (s.startMs < last) return false; // must be monotonic
        last = s.startMs;
    }
    return true;
}
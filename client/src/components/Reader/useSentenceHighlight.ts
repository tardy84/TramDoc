import { useEffect, useRef, useState } from 'react';

/**
 * Sentence highlighting during audiobook playback.
 *
 * Providers give us sentence timings in different ways (google marks / minimax
 * subtitle = exact, everything else = estimated from the real audio duration).
 * This hook turns the current audio position into "which sentence of which
 * segment is being spoken right now", cheaply: it only re-renders when the
 * active sentence actually changes, not on every animation frame.
 */

export interface SentenceMark {
    text: string;
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
    version: number;
    source: 'provider-timepoints' | 'provider-subtitle' | 'estimated' | string;
    durationMs: number;
    sentences: SentenceMark[];
    /** Present only when the provider returned real word timings (exact sources). */
    words?: WordMark[];
}

export interface HighlightState {
    segmentIndex: number;
    sentenceIndex: number;
    /** -1 unless exact word timings are available for this segment. */
    wordIndex: number;
    /** Position inside the current sentence, 0..1 (used for a soft progress hint). */
    sentenceProgress: number;
}

interface UseSentenceHighlightOptions {
    /** Marks keyed by segment orderIndex. */
    marksBySegment: Map<number, SegmentMarks>;
    activeSegmentIndex: number;
    isPlaying: boolean;
    /** Live audio element (the reader uses one shared global audio node). */
    getAudio: () => HTMLAudioElement | null;
}

const IDLE: HighlightState = { segmentIndex: -1, sentenceIndex: -1, wordIndex: -1, sentenceProgress: 0 };

function findSentence(sentences: SentenceMark[], positionMs: number): { index: number; progress: number } {
    if (!sentences.length) return { index: -1, progress: 0 };
    // Marks are monotonic; a linear scan over a paragraph (few dozen entries) is cheaper
    // than the bookkeeping of a binary search and runs at most once per frame change.
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        if (positionMs < sentence.endMs) {
            const span = Math.max(sentence.endMs - sentence.startMs, 1);
            const progress = Math.min(1, Math.max(0, (positionMs - sentence.startMs) / span));
            return { index: i, progress };
        }
    }
    const last = sentences.length - 1;
    return { index: last, progress: 1 };
}

function findWord(words: WordMark[], positionMs: number): number {
    if (!words.length) return -1;
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (positionMs < word.endMs) {
            // Inside a natural pause the highlight should stay on the previous word
            // instead of jumping ahead to the next one.
            if (positionMs >= word.startMs) return i;
            return Math.max(0, i - 1);
        }
    }
    return words.length - 1;
}

export function useSentenceHighlight({
    marksBySegment,
    activeSegmentIndex,
    isPlaying,
    getAudio,
}: UseSentenceHighlightOptions): HighlightState {
    const [state, setState] = useState<HighlightState>(IDLE);
    const rafRef = useRef<number | null>(null);
    const lastSentenceRef = useRef<string>('');

    useEffect(() => {
        const stop = () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };

        const compute = (): HighlightState | null => {
            const audio = getAudio();
            const marks = marksBySegment.get(activeSegmentIndex);
            if (!audio || !marks || !marks.sentences.length) return null;

            // Timings always refer to the current segment's own audio file, so
            // playbackRate never has to be applied here.
            const positionMs = audio.currentTime * 1000;
            const { index, progress } = findSentence(marks.sentences, positionMs);
            const words = marks.words && marks.words.length ? marks.words : null;
            return {
                segmentIndex: activeSegmentIndex,
                sentenceIndex: index,
                wordIndex: words ? findWord(words, positionMs) : -1,
                sentenceProgress: progress,
            };
        };

        const publish = (next: HighlightState | null) => {
            const key = next
                ? `${next.segmentIndex}:${next.sentenceIndex}:${next.wordIndex}:${next.sentenceProgress > 0.5 ? 'b' : 'a'}`
                : '';
            if (key === lastSentenceRef.current) return;
            lastSentenceRef.current = key;
            setState(next ?? IDLE);
        };

        if (isPlaying) {
            const tick = () => {
                rafRef.current = requestAnimationFrame(tick);
                publish(compute());
            };
            rafRef.current = requestAnimationFrame(tick);
        } else {
            // Paused/seeked: update once so the highlight still tracks manual position.
            publish(compute());
        }

        return stop;
    }, [activeSegmentIndex, isPlaying, marksBySegment, getAudio]);

    return state;
}
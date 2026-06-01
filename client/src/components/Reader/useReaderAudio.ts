import { useState, useCallback, useRef, useEffect } from 'react';
import { Chapter } from './types';
import { generateTTS } from '../../services/apiService';
import { resolveApiUrl } from '../../constants';
import { getErrorMessage, isAbortError } from '../../utils/errors';

const AUDIO_PRELOAD_WINDOW = 3;

interface UseReaderAudioProps {
    bookId: number;
    chapters: Chapter[];
    setChapters: React.Dispatch<React.SetStateAction<Chapter[]>>;
    currentChapterIndex: number;
    currentSegmentIndex: number;
    setCurrentSegmentIndex: (index: number) => void;
    playbackSpeed: number;
    selectedVoice: string;
    nextChapter: () => void;
    getGlobalAudio: () => HTMLAudioElement | null;
    setGlobalAudio: (audio: HTMLAudioElement | null) => void;
}

export const useReaderAudio = ({
    bookId,
    chapters,
    setChapters,
    currentChapterIndex,
    currentSegmentIndex,
    setCurrentSegmentIndex,
    playbackSpeed,
    selectedVoice,
    nextChapter,
    getGlobalAudio,
    setGlobalAudio
}: UseReaderAudioProps) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [audioFiles, setAudioFiles] = useState<string[]>([]);
    const [audioError, setAudioError] = useState<string | null>(null);
    const [browserTTSMode, setBrowserTTSMode] = useState(false);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const preloadAudioMapRef = useRef<Map<number, HTMLAudioElement>>(new Map());
    const preloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const activeChapterIdRef = useRef<number | null>(null);
    const queuedIndicesRef = useRef<Set<number>>(new Set());
    const playIdRef = useRef<number>(0);
    // Map of segment index -> URL for current chapter
    const activeUrlMapRef = useRef<Map<number, string>>(new Map());

    const stopAudioPlayback = useCallback((message: string, error?: unknown) => {
        if (error) {
            console.error(message, error);
        } else {
            console.error(message);
        }
        setAudioError(message.replace(/^\[[^\]]+\]\s*/, ''));
        setBrowserTTSMode(false);
        setIsPlaying(false);
    }, []);

    const isSpeakableSegment = useCallback((index: number) => {
        const content = chapters[currentChapterIndex]?.segments[index]?.content ?? '';
        const normalized = content
            .replace(/[\s\u00a0]+/g, '')
            .replace(/[*＊✱✲✳✴✻✼✽·•●○◆◇■□_—–~….-]+/g, '');
        return /[\p{L}\p{N}]/u.test(normalized);
    }, [chapters, currentChapterIndex]);

    const playBrowserTTS = useCallback((index: number) => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter || !chapter.segments[index]) return;

        if (!isSpeakableSegment(index)) {
            if (index + 1 < chapter.segments.length) {
                setCurrentSegmentIndex(index + 1);
                playBrowserTTS(index + 1);
            } else {
                nextChapter();
            }
            return;
        }

        window.speechSynthesis.cancel();
        queuedIndicesRef.current.clear();

        const currentGlobal = getGlobalAudio();
        if (currentGlobal) {
            currentGlobal.pause();
            currentGlobal.src = '';
            setGlobalAudio(null);
        }

        if (queuedIndicesRef.current.has(index)) return;

        const utterance = new SpeechSynthesisUtterance(chapter.segments[index].content);
        utterance.lang = 'vi-VN';
        utterance.rate = playbackSpeed;

        utterance.onstart = () => {
            setIsPlaying(true);
            setCurrentSegmentIndex(index);
        };

        utterance.onend = () => {
            queuedIndicesRef.current.delete(index);
            if (index + 1 < chapter.segments.length) {
                playBrowserTTS(index + 1);
            } else {
                nextChapter();
            }
        };

        queuedIndicesRef.current.add(index);
        window.speechSynthesis.speak(utterance);
    }, [chapters, currentChapterIndex, playbackSpeed, nextChapter, setCurrentSegmentIndex, getGlobalAudio, setGlobalAudio, isSpeakableSegment]);

    const playAudio = useCallback(async (index: number, _files: string[] = audioFiles, retryCount = 0, incomingPlayId?: number) => {
        const chapterIdx = currentChapterIndex;
        const chapter = chapters[chapterIdx];
        if (!chapter) return;
        const chapterId = chapter.id;

        const currentPlayId = incomingPlayId ?? ++playIdRef.current;
        activeChapterIdRef.current = chapterId;
        setAudioError(null);
        setCurrentSegmentIndex(index);

        const getAudioForIndex = async (idx: number): Promise<HTMLAudioElement | null> => {
            const preloaded = preloadAudioMapRef.current.get(idx);
            if (preloaded) {
                preloadAudioMapRef.current.delete(idx);
                return preloaded;
            }

            // Check URL map
            let url = activeUrlMapRef.current.get(idx);

            if (!url && _files && _files[idx]) {
                url = _files[idx];
            }

            if (!url) return null;
            const audio = new Audio(resolveApiUrl(url));
            audio.playbackRate = playbackSpeed;
            audio.preload = 'auto';
            return audio;
        };

        const preloadUpcoming = async (startIdx: number) => {
            let queued = 0;

            for (let idx = startIdx; idx < chapter.segments.length && queued < AUDIO_PRELOAD_WINDOW; idx++) {
                if (!isSpeakableSegment(idx)) continue;
                if (preloadAudioMapRef.current.has(idx)) {
                    queued++;
                    continue;
                }

                // Aggressive pre-fetch: Force the browser to start downloading the file into cache
                // BEFORE creating the audio element wait. This circumvents slow audio tag initialization.
                const url = activeUrlMapRef.current.get(idx) || (_files ? _files[idx] : null);
                if (!url) continue;

                fetch(resolveApiUrl(url)).catch(() => {});

                const audio = new Audio(resolveApiUrl(url));
                audio.playbackRate = playbackSpeed;
                audio.preload = 'auto';
                audio.load();
                preloadAudioMapRef.current.set(idx, audio);
                queued++;
            }

            // Keep the queue centered near the active reading position.
            for (const preloadIndex of preloadAudioMapRef.current.keys()) {
                if (preloadIndex < index || preloadIndex >= startIdx + AUDIO_PRELOAD_WINDOW + 3) {
                    preloadAudioMapRef.current.delete(preloadIndex);
                }
            }
        };

        // Fast path: for sequential next segment, skip heavy cleanup
        const isSequentialNext = incomingPlayId === undefined && retryCount === 0;
        if (!isSequentialNext) {
            window.speechSynthesis.cancel();
            queuedIndicesRef.current.clear();
        }

        // Check if user paused before we start
        if (currentPlayId !== playIdRef.current) return;

        const currentGlobal = getGlobalAudio();
        if (currentGlobal) {
            // For sequential transitions, just pause without resetting src (faster)
            currentGlobal.pause();
            currentGlobal.onended = null;
            currentGlobal.onerror = null;
            if (!isSequentialNext) currentGlobal.src = '';
            setGlobalAudio(null);
        }

        if (preloadTimeoutRef.current) {
            clearTimeout(preloadTimeoutRef.current);
            preloadTimeoutRef.current = null;
        }

        const audio = await getAudioForIndex(index);

        if (currentPlayId !== playIdRef.current) return;

        if (!audio) {
            if (!isSpeakableSegment(index)) {
                if (index + 1 < chapter.segments.length) {
                    setCurrentSegmentIndex(index + 1);
                    playAudio(index + 1, _files, 0, currentPlayId);
                } else if (currentChapterIndex < chapters.length - 1) {
                    nextChapter();
                } else {
                    setIsPlaying(false);
                }
                return;
            }

            if (retryCount < 3) {
                setTimeout(() => {
                    if (currentPlayId === playIdRef.current) {
                        playAudio(index, _files, retryCount + 1, currentPlayId);
                    }
                }, 500);
                return;
            }
            stopAudioPlayback('[Audio] Không tìm thấy URL audio sau khi đổi giọng.');
            return;
        }

        setGlobalAudio(audio);
        audioRef.current = audio;

        audio.onerror = () => {
            if (currentPlayId !== playIdRef.current) return;
            if (!isSpeakableSegment(index)) {
                if (index + 1 < chapter.segments.length) {
                    setCurrentSegmentIndex(index + 1);
                    playAudio(index + 1, _files, 0, currentPlayId);
                } else if (currentChapterIndex < chapters.length - 1) {
                    nextChapter();
                } else {
                    setIsPlaying(false);
                }
                return;
            }

            if (retryCount < 3) {
                setTimeout(() => {
                    if (currentPlayId === playIdRef.current) {
                        playAudio(index, _files, retryCount + 1, currentPlayId);
                    }
                }, 500);
            } else {
                stopAudioPlayback(`[Audio] Không phát được audio Vbee ở đoạn ${index + 1}. Kiểm tra API/audio URL rồi thử lại.`);
            }
        };

        audio.onended = () => {
            if (activeChapterIdRef.current !== chapterId) return;
            if (index + 1 < chapter.segments.length) {
                // GAPLESS HACK: If we have preloaded the next segment, play it synchronously
                // here inside the ending frame of the last audio, completely avoiding
                // React event loop and state update delays.
                const nextAudio = preloadAudioMapRef.current.get(index + 1);
                if (nextAudio) {
                    nextAudio.play().catch(console.error);
                }
                playAudio(index + 1, _files);
            } else if (currentChapterIndex < chapters.length - 1) {
                const nextChapterData = chapters[currentChapterIndex + 1];
                if (nextChapterData && nextChapterData.segments.length > 0) {
                    nextChapter();
                } else {
                    setIsPlaying(false);
                }
            } else {
                setIsPlaying(false);
            }
        };

        audio.play().catch(error => {
            if (error.name === 'AbortError') return;
            if (currentPlayId !== playIdRef.current) return;
            if (retryCount < 3) {
                setTimeout(() => {
                    if (currentPlayId === playIdRef.current) {
                        playAudio(index, _files, retryCount + 1, currentPlayId);
                    }
                }, 500);
            } else {
                stopAudioPlayback(`[Audio] Trình phát từ chối phát Vbee ở đoạn ${index + 1}. Hãy thử bấm phát lại.`, error);
            }
        });

        setIsPlaying(true);

        // Preload upcoming segments immediately (no delay)
        if (activeChapterIdRef.current === chapterId) {
            preloadUpcoming(index + 1);
        }

    }, [audioFiles, chapters, currentChapterIndex, nextChapter, playbackSpeed, stopAudioPlayback, setCurrentSegmentIndex, getGlobalAudio, setGlobalAudio, isSpeakableSegment]);

    const generateAudio = useCallback(async (startFromIndex?: number) => {
        if (chapters.length === 0) return;

        const chapter = chapters[currentChapterIndex];
        activeChapterIdRef.current = chapter.id;
        ++playIdRef.current; // Cancel stale playback retries while a new voice/segment is being prepared.

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        window.speechSynthesis.cancel();
        queuedIndicesRef.current.clear();
        preloadAudioMapRef.current.clear();

        const currentGlobal = getGlobalAudio();
        if (currentGlobal) {
            currentGlobal.pause();
            currentGlobal.src = '';
            setGlobalAudio(null);
        }

        setGenerating(true);
        setAudioError(null);
        setBrowserTTSMode(false);

        try {
            const targetIndex = typeof startFromIndex === 'number' ? startFromIndex : currentSegmentIndex;
            // Ask the server for signed, short-lived audio URLs. This avoids exposing
            // the long-lived login JWT in media URLs while still enabling <audio> playback.
            const { audioFiles: urls } = await generateTTS(bookId, chapter.id, selectedVoice, targetIndex);

            if (controller.signal.aborted || activeChapterIdRef.current !== chapter.id) return;

            activeUrlMapRef.current.clear();
            urls.forEach((url, i) => {
                activeUrlMapRef.current.set(i, url);
            });

            setAudioFiles(urls);
            setChapters(prev => prev.map((c, idx) => idx === currentChapterIndex ? { ...c, audioFiles: urls } : c));

            // Start playing immediately from target
            playAudio(targetIndex, urls);

        } catch (error) {
            if (isAbortError(error) || controller.signal.aborted) return;
            console.error('[TTS] Server API Error:', error);
            setGenerating(false);
            stopAudioPlayback(`[TTS] Không tạo được audio Vbee từ server. ${getErrorMessage(error, 'Vui lòng thử lại sau.')}`, error);
        } finally {
            if (activeChapterIdRef.current === chapter.id) {
                setGenerating(false);
                abortControllerRef.current = null;
            }
        }
    }, [bookId, chapters, currentChapterIndex, currentSegmentIndex, playAudio, setChapters, selectedVoice, getGlobalAudio, setGlobalAudio, stopAudioPlayback]);

    const togglePlayPause = useCallback(() => {
        if (browserTTSMode) {
            if (isPlaying) {
                window.speechSynthesis.pause();
                setIsPlaying(false);
            } else {
                window.speechSynthesis.resume();
                setIsPlaying(true);
            }
            return;
        }

        if (isPlaying) {
            // Increment playId to cancel any pending onended chain
            ++playIdRef.current;
            // Pause all possible audio sources
            const globalAudio = getGlobalAudio();
            if (globalAudio) globalAudio.pause();
            if (audioRef.current && audioRef.current !== globalAudio) audioRef.current.pause();
            setIsPlaying(false);
        } else {
            const audio = audioRef.current;
            if (audio && audio.src && !audio.ended) {
                audio.play().catch(console.error);
                setIsPlaying(true);
            } else {
                generateAudio();
            }
        }
    }, [browserTTSMode, isPlaying, generateAudio, getGlobalAudio]);

    const nextSegment = useCallback(() => {
        const currentChapter = chapters[currentChapterIndex];
        if (currentChapter && currentSegmentIndex < currentChapter.segments.length - 1) {
            const nextIdx = currentSegmentIndex + 1;
            if (activeUrlMapRef.current.has(nextIdx)) playAudio(nextIdx, audioFiles);
            else generateAudio(nextIdx);
        } else {
            nextChapter();
        }
    }, [chapters, currentChapterIndex, currentSegmentIndex, audioFiles, playAudio, generateAudio, nextChapter]);

    const prevSegment = useCallback(() => {
        if (currentSegmentIndex > 0) {
            const nextIdx = currentSegmentIndex - 1;
            if (activeUrlMapRef.current.has(nextIdx)) playAudio(nextIdx, audioFiles);
            else generateAudio(nextIdx);
        }
    }, [currentSegmentIndex, audioFiles, playAudio, generateAudio]);

    const prevVoiceRef = useRef(selectedVoice);

    // Auto-play trigger for chapter transitions or voice changes
    useEffect(() => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter) return;

        if (prevVoiceRef.current !== selectedVoice) {
            prevVoiceRef.current = selectedVoice;
            ++playIdRef.current; // Ignore old voice retries/errors after URLs are cleared.
            const currentGlobal = getGlobalAudio();
            if (currentGlobal) {
                currentGlobal.pause();
                setGlobalAudio(null);
                audioRef.current = null;
            }
            activeUrlMapRef.current.clear();
            setAudioFiles([]);
            preloadAudioMapRef.current.clear();
            if (isPlaying) {
                generateAudio(currentSegmentIndex);
                return;
            }
        }

        if (activeChapterIdRef.current !== chapter.id) {
            const currentGlobal = getGlobalAudio();
            if (currentGlobal) {
                currentGlobal.pause();
                setGlobalAudio(null);
                audioRef.current = null;
            }
            activeChapterIdRef.current = chapter.id;
            activeUrlMapRef.current.clear();
            preloadAudioMapRef.current.clear();
            setAudioFiles(chapter.audioFiles || []);
            if (isPlaying) {
                if (chapter.audioFiles && chapter.audioFiles.length > 0) {
                    playAudio(currentSegmentIndex, chapter.audioFiles);
                } else if (!generating) {
                    generateAudio(currentSegmentIndex);
                }
            }
        } else if (isPlaying) {
            const globalAudio = getGlobalAudio();
            if (!globalAudio || (globalAudio.paused && !globalAudio.ended && globalAudio.src)) {
                playAudio(currentSegmentIndex, audioFiles);
            } else if (audioFiles.length === 0 && !generating) {
                generateAudio(currentSegmentIndex);
            }
        }
    }, [currentChapterIndex, chapters, isPlaying, currentSegmentIndex, generating, audioFiles, getGlobalAudio, setGlobalAudio, playAudio, generateAudio, selectedVoice]);

    return {
        isPlaying,
        setIsPlaying,
        generating,
        audioError,
        clearAudioError: () => setAudioError(null),
        audioFiles,
        setAudioFiles,
        browserTTSMode,
        togglePlayPause,
        generateAudio,
        nextSegment,
        prevSegment,
        playAudio,
        playBrowserTTS
    };
};

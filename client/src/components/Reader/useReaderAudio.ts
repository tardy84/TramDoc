import { useState, useCallback, useRef, useEffect } from 'react';
import { Chapter } from './types';


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
    const [browserTTSMode, setBrowserTTSMode] = useState(false);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
    const nextAudioIndexRef = useRef<number | null>(null);
    const preloadTimeoutRef = useRef<any>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const activeChapterIdRef = useRef<number | null>(null);
    const queuedIndicesRef = useRef<Set<number>>(new Set());
    const playIdRef = useRef<number>(0);
    // Map of segment index -> URL for current chapter
    const activeUrlMapRef = useRef<Map<number, string>>(new Map());

    const playBrowserTTS = useCallback((index: number) => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter || !chapter.segments[index]) return;

        window.speechSynthesis.cancel();
        queuedIndicesRef.current.clear();

        const currentGlobal = getGlobalAudio();
        if (currentGlobal) {
            currentGlobal.pause();
            currentGlobal.src = '';
            setGlobalAudio(null);
        }

        const queueNext = (currIdx: number) => {
            for (let i = 1; i <= 3; i++) {
                const nextIdx = currIdx + i;
                if (nextIdx < chapter.segments.length && !queuedIndicesRef.current.has(nextIdx)) {
                    playBrowserTTS(nextIdx);
                }
            }
        };

        if (queuedIndicesRef.current.has(index)) return;

        const utterance = new SpeechSynthesisUtterance(chapter.segments[index].content);
        utterance.lang = 'vi-VN';
        utterance.rate = playbackSpeed;

        utterance.onstart = () => {
            setIsPlaying(true);
            setCurrentSegmentIndex(index);
            queueNext(index);
        };

        utterance.onend = () => {
            queuedIndicesRef.current.delete(index);
            if (index + 1 === chapter.segments.length) {
                nextChapter();
            }
        };

        queuedIndicesRef.current.add(index);
        window.speechSynthesis.speak(utterance);
    }, [chapters, currentChapterIndex, playbackSpeed, nextChapter, setCurrentSegmentIndex]);

    const playAudio = useCallback(async (index: number, _files: string[] = audioFiles, retryCount = 0, incomingPlayId?: number) => {
        const chapterIdx = currentChapterIndex;
        const chapter = chapters[chapterIdx];
        if (!chapter) return;
        const chapterId = chapter.id;

        const currentPlayId = incomingPlayId ?? ++playIdRef.current;
        activeChapterIdRef.current = chapterId;
        setCurrentSegmentIndex(index);

        const getAudioForIndex = async (idx: number): Promise<HTMLAudioElement | null> => {
            // Check preloaded
            if (nextAudioIndexRef.current === idx && preloadAudioRef.current) {
                const preloaded = preloadAudioRef.current;
                preloadAudioRef.current = null;
                nextAudioIndexRef.current = null;
                return preloaded;
            }

            // Check URL map
            let url = activeUrlMapRef.current.get(idx);

            if (!url && _files && _files[idx]) {
                url = _files[idx];
            }

            if (!url) return null;
            const audio = new Audio(url);
            audio.playbackRate = playbackSpeed;
            audio.preload = 'auto';
            return audio;
        };

        const preloadNext = async (idx: number) => {
            if (idx >= chapter.segments.length) return;
            if (nextAudioIndexRef.current === idx) return;
            
            // Aggressive pre-fetch: Force the browser to start downloading the file into cache 
            // BEFORE creating the audio element wait. This circumvents slow audio tag initialization.
            const url = activeUrlMapRef.current.get(idx) || ( _files ? _files[idx] : null);
            if (url) {
                fetch(url).catch(() => {});
            }

            const nextAudio = await getAudioForIndex(idx);
            if (nextAudio) {
                nextAudio.load();
                preloadAudioRef.current = nextAudio;
                nextAudioIndexRef.current = idx;
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
            if (retryCount < 3) {
                setTimeout(() => {
                    if (currentPlayId === playIdRef.current) {
                        playAudio(index, _files, retryCount + 1, currentPlayId);
                    }
                }, 500);
                return;
            }
            setBrowserTTSMode(true);
            playBrowserTTS(index);
            return;
        }

        setGlobalAudio(audio);
        audioRef.current = audio;

        audio.onerror = () => {
            if (currentPlayId !== playIdRef.current) return;
            if (retryCount < 3) {
                setTimeout(() => {
                    if (currentPlayId === playIdRef.current) {
                        playAudio(index, _files, retryCount + 1, currentPlayId);
                    }
                }, 500);
            } else {
                setBrowserTTSMode(true);
                playBrowserTTS(index);
            }
        };

        audio.onended = () => {
            if (activeChapterIdRef.current !== chapterId) return;
            if (index + 1 < chapter.segments.length) {
                // GAPLESS HACK: If we have preloaded the next segment, play it synchronously
                // here inside the ending frame of the last audio, completely avoiding
                // React event loop and state update delays.
                if (nextAudioIndexRef.current === index + 1 && preloadAudioRef.current) {
                    preloadAudioRef.current.play().catch(console.error);
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
                setBrowserTTSMode(true);
                playBrowserTTS(index);
            }
        });

        setIsPlaying(true);

        // Preload next segments immediately (no delay)
        if (activeChapterIdRef.current === chapterId) {
            preloadNext(index + 1);
        }

    }, [audioFiles, chapters, currentChapterIndex, nextChapter, playbackSpeed, bookId, selectedVoice, playBrowserTTS, setCurrentSegmentIndex, getGlobalAudio, setGlobalAudio]);

    const generateAudio = useCallback(async (startFromIndex?: number) => {
        if (chapters.length === 0) return;
        const chapter = chapters[currentChapterIndex];
        activeChapterIdRef.current = chapter.id;

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        window.speechSynthesis.cancel();
        queuedIndicesRef.current.clear();
        preloadAudioRef.current = null;
        nextAudioIndexRef.current = null;

        const currentGlobal = getGlobalAudio();
        if (currentGlobal) {
            currentGlobal.pause();
            currentGlobal.src = '';
            setGlobalAudio(null);
        }

        setGenerating(true);
        setBrowserTTSMode(false);

        try {
            // Zero-delay TTS Initialization!
            // We instantly construct the URLs for all segments. The server's Express route
            // /audio/:filename automatically catches 404s, generates them on-the-fly,
            // and asynchronously triggers lookahead for the next 3 segments! No need to wait.
            const timestamp = Date.now();
            const urls = Array.from(
                { length: chapter.segments.length },
                (_, i) => `/audio/${bookId}_${chapter.id}_${selectedVoice}_${i}.mp3?t=${timestamp}`
            );

            if (controller.signal.aborted || activeChapterIdRef.current !== chapter.id) return;

            activeUrlMapRef.current.clear();
            urls.forEach((url, i) => {
                activeUrlMapRef.current.set(i, url);
            });

            setAudioFiles(urls);
            setChapters(prev => prev.map((c, idx) => idx === currentChapterIndex ? { ...c, audioFiles: urls } : c));

            // Start playing immediately from target
            const targetIndex = typeof startFromIndex === 'number' ? startFromIndex : currentSegmentIndex;
            playAudio(targetIndex, urls);

        } catch (error: any) {
            if (error.name === 'AbortError' || controller.signal.aborted) return;
            console.error('[TTS] Server API Error:', error);
            setBrowserTTSMode(true);
            setGenerating(false);
            playBrowserTTS(typeof startFromIndex === 'number' ? startFromIndex : currentSegmentIndex);
        } finally {
            if (activeChapterIdRef.current === chapter.id) {
                setGenerating(false);
                abortControllerRef.current = null;
            }
        }
    }, [bookId, chapters, currentChapterIndex, currentSegmentIndex, playAudio, playBrowserTTS, setChapters, selectedVoice, getGlobalAudio, setGlobalAudio]);

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
            const currentGlobal = getGlobalAudio();
            if (currentGlobal) {
                currentGlobal.pause();
                setGlobalAudio(null);
                audioRef.current = null;
            }
            activeUrlMapRef.current.clear();
            setAudioFiles([]);
            preloadAudioRef.current = null;
            nextAudioIndexRef.current = null;
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

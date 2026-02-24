import { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';
import { Chapter } from './types';
import { getOfflineAudio } from '../../services/offlineManager';
import { API_BASE_URL } from '../../constants';

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
    authAxios: any;
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
    authAxios,
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

    const playBrowserTTS = useCallback((index: number) => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter || !chapter.segments[index]) return;

        // ALWAYs cancel whatever is playing first to prevent overlap
        window.speechSynthesis.cancel();
        queuedIndicesRef.current.clear();

        const currentGlobal = getGlobalAudio();
        if (currentGlobal) {
            currentGlobal.pause();
            currentGlobal.src = '';
            setGlobalAudio(null);
        }

        // Maintain a queue of 3 items to ensure browser has enough "lookahead"
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

    const playAudio = useCallback(async (index: number, files: string[] = audioFiles, retryCount = 0, incomingPlayId?: number) => {
        const chapterIdx = currentChapterIndex;
        const chapterId = chapters[chapterIdx]?.id;
        if (!chapterId) return;

        // Assign or inherit the current play ID for race condition prevention
        const currentPlayId = incomingPlayId ?? ++playIdRef.current;

        activeChapterIdRef.current = chapterId;
        setCurrentSegmentIndex(index);

        // helper to get the audio object (either preloaded or new)
        const getAudioForIndex = async (idx: number) => {
            if (nextAudioIndexRef.current === idx && preloadAudioRef.current) {
                const preloaded = preloadAudioRef.current;
                preloadAudioRef.current = null;
                nextAudioIndexRef.current = null;
                return preloaded;
            }

            let offlineBlob = null;
            try { offlineBlob = await getOfflineAudio(bookId, chapterId, idx); } catch (e) { }

            let url = '';
            if (offlineBlob) url = URL.createObjectURL(offlineBlob);
            else if (files[idx]) url = `${API_BASE_URL}${files[idx]}`;

            if (!url) return null;
            const audio = new Audio(url);
            audio.playbackRate = playbackSpeed;
            audio.preload = 'auto';
            return audio;
        };

        const preloadNext = async (idx: number) => {
            if (idx >= files.length) {
                // Potential to preload next chapter here
                return;
            }
            if (nextAudioIndexRef.current === idx) return;
            const nextAudio = await getAudioForIndex(idx);
            if (nextAudio) {
                nextAudio.load(); // Start buffering
                preloadAudioRef.current = nextAudio;
                nextAudioIndexRef.current = idx;
            }
        };

        window.speechSynthesis.cancel();
        queuedIndicesRef.current.clear();

        const currentGlobal = getGlobalAudio();
        if (currentGlobal) {
            currentGlobal.pause();
            currentGlobal.src = ''; // Clean up source memory
            setGlobalAudio(null);
        }

        if (preloadTimeoutRef.current) {
            clearTimeout(preloadTimeoutRef.current);
            preloadTimeoutRef.current = null;
        }

        const audio = await getAudioForIndex(index);

        // Abort if another play request has started since we started awaiting
        if (currentPlayId !== playIdRef.current) return;

        if (!audio) {
            // If the file is missing but we have a URL, maybe it's still generating
            if (files[index] && retryCount < 5) {
                setTimeout(() => {
                    if (currentPlayId === playIdRef.current) {
                        playAudio(index, files, retryCount + 1, currentPlayId);
                    }
                }, 1500);
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
            if (retryCount < 5) {
                setTimeout(() => {
                    if (currentPlayId === playIdRef.current) {
                        playAudio(index, files, retryCount + 1, currentPlayId);
                    }
                }, 1500);
            } else {
                setBrowserTTSMode(true);
                playBrowserTTS(index);
            }
        };

        audio.onended = () => {
            if (activeChapterIdRef.current !== chapterId) return;
            if (index + 1 < (files?.length || 0)) {
                playAudio(index + 1, files);
            } else if (currentChapterIndex < chapters.length - 1) {
                // Check if the next chapter's data is available before calling nextChapter
                const nextChapterData = chapters[currentChapterIndex + 1];
                if (nextChapterData && nextChapterData.segments.length > 0) {
                    nextChapter();
                } else {
                    // If next chapter data isn't ready, stop playback for now
                    setIsPlaying(false);
                }
            } else {
                setIsPlaying(false);
            }
        };

        audio.play().catch(error => {
            if (error.name === 'AbortError') return;
            if (currentPlayId !== playIdRef.current) return;
            if (activeChapterIdRef.current !== chapterId) return;
            // Retry on play failure too (sometimes happens with ephemeral blobs)
            if (retryCount < 3) {
                setTimeout(() => {
                    if (currentPlayId === playIdRef.current) {
                        playAudio(index, files, retryCount + 1, currentPlayId);
                    }
                }, 500);
            } else {
                setBrowserTTSMode(true);
                playBrowserTTS(index);
            }
        });

        setIsPlaying(true);

        // Preload next segment almost immediately for maximum buffering time
        preloadTimeoutRef.current = setTimeout(() => {
            if (activeChapterIdRef.current === chapterId) {
                preloadNext(index + 1);
            }
            preloadTimeoutRef.current = null;
        }, 100);

    }, [audioFiles, chapters, currentChapterIndex, nextChapter, playbackSpeed, bookId, playBrowserTTS, setCurrentSegmentIndex, getGlobalAudio, setGlobalAudio]);

    const generateAudio = useCallback(async (startFromIndex?: number) => {
        if (chapters.length === 0) return;
        const chapter = chapters[currentChapterIndex];
        activeChapterIdRef.current = chapter.id;

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Stop any currently playing audio immediately to prevent overlap while generating
        window.speechSynthesis.cancel();
        queuedIndicesRef.current.clear();

        const currentGlobal = getGlobalAudio();
        if (currentGlobal) {
            currentGlobal.pause();
            currentGlobal.src = '';
            setGlobalAudio(null);
        }

        setGenerating(true);
        setBrowserTTSMode(false);
        try {
            const res = await authAxios.post(
                `/api/books/${bookId}/chapters/${chapter.id}/tts`,
                { voice: selectedVoice },
                { signal: controller.signal }
            );

            if (activeChapterIdRef.current !== chapter.id) return;

            const newAudioFiles = res.data.audioFiles;
            setAudioFiles(newAudioFiles);
            setChapters(prev => prev.map((c, idx) => idx === currentChapterIndex ? { ...c, audioFiles: newAudioFiles } : c));

            // Avoid racing with user clicks that happened during compilation
            const targetIndex = typeof startFromIndex === 'number' ? startFromIndex : currentSegmentIndex;
            if (currentSegmentIndex === targetIndex) {
                playAudio(Math.min(targetIndex, newAudioFiles.length - 1), newAudioFiles);
            }
        } catch (error: any) {
            if (axios.isCancel(error)) return;
            setBrowserTTSMode(true);
            setGenerating(false);
            playBrowserTTS(typeof startFromIndex === 'number' ? startFromIndex : currentSegmentIndex);
        } finally {
            if (activeChapterIdRef.current === chapter.id) {
                setGenerating(false);
                abortControllerRef.current = null;
            }
        }
    }, [bookId, chapters, currentChapterIndex, currentSegmentIndex, playAudio, playBrowserTTS, authAxios, setChapters, selectedVoice]);

    const togglePlayPause = useCallback(() => {
        const audio = audioRef.current;
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

        if (audio) {
            if (isPlaying) {
                audio.pause();
                setIsPlaying(false);
            } else {
                audio.play().catch(console.error);
                setIsPlaying(true);
            }
        } else {
            generateAudio();
        }
    }, [browserTTSMode, isPlaying, generateAudio]);

    const nextSegment = useCallback(() => {
        const currentChapter = chapters[currentChapterIndex];
        if (currentChapter && currentSegmentIndex < currentChapter.segments.length - 1) {
            const nextIdx = currentSegmentIndex + 1;
            if (audioFiles[nextIdx]) playAudio(nextIdx, audioFiles);
            else generateAudio(nextIdx);
        } else {
            nextChapter();
        }
    }, [chapters, currentChapterIndex, currentSegmentIndex, audioFiles, playAudio, generateAudio, nextChapter]);

    const prevSegment = useCallback(() => {
        if (currentSegmentIndex > 0) {
            const nextIdx = currentSegmentIndex - 1;
            if (audioFiles[nextIdx]) playAudio(nextIdx, audioFiles);
            else generateAudio(nextIdx);
        }
    }, [currentSegmentIndex, audioFiles, playAudio, generateAudio]);

    const prevVoiceRef = useRef(selectedVoice);

    // Auto-play trigger for chapter transitions or Voice changes
    useEffect(() => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter) return;

        // If voice changes AND we are playing/generating, restart with new voice
        if (prevVoiceRef.current !== selectedVoice) {
            prevVoiceRef.current = selectedVoice;
            const currentGlobal = getGlobalAudio();
            if (currentGlobal) {
                currentGlobal.pause();
                setGlobalAudio(null);
                audioRef.current = null;
            }
            if (isPlaying || audioFiles.length > 0) {
                generateAudio(currentSegmentIndex);
                return;
            }
        }

        if (activeChapterIdRef.current !== chapter.id) {
            // Chapter changed! Stop existing audio
            const currentGlobal = getGlobalAudio();
            if (currentGlobal) {
                currentGlobal.pause();
                setGlobalAudio(null);
                audioRef.current = null;
            }
            activeChapterIdRef.current = chapter.id;
            setAudioFiles(chapter.audioFiles || []);
            // If it was playing, we need to trigger generation or play for the new chapter
            if (isPlaying) {
                if (chapter.audioFiles && chapter.audioFiles.length > 0) {
                    playAudio(currentSegmentIndex, chapter.audioFiles);
                } else if (!generating) {
                    generateAudio(currentSegmentIndex);
                }
            }
        } else if (isPlaying) {
            // Same chapter, just ensuring something is playing if it's supposed to
            const globalAudio = getGlobalAudio();
            if (!globalAudio || (globalAudio.paused && !globalAudio.ended && globalAudio.src)) {
                // This handles cases where user clicked next/prev segment
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

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
    const abortControllerRef = useRef<AbortController | null>(null);
    const activeChapterIdRef = useRef<number | null>(null);

    const playBrowserTTS = useCallback((index: number) => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter || !chapter.segments[index]) return;

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(chapter.segments[index].content);
        utterance.lang = 'vi-VN';
        utterance.rate = playbackSpeed;

        utterance.onstart = () => {
            setIsPlaying(true);
            setCurrentSegmentIndex(index);
        };

        utterance.onend = () => {
            if (index + 1 < chapter.segments.length) {
                playBrowserTTS(index + 1);
            } else {
                nextChapter();
            }
        };

        window.speechSynthesis.speak(utterance);
    }, [chapters, currentChapterIndex, playbackSpeed, nextChapter, setCurrentSegmentIndex]);

    const playAudio = useCallback(async (index: number, files: string[] = audioFiles) => {
        if (!files || files.length === 0) return;
        const intendedChapterId = chapters[currentChapterIndex]?.id;
        activeChapterIdRef.current = intendedChapterId;
        setCurrentSegmentIndex(index);

        let url = '';
        try {
            const offlineBlob = await getOfflineAudio(bookId, chapters[currentChapterIndex].id, index);
            if (offlineBlob) {
                url = URL.createObjectURL(offlineBlob);
            } else {
                url = `${API_BASE_URL}${files[index]}`;
            }
        } catch (e) {
            url = `${API_BASE_URL}${files[index]}`;
        }

        const currentGlobal = getGlobalAudio();
        if (currentGlobal) {
            const currentSrc = currentGlobal.src.split('?')[0];
            const newSrc = url.split('?')[0];
            if (currentSrc === newSrc) {
                if (currentGlobal.paused) currentGlobal.play().catch(console.error);
                audioRef.current = currentGlobal;
                setIsPlaying(true);
                return;
            }
            currentGlobal.pause();
            setGlobalAudio(null);
        }

        const audio = new Audio(url);
        audio.playbackRate = playbackSpeed;
        setGlobalAudio(audio);
        audioRef.current = audio;

        audio.onerror = () => {
            setBrowserTTSMode(true);
            playBrowserTTS(index);
        };

        audio.onended = () => {
            if (activeChapterIdRef.current !== intendedChapterId) return;
            if (index + 1 < files.length) {
                playAudio(index + 1, files);
            } else if (currentChapterIndex < chapters.length - 1) {
                nextChapter();
            } else {
                setIsPlaying(false);
            }
        };

        audio.play().catch(error => {
            if (error.name === 'AbortError') return;
            if (activeChapterIdRef.current !== intendedChapterId) return;
            setBrowserTTSMode(true);
            playBrowserTTS(index);
        });

        setIsPlaying(true);
    }, [audioFiles, chapters, currentChapterIndex, nextChapter, playbackSpeed, bookId, playBrowserTTS, setCurrentSegmentIndex, getGlobalAudio, setGlobalAudio]);

    const generateAudio = useCallback(async (startFromIndex?: number) => {
        if (chapters.length === 0) return;
        const chapter = chapters[currentChapterIndex];
        activeChapterIdRef.current = chapter.id;

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

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

            const targetIndex = typeof startFromIndex === 'number' ? startFromIndex : currentSegmentIndex;
            playAudio(Math.min(targetIndex, newAudioFiles.length - 1), newAudioFiles);
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

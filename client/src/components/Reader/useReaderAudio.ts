import { useState, useCallback, useRef, useEffect } from 'react';
import { Chapter } from './types';
import { generateTTS } from '../../services/apiService';
import { deleteOfflineAudioSegment, getOfflineAudio } from '../../services/offlineManager';
import { getStoredOfflineTtsQuality, isOfflineTtsQuality, OFFLINE_TTS_QUALITIES, OfflineTtsQuality, resolveApiUrl } from '../../constants';
import { getErrorMessage, isAbortError } from '../../utils/errors';

const AUDIO_PRELOAD_WINDOW = 3;
const USER_GESTURE_PRIMER_SRC = 'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface UseReaderAudioProps {
    bookId: number;
    chapters: Chapter[];
    setChapters: React.Dispatch<React.SetStateAction<Chapter[]>>;
    currentChapterIndex: number;
    currentSegmentIndex: number;
    setCurrentSegmentIndex: (index: number) => void;
    playbackSpeed: number;
    selectedVoice: string;
    expressiveTts: boolean;
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
    expressiveTts,
    nextChapter,
    getGlobalAudio,
    setGlobalAudio
}: UseReaderAudioProps) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [audioFiles, setAudioFiles] = useState<string[]>([]);
    const [audioError, setAudioError] = useState<string | null>(null);
    const [browserTTSMode, setBrowserTTSMode] = useState(false);
    const [hasAudioSession, setHasAudioSession] = useState(false);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const primedAudioRef = useRef<HTMLAudioElement | null>(null);
    const preloadAudioMapRef = useRef<Map<number, HTMLAudioElement>>(new Map());
    const preloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const activeChapterIdRef = useRef<number | null>(null);
    const queuedIndicesRef = useRef<Set<number>>(new Set());
    const playIdRef = useRef<number>(0);
    const offlineObjectUrlsRef = useRef<Set<string>>(new Set());
    const offlinePlaybackQualityRef = useRef<OfflineTtsQuality | null>(null);
    const badOfflineAudioKeysRef = useRef<Set<string>>(new Set());
    const pausedAudioRef = useRef<{
        audio: HTMLAudioElement;
        chapterId: number;
        segmentIndex: number;
        currentTime: number;
    } | null>(null);
    // Map of segment index -> URL for current chapter
    const activeUrlMapRef = useRef<Map<number, string>>(new Map());

    const revokeOfflineObjectUrl = useCallback((url?: string) => {
        if (!url || !offlineObjectUrlsRef.current.has(url)) return;
        URL.revokeObjectURL(url);
        offlineObjectUrlsRef.current.delete(url);
    }, []);

    const primeAudioForUserGesture = useCallback(() => {
        const audio = new Audio(USER_GESTURE_PRIMER_SRC);
        audio.muted = true;
        audio.volume = 0;
        audio.preload = 'auto';
        audio.setAttribute('playsinline', 'true');
        primedAudioRef.current = audio;
        audio.play().catch(() => {
            // Some browser automation does not grant a real user gesture. The normal
            // play path still works for real taps, and will show a clear error if not.
        });
    }, []);

    const consumePrimedAudio = useCallback(() => {
        const audio = primedAudioRef.current;
        primedAudioRef.current = null;
        if (!audio) return null;
        audio.pause();
        audio.muted = false;
        audio.volume = 1;
        return audio;
    }, []);

    const createOfflineAudio = useCallback((blob: Blob, reusableAudio?: HTMLAudioElement | null) => {
        const playableBlob = blob.type.toLowerCase().startsWith('audio/')
            ? blob
            : new Blob([blob], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(playableBlob);
        offlineObjectUrlsRef.current.add(url);
        const audio = reusableAudio || new Audio();
        audio.src = url;
        audio.muted = false;
        audio.volume = 1;
        audio.playbackRate = playbackSpeed;
        audio.preload = 'auto';
        audio.setAttribute('playsinline', 'true');
        return audio;
    }, [playbackSpeed]);

    const getOfflineQualityCandidates = useCallback(() => {
        const storedQuality = getStoredOfflineTtsQuality();
        if (expressiveTts) return [];

        const candidates = [
            offlinePlaybackQualityRef.current,
            storedQuality,
            ...OFFLINE_TTS_QUALITIES.map(item => item.id),
        ].filter((quality): quality is OfflineTtsQuality => Boolean(quality));
        return Array.from(new Set(candidates));
    }, [expressiveTts]);

    const buildOfflineAudioKey = useCallback((
        chapterId: number,
        voice: string,
        quality: OfflineTtsQuality,
        segmentIndex: number
    ) => `${bookId}_${chapterId}_${voice}_${quality}_${segmentIndex}`, [bookId]);

    const markBadOfflineAudio = useCallback((audio: HTMLAudioElement) => {
        const key = audio.dataset.offlineKey;
        if (!key) return false;
        badOfflineAudioKeysRef.current.add(key);
        return true;
    }, []);

    const normalizeAudioFilesForStart = useCallback((
        urls: string[],
        startIndex: number,
        totalSegments: number
    ) => {
        if (urls.length >= totalSegments || urls[startIndex]) {
            return urls;
        }

        const normalized = Array.from({ length: totalSegments }, () => '');
        urls.forEach((url, index) => {
            const targetIndex = startIndex + index;
            if (targetIndex < totalSegments) {
                normalized[targetIndex] = url;
            }
        });
        return normalized;
    }, []);

    const findPlayableUrlIndex = useCallback((urls: string[], startIndex: number) => {
        if (urls[startIndex]) return startIndex;
        const nextIndex = urls.findIndex((url, index) => index >= startIndex && Boolean(url));
        return nextIndex >= 0 ? nextIndex : startIndex;
    }, []);

    const hasPlayableAudioUrl = useCallback((urls?: string[]) => Boolean(urls?.some(Boolean)), []);

    const clearPreloadedAudio = useCallback(() => {
        preloadAudioMapRef.current.forEach(audio => {
            audio.pause();
            revokeOfflineObjectUrl(audio.src);
            audio.removeAttribute('src');
            audio.load();
            audio.remove();
        });
        preloadAudioMapRef.current.clear();
    }, [revokeOfflineObjectUrl]);

    useEffect(() => {
        document.querySelectorAll('audio[data-offline-key]').forEach(audio => {
            const media = audio as HTMLAudioElement;
            media.pause();
            media.removeAttribute('src');
            media.load();
            media.remove();
        });
    }, []);

    useEffect(() => {
        const objectUrls = offlineObjectUrlsRef.current;
        return () => {
            clearPreloadedAudio();
            if (primedAudioRef.current) {
                primedAudioRef.current.pause();
                primedAudioRef.current.removeAttribute('src');
                primedAudioRef.current.load();
                primedAudioRef.current = null;
            }
            objectUrls.forEach(url => URL.revokeObjectURL(url));
            objectUrls.clear();
        };
    }, [clearPreloadedAudio]);

    const stopAudioPlayback = useCallback((message: string, error?: unknown) => {
        if (error) {
            console.error(message, error);
        } else {
            console.error(message);
        }
        setAudioError(message.replace(/^\[[^\]]+\]\s*/, ''));
        setBrowserTTSMode(false);
        setIsPlaying(false);
        setHasAudioSession(false);
        pausedAudioRef.current = null;
    }, []);

    const isSpeakableSegment = useCallback((index: number) => {
        const content = chapters[currentChapterIndex]?.segments[index]?.content ?? '';
        const normalized = content
            .replace(/[\s\u00a0]+/g, '')
            .replace(/[*＊✱✲✳✴✻✼✽·•●○◆◇■□_—–~….-]+/g, '');
        return /[\p{L}\p{N}]/u.test(normalized);
    }, [chapters, currentChapterIndex]);

    const findNextSpeakableSegmentIndex = useCallback((startIndex: number) => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter) return null;
        for (let index = startIndex; index < chapter.segments.length; index++) {
            if (isSpeakableSegment(index)) return index;
        }
        return null;
    }, [chapters, currentChapterIndex, isSpeakableSegment]);

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
            revokeOfflineObjectUrl(currentGlobal.src);
            if (currentGlobal.dataset.offlineKey) {
                currentGlobal.removeAttribute('src');
                currentGlobal.load();
                currentGlobal.remove();
            } else {
                currentGlobal.src = '';
            }
            setGlobalAudio(null);
        }

        if (queuedIndicesRef.current.has(index)) return;

        const utterance = new SpeechSynthesisUtterance(chapter.segments[index].content);
        utterance.lang = 'vi-VN';
        utterance.rate = playbackSpeed;

        utterance.onstart = () => {
            setIsPlaying(true);
            setHasAudioSession(true);
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
    }, [chapters, currentChapterIndex, playbackSpeed, nextChapter, setCurrentSegmentIndex, getGlobalAudio, setGlobalAudio, isSpeakableSegment, revokeOfflineObjectUrl]);

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

            for (const quality of getOfflineQualityCandidates()) {
                const offlineKey = buildOfflineAudioKey(chapterId, selectedVoice, quality, idx);
                if (badOfflineAudioKeysRef.current.has(offlineKey)) continue;
                const offlineBlob = await getOfflineAudio(bookId, chapterId, selectedVoice, idx, quality);
                if (offlineBlob) {
                    offlinePlaybackQualityRef.current = quality;
                    const audio = createOfflineAudio(offlineBlob, consumePrimedAudio());
                    audio.dataset.offlineKey = offlineKey;
                    audio.dataset.offlineQuality = quality;
                    audio.dataset.offlineSegmentIndex = String(idx);
                    return audio;
                }
            }

            // Check URL map
            let url = activeUrlMapRef.current.get(idx);

            if (!url && _files && _files[idx]) {
                url = _files[idx];
            }

            if (!url) return null;
            const audio = consumePrimedAudio() || new Audio();
            audio.src = resolveApiUrl(url);
            audio.muted = false;
            audio.volume = 1;
            audio.playbackRate = playbackSpeed;
            audio.preload = 'auto';
            audio.setAttribute('playsinline', 'true');
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

                for (const quality of getOfflineQualityCandidates()) {
                    const offlineKey = buildOfflineAudioKey(chapterId, selectedVoice, quality, idx);
                    if (badOfflineAudioKeysRef.current.has(offlineKey)) continue;
                    const offlineBlob = await getOfflineAudio(bookId, chapterId, selectedVoice, idx, quality);
                    if (offlineBlob) {
                        offlinePlaybackQualityRef.current = quality;
                        const audio = createOfflineAudio(offlineBlob);
                        audio.dataset.offlineKey = offlineKey;
                        audio.dataset.offlineQuality = quality;
                        audio.dataset.offlineSegmentIndex = String(idx);
                        audio.load();
                        preloadAudioMapRef.current.set(idx, audio);
                        queued++;
                        break;
                    }
                }
                if (preloadAudioMapRef.current.has(idx)) {
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
                    const preloadedAudio = preloadAudioMapRef.current.get(preloadIndex);
                    if (preloadedAudio) {
                        preloadedAudio.pause();
                        revokeOfflineObjectUrl(preloadedAudio.src);
                        preloadedAudio.removeAttribute('src');
                        preloadedAudio.load();
                        preloadedAudio.remove();
                    }
                    preloadAudioMapRef.current.delete(preloadIndex);
                }
            }
        };

        const fallbackToServerAudio = async (reuseAudio?: HTMLAudioElement) => {
            clearPreloadedAudio();
            const offlineObjectUrl = reuseAudio?.dataset.offlineKey ? reuseAudio.src : undefined;

            if (!navigator.onLine) {
                if (offlineObjectUrl) revokeOfflineObjectUrl(offlineObjectUrl);
                stopAudioPlayback('[TTS] Đoạn này chưa được tải offline.');
                return;
            }

            try {
                setGenerating(true);
                const { audioFiles: urls } = await generateTTS(bookId, chapterId, selectedVoice, index, undefined, abortControllerRef.current?.signal, expressiveTts);
                if (currentPlayId !== playIdRef.current || activeChapterIdRef.current !== chapterId) {
                    if (offlineObjectUrl) revokeOfflineObjectUrl(offlineObjectUrl);
                    return;
                }

                const normalizedUrls = normalizeAudioFilesForStart(urls, index, chapter.segments.length);
                if (!hasPlayableAudioUrl(normalizedUrls)) {
                    stopAudioPlayback('[TTS] Không tạo được URL audio cho chương này.');
                    return;
                }
                const playbackIndex = findPlayableUrlIndex(normalizedUrls, index);
                activeUrlMapRef.current.clear();
                offlinePlaybackQualityRef.current = null;
                normalizedUrls.forEach((url, i) => {
                    activeUrlMapRef.current.set(i, url);
                });
                setAudioFiles(normalizedUrls);
                setChapters(prev => prev.map((c, idx) => idx === currentChapterIndex ? { ...c, audioFiles: normalizedUrls } : c));

                const serverUrl = normalizedUrls[playbackIndex];
                if (reuseAudio && playbackIndex === index && serverUrl) {
                    if (offlineObjectUrl) revokeOfflineObjectUrl(offlineObjectUrl);
                    delete reuseAudio.dataset.offlineKey;
                    delete reuseAudio.dataset.offlineQuality;
                    delete reuseAudio.dataset.offlineSegmentIndex;
                    reuseAudio.pause();
                    reuseAudio.src = resolveApiUrl(serverUrl);
                    reuseAudio.playbackRate = playbackSpeed;
                    reuseAudio.preload = 'auto';
                    reuseAudio.load();
                    setGlobalAudio(reuseAudio);
                    audioRef.current = reuseAudio;
                    setHasAudioSession(true);
                    setIsPlaying(true);
                    preloadUpcoming(index + 1);
                    reuseAudio.play().catch(error => {
                        if (error.name === 'AbortError') return;
                        if (currentPlayId !== playIdRef.current) return;
                        stopAudioPlayback('[Audio] Trình duyệt chặn tự phát sau khi xoá audio offline lỗi. Bấm phát lại để nghe tiếp.', error);
                    });
                    return;
                }

                if (offlineObjectUrl) revokeOfflineObjectUrl(offlineObjectUrl);
                playAudio(playbackIndex, normalizedUrls, 0, currentPlayId);
            } catch (error) {
                if (currentPlayId !== playIdRef.current) return;
                if (offlineObjectUrl) revokeOfflineObjectUrl(offlineObjectUrl);
                stopAudioPlayback(`[TTS] Không tạo được audio server sau khi audio offline lỗi. ${getErrorMessage(error, 'Vui lòng thử lại sau.')}`, error);
            } finally {
                if (activeChapterIdRef.current === chapterId) {
                    setGenerating(false);
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
            revokeOfflineObjectUrl(currentGlobal.src);
            if (currentGlobal.dataset.offlineKey) {
                currentGlobal.removeAttribute('src');
                currentGlobal.load();
                currentGlobal.remove();
            }
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
                    setHasAudioSession(false);
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
        pausedAudioRef.current = null;
        setHasAudioSession(true);

        let offlineStartTimeout: ReturnType<typeof setTimeout> | null = null;
        const clearOfflineStartTimeout = () => {
            if (!offlineStartTimeout) return;
            clearTimeout(offlineStartTimeout);
            offlineStartTimeout = null;
        };
        const fallbackFromBadOfflineAudio = (reason = 'offline audio did not start') => {
            const badOfflineAudio = markBadOfflineAudio(audio);
            if (!badOfflineAudio) return false;
            if (badOfflineAudio) {
                const failedQuality = audio.dataset.offlineQuality;
                const failedSegmentIndex = Number(audio.dataset.offlineSegmentIndex);
                if (failedQuality && isOfflineTtsQuality(failedQuality) && Number.isInteger(failedSegmentIndex)) {
                    deleteOfflineAudioSegment(bookId, chapterId, selectedVoice, failedSegmentIndex, failedQuality)
                        .catch(error => console.error('[Offline audio] Failed to delete bad cached segment:', error));
                }
                console.warn('[Offline audio] Skipping cached segment and falling back to server', {
                    key: audio.dataset.offlineKey,
                    reason,
                    currentTime: audio.currentTime,
                    readyState: audio.readyState,
                    networkState: audio.networkState,
                    errorCode: audio.error?.code,
                });
                setAudioError('Audio offline trên máy bị lỗi, đang xoá đoạn hỏng và phát từ server...');
            }
            clearOfflineStartTimeout();
            fallbackToServerAudio(audio);
            return true;
        };

        audio.onerror = () => {
            if (currentPlayId !== playIdRef.current) return;
            if (fallbackFromBadOfflineAudio(`media error ${audio.error?.code || 'unknown'}`)) return;
            if (!isSpeakableSegment(index)) {
                if (index + 1 < chapter.segments.length) {
                    setCurrentSegmentIndex(index + 1);
                    playAudio(index + 1, _files, 0, currentPlayId);
                } else if (currentChapterIndex < chapters.length - 1) {
                    nextChapter();
                } else {
                    setIsPlaying(false);
                    setHasAudioSession(false);
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
            clearOfflineStartTimeout();
            revokeOfflineObjectUrl(audio.src);
            if (audio.dataset.offlineKey) {
                audio.removeAttribute('src');
                audio.load();
                audio.remove();
            }
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
                    setHasAudioSession(false);
                }
            } else {
                setIsPlaying(false);
                setHasAudioSession(false);
            }
        };

        audio.onplaying = () => {
            clearOfflineStartTimeout();
        };
        if (audio.dataset.offlineKey) {
            audio.ontimeupdate = () => {
                if (audio.currentTime > 0.1) {
                    clearOfflineStartTimeout();
                }
            };
            offlineStartTimeout = setTimeout(() => {
                if (
                    currentPlayId !== playIdRef.current ||
                    activeChapterIdRef.current !== chapterId ||
                    !audio.dataset.offlineKey ||
                    audio.ended
                ) return;

                if (audio.paused || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || audio.currentTime <= 0.1) {
                    fallbackFromBadOfflineAudio('offline audio made no audible progress');
                }
            }, 3000);
        }

        audio.play().catch(error => {
            if (error.name === 'AbortError') return;
            if (currentPlayId !== playIdRef.current) return;
            if (error.name === 'NotAllowedError') {
                clearOfflineStartTimeout();
                stopAudioPlayback('[Audio] Trình duyệt chặn tự phát. Bấm phát lại để nghe tiếp.', error);
                return;
            }
            if (fallbackFromBadOfflineAudio(error?.message || 'play rejected')) return;
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

    }, [audioFiles, bookId, buildOfflineAudioKey, chapters, clearPreloadedAudio, consumePrimedAudio, currentChapterIndex, createOfflineAudio, expressiveTts, findPlayableUrlIndex, hasPlayableAudioUrl, nextChapter, normalizeAudioFilesForStart, playbackSpeed, selectedVoice, setChapters, stopAudioPlayback, setCurrentSegmentIndex, getGlobalAudio, setGlobalAudio, isSpeakableSegment, revokeOfflineObjectUrl, getOfflineQualityCandidates, markBadOfflineAudio]);

    const resumePausedAudio = useCallback((chapterId: number) => {
        const paused = pausedAudioRef.current;
        if (!paused || paused.chapterId !== chapterId || paused.audio.ended || !paused.audio.src) {
            return false;
        }

        const audio = paused.audio;
        audio.playbackRate = playbackSpeed;
        if (Number.isFinite(paused.currentTime) && paused.currentTime > 0) {
            audio.currentTime = paused.currentTime;
        }
        audioRef.current = audio;
        setGlobalAudio(audio);
        setHasAudioSession(true);
        audio.play()
            .then(() => {
                setCurrentSegmentIndex(paused.segmentIndex);
                setIsPlaying(true);
            })
            .catch(error => {
                stopAudioPlayback('[Audio] Trình duyệt chặn tự phát. Bấm phát lại để nghe tiếp.', error);
            });
        return true;
    }, [playbackSpeed, setCurrentSegmentIndex, setGlobalAudio, stopAudioPlayback]);

    const findOfflineAudioIndex = useCallback(async (
        chapterId: number,
        startIndex: number
    ) => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter) return null;
        const qualities = getOfflineQualityCandidates();

        if (!isSpeakableSegment(startIndex)) return null;
        for (const quality of qualities) {
            const offlineKey = buildOfflineAudioKey(chapterId, selectedVoice, quality, startIndex);
            if (badOfflineAudioKeysRef.current.has(offlineKey)) continue;
            const blob = await getOfflineAudio(bookId, chapterId, selectedVoice, startIndex, quality);
            if (blob) return { index: startIndex, quality };
        }
        return null;
    }, [bookId, buildOfflineAudioKey, chapters, currentChapterIndex, isSpeakableSegment, selectedVoice, getOfflineQualityCandidates]);

    const generateAudio = useCallback(async (startFromIndex?: number) => {
        if (chapters.length === 0) return;

        const chapter = chapters[currentChapterIndex];
        if (typeof startFromIndex !== 'number' && resumePausedAudio(chapter.id)) return;

        activeChapterIdRef.current = chapter.id;
        ++playIdRef.current; // Cancel stale playback retries while a new voice/segment is being prepared.

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        window.speechSynthesis.cancel();
        queuedIndicesRef.current.clear();
        clearPreloadedAudio();

        const currentGlobal = getGlobalAudio();
            if (currentGlobal) {
                currentGlobal.pause();
                revokeOfflineObjectUrl(currentGlobal.src);
                if (currentGlobal.dataset.offlineKey) {
                    currentGlobal.removeAttribute('src');
                    currentGlobal.load();
                    currentGlobal.remove();
                }
                currentGlobal.src = '';
                setGlobalAudio(null);
            }
        pausedAudioRef.current = null;
        setHasAudioSession(false);

        setGenerating(true);
        setAudioError(null);
        setBrowserTTSMode(false);
        primeAudioForUserGesture();

        try {
            const requestedIndex = typeof startFromIndex === 'number' ? startFromIndex : currentSegmentIndex;
            const targetIndex = findNextSpeakableSegmentIndex(requestedIndex);
            if (targetIndex === null) {
                if (currentChapterIndex < chapters.length - 1) {
                    nextChapter();
                } else {
                    setIsPlaying(false);
                    setHasAudioSession(false);
                }
                return;
            }
            const offlineStart = await findOfflineAudioIndex(chapter.id, targetIndex);
            if (offlineStart !== null) {
                if (controller.signal.aborted || activeChapterIdRef.current !== chapter.id) return;
                offlinePlaybackQualityRef.current = offlineStart.quality;
                activeUrlMapRef.current.clear();
                setAudioFiles([]);
                setChapters(prev => prev.map((c, idx) => idx === currentChapterIndex ? { ...c, audioFiles: [] } : c));
                playAudio(offlineStart.index, []);
                return;
            }

            if (!navigator.onLine) {
                stopAudioPlayback('[TTS] Đoạn này chưa được tải offline.');
                return;
            }

            // Ask the server for signed, short-lived audio URLs. This avoids exposing
            // the long-lived login JWT in media URLs while still enabling <audio> playback.
            const { audioFiles: urls } = await generateTTS(bookId, chapter.id, selectedVoice, targetIndex, undefined, controller.signal, expressiveTts);

            if (controller.signal.aborted || activeChapterIdRef.current !== chapter.id) return;

            const normalizedUrls = normalizeAudioFilesForStart(urls, targetIndex, chapter.segments.length);
            if (!hasPlayableAudioUrl(normalizedUrls)) {
                stopAudioPlayback('[TTS] Không tạo được URL audio cho chương này.');
                return;
            }
            const playbackIndex = findPlayableUrlIndex(normalizedUrls, targetIndex);
            activeUrlMapRef.current.clear();
            offlinePlaybackQualityRef.current = null;
            normalizedUrls.forEach((url, i) => {
                activeUrlMapRef.current.set(i, url);
            });

            setAudioFiles(normalizedUrls);
            setChapters(prev => prev.map((c, idx) => idx === currentChapterIndex ? { ...c, audioFiles: normalizedUrls } : c));

            // Start playing immediately from target
            playAudio(playbackIndex, normalizedUrls);

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
    }, [bookId, chapters, currentChapterIndex, currentSegmentIndex, playAudio, setChapters, selectedVoice, expressiveTts, getGlobalAudio, setGlobalAudio, stopAudioPlayback, clearPreloadedAudio, revokeOfflineObjectUrl, resumePausedAudio, findOfflineAudioIndex, findNextSpeakableSegmentIndex, findPlayableUrlIndex, nextChapter, normalizeAudioFilesForStart, primeAudioForUserGesture, hasPlayableAudioUrl]);

    const playSegment = useCallback(async (startIndex: number) => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter) return;

        const targetIndex = findNextSpeakableSegmentIndex(startIndex);
        if (targetIndex === null) {
            if (currentChapterIndex < chapters.length - 1) {
                nextChapter();
            } else {
                setIsPlaying(false);
                setHasAudioSession(false);
            }
            return;
        }

        const clickPlayId = ++playIdRef.current;
        activeChapterIdRef.current = chapter.id;
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setGenerating(false);
        setAudioError(null);
        setBrowserTTSMode(false);
        primeAudioForUserGesture();

        const offlineStart = await findOfflineAudioIndex(chapter.id, targetIndex);
        if (clickPlayId !== playIdRef.current || activeChapterIdRef.current !== chapter.id) return;

        if (offlineStart !== null) {
            offlinePlaybackQualityRef.current = offlineStart.quality;
            activeUrlMapRef.current.clear();
            setAudioFiles([]);
            setChapters(prev => prev.map((c, idx) => idx === currentChapterIndex ? { ...c, audioFiles: [] } : c));
            playAudio(offlineStart.index, [], 0, clickPlayId);
            return;
        }

        let playbackIndex = targetIndex;
        let hasCachedUrl = Boolean(activeUrlMapRef.current.get(playbackIndex) || audioFiles[playbackIndex]);
        if (!hasCachedUrl) {
            playbackIndex = findPlayableUrlIndex(audioFiles, targetIndex);
            hasCachedUrl = Boolean(activeUrlMapRef.current.get(playbackIndex) || audioFiles[playbackIndex]);
        }

        if (hasCachedUrl) {
            playAudio(playbackIndex, audioFiles, 0, clickPlayId);
            return;
        }

        generateAudio(targetIndex);
    }, [audioFiles, chapters, currentChapterIndex, findNextSpeakableSegmentIndex, findOfflineAudioIndex, findPlayableUrlIndex, generateAudio, nextChapter, playAudio, primeAudioForUserGesture, setChapters]);

    const togglePlayPause = useCallback(() => {
        if (browserTTSMode) {
            if (isPlaying) {
                window.speechSynthesis.pause();
                setIsPlaying(false);
                setHasAudioSession(true);
            } else {
                window.speechSynthesis.resume();
                setHasAudioSession(true);
                setIsPlaying(true);
            }
            return;
        }

        if (isPlaying) {
            const globalAudio = getGlobalAudio();
            const activeAudio = globalAudio || audioRef.current;
            if (activeAudio && activeAudio.src && !activeAudio.ended) {
                pausedAudioRef.current = {
                    audio: activeAudio,
                    chapterId: activeChapterIdRef.current ?? chapters[currentChapterIndex]?.id ?? 0,
                    segmentIndex: currentSegmentIndex,
                    currentTime: activeAudio.currentTime
                };
                activeAudio.pause();
                audioRef.current = activeAudio;
                setGlobalAudio(activeAudio);
                setHasAudioSession(true);
            } else {
                ++playIdRef.current;
                setHasAudioSession(false);
                pausedAudioRef.current = null;
            }
            if (audioRef.current && audioRef.current !== activeAudio) audioRef.current.pause();
            setIsPlaying(false);
        } else {
            const chapter = chapters[currentChapterIndex];
            if (chapter && resumePausedAudio(chapter.id)) return;

            const audio = getGlobalAudio() || audioRef.current;
            if (audio && audio.src && !audio.ended) {
                audio.playbackRate = playbackSpeed;
                audioRef.current = audio;
                setGlobalAudio(audio);
                setHasAudioSession(true);
                audio.play()
                    .then(() => setIsPlaying(true))
                    .catch(error => {
                        stopAudioPlayback('[Audio] Trình duyệt chặn tự phát. Bấm phát lại để nghe tiếp.', error);
                    });
            } else {
                generateAudio();
            }
        }
    }, [browserTTSMode, chapters, currentChapterIndex, currentSegmentIndex, isPlaying, generateAudio, getGlobalAudio, playbackSpeed, resumePausedAudio, setGlobalAudio, stopAudioPlayback]);

    const nextSegment = useCallback(() => {
        const currentChapter = chapters[currentChapterIndex];
        if (currentChapter && currentSegmentIndex < currentChapter.segments.length - 1) {
            playSegment(currentSegmentIndex + 1);
        } else {
            nextChapter();
        }
    }, [chapters, currentChapterIndex, currentSegmentIndex, playSegment, nextChapter]);

    const prevSegment = useCallback(() => {
        if (currentSegmentIndex > 0) {
            playSegment(currentSegmentIndex - 1);
        }
    }, [currentSegmentIndex, playSegment]);

    const prevPlaybackProfileRef = useRef(`${selectedVoice}:${expressiveTts ? 'ex1' : 'ex0'}`);

    // Auto-play trigger for chapter transitions or voice changes
    useEffect(() => {
        const chapter = chapters[currentChapterIndex];
        if (!chapter) return;

        const playbackProfile = `${selectedVoice}:${expressiveTts ? 'ex1' : 'ex0'}`;
        if (prevPlaybackProfileRef.current !== playbackProfile) {
            prevPlaybackProfileRef.current = playbackProfile;
            ++playIdRef.current; // Ignore old voice retries/errors after URLs are cleared.
            const currentGlobal = getGlobalAudio();
            if (currentGlobal) {
                currentGlobal.pause();
                revokeOfflineObjectUrl(currentGlobal.src);
                if (currentGlobal.dataset.offlineKey) {
                    currentGlobal.removeAttribute('src');
                    currentGlobal.load();
                    currentGlobal.remove();
                }
                setGlobalAudio(null);
                audioRef.current = null;
            }
            pausedAudioRef.current = null;
            setHasAudioSession(false);
            activeUrlMapRef.current.clear();
            setAudioFiles([]);
            clearPreloadedAudio();
            if (isPlaying) {
                generateAudio(currentSegmentIndex);
                return;
            }
        }

        if (activeChapterIdRef.current !== chapter.id) {
            const nextAudioFiles = chapter.audioFiles || [];
            const nextSegmentIndex = currentSegmentIndex < chapter.segments.length ? currentSegmentIndex : 0;
            const currentGlobal = getGlobalAudio();
            if (currentGlobal) {
                currentGlobal.pause();
                revokeOfflineObjectUrl(currentGlobal.src);
                if (currentGlobal.dataset.offlineKey) {
                    currentGlobal.removeAttribute('src');
                    currentGlobal.load();
                    currentGlobal.remove();
                }
                setGlobalAudio(null);
                audioRef.current = null;
            }
            pausedAudioRef.current = null;
            setHasAudioSession(false);
            activeChapterIdRef.current = chapter.id;
            activeUrlMapRef.current.clear();
            clearPreloadedAudio();
            setAudioFiles(nextAudioFiles);
            if (isPlaying) {
                if (hasPlayableAudioUrl(nextAudioFiles)) {
                    playAudio(nextSegmentIndex, nextAudioFiles);
                } else if (!generating) {
                    generateAudio(nextSegmentIndex);
                }
            }
        } else if (isPlaying) {
            const nextSegmentIndex = currentSegmentIndex < chapter.segments.length ? currentSegmentIndex : 0;
            const globalAudio = getGlobalAudio();
            if (globalAudio && globalAudio.paused && !globalAudio.ended && globalAudio.src) {
                globalAudio.playbackRate = playbackSpeed;
                globalAudio.play().catch(console.error);
            } else if (!globalAudio && audioRef.current?.src && !audioRef.current.ended) {
                audioRef.current.playbackRate = playbackSpeed;
                setGlobalAudio(audioRef.current);
                audioRef.current.play().catch(console.error);
            } else if (
                !globalAudio &&
                (
                    preloadAudioMapRef.current.has(nextSegmentIndex) ||
                    Boolean(activeUrlMapRef.current.get(nextSegmentIndex)) ||
                    hasPlayableAudioUrl(audioFiles)
                )
            ) {
                playAudio(nextSegmentIndex, audioFiles);
            } else if (!globalAudio && !generating) {
                generateAudio(nextSegmentIndex);
            }
        }
    }, [currentChapterIndex, chapters, isPlaying, currentSegmentIndex, generating, audioFiles, getGlobalAudio, setGlobalAudio, playAudio, generateAudio, selectedVoice, expressiveTts, clearPreloadedAudio, revokeOfflineObjectUrl, playbackSpeed, hasPlayableAudioUrl]);

    return {
        isPlaying,
        hasAudioSession: hasAudioSession || browserTTSMode || hasPlayableAudioUrl(audioFiles) || Boolean(audioRef.current?.src),
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
        playSegment,
        playAudio,
        playBrowserTTS
    };
};

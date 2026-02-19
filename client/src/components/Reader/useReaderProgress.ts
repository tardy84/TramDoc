import { useCallback, useEffect, useRef } from 'react';
import { Book } from './types';

interface UseReaderProgressProps {
    bookId: number;
    book: Book | null;
    currentChapterIndex: number;
    setCurrentChapterIndex: (index: number) => void;
    currentSegmentIndex: number;
    setCurrentSegmentIndex: (index: number) => void;
    loading: boolean;
    isRestored: boolean;
    setIsRestored: (restored: boolean) => void;
    authAxios: any;
}

export const useReaderProgress = ({
    bookId,
    book,
    currentChapterIndex,
    setCurrentChapterIndex,
    currentSegmentIndex,
    setCurrentSegmentIndex,
    loading,
    isRestored,
    setIsRestored,
    authAxios
}: UseReaderProgressProps) => {
    const lastSavedRef = useRef<{ ch: number, seg: number }>({ ch: -1, seg: -1 });

    const saveProgressToServer = useCallback(async (chIdx: number, segIdx: number) => {
        if (!bookId || loading) return;

        // Don't save if it's the same as last saved
        if (lastSavedRef.current.ch === chIdx && lastSavedRef.current.seg === segIdx) return;

        try {
            await authAxios.post(`/api/progress/${bookId}`, {
                chapterIndex: chIdx,
                segmentIndex: segIdx
            });
            lastSavedRef.current = { ch: chIdx, seg: segIdx };
            console.log(`[Progress] Saved ch:${chIdx}, seg:${segIdx}`);
        } catch (e) {
            console.error('Failed to save progress', e);
        }
    }, [bookId, loading, authAxios]);

    // Initial Restore
    useEffect(() => {
        if (loading || isRestored || !book) return;

        const restoreProgress = async () => {
            try {
                // Try LocalStorage first for instant restore
                const localProgress = localStorage.getItem(`read_progress_${bookId}`);
                if (localProgress) {
                    const { ch, seg } = JSON.parse(localProgress);
                    setCurrentChapterIndex(ch);
                    setCurrentSegmentIndex(seg);
                }

                // Sync with server
                const res = await authAxios.get(`/api/progress/${bookId}`);
                if (res.data) {
                    setCurrentChapterIndex(res.data.chapterIndex);
                    setCurrentSegmentIndex(res.data.segmentIndex);
                }
                setIsRestored(true);
            } catch (e) {
                console.error('Progress restore failed', e);
                setIsRestored(true);
            }
        };

        restoreProgress();
    }, [bookId, book, loading, isRestored, setIsRestored, setCurrentChapterIndex, setCurrentSegmentIndex, authAxios]);

    // Auto-save progress
    useEffect(() => {
        if (loading || !isRestored) return;

        // Save to LocalStorage immediately
        localStorage.setItem(`read_progress_${bookId}`, JSON.stringify({
            ch: currentChapterIndex,
            seg: currentSegmentIndex
        }));

        // If chapter changed, save to server immediately. If it's just a segment, use debounce.
        if (lastSavedRef.current.ch !== currentChapterIndex && lastSavedRef.current.ch !== -1) {
            saveProgressToServer(currentChapterIndex, currentSegmentIndex);
        } else {
            const timer = setTimeout(() => {
                saveProgressToServer(currentChapterIndex, currentSegmentIndex);
            }, 3000); // 3s debounce for segment changes
            return () => clearTimeout(timer);
        }
    }, [bookId, currentChapterIndex, currentSegmentIndex, loading, isRestored, saveProgressToServer]);
};

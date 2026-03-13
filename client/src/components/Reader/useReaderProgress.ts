import { useCallback, useEffect, useRef } from 'react';
import { Book } from './types';
import { getProgress, saveProgress } from '../../services/apiService';

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
}: UseReaderProgressProps) => {
    const lastSavedRef = useRef<{ ch: number, seg: number }>({ ch: -1, seg: -1 });
    // Always track latest position in a ref so cleanup can access it
    const latestPositionRef = useRef<{ ch: number, seg: number }>({ ch: 0, seg: 0 });
    const isRestoredRef = useRef(false);

    // Keep refs in sync with state
    useEffect(() => {
        latestPositionRef.current = { ch: currentChapterIndex, seg: currentSegmentIndex };
    }, [currentChapterIndex, currentSegmentIndex]);

    useEffect(() => {
        isRestoredRef.current = isRestored;
    }, [isRestored]);

    const saveProgressLocal = useCallback(async (chIdx: number, segIdx: number) => {
        if (!bookId || loading) return;
        if (lastSavedRef.current.ch === chIdx && lastSavedRef.current.seg === segIdx) return;

        try {
            await saveProgress(bookId, chIdx, segIdx);
            lastSavedRef.current = { ch: chIdx, seg: segIdx };
            console.log(`[Progress] Saved ch:${chIdx}, seg:${segIdx}`);
        } catch (e) {
            console.error('Failed to save progress', e);
        }
    }, [bookId, loading]);

    // Initial Restore
    useEffect(() => {
        if (loading || isRestored || !book) return;

        const restoreProgress = async () => {
            try {
                const progress = await getProgress(bookId);
                console.log(`[Progress] Restoring: ch:${progress.chapterIndex}, seg:${progress.segmentIndex}`);
                if (progress) {
                    setCurrentChapterIndex(progress.chapterIndex);
                    setCurrentSegmentIndex(progress.segmentIndex);
                    latestPositionRef.current = { ch: progress.chapterIndex, seg: progress.segmentIndex };
                    lastSavedRef.current = { ch: progress.chapterIndex, seg: progress.segmentIndex };
                }
                setIsRestored(true);
            } catch (e) {
                console.error('Progress restore failed', e);
                setIsRestored(true);
            }
        };

        restoreProgress();
    }, [bookId, book, loading, isRestored, setIsRestored, setCurrentChapterIndex, setCurrentSegmentIndex]);

    // Auto-save progress (debounced for segments, immediate for chapters)
    useEffect(() => {
        if (loading || !isRestored) return;

        if (lastSavedRef.current.ch !== currentChapterIndex && lastSavedRef.current.ch !== -1) {
            // Chapter changed — save immediately
            saveProgressLocal(currentChapterIndex, currentSegmentIndex);
        } else {
            // Segment changed — save after 1.5s (reduced from 3s for better accuracy)
            const timer = setTimeout(() => {
                saveProgressLocal(currentChapterIndex, currentSegmentIndex);
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, [bookId, currentChapterIndex, currentSegmentIndex, loading, isRestored, saveProgressLocal]);

    // Save progress immediately when component unmounts (book closed)
    useEffect(() => {
        return () => {
            // Only save if progress was actually restored (prevents saving {0,0})
            if (!isRestoredRef.current) return;
            const { ch, seg } = latestPositionRef.current;
            if (bookId && (ch > 0 || seg > 0)) {
                // Fire-and-forget save on unmount
                saveProgress(bookId, ch, seg).catch(() => { });
                console.log(`[Progress] Saved on close: ch:${ch}, seg:${seg}`);
            }
        };
    }, [bookId]);
};

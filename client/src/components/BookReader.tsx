import { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { getGlobalAudio, setGlobalAudio } from '../services/audioPlayer';
import { saveBookOffline, saveChapterAudio, isBookOffline, getAllOfflineBooks, deleteOfflineBook } from '../services/offlineManager';

// Sub-components
import ReaderHeader from './Reader/ReaderHeader';
import ReaderControls from './Reader/ReaderControls';
import LibraryPanel from './Reader/LibraryPanel';
import SettingsPanel from './Reader/SettingsPanel';
import BookmarkModal from './Reader/BookmarkModal';
import ReadingSurface from './Reader/ReadingSurface';

// Types & Hooks
import { ThemeMode, Book, Chapter, Bookmark, Segment } from './Reader/types';
import { useReaderAudio } from './Reader/useReaderAudio';
import { useReaderProgress } from './Reader/useReaderProgress';
import { API_BASE_URL } from '../constants';

const THEMES: Record<ThemeMode, { container: string, text: string, card: string, active: string, header: string, btn: string, backBtn: string, paper: string }> = {
    midnight: {
        container: 'bg-[#0f172a]', // Dark Slate
        text: 'text-gray-200',
        card: 'bg-white/5 border-white/10',
        active: 'bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-500/30',
        header: 'bg-[#0f172a]/80 backdrop-blur-xl border-white/5',
        btn: 'bg-white/5 border-white/10 text-white/70 hover:text-white',
        backBtn: 'bg-white/10 text-white/70 group-hover:bg-white/20',
        paper: 'bg-[#1e293b]'
    },
    sepia: {
        container: 'bg-[#f4ecd8]', // Classic Paper
        text: 'text-[#433429]',
        card: 'bg-[#ebe1c9] border-[#d3c2a3]',
        active: 'bg-[#d3c2a3] text-[#2c1d12] shadow-sm',
        header: 'bg-[#f4ecd8]/90 backdrop-blur-md border-[#d3c2a3]/50',
        btn: 'bg-[#5b4636]/10 border-[#5b4636]/20 text-[#433429] hover:bg-[#5b4636]/20',
        backBtn: 'bg-amber-900/10 text-amber-900 group-hover:bg-amber-900/20',
        paper: 'bg-[#fdf6e3]'
    },
    emerald: {
        container: 'bg-[#064e3b]',
        text: 'text-emerald-50',
        card: 'bg-white/5 border-white/10',
        active: 'bg-emerald-400/20 text-emerald-100 ring-1 ring-emerald-400/30',
        header: 'bg-[#064e3b]/80 backdrop-blur-xl border-white/5',
        btn: 'bg-white/5 border-white/10 text-white/70 hover:text-white',
        backBtn: 'bg-white/10 text-white/70 group-hover:bg-white/20',
        paper: 'bg-[#065f46]'
    },
    oled: {
        container: 'bg-black',
        text: 'text-zinc-400',
        card: 'bg-zinc-900/50 border-zinc-800',
        active: 'bg-white/10 text-white',
        header: 'bg-black/80 backdrop-blur-xl border-zinc-800',
        btn: 'bg-zinc-800 border-zinc-700 text-gray-400 hover:text-white',
        backBtn: 'bg-white/10 text-white/70 group-hover:bg-white/20',
        paper: 'bg-black'
    }
};

interface BookReaderProps {
    bookId: number;
    token: string | null;
    onClose: () => void;
}

export default function BookReader({ bookId, token, onClose }: BookReaderProps) {
    const [book, setBook] = useState<Book | null>(null);
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string, type: string } | null>(null);

    // UI States
    const [showControls, setShowControls] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [showLibrary, setShowLibrary] = useState(false);
    const [libraryTab, setLibraryTab] = useState<'toc' | 'bookmarks' | 'offline'>('toc');
    const [offlineBooks, setOfflineBooks] = useState<any[]>([]);
    const [isRestored, setIsRestored] = useState(false);

    // Theme & Layout
    const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('reader_theme') as ThemeMode) || 'midnight');
    const [fontSize, setFontSize] = useState(18);
    const [fontFamily, setFontFamily] = useState('noto');
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [sleepTimer, setSleepTimer] = useState<number | null>(null);
    const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('reader_voice') || 'vi-VN-Wavenet-B');

    // Content & Bookmarks
    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [editingBookmark, setEditingBookmark] = useState<{ segment: Segment, chapterId: number, note: string } | null>(null);
    const [isOfflineAvailable, setIsOfflineAvailable] = useState(false);
    const [downloadingOffline, setDownloadingOffline] = useState(false);

    // Refs
    const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
    const pendingSegmentRef = useRef<number | null>(null);
    const lastScrollY = useRef(0);

    const authAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { Authorization: `Bearer ${token}` }
    });

    const showToast = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    // Hooks
    const audio = useReaderAudio({
        bookId,
        chapters,
        setChapters,
        currentChapterIndex,
        currentSegmentIndex,
        setCurrentSegmentIndex,
        playbackSpeed,
        selectedVoice,
        nextChapter: () => {
            if (currentChapterIndex < chapters.length - 1) {
                setCurrentChapterIndex(prev => prev + 1);
                setCurrentSegmentIndex(0);
            }
        },
        authAxios,
        getGlobalAudio,
        setGlobalAudio
    });

    useReaderProgress({
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
    });

    // Data Loading
    useEffect(() => {
        const loadBook = async () => {
            try {
                const [bookRes, bookmarksRes, offlineStatus] = await Promise.all([
                    authAxios.get(`/api/books/${bookId}`),
                    authAxios.get(`/api/books/${bookId}/bookmarks`),
                    isBookOffline(bookId)
                ]);
                setBook(bookRes.data);
                setChapters(bookRes.data.chapters);
                setBookmarks(bookmarksRes.data);
                setIsOfflineAvailable(offlineStatus);
                setLoading(false);
            } catch (e: any) {
                setError(e.message);
                setLoading(false);
            }
        };
        loadBook();
    }, [bookId]);

    // Load Offline Books when tab changes
    useEffect(() => {
        if (showLibrary && libraryTab === 'offline') {
            getAllOfflineBooks().then(setOfflineBooks);
        }
    }, [showLibrary, libraryTab]);

    // Auto-Scroll Logic
    useEffect(() => {
        if (segmentRefs.current[currentSegmentIndex]) {
            segmentRefs.current[currentSegmentIndex]?.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }, [currentSegmentIndex, theme]);

    // Sleep Timer Logic
    useEffect(() => {
        if (sleepTimer === null || !audio.isPlaying) return;
        const interval = setInterval(() => {
            setSleepTimer(prev => {
                if (prev === null) return null;
                if (prev <= 1) {
                    audio.setIsPlaying(false);
                    const globalAudio = getGlobalAudio();
                    if (globalAudio) globalAudio.pause();
                    window.speechSynthesis.cancel();
                    showToast('Đã dừng phát do hết giờ hẹn.', 'info');
                    return null;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [sleepTimer, audio.isPlaying, audio.setIsPlaying, showToast]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const currentScrollY = e.currentTarget.scrollTop;
        if (currentScrollY <= 100) {
            setShowControls(true);
        }
        lastScrollY.current = currentScrollY;
    };

    const handleClose = () => {
        audio.setIsPlaying(false);
        const globalAudio = getGlobalAudio();
        if (globalAudio) globalAudio.pause();
        window.speechSynthesis.cancel();
        onClose();
    };

    const toggleBookmark = async (segment: Segment) => {
        const existing = bookmarks.find(b => b.segmentId === segment.id);
        if (existing) {
            setBookmarks(prev => prev.filter(b => b.id !== existing.id));
            await authAxios.delete(`/api/bookmarks/${existing.id}`);
        } else {
            setEditingBookmark({ segment, chapterId: chapters[currentChapterIndex].id, note: '' });
        }
    };

    const saveBookmarkWithNote = async () => {
        if (!editingBookmark) return;
        try {
            const res = await authAxios.post('/api/bookmarks', {
                bookId,
                chapterId: editingBookmark.chapterId,
                segmentId: editingBookmark.segment.id,
                previewText: editingBookmark.segment.content,
                note: editingBookmark.note
            });
            setBookmarks(prev => [res.data, ...prev]);
            setEditingBookmark(null);
            showToast('Đã lưu dấu trang!', 'success');
        } catch (e) {
            showToast('Lỗi khi lưu dấu trang', 'error');
        }
    };

    const downloadOffline = async () => {
        if (!book) return;
        setDownloadingOffline(true);
        try {
            await saveBookOffline(book);
            if (chapters[currentChapterIndex]?.audioFiles) {
                await saveChapterAudio(book.id, chapters[currentChapterIndex].id, chapters[currentChapterIndex].audioFiles);
            }
            setIsOfflineAvailable(true);

            // Refresh the list immediately so the UI updates
            const updatedOffline = await getAllOfflineBooks();
            setOfflineBooks(updatedOffline);

            showToast('Sách đã được tải xuống để nghe offline!', 'success');
        } catch (e) {
            showToast('Lỗi khi tải sách!', 'error');
        } finally {
            setDownloadingOffline(false);
        }
    };

    if (loading) return (
        <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center gap-6 z-[100]">
            <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin shadow-lg shadow-emerald-500/20" />
            <p className="text-emerald-400 font-bold uppercase tracking-widest text-sm animate-pulse">Đang tải nội dung...</p>
        </div>
    );

    if (error) return (
        <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center p-6 text-center z-[100]">
            <div className="text-6xl mb-6">⚠️</div>
            <h2 className="text-2xl font-black text-white mb-2">Không thể tải sách</h2>
            <p className="text-gray-400 mb-8 max-w-md">{error}</p>
            <button onClick={onClose} className="px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-500/20">Quay lại</button>
        </div>
    );

    const currentThemeStyles = THEMES[theme];
    const currentChapter = chapters[currentChapterIndex];

    return (
        <div className={`fixed inset-0 z-50 overflow-hidden flex flex-col font-${fontFamily} ${currentThemeStyles.container} ${currentThemeStyles.text} animate-in fade-in duration-500`}>

            <ReaderHeader
                book={book}
                showControls={showControls}
                theme={theme}
                currentThemeStyles={currentThemeStyles}
                showLibrary={showLibrary}
                setShowLibrary={setShowLibrary}
                setShowSettings={setShowSettings}
                handleClose={handleClose}
                currentSegment={currentChapter?.segments[currentSegmentIndex]}
                isBookmarked={bookmarks.some(b => b.segmentId === currentChapter?.segments[currentSegmentIndex]?.id)}
                toggleBookmark={toggleBookmark}
            />

            <ReadingSurface
                book={book}
                currentChapter={currentChapter}
                currentSegmentIndex={currentSegmentIndex}
                fontSize={fontSize}
                fontFamily={fontFamily}
                theme={theme}
                currentThemeStyles={currentThemeStyles}
                segmentRefs={segmentRefs}
                onSegmentClick={(index) => {
                    if (audio.audioFiles[index]) audio.playAudio(index, audio.audioFiles);
                    else audio.generateAudio(index);
                }}
                onScroll={handleScroll}
            />

            <ReaderControls
                showControls={showControls}
                theme={theme}
                isPlaying={audio.isPlaying}
                generating={audio.generating}
                audioFiles={audio.audioFiles}
                playbackSpeed={playbackSpeed}
                currentChapterIndex={currentChapterIndex}
                chapters={chapters}
                togglePlayPause={audio.togglePlayPause}
                generateAudio={audio.generateAudio}
                prevChapter={() => {
                    if (currentChapterIndex > 0) {
                        setCurrentChapterIndex(prev => prev - 1);
                        setCurrentSegmentIndex(0);
                    }
                }}
                nextChapter={() => {
                    if (currentChapterIndex < chapters.length - 1) {
                        setCurrentChapterIndex(prev => prev + 1);
                        setCurrentSegmentIndex(0);
                    }
                }}
                prevSegment={audio.prevSegment}
                nextSegment={audio.nextSegment}
                toggleSpeed={() => {
                    const speeds = [1, 1.25, 1.5, 2, 0.75];
                    const nextSpeed = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
                    setPlaybackSpeed(nextSpeed);
                    const globalAudio = getGlobalAudio();
                    if (globalAudio) globalAudio.playbackRate = nextSpeed;
                }}
                setShowSettings={setShowSettings}
                showSettings={showSettings}
                currentThemeStyles={currentThemeStyles}
            />

            <SettingsPanel
                showSettings={showSettings}
                setShowSettings={setShowSettings}
                theme={theme}
                setTheme={setTheme}
                fontSize={fontSize}
                setFontSize={setFontSize}
                fontFamily={fontFamily}
                setFontFamily={setFontFamily}
                sleepTimer={sleepTimer}
                setSleepTimer={setSleepTimer}
                selectedVoice={selectedVoice}
                setSelectedVoice={(voice) => {
                    setSelectedVoice(voice);
                    localStorage.setItem('reader_voice', voice);
                }}
            />

            <LibraryPanel
                showLibrary={showLibrary}
                setShowLibrary={setShowLibrary}
                libraryTab={libraryTab}
                setLibraryTab={setLibraryTab}
                theme={theme}
                chapters={chapters}
                currentChapterIndex={currentChapterIndex}
                setCurrentChapterIndex={setCurrentChapterIndex}
                setCurrentSegmentIndex={setCurrentSegmentIndex}
                bookmarks={bookmarks}
                setBookmarks={setBookmarks}
                offlineBooks={offlineBooks}
                setOfflineBooks={setOfflineBooks}
                bookId={bookId}
                playAudio={audio.playAudio}
                generateAudio={audio.generateAudio}
                deleteOfflineBook={deleteOfflineBook}
                setIsOfflineAvailable={setIsOfflineAvailable}
                isOfflineAvailable={isOfflineAvailable}
                downloadingOffline={downloadingOffline}
                downloadOffline={downloadOffline}
                audioFiles={audio.audioFiles}
                pendingSegmentRef={pendingSegmentRef}
                authAxios={authAxios}
                fontFamily={fontFamily}
            />

            <BookmarkModal
                editingBookmark={editingBookmark}
                setEditingBookmark={setEditingBookmark}
                saveBookmarkWithNote={saveBookmarkWithNote}
            />



            {/* Toast System */}
            {toast && (
                <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl z-[100] animate-in slide-in-from-bottom-4 duration-300 font-bold ${toast.type === 'error' ? 'bg-red-500 text-white' : toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'}`}>
                    {toast.message}
                </div>
            )}
        </div>
    );
}

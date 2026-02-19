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

// Types & Hooks
import { ThemeMode, Book, Chapter, Bookmark, Segment } from './Reader/types';
import { useReaderAudio } from './Reader/useReaderAudio';
import { useReaderProgress } from './Reader/useReaderProgress';
import { API_BASE_URL } from '../constants';

const THEMES: Record<ThemeMode, { container: string, text: string, card: string, active: string, header: string, btn: string, backBtn: string }> = {
    midnight: {
        container: 'bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900',
        text: 'text-purple-50',
        card: 'bg-white/10 border-white/20',
        active: 'bg-purple-500/30 ring-purple-500/50 text-purple-200',
        header: 'bg-black/30 border-white/10',
        btn: 'bg-white/5 border-white/10 text-white/70 hover:text-white',
        backBtn: 'bg-white/10 text-white/70 group-hover:bg-white/20'
    },
    sepia: {
        container: 'bg-[#f4ecd8]',
        text: 'text-[#5b4636]',
        card: 'bg-[#ebe1c9] border-[#d3c2a3]',
        active: 'bg-[#d3c2a3] ring-[#bfae8e] text-[#433429]',
        header: 'bg-[#e7dec3] border-[#d3c2a3]',
        btn: 'bg-[#5b4636]/10 border-[#5b4636]/20 text-[#433429] hover:bg-[#5b4636]/20',
        backBtn: 'bg-amber-900/10 text-amber-900 group-hover:bg-amber-900/20'
    },
    emerald: {
        container: 'bg-gradient-to-br from-[#064e3b] via-[#065f46] to-[#047857]',
        text: 'text-emerald-50',
        card: 'bg-white/5 border-white/10',
        active: 'bg-emerald-400/20 ring-emerald-400/50 text-emerald-200',
        header: 'bg-black/20 border-white/10',
        btn: 'bg-white/5 border-white/10 text-white/70 hover:text-white',
        backBtn: 'bg-white/10 text-white/70 group-hover:bg-white/20'
    },
    oled: {
        container: 'bg-black',
        text: 'text-gray-300',
        card: 'bg-zinc-900/50 border-zinc-800',
        active: 'bg-emerald-500/10 ring-emerald-500/30 text-emerald-400',
        header: 'bg-black border-zinc-800',
        btn: 'bg-zinc-800 border-zinc-700 text-gray-400 hover:text-white',
        backBtn: 'bg-white/10 text-white/70 group-hover:bg-white/20'
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
    const [isFocusMode, setIsFocusMode] = useState(false);
    const [isRestored, setIsRestored] = useState(false);

    // Theme & Layout
    const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('reader_theme') as ThemeMode) || 'midnight');
    const [fontSize, setFontSize] = useState(18);
    const [fontFamily, setFontFamily] = useState('noto');
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [sleepTimer, setSleepTimer] = useState<number | null>(null);

    // Content & Bookmarks
    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [editingBookmark, setEditingBookmark] = useState<{ segment: Segment, chapterId: number, note: string } | null>(null);
    const [isOfflineAvailable, setIsOfflineAvailable] = useState(false);
    const [downloadingOffline, setDownloadingOffline] = useState(false);

    // Refs
    const segmentRefs = useRef<(HTMLParagraphElement | null)[]>([]);
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

    // Focus Mode Auto-Hide
    useEffect(() => {
        let timeout: any;
        if (isFocusMode && audio.isPlaying) {
            timeout = setTimeout(() => setShowControls(false), 3000);
        } else {
            setShowControls(true);
        }
        return () => clearTimeout(timeout);
    }, [isFocusMode, audio.isPlaying]);

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
        if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
            // Optional: Hide controls on scroll down
        } else {
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
            />

            <div
                key={currentChapterIndex}
                onScroll={handleScroll}
                className="container mx-auto px-4 py-20 h-screen overflow-y-auto animate-in fade-in slide-in-from-right-4 duration-500 ease-out scroll-smooth no-scrollbar"
                style={{ paddingBottom: '160px' }}
            >
                {currentChapter && (
                    <>
                        <h2 className={`text-3xl font-bold mb-6 transition-colors ${theme === 'sepia' ? 'text-[#5b4636]' : 'text-white'}`}>
                            {currentChapter.title}
                        </h2>

                        {currentChapter.orderIndex === 0 && book?.coverImageUrl && (
                            <div className={`bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 flex flex-col items-center justify-center transition-all duration-700 mb-12 ${isFocusMode && audio.isPlaying ? 'opacity-20 scale-95' : 'opacity-100'}`}>
                                <img src={`${API_BASE_URL}${book.coverImageUrl}`} className="w-48 h-72 object-cover rounded-xl shadow-2xl mb-6" alt="" />
                                <div className="text-center">
                                    <h1 className="text-2xl font-black text-white mb-2">{book.title}</h1>
                                    <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">{book.author || 'Khuyết danh'}</p>
                                </div>
                            </div>
                        )}

                        <div className="space-y-4 md:space-y-6 max-w-3xl mx-auto leading-relaxed">
                            {currentChapter.segments.map((segment, index) => (
                                <div
                                    key={segment.id}
                                    ref={el => segmentRefs.current[index] = el}
                                    onClick={() => {
                                        if (audio.audioFiles[index]) audio.playAudio(index, audio.audioFiles);
                                        else audio.generateAudio(index);
                                    }}
                                    className={`group relative mb-2 p-1 rounded-xl transition-all duration-500 cursor-pointer ${index === currentSegmentIndex
                                        ? currentThemeStyles.active
                                        : (isFocusMode && audio.isPlaying) ? 'opacity-20 grayscale' : (theme === 'sepia' ? 'hover:bg-amber-900/5' : 'hover:bg-white/5')
                                        }`}
                                >
                                    <p className={`relative z-10 font-medium transition-all duration-500 pr-12`} style={{ fontSize: `${fontSize}px` }}>
                                        {segment.content}
                                    </p>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); toggleBookmark(segment); }}
                                        className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all duration-300 ${index === currentSegmentIndex ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${bookmarks.some(b => b.segmentId === segment.id) ? 'text-yellow-500 scale-110' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill={bookmarks.some(b => b.segmentId === segment.id) ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <ReaderControls
                showControls={showControls}
                theme={theme}
                isPlaying={audio.isPlaying}
                generating={audio.generating}
                audioFiles={audio.audioFiles}
                playbackSpeed={playbackSpeed}
                currentChapterIndex={currentChapterIndex}
                chapters={chapters}
                isOfflineAvailable={isOfflineAvailable}
                downloadingOffline={downloadingOffline}
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
                downloadOffline={downloadOffline}
                setShowSettings={setShowSettings}
                showSettings={showSettings}
                isFocusMode={isFocusMode}
                setIsFocusMode={setIsFocusMode}
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
                audioFiles={audio.audioFiles}
                pendingSegmentRef={pendingSegmentRef}
                authAxios={authAxios}
            />

            <BookmarkModal
                editingBookmark={editingBookmark}
                setEditingBookmark={setEditingBookmark}
                saveBookmarkWithNote={saveBookmarkWithNote}
            />

            {/* Focus Hint */}
            {isFocusMode && !showControls && audio.isPlaying && (
                <div onClick={() => setShowControls(true)} className="fixed inset-0 z-[5] cursor-pointer" />
            )}

            {/* Toast System */}
            {toast && (
                <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl z-[100] animate-in slide-in-from-bottom-4 duration-300 font-bold ${toast.type === 'error' ? 'bg-red-500 text-white' : toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'}`}>
                    {toast.message}
                </div>
            )}
        </div>
    );
}

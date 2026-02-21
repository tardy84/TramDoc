import React from 'react';
import { ThemeMode, Chapter, Bookmark } from './types';
import { API_BASE_URL } from '../../constants';

interface LibraryPanelProps {
    showLibrary: boolean;
    setShowLibrary: (show: boolean) => void;
    libraryTab: 'toc' | 'bookmarks' | 'offline';
    setLibraryTab: (tab: 'toc' | 'bookmarks' | 'offline') => void;
    theme: ThemeMode;
    chapters: Chapter[];
    currentChapterIndex: number;
    setCurrentChapterIndex: (index: number) => void;
    setCurrentSegmentIndex: (index: number) => void;
    bookmarks: Bookmark[];
    setBookmarks: React.Dispatch<React.SetStateAction<Bookmark[]>>;
    offlineBooks: any[];
    setOfflineBooks: React.Dispatch<React.SetStateAction<any[]>>;
    bookId: number;
    playAudio: (index: number) => void;
    generateAudio: (index: number) => void;
    deleteOfflineBook: (id: number) => Promise<void>;
    setIsOfflineAvailable: (available: boolean) => void;
    audioFiles: string[];
    pendingSegmentRef: React.MutableRefObject<number | null>;
    authAxios: any;
    fontFamily: string;
}

const LibraryPanel: React.FC<LibraryPanelProps> = ({
    showLibrary,
    setShowLibrary,
    libraryTab,
    setLibraryTab,
    theme,
    chapters,
    currentChapterIndex,
    setCurrentChapterIndex,
    setCurrentSegmentIndex,
    bookmarks,
    setBookmarks,
    offlineBooks,
    setOfflineBooks,
    bookId,
    playAudio,
    generateAudio,
    deleteOfflineBook,
    setIsOfflineAvailable,
    audioFiles,
    pendingSegmentRef,
    authAxios,
    fontFamily
}) => {
    if (!showLibrary) return null;

    return (
        <div className={`fixed top-20 right-4 w-80 md:w-96 rounded-[32px] shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200 border ${theme === 'sepia' ? 'bg-[#ebe1c9] border-[#d3c2a3]' : 'bg-black/95 border-white/20'}`}>
            {/* Tabs */}
            <div className="flex border-b border-white/10">
                <button
                    onClick={() => setLibraryTab('toc')}
                    className={`flex-1 py-4 text-lg transition-all ${libraryTab === 'toc' ? (theme === 'sepia' ? 'bg-[#d3c2a3] text-[#433429]' : 'bg-white/10 text-white') : 'opacity-40 hover:opacity-100'}`}
                    title="Mục lục"
                >
                    📖
                </button>
                <button
                    onClick={() => setLibraryTab('bookmarks')}
                    className={`flex-1 py-4 text-lg transition-all ${libraryTab === 'bookmarks' ? 'bg-yellow-500/20 text-yellow-500' : 'opacity-40 hover:opacity-100'}`}
                    title="Dấu trang"
                >
                    🔖
                </button>
                <button
                    onClick={() => setLibraryTab('offline')}
                    className={`flex-1 py-4 text-lg transition-all ${libraryTab === 'offline' ? 'bg-emerald-500/20 text-emerald-500' : 'opacity-40 hover:opacity-100'}`}
                    title="Offline"
                >
                    📥
                </button>
                <button onClick={() => setShowLibrary(false)} className="px-4 opacity-40 hover:opacity-100 transition-opacity">✕</button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto no-scrollbar">
                {libraryTab === 'toc' ? (
                    <div className="p-2 space-y-1">
                        {chapters.map((chapter, index) => (
                            <button
                                key={chapter.id}
                                onClick={() => {
                                    setCurrentChapterIndex(index);
                                    setCurrentSegmentIndex(0);
                                    setShowLibrary(false);
                                }}
                                className={`w-full text-left px-6 py-1 rounded-xl transition-all flex items-center justify-between group ${index === currentChapterIndex ? (theme === 'sepia' ? 'bg-[#d3c2a3] text-[#433429]' : 'bg-blue-500/20 text-blue-400') : 'hover:bg-white/5 opacity-80 hover:opacity-100'}`}
                            >
                                <span className={`text-sm font-bold truncate ${fontFamily === 'bookerly' ? 'font-serif' : 'font-sans'}`}>
                                    {index === 0
                                        ? 'Bìa sách'
                                        : (/^Chapter \d+$/i.test(chapter.title) ? '' : chapter.title)
                                    }
                                </span>
                                {index === currentChapterIndex && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse shadow-[0_0_8px_currentColor]" />
                                )}
                            </button>
                        ))}
                    </div>
                ) : libraryTab === 'bookmarks' ? (
                    <div className="p-4 space-y-4">
                        {bookmarks.length === 0 ? (
                            <div className="py-20 text-center opacity-40 text-sm">Chưa có dấu trang nào</div>
                        ) : (
                            bookmarks.map((bookmark) => (
                                <div key={bookmark.id} className={`rounded-2xl p-4 border transition-all group ${theme === 'sepia' ? 'bg-amber-900/5 border-amber-900/10' : 'bg-white/5 border-white/5'}`}>
                                    <div
                                        onClick={() => {
                                            const chapterIdx = chapters.findIndex(c => c.id === bookmark.chapterId);
                                            if (chapterIdx !== -1) {
                                                const chapter = chapters[chapterIdx];
                                                const segmentIdx = chapter.segments.findIndex(s => s.id === bookmark.segmentId);
                                                if (segmentIdx !== -1) {
                                                    if (chapterIdx === currentChapterIndex) {
                                                        setCurrentSegmentIndex(segmentIdx);
                                                        if (audioFiles.length > 0) playAudio(segmentIdx);
                                                        else generateAudio(segmentIdx);
                                                    } else {
                                                        pendingSegmentRef.current = segmentIdx;
                                                        setCurrentChapterIndex(chapterIdx);
                                                    }
                                                    setShowLibrary(false);
                                                }
                                            }
                                        }}
                                        className="cursor-pointer"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-[10px] font-black uppercase text-yellow-500/70">{bookmark.chapter?.title}</span>
                                            <span className="text-[9px] opacity-40">{new Date(bookmark.createdAt).toLocaleDateString()}</span>
                                        </div>
                                        <p className={`text-sm italic line-clamp-3 ${theme === 'sepia' ? 'text-[#5b4636]' : 'text-gray-300'}`}>"{bookmark.previewText}"</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setBookmarks(prev => prev.filter(b => b.id !== bookmark.id));
                                            authAxios.delete(`/api/bookmarks/${bookmark.id}`);
                                        }}
                                        className="mt-3 text-[10px] font-bold text-red-400/60 hover:text-red-400 transition-colors uppercase tracking-widest"
                                    >
                                        Xóa dấu trang
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                ) : (
                    <div className="p-4 space-y-4">
                        {offlineBooks.length === 0 ? (
                            <div className="py-20 text-center opacity-40 text-sm">Chưa có sách tải về</div>
                        ) : (
                            offlineBooks.map((offBook) => (
                                <div key={offBook.id} className={`rounded-2xl p-4 border flex items-center gap-3 ${theme === 'sepia' ? 'bg-amber-900/5 border-amber-900/10' : 'bg-white/5 border-white/10'}`}>
                                    <div className="w-10 h-14 bg-slate-800 rounded overflow-hidden flex-shrink-0">
                                        {offBook.coverImageUrl && <img src={`${API_BASE_URL}${offBook.coverImageUrl}`} className="w-full h-full object-cover" alt="" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-sm font-bold truncate text-white">{offBook.title}</h4>
                                        <p className="text-[10px] opacity-40 mb-2">Tải về: {new Date(offBook.downloadedAt).toLocaleDateString()}</p>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => {
                                                    if (offBook.id === bookId) setShowLibrary(false);
                                                    else window.location.href = `/?bookId=${offBook.id}`;
                                                }}
                                                className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider"
                                            >
                                                Đọc ngay
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    await deleteOfflineBook(offBook.id);
                                                    setOfflineBooks(prev => prev.filter(b => b.id !== offBook.id));
                                                    if (offBook.id === bookId) setIsOfflineAvailable(false);
                                                }}
                                                className="text-[10px] font-bold text-red-400/60 hover:text-red-400 uppercase tracking-wider"
                                            >
                                                Gỡ bỏ
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LibraryPanel;

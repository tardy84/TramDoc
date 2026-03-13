import React from 'react';
import { ThemeMode, Chapter, Bookmark } from './types';
import { deleteBookmark as deleteBookmarkApi } from '../../services/apiService';

interface LibraryPanelProps {
    showLibrary: boolean;
    setShowLibrary: (show: boolean) => void;
    libraryTab: 'toc' | 'bookmarks';
    setLibraryTab: (tab: 'toc' | 'bookmarks') => void;
    theme: ThemeMode;
    chapters: Chapter[];
    currentChapterIndex: number;
    setCurrentChapterIndex: (index: number) => void;
    setCurrentSegmentIndex: (index: number) => void;
    bookmarks: Bookmark[];
    setBookmarks: React.Dispatch<React.SetStateAction<Bookmark[]>>;
    playAudio: (index: number) => void;
    generateAudio: (index: number) => void;
    audioFiles: string[];
    pendingSegmentRef: React.MutableRefObject<number | null>;
    fontFamily: string;
    bookId: number;
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
    playAudio,
    generateAudio,
    audioFiles,
    pendingSegmentRef,
    fontFamily
}) => {
    if (!showLibrary) return null;

    return (
        <div className={`fixed top-20 right-4 w-80 md:w-96 rounded-[32px] shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200 border ${theme === 'sepia' ? 'bg-[#ebe1c9] border-[#d3c2a3]' : 'bg-black/95 border-white/20'}`}>
            {/* Tabs */}
            <div className={`flex border-b ${theme === 'sepia' ? 'border-[#d3c2a3]' : 'border-white/10'}`}>
                <button
                    onClick={() => setLibraryTab('toc')}
                    className={`flex-1 py-4 flex items-center justify-center transition-all ${libraryTab === 'toc' ? (theme === 'sepia' ? 'bg-[#d3c2a3] text-[#433429]' : 'bg-white/10 text-white') : 'opacity-40 hover:opacity-100'}`}
                    title="Mục lục"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                </button>
                <button
                    onClick={() => setLibraryTab('bookmarks')}
                    className={`flex-1 py-4 flex items-center justify-center transition-all ${libraryTab === 'bookmarks' ? 'bg-emerald-500/20 text-emerald-500' : 'opacity-40 hover:opacity-100'}`}
                    title="Dấu trang"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
                </button>

                <button onClick={() => setShowLibrary(false)} className="px-4 flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </div>

            <div className="h-[480px] overflow-y-auto no-scrollbar">
                {libraryTab === 'toc' ? (
                    <div className="p-2 space-y-1 pb-10">
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
                    <div className="p-4 space-y-4 pb-10">
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
                                        onClick={async () => {
                                            try {
                                                await deleteBookmarkApi(bookmark.id);
                                                setBookmarks(prev => prev.filter(b => b.id !== bookmark.id));
                                            } catch (err) {
                                                console.error('Failed to delete bookmark:', err);
                                            }
                                        }}
                                        className="mt-3 text-[10px] font-bold text-red-400/60 hover:text-red-400 transition-colors uppercase tracking-widest"
                                    >
                                        Xóa dấu trang
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
) : null}
            </div>
        </div >
    );
};

export default LibraryPanel;

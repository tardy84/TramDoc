import React from 'react';
import { Book, ThemeMode } from './types';

interface ReaderHeaderProps {
    book: Book | null;
    showControls: boolean;
    theme: ThemeMode;
    currentThemeStyles: any;
    showLibrary: boolean;
    setShowLibrary: (show: boolean) => void;
    setShowSettings: (show: boolean) => void;
    handleClose: () => void;
    currentSegment: any;
    isBookmarked: boolean;
    toggleBookmark: (segment: any) => void;
}

const ReaderHeader: React.FC<ReaderHeaderProps> = ({
    book,
    showControls,
    theme,
    currentThemeStyles,
    showLibrary,
    setShowLibrary,
    setShowSettings,
    handleClose,
    currentSegment,
    isBookmarked,
    toggleBookmark
}) => {
    return (
        <>
            {/* Back Button for Focus Mode */}
            <button
                onClick={handleClose}
                className={`fixed top-4 left-4 z-40 p-3 rounded-full shadow-lg backdrop-blur-3xl transition-all duration-300 transform 
                    ${showControls ? '-translate-y-20 opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'} 
                    ${theme === 'sepia' ? 'bg-amber-900/20 text-amber-900 border-amber-900/20' : 'bg-black/40 text-white border-white/10'}`}
                title="Quay lại"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
            </button>

            {/* Header - Auto Hiding */}
            <div className={`fixed top-0 left-0 right-0 backdrop-blur-3xl border-b p-4 z-50 transition-transform duration-500 ${showControls ? 'translate-y-0' : '-translate-y-full'} ${currentThemeStyles.header}`}>
                <div className="container mx-auto flex items-center justify-between">
                    {/* Clean Header - Responsive Title */}
                    <div className="flex items-center gap-4 cursor-pointer group" onClick={handleClose}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${currentThemeStyles.backBtn}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </div>
                        <h1 className={`text-lg md:text-xl font-black uppercase tracking-tight line-clamp-2 md:line-clamp-none flex-1 ${theme === 'sepia' ? 'text-[#433429]' : 'text-white'}`}>
                            {book?.title}
                        </h1>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => toggleBookmark(currentSegment)}
                            className={`flex items-center justify-center w-10 h-10 rounded-full transition-all ${isBookmarked ? 'bg-yellow-500 text-white shadow-lg shadow-yellow-500/20' : currentThemeStyles.btn}`}
                            title={isBookmarked ? 'Xóa dấu trang' : 'Lưu dấu trang'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill={isBookmarked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                            </svg>
                        </button>

                        <button
                            onClick={() => {
                                setShowLibrary(!showLibrary);
                                setShowSettings(false);
                            }}
                            className={`flex items-center justify-center w-10 h-10 rounded-full transition-all ${showLibrary ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : currentThemeStyles.btn}`}
                            title="Mục lục & Dấu trang"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default ReaderHeader;

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
}

const ReaderHeader: React.FC<ReaderHeaderProps> = ({
    book,
    showControls,
    theme,
    currentThemeStyles,
    showLibrary,
    setShowLibrary,
    setShowSettings,
    handleClose
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
                            onClick={() => {
                                setShowLibrary(!showLibrary);
                                setShowSettings(false);
                            }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm transition-all ${showLibrary ? 'bg-blue-500 text-white' : currentThemeStyles.btn}`}
                            title="Thư viện & Dấu trang"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.168.477-4.5 1.253" />
                            </svg>
                            <span className="hidden md:inline">Thư viện</span>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default ReaderHeader;

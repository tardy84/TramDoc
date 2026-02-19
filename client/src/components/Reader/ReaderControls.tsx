import React from 'react';
import { ThemeMode, Chapter } from './types';

interface ReaderControlsProps {
    showControls: boolean;
    theme: ThemeMode;
    isPlaying: boolean;
    generating: boolean;
    audioFiles: string[];
    playbackSpeed: number;
    currentChapterIndex: number;
    chapters: Chapter[];
    isOfflineAvailable: boolean;
    downloadingOffline: boolean;
    togglePlayPause: () => void;
    generateAudio: () => void;
    prevChapter: () => void;
    nextChapter: () => void;
    prevSegment: () => void;
    nextSegment: () => void;
    toggleSpeed: () => void;
    downloadOffline: () => void;
    setShowSettings: (show: boolean) => void;
    showSettings: boolean;
    isFocusMode: boolean;
    setIsFocusMode: (mode: boolean) => void;
    currentThemeStyles: any;
}

const ReaderControls: React.FC<ReaderControlsProps> = ({
    showControls,
    theme,
    isPlaying,
    generating,
    audioFiles,
    playbackSpeed,
    currentChapterIndex,
    chapters,
    isOfflineAvailable,
    downloadingOffline,
    togglePlayPause,
    generateAudio,
    prevChapter,
    nextChapter,
    prevSegment,
    nextSegment,
    toggleSpeed,
    downloadOffline,
    setShowSettings,
    showSettings,
    isFocusMode,
    setIsFocusMode,
    currentThemeStyles
}) => {
    return (
        <div className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-500 ease-in-out transform ${showControls ? 'translate-y-0' : 'translate-y-full'}`}>
            <div className="container mx-auto max-w-2xl px-4 pb-8">
                <div className={`backdrop-blur-3xl border p-6 rounded-[40px] shadow-2xl ${currentThemeStyles.header}`}>
                    <div className="flex items-center justify-between gap-2">
                        {/* Group: Left (Speed & Focus) */}
                        <div className="flex items-center gap-1 md:gap-3">
                            <button
                                onClick={toggleSpeed}
                                className={`h-10 w-10 flex items-center justify-center rounded-full font-mono text-xs border transition-all ${theme === 'sepia' ? 'bg-amber-900/5 border-amber-900/10' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                            >
                                {playbackSpeed}x
                            </button>
                            <button
                                onClick={() => setIsFocusMode(!isFocusMode)}
                                className={`h-10 w-10 flex items-center justify-center rounded-full transition-all border ${isFocusMode ? 'bg-emerald-500 text-white' : (theme === 'sepia' ? 'bg-amber-900/5 border-amber-900/10' : 'bg-white/5 border-white/10 hover:bg-white/10')}`}
                                title="Chế độ tập trung"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3v-8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                </svg>
                            </button>
                        </div>

                        {/* Center: Playback & Chapter Nav */}
                        <div className="flex items-center gap-1 md:gap-3">
                            {/* Prev Chapter */}
                            <button
                                onClick={prevChapter}
                                disabled={currentChapterIndex === 0}
                                className={`p-2 rounded-full transition-all active:scale-95 disabled:opacity-20 ${theme === 'sepia' ? 'hover:bg-amber-900/10' : 'hover:bg-white/10'}`}
                                title="Chương trước"
                            >
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                                </svg>
                            </button>

                            {/* Prev Sentence */}
                            <button
                                onClick={prevSegment}
                                className={`p-2 rounded-full transition-all active:scale-95 ${theme === 'sepia' ? 'hover:bg-amber-900/10' : 'hover:bg-white/10'}`}
                                title="Câu trước"
                            >
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>

                            {/* Play/Pause */}
                            {audioFiles.length === 0 ? (
                                <button
                                    onClick={() => generateAudio()}
                                    disabled={generating}
                                    className={`h-14 w-14 rounded-full flex items-center justify-center shadow-lg transition-all transform active:scale-95 ${theme === 'sepia' ? 'bg-amber-700 text-amber-50 shadow-amber-900/30' : 'bg-white text-black shadow-white/20'}`}
                                >
                                    {generating ? (
                                        <div className="h-5 w-5 border-2 border-inherit border-t-transparent rounded-full animate-spin opacity-50" />
                                    ) : (
                                        <svg className="w-7 h-7 ml-1 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                    )}
                                </button>
                            ) : (
                                <button
                                    onClick={togglePlayPause}
                                    className={`h-14 w-14 rounded-full flex items-center justify-center shadow-lg transition-all transform active:scale-95 ${theme === 'sepia' ? 'bg-amber-700 text-amber-50 shadow-amber-900/30' : 'bg-white text-black shadow-white/20'}`}
                                >
                                    {isPlaying ? (
                                        <svg className="w-7 h-7 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                                    ) : (
                                        <svg className="w-7 h-7 ml-1 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                    )}
                                </button>
                            )}

                            {/* Next Sentence */}
                            <button
                                onClick={nextSegment}
                                className={`p-2 rounded-full transition-all active:scale-95 ${theme === 'sepia' ? 'hover:bg-amber-900/10' : 'hover:bg-white/10'}`}
                                title="Câu kế tiếp"
                            >
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </button>

                            {/* Next Chapter */}
                            <button
                                onClick={nextChapter}
                                disabled={currentChapterIndex === chapters.length - 1}
                                className={`p-2 rounded-full transition-all active:scale-95 disabled:opacity-20 ${theme === 'sepia' ? 'hover:bg-amber-900/10' : 'hover:bg-white/10'}`}
                                title="Chương kế tiếp"
                            >
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>

                        {/* Group: Right (Download & Settings) */}
                        <div className="flex items-center gap-1 md:gap-3">
                            <button
                                onClick={downloadOffline}
                                disabled={isOfflineAvailable || downloadingOffline}
                                className={`h-10 w-10 flex items-center justify-center rounded-full transition-all border ${isOfflineAvailable ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/50' : theme === 'sepia' ? 'bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                                title={isOfflineAvailable ? "Đã tải về" : "Tải về nghe offline"}
                            >
                                {downloadingOffline ? (
                                    <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                )}
                            </button>
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className={`h-10 w-10 flex items-center justify-center rounded-full transition-all border ${showSettings ? 'bg-emerald-500 text-white' : (theme === 'sepia' ? 'bg-amber-900/5 border-amber-900/10' : 'bg-white/5 border-white/10 hover:bg-white/10')}`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReaderControls;

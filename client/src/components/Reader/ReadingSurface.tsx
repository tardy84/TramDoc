import React from 'react';
import { Chapter, Segment, ThemeMode } from './types';
import { API_BASE_URL } from '../../constants';

interface ReadingSurfaceProps {
    book: any;
    currentChapter: Chapter | null;
    currentSegmentIndex: number;
    fontSize: number;
    fontFamily: string;
    theme: ThemeMode;
    currentThemeStyles: any;
    segmentRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
    onSegmentClick: (index: number) => void;
    onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

const ReadingSurface: React.FC<ReadingSurfaceProps> = ({
    book,
    currentChapter,
    currentSegmentIndex,
    fontSize,
    fontFamily,
    theme,
    currentThemeStyles,
    segmentRefs,
    onSegmentClick,
    onScroll
}) => {
    if (!currentChapter) return null;

    return (
        <div
            onScroll={onScroll}
            className="container mx-auto px-4 py-20 h-screen overflow-y-auto animate-in fade-in slide-in-from-right-4 duration-500 ease-out scroll-smooth no-scrollbar"
            style={{ paddingBottom: '160px' }}
        >
            <div className="max-w-3xl mx-auto">
                {/* Book Header Card (Only for Chapter 0) */}
                {currentChapter.orderIndex === 0 && book?.coverImageUrl && (
                    <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 border border-white/20 flex flex-col items-center justify-center mb-12 animate-in fade-in zoom-in duration-700">
                        <img
                            src={`${API_BASE_URL}${book.coverImageUrl}`}
                            className="w-48 h-72 object-cover rounded-2xl shadow-2xl mb-6 transform hover:scale-105 transition-transform duration-500"
                            alt={book.title}
                        />
                        <div className="text-center">
                            <h1 className="text-3xl font-black text-white mb-2">{book.title}</h1>
                            <p className="text-emerald-400 font-bold uppercase tracking-[0.2em] text-[10px]">{book.author || 'Khuyết danh'}</p>
                        </div>
                    </div>
                )}

                {/* Main Content Pane */}
                <div className={`rounded-[40px] p-6 md:p-16 shadow-2xl transition-all duration-700 ${currentThemeStyles.paper} paper-texture shadow-black/20 overflow-hidden`}>
                    <div className="space-y-1 text-justify leading-relaxed md:leading-[2]">
                        {currentChapter.segments.map((segment: Segment, index: number) => (
                            <div
                                key={segment.id}
                                ref={el => segmentRefs.current[index] = el}
                                onClick={() => onSegmentClick(index)}
                                className={`group relative inline-block w-full rounded-xl transition-all duration-500 cursor-pointer ${segment.role === 'heading' ? 'text-center mb-12 mt-16 block' : 'py-1.5 px-3'} ${index === currentSegmentIndex
                                    ? currentThemeStyles.active + ' scale-[1.02] z-10'
                                    : (theme === 'sepia' ? 'hover:bg-[#d3c2a3]/40' : 'hover:bg-white/5')
                                    }`}
                            >
                                <p
                                    className={`relative z-10 transition-all duration-500 ${fontFamily === 'bookerly' ? 'font-serif tracking-tight' : 'font-sans tracking-normal'} ${segment.role === 'heading' ? 'text-4xl md:text-6xl font-black uppercase tracking-widest leading-tight' : ''}`}
                                    style={{ fontSize: segment.role === 'heading' ? undefined : `${fontSize}px` }}
                                >
                                    {segment.content}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReadingSurface;

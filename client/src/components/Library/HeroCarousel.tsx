
import { Book } from '../../types';

interface HeroCarouselProps {
    heroBooks: Book[];
    activeHeroIndex: number;
    setActiveHeroIndex: (index: number) => void;
    setSelectedBookId: (id: number) => void;
}

export default function HeroCarousel({ heroBooks, activeHeroIndex, setActiveHeroIndex, setSelectedBookId }: HeroCarouselProps) {
    if (heroBooks.length === 0) return null;

    return (
        <div className="mb-4">
            <div className="flex items-center justify-between mb-4 px-1">
                <h3 className="text-xs font-black text-emerald-500 uppercase tracking-[0.3em]">
                    {heroBooks.some(b => (b.progress || 0) > 0) ? 'Tiếp tục nghe' : 'Sách mới nhất'}
                </h3>
                {heroBooks.length > 1 && (
                    <div className="flex gap-1.5 bg-slate-800/50 px-2 py-1 rounded-full border border-white/5 backdrop-blur-sm">
                        {heroBooks.map((_, idx) => (
                            <div
                                key={idx}
                                className={`h-1.5 transition-all duration-300 rounded-full ${idx === activeHeroIndex ? 'w-4 bg-emerald-500' : 'w-1.5 bg-slate-600'}`}
                            />
                        ))}
                    </div>
                )}
            </div>

            <div
                onScroll={(e) => {
                    const container = e.currentTarget;
                    const itemWidth = container.firstElementChild?.clientWidth || 0;
                    const gap = 16;
                    const index = Math.round(container.scrollLeft / (itemWidth + gap));
                    if (index !== activeHeroIndex && index < heroBooks.length) setActiveHeroIndex(index);
                }}
                className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory -mx-4 px-4"
            >
                {heroBooks.map((heroBook) => (
                    <div
                        key={heroBook.id}
                        onClick={() => setSelectedBookId(heroBook.id)}
                        className="relative flex-shrink-0 w-[92vw] md:w-[750px] group cursor-pointer overflow-hidden rounded-[32px] border border-white/10 shadow-2xl active:scale-[0.98] transition-all duration-300 snap-center"
                    >
                        <div className="absolute inset-0 z-0">
                            <img
                                src={heroBook.coverImageUrl || '/default-cover.png'}
                                alt=""
                                className="w-full h-full object-cover blur-[80px] opacity-40 scale-150"
                            />
                            <div className="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-slate-900/60 to-slate-900" />
                        </div>

                        <div className="relative z-10 flex flex-col p-5 md:p-8">
                            <div className="flex flex-row items-start gap-6 w-full text-left">
                                <div className="w-44 md:w-64 aspect-[2/3] flex-shrink-0 relative">
                                    <img
                                        src={heroBook.coverImageUrl || '/default-cover.png'}
                                        className="h-full w-full object-cover rounded-xl shadow-2xl border border-white/10"
                                        alt={heroBook.title}
                                    />
                                    {!heroBook.coverImageUrl && (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center pointer-events-none rounded-xl overflow-hidden">
                                            <div className="absolute inset-0 bg-black/40" />
                                            <h3 className="text-white font-playfair font-black text-2xl leading-tight line-clamp-3 mb-2 drop-shadow-md z-10 uppercase tracking-wide">{heroBook.title}</h3>
                                            <p className="text-white/80 font-serif text-sm line-clamp-2 drop-shadow-md z-10">{heroBook.author || 'Khuyết danh'}</p>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch py-1">
                                    <div>
                                        <h2 className="text-2xl md:text-5xl font-black text-white mb-2 font-playfair tracking-tight leading-tight line-clamp-2">
                                            {heroBook.title}
                                        </h2>
                                        <p className="text-emerald-400/60 text-sm md:text-xl font-medium truncate italic mb-4">
                                            {heroBook.author || 'Tác giả ẩn danh'}
                                        </p>

                                        {heroBook.currentText && (
                                            <p className="text-slate-200 text-sm md:text-lg italic line-clamp-3 md:line-clamp-4 font-serif leading-relaxed border-l-4 border-emerald-500/30 pl-4 mb-6">
                                                "{heroBook.currentText}..."
                                            </p>
                                        )}
                                    </div>

                                    <div className="w-full">
                                        <div className="mb-2 px-1 text-right">
                                            <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px] md:text-xs">BẠN ĐÃ HOÀN THÀNH </span>
                                            <span className="text-emerald-400 font-black text-xs md:text-sm">{heroBook.progress || 0}%</span>
                                        </div>
                                        <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5 p-0.5">
                                            <div
                                                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-700"
                                                style={{ width: `${heroBook.progress || 0}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

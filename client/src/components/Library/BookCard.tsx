
import { Book } from '../../types';

interface BookCardProps {
    book: Book;
    onSelect: (id: number) => void;
    onDelete: (confirm: { bookId: number, title: string }) => void;
}

export default function BookCard({ book, onSelect, onDelete }: BookCardProps) {
    const isNew = !book.lastRead;
    const isCompleted = (book.progress || 0) === 100;
    const inProgress = (book.progress || 0) > 0 && (book.progress || 0) < 100;

    return (
        <div
            className="group relative flex flex-col bg-slate-900/40 rounded-2xl overflow-hidden border border-white/5 transition-all duration-500 cursor-pointer h-full hover:shadow-2xl hover:shadow-emerald-500/10 hover:border-white/10"
            onClick={() => onSelect(book.id)}
        >
            <div className="aspect-[2/3] w-full bg-slate-950 relative overflow-hidden">
                <img
                    src={book.coverImageUrl || '/default-cover.png'}
                    alt={book.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 group-hover:blur-[2px] group-hover:brightness-50"
                />
                {!book.coverImageUrl && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center z-10 pointer-events-none">
                        <div className="absolute inset-0 bg-black/40" />
                        <h3 className="text-white font-playfair font-black text-xl leading-tight line-clamp-3 mb-2 drop-shadow-md z-10 uppercase tracking-wide">{book.title}</h3>
                        <p className="text-white/80 font-serif text-sm line-clamp-2 drop-shadow-md z-10">{book.author || 'Khuyết danh'}</p>
                    </div>
                )}

                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-90" />

                <div className="absolute top-2 left-2 flex flex-col gap-1.5 z-20">
                    {isNew && (
                        <span className="bg-amber-500/90 backdrop-blur-md text-[9px] font-black uppercase tracking-widest text-white px-2 py-1 rounded shadow-lg border border-white/10">
                            MỚI
                        </span>
                    )}
                    {isCompleted && (
                        <span className="bg-emerald-500/90 backdrop-blur-md text-[9px] font-black uppercase tracking-widest text-white px-2 py-1 rounded shadow-lg border border-white/10 flex items-center gap-1">
                            <span>✓</span> ĐÃ XONG
                        </span>
                    )}
                    {inProgress && (
                        <span className="bg-indigo-500/90 backdrop-blur-md text-[9px] font-black uppercase tracking-widest text-white px-2 py-1 rounded shadow-lg border border-white/10">
                            {book.progress}%
                        </span>
                    )}
                </div>

                <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 z-10 px-4 text-center">
                    <div className="bg-emerald-500 text-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/40 mb-3 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                        <svg className="w-5 h-5 fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                    {book.currentText && (
                        <p className="text-white/90 text-xs italic font-serif line-clamp-3 leading-relaxed drop-shadow-md transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-75">
                            "{book.currentText}"
                        </p>
                    )}
                </div>

                <button
                    onClick={(e) => { e.stopPropagation(); onDelete({ bookId: book.id, title: book.title }); }}
                    className="absolute top-2 right-2 p-2 bg-black/40 hover:bg-red-500/80 text-white/60 hover:text-white rounded-full transition-all backdrop-blur-md z-30 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 duration-200"
                    title="Xóa sách"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>

                {inProgress && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                        <div className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" style={{ width: `${book.progress}%` }} />
                    </div>
                )}
            </div>

            <div className="p-3 flex-1 flex flex-col justify-start bg-gradient-to-b from-transparent to-slate-900/30">
                <h3 className="text-white font-playfair font-bold leading-tight mb-1 truncate group-hover:text-emerald-400 transition-colors uppercase tracking-tight">
                    {book.title}
                </h3>
                <p className="text-slate-500 text-xs truncate font-medium">
                    {book.author || 'Tác giả ẩn danh'}
                </p>
            </div>
        </div>
    );
}

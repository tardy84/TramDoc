import React from 'react';
import { Segment } from './types';

interface BookmarkModalProps {
    editingBookmark: { segment: Segment, chapterId: number, note: string } | null;
    setEditingBookmark: (val: { segment: Segment, chapterId: number, note: string } | null) => void;
    saveBookmarkWithNote: () => void;
}

const BookmarkModal: React.FC<BookmarkModalProps> = ({
    editingBookmark,
    setEditingBookmark,
    saveBookmarkWithNote
}) => {
    if (!editingBookmark) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-slate-900 border border-white/20 rounded-[32px] p-6 w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-300">
                <div className="flex items-center gap-3 mb-6">
                    <span className="text-3xl">🔖</span>
                    <h3 className="text-2xl font-black text-white">Lưu đoạn hay</h3>
                </div>

                <div className="mb-6 p-4 bg-white/5 rounded-2xl border border-white/10 italic text-gray-400 text-sm line-clamp-4 text-white/70">
                    "{editingBookmark?.segment?.content}"
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-2">Ghi chú của bạn</label>
                        <textarea
                            autoFocus
                            placeholder="Viết cảm nghĩ hoặc ghi chú nhanh về đoạn này..."
                            value={editingBookmark?.note || ''}
                            onChange={(e) => setEditingBookmark({ ...editingBookmark, note: e.target.value })}
                            className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white focus:outline-none focus:border-emerald-500 transition-all h-32 resize-none"
                        />
                    </div>

                    <div className="flex gap-4">
                        <button
                            onClick={() => setEditingBookmark(null)}
                            className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl transition-all"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            onClick={saveBookmarkWithNote}
                            className="flex-1 py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
                        >
                            Lưu ngay
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BookmarkModal;

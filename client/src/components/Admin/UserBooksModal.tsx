import React from 'react';
import ConfirmModal from '../Shared/ConfirmModal';

interface UserBooksModalProps {
    isOpen: boolean;
    userName: string;
    books: any[];
    onClose: () => void;
    onDeleteBook: (id: number) => Promise<void>;
    onBulkDelete: (ids: number[]) => Promise<void>;
}

const UserBooksModal: React.FC<UserBooksModalProps> = ({ isOpen, userName, books, onClose, onDeleteBook, onBulkDelete }) => {
    const [confirmBookDelete, setConfirmBookDelete] = React.useState<number | null>(null);
    const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
    const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);
    const [localBooks, setLocalBooks] = React.useState(books);

    // Sync local books when prop changes or modal opens
    React.useEffect(() => {
        if (isOpen) {
            setLocalBooks(books);
            setSelectedIds(new Set());
        }
    }, [books, isOpen]);

    const toggleSelect = (id: number) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === localBooks.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(localBooks.map(b => b.id)));
        }
    };

    const handleDeleteOne = async (id: number) => {
        try {
            await onDeleteBook(id);
            setLocalBooks(prev => prev.filter(b => b.id !== id));
            setSelectedIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        } finally {
            setConfirmBookDelete(null);
        }
    };

    const handleBulkDelete = async () => {
        const ids = Array.from(selectedIds);
        try {
            await onBulkDelete(ids);
            setLocalBooks(prev => prev.filter(b => !selectedIds.has(b.id)));
            setSelectedIds(new Set());
        } finally {
            setConfirmBulkDelete(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="p-8">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-xl font-black text-white">Sách của {userName}</h3>
                            <div className="flex items-center gap-4 mt-2">
                                <button
                                    onClick={toggleSelectAll}
                                    className="text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-white transition-colors"
                                >
                                    {selectedIds.size === localBooks.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}
                                </button>
                                {selectedIds.size > 0 && (
                                    <button
                                        onClick={() => setConfirmBulkDelete(true)}
                                        className="text-[10px] font-black uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors animate-in slide-in-from-left-2"
                                    >
                                        Xóa {selectedIds.size} mục đã chọn
                                    </button>
                                )}
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 text-white/40 hover:text-white transition-colors">✕</button>
                    </div>

                    <div className="max-h-[60vh] overflow-y-auto custom-scrollbar space-y-3">
                        {localBooks.length > 0 ? (
                            localBooks.map((b) => (
                                <div
                                    key={b.id}
                                    className={`p-5 bg-white/5 border rounded-2xl text-sm text-white/80 flex items-center justify-between group/item transition-all cursor-pointer ${selectedIds.has(b.id) ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/5 hover:border-white/10'}`}
                                    onClick={() => toggleSelect(b.id)}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${selectedIds.has(b.id) ? 'bg-blue-500 border-blue-500' : 'border-white/10'}`}>
                                            {selectedIds.has(b.id) && <span className="text-[10px] text-white">✓</span>}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-lg opacity-40">📖</span>
                                            <span className="font-bold underline decoration-white/10 underline-offset-4">{b.title}</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setConfirmBookDelete(b.id);
                                        }}
                                        className="p-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-xl transition-all border border-red-500/20 active:scale-90 opacity-40 group-hover/item:opacity-100"
                                        title="Xóa sách này"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            ))
                        ) : (
                            <div className="py-12 text-center text-white/20 font-medium">Chưa có sách nào</div>
                        )}
                    </div>
                </div>
            </div>

            <ConfirmModal
                isOpen={confirmBookDelete !== null}
                onClose={() => setConfirmBookDelete(null)}
                onConfirm={() => {
                    if (confirmBookDelete) handleDeleteOne(confirmBookDelete);
                }}
                title="Xóa sách từ người dùng?"
                message="Bạn có chắc chắn muốn xóa cuốn sách này khỏi hệ thống?"
                variant="danger"
                confirmLabel="Xóa ngay"
            />

            <ConfirmModal
                isOpen={confirmBulkDelete}
                onClose={() => setConfirmBulkDelete(false)}
                onConfirm={handleBulkDelete}
                title={`Xóa ${selectedIds.size} cuốn sách?`}
                message={`Hành động này sẽ xóa vĩnh viễn ${selectedIds.size} cuốn sách đã chọn của người dùng này.`}
                variant="danger"
                confirmLabel="Xóa tất cả"
            />
        </div>
    );
};

export default UserBooksModal;

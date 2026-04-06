import React from 'react';
import { API_BASE_URL } from '../../constants';
import ConfirmModal from '../Shared/ConfirmModal';

interface AdminBookListProps {
    books: any[];
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    onDeleteBook: (id: number) => Promise<void>;
    onBulkDelete: (ids: number[]) => Promise<void>;
    refreshData: () => void;
}

const AdminBookList: React.FC<AdminBookListProps> = ({ books, searchQuery, setSearchQuery, onDeleteBook, onBulkDelete }) => {
    const [confirmDelete, setConfirmDelete] = React.useState<number | null>(null);
    const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
    const [isBulkDeleting, setIsBulkDeleting] = React.useState(false);
    const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);

    const filteredBooks = books.filter(b =>
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (b.author || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const toggleSelect = (id: number) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredBooks.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredBooks.map(b => b.id)));
        }
    };

    const handleBulkDelete = async () => {
        setIsBulkDeleting(true);
        try {
            await onBulkDelete(Array.from(selectedIds));
            setSelectedIds(new Set());
        } catch (error) {
            console.error('Bulk delete failed:', error);
        } finally {
            setIsBulkDeleting(false);
            setConfirmBulkDelete(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-white">Thư viện toàn hệ thống</h2>
                    <p className="text-white/40 text-sm mt-1">{books.length} cuốn sách đã tải lên</p>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                    {selectedIds.size > 0 && (
                        <button
                            onClick={() => setConfirmBulkDelete(true)}
                            className="flex-shrink-0 px-6 py-3 bg-red-500 text-white rounded-2xl font-bold shadow-lg shadow-red-500/20 animate-in zoom-in-95 duration-200"
                        >
                            Xóa {selectedIds.size} mục
                        </button>
                    )}
                    <div className="relative flex-1 md:w-80">
                        <input
                            type="text"
                            placeholder="Tìm tên sách, tác giả..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                        />
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20">🔍</span>
                    </div>
                </div>
            </div>

            {filteredBooks.length > 0 && (
                <div className="flex items-center gap-2 px-2">
                    <button
                        onClick={toggleSelectAll}
                        className="text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-white transition-colors flex items-center gap-2"
                    >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selectedIds.size === filteredBooks.length ? 'bg-emerald-500 border-emerald-500' : 'border-white/20'}`}>
                            {selectedIds.size === filteredBooks.length && <span className="text-[10px] text-white">✓</span>}
                        </div>
                        {selectedIds.size === filteredBooks.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 md:gap-4">
                {filteredBooks.map((b: any) => (
                    <div
                        key={b.id}
                        className={`flex flex-col group animate-in fade-in zoom-in-95 duration-300 relative ${selectedIds.has(b.id) ? 'scale-[0.98]' : ''}`}
                        onClick={() => toggleSelect(b.id)}
                    >
                        <div className={`relative aspect-[2/3] bg-white/5 rounded-2xl md:rounded-3xl border overflow-hidden shadow-lg transition-all duration-300 group-hover:-translate-y-1 ${selectedIds.has(b.id) ? 'border-emerald-500 ring-2 ring-emerald-500/50' : 'border-white/5 group-hover:bg-white/10 group-hover:border-white/10'}`}>
                            <img
                                src={b.coverImageUrl ? `${API_BASE_URL}${b.coverImageUrl}` : '/default-cover.png'}
                                className={`w-full h-full object-cover transition-all ${selectedIds.has(b.id) ? 'opacity-40 grayscale' : 'opacity-80 group-hover:opacity-100'}`}
                                alt={b.title}
                            />
                            {!b.coverImageUrl && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center z-10 pointer-events-none">
                                    <div className="absolute inset-0 bg-black/40" />
                                    <h3 className="text-white font-black text-2xl leading-tight line-clamp-3 mb-2 drop-shadow-md z-10 uppercase tracking-wide">{b.title}</h3>
                                    <p className="text-white/80 text-sm line-clamp-2 drop-shadow-md z-10">{b.author || 'Khuyết danh'}</p>
                                </div>
                            )}

                            {/* Checkbox Overlay */}
                            <div className="absolute top-2 left-2 z-40">
                                <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${selectedIds.has(b.id) ? 'bg-emerald-500 border-emerald-500 scale-110 shadow-lg' : 'bg-black/20 border-white/20 opacity-0 group-hover:opacity-100'}`}>
                                    {selectedIds.has(b.id) && <span className="text-white font-bold text-sm">✓</span>}
                                </div>
                            </div>

                            {/* Large Prominent Action Button (Only if NOT selecting multiple) */}
                            {selectedIds.size === 0 && (
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(b.id); }}
                                        className="p-5 bg-red-500 text-white rounded-2xl shadow-2xl transform scale-75 group-hover:scale-100 transition-all duration-300 active:scale-90 pointer-events-auto border border-white/20"
                                        title="Xóa cuốn sách"
                                    >
                                        <span className="text-2xl">🗑️</span>
                                    </button>
                                </div>
                            )}

                            {/* Stats overlay */}
                            <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                <div className="text-[8px] font-black text-white/60 uppercase tracking-widest">{b._count?.chapters || 0} CHƯƠNG</div>
                            </div>
                        </div>

                        <div className="mt-2 px-1">
                            <h3 className={`text-[10px] md:text-sm font-bold truncate transition-colors leading-tight ${selectedIds.has(b.id) ? 'text-emerald-400' : 'text-white group-hover:text-emerald-400'}`} title={b.title}>
                                {b.title}
                            </h3>
                            <div className="flex items-center gap-1 mt-1 opacity-40">
                                <div className="w-3 h-3 rounded-full bg-white/20 flex items-center justify-center text-[6px]">👤</div>
                                <span className="text-[8px] md:text-[10px] text-white truncate font-medium">
                                    {b.user?.name || b.user?.email || 'N/A'}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <ConfirmModal
                isOpen={confirmDelete !== null}
                onClose={() => setConfirmDelete(null)}
                onConfirm={() => {
                    if (confirmDelete) onDeleteBook(confirmDelete);
                    setConfirmDelete(null);
                }}
                title="Xóa cuốn sách?"
                message="Bạn có chắc chắn muốn xóa cuốn sách này cùng toàn bộ dữ liệu liên quan?"
                variant="danger"
                confirmLabel="Xóa ngay"
            />

            <ConfirmModal
                isOpen={confirmBulkDelete}
                onClose={() => setConfirmBulkDelete(false)}
                onConfirm={handleBulkDelete}
                title={`Xóa ${selectedIds.size} cuốn sách?`}
                message={`Hành động này sẽ xóa vĩnh viễn ${selectedIds.size} cuốn sách đã chọn.`}
                variant="danger"
                confirmLabel={isBulkDeleting ? "Đang xóa..." : "Xóa tất cả"}
            />
        </div>
    );
};

export default AdminBookList;

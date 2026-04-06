import React from 'react';
import ConfirmModal from '../Shared/ConfirmModal';
import UserBooksModal from './UserBooksModal';

interface AdminUserListProps {
    users: any[];
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    onDeleteUser: (id: number) => Promise<void>;
    onDeleteBook: (id: number) => Promise<void>;
    onBulkDelete: (ids: number[]) => Promise<void>;
    authAxios: any;
    refreshData: () => void;
}

const AdminUserList: React.FC<AdminUserListProps> = ({ users, searchQuery, setSearchQuery, onDeleteUser, onDeleteBook, onBulkDelete, authAxios, refreshData }) => {
    const [selectedUserBooks, setSelectedUserBooks] = React.useState<{ name: string, books: any[] } | null>(null);
    const [confirmDelete, setConfirmDelete] = React.useState<number | null>(null);
    const [resetPasswordFor, setResetPasswordFor] = React.useState<number | null>(null);

    const filteredUsers = users.filter(u =>
        (u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase())
    ); const handleConfirmReset = async (newPassword?: string) => {
        if (!newPassword || newPassword.length < 6) {
            alert('Mật khẩu phải có ít nhất 6 ký tự');
            return;
        }

        try {
            await authAxios.patch(`/api/admin/users/${resetPasswordFor}/password`, { newPassword });
            alert('Reset mật khẩu thành công');
            refreshData();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Lỗi khi reset mật khẩu');
        } finally {
            setResetPasswordFor(null);
        }
    };


    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-white">Quản lý người dùng</h2>
                    <p className="text-white/40 text-sm mt-1">{users.length} tài khoản đã đăng ký</p>
                </div>
                <div className="relative w-full md:w-96">
                    <input
                        type="text"
                        placeholder="Tìm theo tên, email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20">🔍</span>
                </div>
            </div>

            <div className="bg-white/5 rounded-[32px] border border-white/5 overflow-hidden overflow-x-auto custom-scrollbar shadow-xl">
                <table className="w-full text-left min-w-[800px]">
                    <thead className="bg-white/5 text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">
                        <tr>
                            <th className="px-8 py-5">Người dùng</th>
                            <th className="px-8 py-5">Quyền hạn</th>
                            <th className="px-8 py-5">Số sách</th>
                            <th className="px-8 py-5">Ngày tham gia</th>
                            <th className="px-8 py-5 text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {filteredUsers.map((u: any) => (
                            <tr key={u.id} className="hover:bg-white/[0.02] transition-all group">
                                <td className="px-8 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-bold text-xs text-blue-400 border border-white/5">
                                            {u.avatarUrl ? <img src={u.avatarUrl} className="w-full h-full rounded-full" /> : (u.name || (u.email && u.email[0])).toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-white leading-tight">{u.name || 'N/A'}</div>
                                            <div className="text-xs text-white/30">{u.email}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-8 py-4">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${u.role === 'ADMIN' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'}`}>
                                        {u.role}
                                    </span>
                                </td>
                                <td className="px-8 py-4 text-sm font-medium text-white/60">
                                    <button
                                        onClick={() => {
                                            setSelectedUserBooks({ name: u.name || u.email, books: u.books || [] });
                                        }}
                                        className="hover:text-blue-400 transition-colors flex items-center gap-2"
                                    >
                                        <span className="text-lg">📚</span> {u._count.books} quyển
                                    </button>
                                </td>
                                <td className="px-8 py-4 text-xs text-white/30">
                                    {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                                </td>
                                <td className="px-8 py-4 text-right">
                                    <div className="flex justify-end gap-3">
                                        <button
                                            onClick={() => setResetPasswordFor(u.id)}
                                            className="p-4 bg-blue-500/10 hover:bg-blue-500 text-white/40 hover:text-white rounded-2xl transition-all border border-blue-500/20 active:scale-90"
                                            title="Reset Mật khẩu"
                                        >
                                            <span className="text-xl">🔑</span>
                                        </button>
                                        <button
                                            onClick={() => setConfirmDelete(u.id)}
                                            className="p-4 bg-red-500/10 hover:bg-red-500 text-white/40 hover:text-white rounded-2xl transition-all border border-red-500/20 active:scale-90"
                                            title="Xóa người dùng"
                                        >
                                            <span className="text-xl">🗑️</span>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Modals */}
            <ConfirmModal
                isOpen={confirmDelete !== null}
                onClose={() => setConfirmDelete(null)}
                onConfirm={() => {
                    if (confirmDelete) onDeleteUser(confirmDelete);
                    setConfirmDelete(null);
                }}
                title="Xóa người dùng?"
                message="Bạn có chắc chắn muốn xóa người dùng này cùng toàn bộ dữ liệu liên quan?"
                variant="danger"
                confirmLabel="Xóa ngay"
            />


            <ConfirmModal
                isOpen={resetPasswordFor !== null}
                onClose={() => setResetPasswordFor(null)}
                onConfirm={(val) => handleConfirmReset(val)}
                title="Reset Mật khẩu"
                message="Đặt lại mật khẩu mới cho người dùng này. Mật khẩu phải có ít nhất 6 ký tự."
                type="input"
                placeholder="Nhập mật khẩu mới..."
                confirmLabel="Cập nhật"
                variant="info"
            />

            {/* User Books Modal */}
            <UserBooksModal
                isOpen={selectedUserBooks !== null}
                userName={selectedUserBooks?.name || ''}
                books={selectedUserBooks?.books || []}
                onClose={() => setSelectedUserBooks(null)}
                onDeleteBook={onDeleteBook}
                onBulkDelete={onBulkDelete}
            />
        </div>
    );
};

export default AdminUserList;

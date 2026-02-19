import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../../constants';

interface AdminStats {
    userCount: number;
    bookCount: number;
    chapterCount: number;
    segmentCount: number;
    recentUsers: any[];
}

export default function AdminDashboard({ onClose }: { onClose: () => void }) {
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [books, setBooks] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'books'>('overview');
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    const token = localStorage.getItem('audiobook_token');
    const authAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { Authorization: `Bearer ${token}` }
    });

    const fetchData = async () => {
        setLoading(true);
        try {
            const [statsRes, usersRes, booksRes] = await Promise.all([
                authAxios.get('/api/admin/stats'),
                authAxios.get('/api/admin/users'),
                authAxios.get('/api/admin/books')
            ]);
            setStats(statsRes.data);
            setUsers(usersRes.data);
            setBooks(booksRes.data);
        } catch (error) {
            console.error('Admin fetch error:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleDeleteUser = async (id: number) => {
        if (!confirm('Bạn có chắc chắn muốn xóa người dùng này?')) return;
        try {
            await authAxios.delete(`/api/admin/users/${id}`);
            fetchData();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Lỗi khi xóa người dùng');
        }
    };

    const filteredUsers = users.filter(u =>
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredBooks = books.filter(b =>
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (b.user?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 font-outfit">
            {/* iCloud Dynamic Background */}
            <div className="absolute inset-0 bg-slate-900">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/20 blur-[120px] rounded-full animate-pulse"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/10 blur-[150px] rounded-full animate-pulse delay-700"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] bg-purple-500/10 blur-[180px] rounded-full"></div>
            </div>

            {/* Main Container */}
            <div className="relative w-full h-full max-w-7xl bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[40px] shadow-[0_32px_64px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-500">

                {/* Header / Navigation */}
                <header className="flex items-center justify-between px-8 py-6 border-b border-white/5">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <span className="text-2xl">⚙️</span>
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-white tracking-tight">Hệ thống Quản trị</h1>
                            <p className="text-white/40 text-sm font-medium">Bảng điều khiển backend</p>
                        </div>
                    </div>

                    <nav className="hidden md:flex bg-white/5 p-1 rounded-2xl border border-white/5 backdrop-blur-md">
                        {[
                            { id: 'overview', label: 'Tổng quan', icon: '📊' },
                            { id: 'users', label: 'Người dùng', icon: '👥' },
                            { id: 'books', label: 'Kho sách', icon: '📚' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${activeTab === tab.id ? 'bg-white/10 text-white shadow-inner' : 'text-white/40 hover:text-white/60'}`}
                            >
                                <span>{tab.icon}</span>
                                {tab.label}
                            </button>
                        ))}
                    </nav>

                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full border border-white/10 text-white/60 hover:text-white transition-all active:scale-90"
                    >
                        ✕
                    </button>
                </header>

                {/* Sub-header for Mobile */}
                <div className="md:hidden px-8 py-4 border-b border-white/5 overflow-x-auto">
                    <div className="flex gap-2">
                        {['overview', 'users', 'books'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab as any)}
                                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${activeTab === tab ? 'bg-white/10 text-white' : 'text-white/40'}`}
                            >
                                {tab.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content Area */}
                <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {loading ? (
                        <div className="h-full flex flex-col items-center justify-center gap-4 text-white/20">
                            <div className="w-12 h-12 border-4 border-current border-t-white rounded-full animate-spin"></div>
                            <span className="font-bold tracking-widest text-xs uppercase">Đang tải dữ liệu...</span>
                        </div>
                    ) : (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">

                            {activeTab === 'overview' && stats && (
                                <div className="space-y-8">
                                    {/* Bento Stats Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                        <StatCard label="Người dùng" value={stats.userCount} color="from-blue-400 to-indigo-500" icon="👤" />
                                        <StatCard label="Sách" value={stats.bookCount} color="from-emerald-400 to-teal-500" icon="📖" />
                                        <StatCard label="Chương sách" value={stats.chapterCount} color="from-amber-400 to-orange-500" icon="📑" />
                                        <StatCard label="Phân đoạn" value={stats.segmentCount} color="from-pink-400 to-rose-500" icon="🧩" />
                                    </div>

                                    {/* Recent Activity Section */}
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                        <div className="lg:col-span-2 bg-white/5 rounded-[32px] p-8 border border-white/5">
                                            <h3 className="text-xl font-bold text-white mb-6">Hoạt động gần đây</h3>
                                            <div className="space-y-4">
                                                {stats.recentUsers.map((u: any) => (
                                                    <div key={u.id} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/[0.08] transition-all">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center text-xl">
                                                                {u.avatarUrl ? <img src={u.avatarUrl} className="w-full h-full rounded-full" /> : '👤'}
                                                            </div>
                                                            <div>
                                                                <p className="text-white font-bold">{u.name || (u.email && u.email.split('@')[0])}</p>
                                                                <p className="text-white/40 text-xs">{u.email}</p>
                                                            </div>
                                                        </div>
                                                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">
                                                            {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="bg-gradient-to-br from-indigo-600/20 to-purple-600/20 rounded-[32px] p-8 border border-white/10 flex flex-col justify-between">
                                            <div>
                                                <h3 className="text-xl font-bold text-white mb-2">Trạng thái hệ thống</h3>
                                                <p className="text-white/60 text-sm">Máy chủ đang hoạt động ổn định trên Port 3005</p>
                                            </div>
                                            <div className="mt-8 space-y-4">
                                                <div className="flex items-center justify-between text-xs font-bold text-white/40">
                                                    <span>CPU CLUSTER</span>
                                                    <span className="text-emerald-400">99.9% UP</span>
                                                </div>
                                                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                                    <div className="h-full bg-emerald-500 w-[85%]"></div>
                                                </div>
                                                <button className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl text-white font-bold text-sm transition-all border border-white/10">
                                                    Kiểm tra nhật ký
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'users' && (
                                <div className="space-y-6">
                                    <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                                        <h2 className="text-2xl font-black text-white">Quản lý người dùng</h2>
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

                                    <div className="bg-white/5 rounded-[32px] border border-white/5 overflow-hidden">
                                        <table className="w-full text-left">
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
                                                                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-bold text-xs text-blue-400">
                                                                    {u.avatarUrl ? <img src={u.avatarUrl} className="w-full h-full rounded-full" /> : (u.name || (u.email && u.email[0])).toUpperCase()}
                                                                </div>
                                                                <div>
                                                                    <div className="text-sm font-bold text-white">{u.name || 'N/A'}</div>
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
                                                            {u._count.books} quyển
                                                        </td>
                                                        <td className="px-8 py-4 text-xs text-white/30">
                                                            {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                                                        </td>
                                                        <td className="px-8 py-4 text-right">
                                                            <button
                                                                onClick={() => handleDeleteUser(u.id)}
                                                                className="p-2 text-white/20 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                                                            >
                                                                🗑️
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'books' && (
                                <div className="space-y-6">
                                    <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                                        <h2 className="text-2xl font-black text-white">Thư viện toàn hệ thống</h2>
                                        <div className="relative w-full md:w-96">
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

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {filteredBooks.map((b: any) => (
                                            <div key={b.id} className="bg-white/5 rounded-[32px] p-6 border border-white/5 hover:border-white/10 transition-all group overflow-hidden relative">
                                                <div className="flex gap-4">
                                                    <div className="w-24 aspect-[2/3] bg-slate-900 rounded-xl overflow-hidden shadow-lg flex-shrink-0">
                                                        {b.coverImageUrl ? (
                                                            <img src={`${API_BASE_URL}${b.coverImageUrl}`} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-2xl">📘</div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 flex flex-col justify-between">
                                                        <div>
                                                            <h4 className="text-white font-bold line-clamp-2">{b.title}</h4>
                                                            <p className="text-white/40 text-xs mt-1 italic">{b.author || 'Tác giả ẩn danh'}</p>
                                                        </div>
                                                        <div className="space-y-2 mt-4">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px]">👤</div>
                                                                <span className="text-[10px] text-white/50 font-medium">{b.user?.name || b.user?.email || 'Anonymous'}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-[10px] text-white/30 uppercase tracking-widest font-black">
                                                                <span>{b._count.chapters} Chương</span>
                                                                <span>•</span>
                                                                <span>{new Date(b.createdAt).toLocaleDateString('vi-VN')}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                        </div>
                    )}
                </main>
            </div>

            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `}</style>
        </div>
    );
}

function StatCard({ label, value, color, icon }: { label: string, value: number, color: string, icon: string }) {
    return (
        <div className="bg-white/5 rounded-[32px] p-6 border border-white/5 hover:bg-white/[0.08] transition-all group">
            <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-tr ${color} flex items-center justify-center text-xl shadow-lg shadow-black/20 group-hover:scale-110 transition-transform`}>
                    {icon}
                </div>
                <div className="text-white/20 text-xs font-black uppercase tracking-widest">Live</div>
            </div>
            <div className="text-3xl font-black text-white mb-1">{value.toLocaleString()}</div>
            <div className="text-white/40 text-xs font-bold uppercase tracking-wider">{label}</div>
        </div>
    );
}

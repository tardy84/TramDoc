import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../../constants';
import { deleteOfflineBook } from '../../services/offlineManager';
import AdminOverview from './AdminOverview';
import AdminUserList from './AdminUserList';
import AdminBookList from './AdminBookList';

interface AdminStats {
    userCount: number;
    bookCount: number;
    chapterCount: number;
    segmentCount: number;
    recentUsers: any[];
}

export default function AdminDashboard({ onClose }: { onClose?: () => void }) {
    const navigate = useNavigate();
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
        try {
            await authAxios.delete(`/api/admin/users/${id}`);
            fetchData();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Lỗi khi xóa người dùng');
        }
    };
    const handleDeleteBook = async (id: number) => {
        try {
            await authAxios.delete(`/api/admin/books/${id}`);
            await deleteOfflineBook(id);
            fetchData();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Lỗi khi xóa sách');
        }
    };

    const handleBulkDelete = async (ids: number[]) => {
        try {
            await authAxios.post('/api/admin/books/bulk-delete', { ids });
            // Clean up offline data for all deleted books
            await Promise.all(ids.map(id => deleteOfflineBook(id)));
            fetchData();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Lỗi khi xóa hàng loạt');
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 border-white/10 flex flex-col font-outfit relative">
            {/* iCloud Dynamic Background */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/20 blur-[120px] rounded-full animate-pulse"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/10 blur-[150px] rounded-full animate-pulse delay-700"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] bg-purple-500/10 blur-[180px] rounded-full"></div>
            </div>

            {/* Main Container */}
            <div className="relative flex-1 flex flex-col overflow-hidden animate-in fade-in duration-500">

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
                        onClick={() => onClose ? onClose() : navigate('/')}
                        className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full border border-white/10 text-white/60 hover:text-white transition-all active:scale-90"
                        title="Thoát Quản trị"
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
                                <AdminOverview stats={stats} />
                            )}

                            {activeTab === 'users' && (
                                <AdminUserList
                                    users={users}
                                    searchQuery={searchQuery}
                                    setSearchQuery={setSearchQuery}
                                    onDeleteUser={handleDeleteUser}
                                    onDeleteBook={handleDeleteBook}
                                    onBulkDelete={handleBulkDelete}
                                    authAxios={authAxios}
                                    refreshData={fetchData}
                                />
                            )}

                            {activeTab === 'books' && (
                                <AdminBookList
                                    books={books}
                                    searchQuery={searchQuery}
                                    setSearchQuery={setSearchQuery}
                                    onDeleteBook={handleDeleteBook}
                                    onBulkDelete={handleBulkDelete}
                                    refreshData={fetchData}
                                />
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


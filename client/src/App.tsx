import { useState, useEffect } from 'react';
import axios from 'axios';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import BookReader from './components/BookReader';
import Auth from './components/Auth';
import AuthSuccess from './components/AuthSuccess';
import Dashboard from './components/Dashboard';
import AdminDashboard from './components/Admin/AdminDashboard';
import { API_BASE_URL } from './constants';

interface Book {
    id: number;
    title: string;
    author: string;
    coverImageUrl?: string;
    createdAt: string;
    chapters: any[];
    progress?: number;
    currentText?: string;
    lastRead?: number;
}

interface User {
    id: number;
    email: string;
    name: string;
    avatarUrl?: string;
    role: string;
}

function MainApp() {
    const [books, setBooks] = useState<Book[]>([]);
    const [user, setUser] = useState<User | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [uploadStatus, setUploadStatus] = useState('');
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
    const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ bookId: number, title: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'all' | 'author'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'recent' | 'title' | 'progress'>('recent');
    const [activeHeroIndex, setActiveHeroIndex] = useState(0);
    const [showDashboard, setShowDashboard] = useState(false);
    const [showAdmin, setShowAdmin] = useState(false);
    const [avatarError, setAvatarError] = useState(false);

    const token = localStorage.getItem('audiobook_token');

    const authAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { Authorization: `Bearer ${token}` }
    });

    const checkAuth = async () => {
        if (!token) {
            setLoading(false);
            return;
        }
        try {
            const res = await authAxios.get('/api/auth/me');
            setUser(res.data);
            loadBooks();
        } catch (e) {
            localStorage.removeItem('audiobook_token');
            setUser(null);
        } finally {
            setLoading(false);
        }
    };

    const loadBooks = async () => {
        try {
            const res = await authAxios.get('/api/books');
            const fetchedBooks = res.data.sort((a: any, b: any) =>
                new Date(b.lastRead || 0).getTime() - new Date(a.lastRead || 0).getTime()
            );
            setBooks(fetchedBooks);
        } catch (error) {
            console.error('Error loading books:', error);
        }
    };

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.name.endsWith('.epub')) {
            showToast('Please upload an EPUB file', 'error');
            return;
        }

        setUploading(true);
        setProgress(0);
        setUploadStatus('Uploading file...');

        const jobId = Math.random().toString(36).substring(7);
        const formData = new FormData();
        formData.append('book', file);
        formData.append('jobId', jobId);

        const pollInterval = setInterval(async () => {
            try {
                const statusRes = await authAxios.get(`/api/upload-status/${jobId}`);
                setProgress(statusRes.data.progress);
                setUploadStatus(statusRes.data.status);
                if (statusRes.data.progress === 100 || statusRes.data.status === 'Error') clearInterval(pollInterval);
            } catch (e) { }
        }, 800);

        try {
            await authAxios.post('/api/upload', formData);
            loadBooks();
            setUploadStatus('Complete');
            setProgress(100);
            setTimeout(() => {
                setUploading(false);
                showToast(`Book "${file.name}" processed successfully!`);
            }, 1000);
        } catch (error: any) {
            clearInterval(pollInterval);
            setUploadStatus('Error');
            showToast(error.response?.data?.error || error.message, 'error');
            setUploading(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        try {
            await authAxios.delete(`/api/books/${deleteConfirm.bookId}`);
            showToast(`Sách "${deleteConfirm.title}" đã được xóa!`);
            loadBooks();
        } catch (error: any) {
            showToast(`Lỗi: ${error.response?.data?.error || error.message}`, 'error');
        } finally {
            setDeleteConfirm(null);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('audiobook_token');
        setUser(null);
        window.location.href = '/';
    };

    useEffect(() => {
        checkAuth();
    }, []);

    if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-emerald-500 animate-pulse text-2xl font-black">TRẠM ĐỌC...</div>;
    if (!user) return <Auth onLogin={(t, u) => { localStorage.setItem('audiobook_token', t); setUser(u); window.location.reload(); }} />;

    if (selectedBookId !== null) {
        return <BookReader bookId={selectedBookId} token={token} onClose={() => { setSelectedBookId(null); loadBooks(); }} />;
    }

    const filteredAndSortedBooks = books
        .filter(book =>
            book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (book.author || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
        .sort((a, b) => {
            if (sortBy === 'recent') {
                return new Date(b.lastRead || 0).getTime() - new Date(a.lastRead || 0).getTime();
            } else if (sortBy === 'title') {
                return a.title.localeCompare(b.title);
            } else if (sortBy === 'progress') {
                return (b.progress || 0) - (a.progress || 0);
            }
            return 0;
        });

    // Author Grouping Logic
    const booksByAuthor = filteredAndSortedBooks.reduce((acc, book) => {
        const author = book.author || 'Tác giả ẩn danh';
        if (!acc[author]) acc[author] = [];
        acc[author].push(book);
        return acc;
    }, {} as Record<string, Book[]>);

    const inProgressBooks = books.filter(b => (b.progress || 0) > 0 && (b.progress || 0) < 100).slice(0, 3);
    const heroBooks = inProgressBooks.length > 0 ? inProgressBooks : (books.length > 0 ? [books[0]] : []);

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-outfit selection:bg-emerald-500/30">
            <div className="container mx-auto px-4 py-4">
                <header className="flex items-center justify-between mb-6 pb-2 border-b border-slate-800/30">
                    <div className="flex items-center gap-1.5 group">
                        <img src="/logo.png" alt="Logo" className="h-10 md:h-14 w-auto object-contain mix-blend-screen" />
                        <h1 className="text-xl md:text-4xl font-black text-white tracking-tight font-playfair bg-gradient-to-br from-white via-emerald-100 to-teal-200 bg-clip-text text-transparent">
                            Trạm Đọc
                        </h1>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowDashboard(true)}
                            className="p-2 md:p-3 bg-slate-800/50 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all border border-white/5 active:scale-95"
                            title="Thống kê"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                        </button>

                        {user.role === 'ADMIN' && (
                            <button
                                onClick={() => setShowAdmin(true)}
                                className="p-2 md:p-3 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 hover:text-indigo-300 rounded-xl transition-all border border-indigo-500/20 active:scale-95"
                                title="Quản trị Backend"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                        )}

                        <div className="flex items-center gap-2">
                            <div className="flex flex-col items-end">
                                <span className="text-white font-bold text-[10px] md:text-sm leading-none mb-1 max-w-[70px] md:max-w-none truncate">{user.name || user.email.split('@')[0]}</span>
                                <button
                                    onClick={handleLogout}
                                    className="text-[9px] text-red-400 font-black uppercase tracking-widest"
                                >
                                    Thoát
                                </button>
                            </div>
                            {user.avatarUrl && !avatarError ? (
                                <img
                                    src={user.avatarUrl}
                                    className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-emerald-500/30 shadow-lg object-cover"
                                    alt="Avatar"
                                    referrerPolicy="no-referrer"
                                    onError={() => setAvatarError(true)}
                                />
                            ) : (
                                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-[10px] font-bold">
                                    {(user.name || user.email)[0].toUpperCase()}
                                </div>
                            )}
                        </div>

                        <label className="group relative cursor-pointer ml-1">
                            <input type="file" accept=".epub" onChange={handleFileUpload} disabled={uploading} className="hidden" />
                            <div className="flex items-center justify-center w-9 h-9 md:w-auto md:h-auto md:px-5 md:py-2.5 bg-emerald-500 text-white rounded-full shadow-lg active:scale-90 transition-transform">
                                <span className="text-lg md:text-base">{uploading ? '⏳' : '📤'}</span>
                                <span className="hidden md:inline ml-2 font-bold text-xs uppercase tracking-wider">Tải sách</span>
                            </div>
                        </label>
                    </div>
                </header>

                {uploading && (
                    <div className="mb-8 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="bg-slate-800/40 backdrop-blur-md rounded-2xl p-4 border border-slate-700/50 shadow-xl">
                            <div className="flex items-center justify-between gap-4 mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="text-xl animate-spin-slow">{progress === 100 ? '✅' : '⏳'}</div>
                                    <div>
                                        <span className="text-sm font-bold text-white uppercase tracking-wider mr-2">Đang xử lý</span>
                                        <span className="text-xs text-slate-400 font-medium">{uploadStatus}</span>
                                    </div>
                                </div>
                                <div className="text-lg font-black text-emerald-400">{progress}%</div>
                            </div>
                            <div className="h-1.5 w-full bg-slate-900/50 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Continue Reading Carousel - Cinematic Horizontal Scroll */}
                {heroBooks.length > 0 && (
                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-4 px-1">
                            <h3 className="text-xs font-black text-emerald-500 uppercase tracking-[0.3em]">
                                {inProgressBooks.length > 0 ? 'Tiếp tục nghe' : 'Sách vừa xem'}
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
                                const gap = 16; // gap-4 = 1rem = 16px
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
                                    {/* Cinematic Background */}
                                    <div className="absolute inset-0 z-0">
                                        {heroBook.coverImageUrl && (
                                            <img src={`${API_BASE_URL}${heroBook.coverImageUrl}`} alt="" className="w-full h-full object-cover blur-[80px] opacity-40 scale-150" />
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-slate-900/60 to-slate-900" />
                                    </div>

                                    <div className="relative z-10 flex flex-col p-5 md:p-8">
                                        <div className="flex flex-row items-start gap-6 w-full text-left">
                                            <div className="w-44 md:w-64 aspect-[2/3] flex-shrink-0 relative">
                                                {heroBook.coverImageUrl ? (
                                                    <img
                                                        src={`${API_BASE_URL}${heroBook.coverImageUrl}`}
                                                        className="h-full w-full object-cover rounded-xl shadow-2xl border border-white/10"
                                                        alt={heroBook.title}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full bg-slate-800 rounded-xl flex items-center justify-center border border-white/10">
                                                        <span className="text-3xl">📘</span>
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
                                                        <p className="text-slate-200 text-xs md:text-base italic line-clamp-3 md:line-clamp-4 font-serif leading-relaxed border-l-4 border-emerald-500/30 pl-4 mb-6">
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
                )}

                <main className="pb-12">
                    {/* Search & Sort Controls */}
                    <div className="flex flex-col gap-4 mb-8">
                        <div className="relative group">
                            <input
                                type="text"
                                placeholder="Tìm tên sách, tác giả..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-slate-800/50 border border-slate-700/50 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 transition-all placeholder:text-slate-500 font-medium"
                            />
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl opacity-50">🔍</span>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                                    <span className="text-emerald-500">📚</span> Thư viện
                                </h2>
                                <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-bold">
                                    {filteredAndSortedBooks.length}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value as any)}
                                        className="appearance-none bg-slate-800/80 text-white text-[10px] font-black uppercase px-3 py-2 pr-8 rounded-xl border border-white/5"
                                    >
                                        <option value="recent">Mới</option>
                                        <option value="title">Tên</option>
                                        <option value="progress">Tiến độ</option>
                                    </select>
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[8px] opacity-40">▼</span>
                                </div>

                                <div className="flex bg-slate-800/80 p-0.5 rounded-xl border border-white/5">
                                    <button
                                        onClick={() => setViewMode('all')}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all uppercase ${viewMode === 'all' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}
                                    >
                                        Tất cả
                                    </button>
                                    <button
                                        onClick={() => setViewMode('author')}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all uppercase ${viewMode === 'author' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}
                                    >
                                        Tác giả
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {filteredAndSortedBooks.length === 0 ? (
                        <div className="text-center py-20 bg-slate-800/20 rounded-3xl border border-slate-700/50 border-dashed">
                            <div className="text-5xl mb-4 opacity-20">🔍</div>
                            <p className="text-slate-400 text-lg font-medium">Không tìm thấy sách nào</p>
                            <button onClick={() => setSearchQuery('')} className="mt-4 text-emerald-400 font-bold text-sm underline">Xóa tìm kiếm</button>
                        </div>
                    ) : viewMode === 'author' ? (
                        <div className="space-y-10">
                            {Object.entries(booksByAuthor)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([author, authorBooks]) => (
                                    <section key={author} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                                        <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-3">
                                            <span className="whitespace-nowrap">{author}</span>
                                            <div className="h-px flex-1 bg-white/5" />
                                            <span className="text-[10px] font-medium text-slate-600 italic">{authorBooks.length}</span>
                                        </h3>
                                        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-6">
                                            {authorBooks.map((book) => (
                                                <BookCard key={book.id} book={book} onSelect={setSelectedBookId} onDelete={setDeleteConfirm} />
                                            ))}
                                        </div>
                                    </section>
                                ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-6 animate-in fade-in duration-500">
                            {filteredAndSortedBooks.map((book) => (
                                <BookCard key={book.id} book={book} onSelect={setSelectedBookId} onDelete={setDeleteConfirm} />
                            ))}
                        </div>
                    )}
                </main>
            </div>

            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full border border-slate-700 shadow-2xl">
                        <h3 className="text-2xl font-bold text-white mb-4">Xóa sách?</h3>
                        <p className="text-slate-400 mb-2">Bạn có chắc chắn muốn xóa cuốn sách:</p>
                        <p className="text-emerald-400 font-semibold mb-6">"{deleteConfirm.title}"</p>
                        <div className="flex gap-4">
                            <button onClick={() => setDeleteConfirm(null)} className="flex-1 bg-slate-800 py-3 rounded-xl">Hủy</button>
                            <button onClick={confirmDelete} className="flex-1 bg-red-500 text-white py-3 rounded-xl">Xóa</button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-8">
                    <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl backdrop-blur-xl border ${toast.type === 'success' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' : 'bg-red-500/20 border-red-500/30 text-red-400'}`}>
                        <span>{toast.type === 'success' ? '✨' : '⚠️'}</span>
                        <span className="font-semibold">{toast.message}</span>
                    </div>
                </div>
            )}

            {showDashboard && user && (
                <Dashboard books={books} user={user} onClose={() => setShowDashboard(false)} />
            )}

            {showAdmin && user && (
                <AdminDashboard onClose={() => setShowAdmin(false)} />
            )}
        </div>
    );
}

function BookCard({ book, onSelect, onDelete }: { book: Book, onSelect: (id: number) => void, onDelete: (confirm: { bookId: number, title: string }) => void }) {
    const isCompleted = (book.progress || 0) >= 100;
    const inProgress = (book.progress || 0) > 0 && (book.progress || 0) < 100;
    const isNew = !book.progress || book.progress === 0;

    return (
        <div
            onClick={() => onSelect(book.id)}
            className="group relative bg-slate-900/40 rounded-xl overflow-hidden border border-white/5 hover:border-emerald-500/30 transition-all duration-500 cursor-pointer hover:-translate-y-1 hover:shadow-2xl hover:shadow-emerald-500/10 flex flex-col h-full"
            title={book.title}
        >
            {/* Cover Image Container */}
            <div className="aspect-[2/3] w-full bg-slate-950 relative overflow-hidden">
                {book.coverImageUrl ? (
                    <img
                        src={`${API_BASE_URL}${book.coverImageUrl}`}
                        alt={book.title}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 group-hover:blur-[2px] group-hover:brightness-50"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                        <span className="text-4xl opacity-30 invert">📘</span>
                    </div>
                )}

                {/* Cinematic Gradient Overlay */}
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-90" />

                {/* Smart Badges */}
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

                {/* Quick Peek Overlay (Hover) */}
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

                {/* Delete Button (Hover) */}
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete({ bookId: book.id, title: book.title }); }}
                    className="absolute top-2 right-2 p-2 bg-black/40 hover:bg-red-500/80 text-white/60 hover:text-white rounded-full transition-all backdrop-blur-md z-30 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 duration-200"
                    title="Xóa sách"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>

                {/* Progress Bar (Bottom) */}
                {inProgress && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                        <div className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" style={{ width: `${book.progress}%` }} />
                    </div>
                )}
            </div>

            {/* Content info */}
            <div className="p-3 flex-1 flex flex-col justify-start bg-gradient-to-b from-transparent to-slate-900/30">
                <h3 className="text-white font-playfair font-bold leading-tight mb-1 truncate group-hover:text-emerald-400 transition-colors">
                    {book.title}
                </h3>
                <p className="text-slate-500 text-xs truncate font-medium">
                    {book.author || 'Tác giả ẩn danh'}
                </p>
            </div>
        </div>
    );
}

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<MainApp />} />
                <Route path="/auth-success" element={<AuthSuccess />} />
                <Route path="*" element={<Navigate to="/" />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;

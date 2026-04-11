import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ConfirmModal from './components/Shared/ConfirmModal';
import BookReader from './components/BookReader';
import Dashboard from './components/Dashboard';
import InfoModal from './components/Reader/InfoModal';
import Auth from './components/Auth';
import BookCard from './components/Library/BookCard';
import HeroCarousel from './components/Library/HeroCarousel';
import { Book } from './types';
import { getAllBooks, deleteBook as deleteBookApi, uploadBook, getUploadStatus } from './services/apiService';

function MainApp({
    books,
    loadBooks,
    loading,
    onLogout
}: {
    books: Book[],
    loadBooks: () => void,
    loading: boolean,
    onLogout: () => void
}) {
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [uploadStatus, setUploadStatus] = useState('');
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
    const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ bookId: number, title: string } | null>(null);
    const [viewMode, setViewMode] = useState<'all' | 'author'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'recent' | 'title' | 'progress'>('recent');
    const [activeHeroIndex, setActiveHeroIndex] = useState(0);
    const [showDashboard, setShowDashboard] = useState(false);
    const [showInfo, setShowInfo] = useState(false);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.name.endsWith('.epub')) {
            showToast('Vui lòng chọn file EPUB', 'error');
            return;
        }

        const jobId = `job_${Date.now()}`;
        setUploading(true);
        setProgress(0);
        setUploadStatus('Đang tải lên...');

        try {
            await uploadBook(file, jobId);
            
            // Poll for status
            const pollInterval = setInterval(async () => {
                try {
                    const status = await getUploadStatus(jobId);
                    setProgress(status.progress);
                    setUploadStatus(status.status);

                    if (status.progress === 100) {
                        clearInterval(pollInterval);
                        await loadBooks();
                        setUploadStatus('Hoàn tất!');
                        setTimeout(() => {
                            setUploading(false);
                            showToast(`Sách "${file.name}" đã xử lý thành công!`);
                        }, 1000);
                    } else if (status.error) {
                        clearInterval(pollInterval);
                        throw new Error(status.error);
                    }
                } catch (err: any) {
                    clearInterval(pollInterval);
                    setUploadStatus('Lỗi');
                    showToast(err.message || 'Lỗi xử lý EPUB', 'error');
                    setUploading(false);
                }
            }, 1000);

        } catch (error: any) {
            setUploadStatus('Lỗi');
            showToast(error.message || 'Lỗi tải sách', 'error');
            setUploading(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        try {
            await deleteBookApi(deleteConfirm.bookId);
            showToast(`Sách "${deleteConfirm.title}" đã được xóa!`);
            await loadBooks();
        } catch (error: any) {
            showToast(`Lỗi: ${error.message}`, 'error');
        } finally {
            setDeleteConfirm(null);
        }
    };

    if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-emerald-500 animate-pulse text-2xl font-black">TRẠM ĐỌC...</div>;

    if (selectedBookId !== null) {
        return <BookReader
            key={selectedBookId}
            bookId={selectedBookId}
            onClose={() => { setSelectedBookId(null); loadBooks(); }}
        />;
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

    const booksByAuthor = filteredAndSortedBooks.reduce((acc, book) => {
        const author = book.author || 'Tác giả ẩn danh';
        if (!acc[author]) acc[author] = [];
        acc[author].push(book);
        return acc;
    }, {} as Record<string, Book[]>);

    const heroBooks = [...books]
        .sort((a, b) => new Date(b.lastRead || 0).getTime() - new Date(a.lastRead || 0).getTime())
        .slice(0, 3);

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

                        <button
                            onClick={() => setShowInfo(true)}
                            className="p-2 md:p-3 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 rounded-xl transition-all border border-blue-500/20 active:scale-95"
                            title="Thông tin & Hướng dẫn"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>

                        <button
                            onClick={onLogout}
                            className="p-2 md:p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 hover:text-red-400 rounded-xl transition-all border border-red-500/20 active:scale-95 ml-2"
                            title="Đăng xuất"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 17l5-5m0 0l-5-5m5 5H9m5 4v1a3 3 0 01-3 3H5a3 3 0 01-3-3V6a3 3 0 013-3h6a3 3 0 013 3v1" />
                            </svg>
                        </button>

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

                {/* Continue Reading Carousel */}
                <HeroCarousel 
                    heroBooks={heroBooks} 
                    activeHeroIndex={activeHeroIndex} 
                    setActiveHeroIndex={setActiveHeroIndex} 
                    setSelectedBookId={setSelectedBookId} 
                />

                <main className="pb-12">
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
                            <div className="text-5xl mb-4 opacity-20">📚</div>
                            <p className="text-slate-400 text-lg font-medium">
                                {searchQuery ? 'Không tìm thấy sách nào' : 'Chưa có sách nào'}
                            </p>
                            {searchQuery ? (
                                <button onClick={() => setSearchQuery('')} className="mt-4 text-emerald-400 font-bold text-sm underline">Xóa tìm kiếm</button>
                            ) : (
                                <p className="mt-2 text-slate-500 text-sm">Nhấn 📤 để tải lên file EPUB</p>
                            )}
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

            <ConfirmModal
                isOpen={deleteConfirm !== null}
                onClose={() => setDeleteConfirm(null)}
                onConfirm={confirmDelete}
                title="Xóa sách?"
                message={`Bạn có chắc chắn muốn xóa cuốn sách "${deleteConfirm?.title}"?`}
                variant="danger"
                confirmLabel="Xóa ngay"
            />

            {toast && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-8">
                    <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl backdrop-blur-xl border ${toast.type === 'success' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' : 'bg-red-500/20 border-red-500/30 text-red-400'}`}>
                        <span>{toast.type === 'success' ? '✨' : '⚠️'}</span>
                        <span className="font-semibold">{toast.message}</span>
                    </div>
                </div>
            )}

            {showDashboard && (
                <Dashboard books={books} user={{ id: 1, email: 'local', name: 'Trạm Đọc', role: 'USER' }} onClose={() => setShowDashboard(false)} />
            )}

            <InfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} />
        </div>
    );
}



function App() {
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);

    const loadBooks = async () => {
        if (!token) return;
        try {
            const serverBooks = await getAllBooks();
            setBooks(serverBooks);
        } catch (error) {
            console.error('Failed to load books:', error);
        }
    };

    useEffect(() => {
        const init = async () => {
            await loadBooks();
            setLoading(false);
        };
        if (token) {
            init();
        } else {
            setLoading(false);
        }
    }, [token]);

    const handleLogin = (newToken: string, user: any) => {
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(user));
        setToken(newToken);
    };

    if (!token) {
        return <Auth onLogin={handleLogin} />;
    }

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={
                    <MainApp
                        books={books}
                        loadBooks={loadBooks}
                        loading={loading}
                        onLogout={() => {
                            localStorage.removeItem('token');
                            localStorage.removeItem('user');
                            setToken(null);
                        }}
                    />
                } />
                <Route path="*" element={<Navigate to="/" />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;

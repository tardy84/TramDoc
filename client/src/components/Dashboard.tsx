import { } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { API_BASE_URL } from '../constants';

ChartJS.register(ArcElement, Tooltip, Legend);

interface StatCardProps {
    title: string;
    value: string | number;
    subtext?: string;
    icon: string;
    trend?: 'up' | 'down' | 'neutral';
    color?: string;
}

function StatCard({ title, value, subtext, icon, trend, color = 'emerald' }: StatCardProps) {
    return (
        <div className="bg-slate-800/40 backdrop-blur-md border border-white/5 p-4 rounded-2xl flex items-center gap-4 hover:bg-slate-800/60 transition-colors group">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shadow-lg group-hover:scale-110 transition-transform ${color === 'emerald' ? 'bg-emerald-500/20 text-emerald-400' : color === 'amber' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>
                {icon}
            </div>
            <div>
                <h4 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">{title}</h4>
                <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-white font-outfit">{value}</span>
                    {trend && (
                        <span className={`text-[10px] font-bold ${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {trend === 'up' ? '↗' : '↘'}
                        </span>
                    )}
                </div>
                {subtext && <p className="text-[10px] text-slate-500 font-medium">{subtext}</p>}
            </div>
        </div>
    );
}

interface DashboardProps {
    books: any[];
    user: any;
    onClose: () => void;
}

export default function Dashboard({ books, user, onClose }: DashboardProps) {
    const totalBooks = books.length;
    const completedBooks = books.filter(b => (b.progress || 0) >= 100).length;
    const inProgressBooks = books.filter(b => (b.progress || 0) > 0 && (b.progress || 0) < 100).length;

    // Calculate total hours read (mock data for now, or derived from progress)
    // Assuming average book is 5 hours. (progress / 100) * 5
    const totalHours = books.reduce((acc, b) => acc + ((b.progress || 0) / 100) * 5, 0);

    // Streak calculation (mock)
    const currentStreak = 5;

    // Chart Data
    const data = {
        labels: ['Đã xong', 'Đang đọc', 'Chưa đọc'],
        datasets: [
            {
                data: [completedBooks, inProgressBooks, totalBooks - completedBooks - inProgressBooks],
                backgroundColor: [
                    'rgba(16, 185, 129, 0.8)', // Emerald
                    'rgba(245, 158, 11, 0.8)', // Amber
                    'rgba(51, 65, 85, 0.5)',   // Slate
                ],
                borderColor: [
                    'rgba(16, 185, 129, 1)',
                    'rgba(245, 158, 11, 1)',
                    'rgba(51, 65, 85, 1)',
                ],
                borderWidth: 1,
            },
        ],
    };

    const options = {
        cutout: '70%',
        plugins: {
            legend: {
                display: false
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-700/50 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl relative" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="sticky top-0 bg-slate-900/95 backdrop-blur-md border-b border-white/5 p-6 flex justify-between items-center z-10">
                    <div>
                        <h2 className="text-2xl font-black text-white font-playfair flex items-center gap-3">
                            <span className="text-3xl">📊</span> Thống Kê Đọc Sách
                        </h2>
                        <p className="text-slate-400 text-xs font-medium uppercase tracking-widest mt-1">Hello, {user?.name || 'Reader'}</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors">
                        <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 space-y-8">
                    {/* Key Metrics Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard
                            title="Sách Đã Xong"
                            value={completedBooks}
                            subtext="Tuyệt vời!"
                            icon="🏆"
                            color="emerald"
                        />
                        <StatCard
                            title="Giờ Nghe"
                            value={totalHours.toFixed(1)}
                            subtext="Tương đương 3 cuốn"
                            icon="⏱️"
                            color="blue"
                        />
                        <StatCard
                            title="Streak"
                            value={`${currentStreak} Ngày`}
                            subtext="Giữ vững phong độ!"
                            icon="🔥"
                            color="amber"
                            trend="up"
                        />
                        <StatCard
                            title="Thư Viện"
                            value={totalBooks}
                            subtext="Đang mở rộng"
                            icon="📚"
                            color="emerald"
                        />
                    </div>

                    {/* Chart & Insights Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Doughnut Chart */}
                        <div className="bg-slate-800/20 rounded-3xl p-6 border border-white/5 flex flex-col items-center justify-center relative">
                            <h3 className="absolute top-6 left-6 text-sm font-bold text-slate-400 uppercase tracking-widest">Tiến độ tổng thể</h3>
                            <div className="w-48 h-48 relative mt-8">
                                <Doughnut data={data} options={options} />
                                <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                                    <span className="text-3xl font-black text-white">{Math.round((completedBooks / totalBooks || 0) * 100)}%</span>
                                    <span className="text-[10px] text-slate-500 font-bold uppercase">Hoàn thành</span>
                                </div>
                            </div>
                            <div className="flex gap-4 mt-6">
                                <div className="flex items-center gap-2 text-xs text-slate-400">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div> Đã xong
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-400">
                                    <div className="w-2 h-2 rounded-full bg-amber-500"></div> Đang đọc
                                </div>
                            </div>
                        </div>

                        {/* Recent Activity / Insights */}
                        <div className="lg:col-span-2 bg-slate-800/20 rounded-3xl p-6 border border-white/5">
                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-6">Đang đọc gần đây</h3>
                            <div className="space-y-4">
                                {inProgressBooks > 0 ? books.filter(b => (b.progress || 0) > 0 && (b.progress || 0) < 100).slice(0, 3).map(book => (
                                    <div key={book.id} className="flex items-center gap-4 p-3 bg-white/5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
                                        <div className="w-12 h-16 bg-slate-700 rounded-lg flex-shrink-0 overflow-hidden relative">
                                            <img src={book.coverImageUrl ? `${API_BASE_URL}${book.coverImageUrl}` : '/default-cover.png'} className="w-full h-full object-cover" alt="" />
                                            {!book.coverImageUrl && (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center p-1 text-center pointer-events-none">
                                                    <div className="absolute inset-0 bg-black/40" />
                                                    <span className="text-white font-black text-[9px] leading-tight line-clamp-3 drop-shadow-md z-10 px-0.5 uppercase tracking-wider">{book.title}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-white font-bold truncate mb-1">{book.title}</h4>
                                            <div className="flex items-center gap-3">
                                                <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${book.progress}%` }}></div>
                                                </div>
                                                <span className="text-xs font-mono text-emerald-400">{book.progress}%</span>
                                            </div>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="text-center py-10 text-slate-500 italic">Chưa có sách nào đang đọc. Hãy bắt đầu ngay!</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Weekly Goals (Mock Visual) */}
                    <div className="bg-gradient-to-r from-emerald-900/20 to-teal-900/20 rounded-3xl p-6 border border-emerald-500/10">
                        <div className="flex justify-between items-end mb-4">
                            <div>
                                <h3 className="text-emerald-400 font-bold text-lg mb-1">Mục tiêu tuần này</h3>
                                <p className="text-slate-400 text-sm">Bạn đã đạt <span className="text-white font-bold">3/5</span> giờ nghe mục tiêu.</p>
                            </div>
                            <span className="text-3xl font-black text-emerald-500/50">60%</span>
                        </div>
                        <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-emerald-600 to-teal-400" style={{ width: '60%' }}></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

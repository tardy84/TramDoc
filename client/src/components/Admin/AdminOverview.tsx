import React from 'react';

interface Stat {
    userCount: number;
    bookCount: number;
    chapterCount: number;
    segmentCount: number;
    recentUsers: any[];
}

interface AdminOverviewProps {
    stats: Stat;
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

const AdminOverview: React.FC<AdminOverviewProps> = ({ stats }) => {
    return (
        <div className="space-y-8">
            {/* Bento Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard label="Người dùng" value={stats.userCount} color="from-blue-400 to-indigo-500" icon="👤" />
                <StatCard label="Sách" value={stats.bookCount} color="from-emerald-400 to-teal-500" icon="📖" />
                <StatCard label="Chương sách" value={stats.chapterCount} color="from-amber-400 to-orange-500" icon="📑" />
                <StatCard label="Phân đoạn" value={stats.segmentCount} color="from-pink-400 to-rose-500" icon="🧩" />
            </div>

            {/* Recent Activity Section */}
            <div className="bg-white/5 rounded-[32px] p-8 border border-white/5">
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
        </div>
    );
};

export default AdminOverview;

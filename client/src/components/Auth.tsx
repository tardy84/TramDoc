import React, { useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../constants';

interface AuthProps {
    onLogin: (token: string, user: any) => void;
}

export default function Auth({ onLogin }: AuthProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await axios.post(`${API_BASE_URL}/api/auth/login`, {
                username,
                password
            });
            onLogin(res.data.token, res.data.user);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Sai thông tin đăng nhập');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4 font-outfit">
            <div className="max-w-md w-full">
                <div className="text-center mb-10">
                    <img src="/logo.png" alt="Logo" className="h-20 mx-auto mb-4 mix-blend-screen" />
                    <h1 className="text-4xl font-black text-white tracking-tight font-playfair bg-gradient-to-br from-white via-emerald-100 to-teal-200 bg-clip-text text-transparent">
                        Trạm Đọc
                    </h1>
                    <p className="text-slate-400 mt-2">Nơi dừng chân của những tâm hồn yêu sách</p>
                </div>

                <div className="bg-slate-800/40 backdrop-blur-xl p-8 rounded-3xl border border-slate-700/50 shadow-2xl">
                    <h2 className="text-2xl font-bold text-white mb-6">
                        Đăng nhập hệ thống
                    </h2>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl mb-6 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Tên đăng nhập</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                                placeholder="phong"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Mật khẩu</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 mt-4"
                        >
                            {loading ? 'Đang xử lý...' : 'Đăng nhập'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

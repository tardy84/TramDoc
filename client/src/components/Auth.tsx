import React, { useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../constants';

interface AuthProps {
    onLogin: (token: string, user: any) => void;
}

export default function Auth({ onLogin }: AuthProps) {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
            const res = await axios.post(`${API_BASE_URL}${endpoint}`, {
                email,
                password,
                ...(isLogin ? {} : { name })
            });
            onLogin(res.data.token, res.data.user);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = () => {
        window.location.href = `${API_BASE_URL}/api/auth/google`;
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4 font-outfit">
            <div className="max-w-md w-full">
                <div className="text-center mb-10">
                    <img src="/logo.png" alt="Logo" className="h-20 mx-auto mb-4 mix-blend-screen" />
                    <h1 className="text-4xl font-black text-white tracking-tight font-playfair bg-gradient-to-br from-white via-emerald-100 to-teal-200 bg-clip-text text-transparent">
                        Trạm Đọc v1.2
                    </h1>
                    <p className="text-slate-400 mt-2">Nơi dừng chân của những tâm hồn yêu sách</p>
                </div>

                <div className="bg-slate-800/40 backdrop-blur-xl p-8 rounded-3xl border border-slate-700/50 shadow-2xl">
                    <h2 className="text-2xl font-bold text-white mb-6">
                        {isLogin ? 'Chào mừng trở lại!' : 'Tạo tài khoản mới'}
                    </h2>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl mb-6 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!isLogin && (
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Tên của bạn</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                                    placeholder="Nguyễn Văn A"
                                    required
                                />
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                                placeholder="name@example.com"
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
                            {loading ? 'Đang xử lý...' : isLogin ? 'Đăng nhập' : 'Đăng ký'}
                        </button>
                    </form>

                    <div className="relative my-8">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-700"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-transparent px-2 text-slate-500">Hoặc tiếp tục với</span>
                        </div>
                    </div>

                    <button
                        onClick={handleGoogleLogin}
                        className="w-full bg-white text-slate-900 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 hover:bg-slate-100"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Google
                    </button>

                    <div className="mt-8 text-center text-sm text-slate-400">
                        {isLogin ? (
                            <>
                                Chưa có tài khoản?{' '}
                                <button onClick={() => setIsLogin(false)} className="text-emerald-400 font-bold hover:underline">
                                    Đăng ký ngay
                                </button>
                            </>
                        ) : (
                            <>
                                Đã có tài khoản?{' '}
                                <button onClick={() => setIsLogin(true)} className="text-emerald-400 font-bold hover:underline">
                                    Đăng nhập
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

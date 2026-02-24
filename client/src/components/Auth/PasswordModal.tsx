import React, { useState } from 'react';

interface PasswordModalProps {
    isOpen: boolean;
    onClose: () => void;
    authAxios: any;
}

const PasswordModal: React.FC<PasswordModalProps> = ({ isOpen, onClose, authAxios }) => {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (newPassword !== confirmPassword) {
            setError('Mật khẩu xác nhận không khớp');
            return;
        }

        if (newPassword.length < 6) {
            setError('Mật khẩu mới phải có ít nhất 6 ký tự');
            return;
        }

        setLoading(true);
        try {
            await authAxios.patch('/api/auth/change-password', {
                oldPassword,
                newPassword
            });
            setSuccess('Đổi mật khẩu thành công!');
            setTimeout(() => {
                onClose();
                setOldPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setSuccess('');
            }, 2000);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Lớp có lỗi xảy ra');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-500">
            <div className="w-full max-w-md relative group overflow-hidden rounded-[40px] border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-500">
                {/* Cinematic Background Elements */}
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-indigo-600/20 via-slate-900 to-emerald-600/20" />
                    <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/20 rounded-full blur-[80px] animate-pulse" />
                    <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-emerald-500/20 rounded-full blur-[80px] animate-pulse delay-75" />
                </div>

                <div className="relative z-10 p-8 md:p-10">
                    <div className="flex justify-between items-start mb-10">
                        <div>
                            <h2 className="text-3xl font-black text-white tracking-tight mb-1 font-playfair">Bảo mật</h2>
                            <p className="text-white/40 text-xs font-bold uppercase tracking-[0.2em]">Cập nhật mật khẩu cá nhân</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-3 bg-white/5 hover:bg-white/10 text-white/40 hover:text-white rounded-2xl transition-all active:scale-90 border border-white/5"
                        >
                            ✕
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-5">
                            <div className="relative group/input">
                                <label className="block text-[10px] font-black text-emerald-500 uppercase tracking-[0.2em] mb-2 px-1">Mật khẩu hiện tại</label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        required
                                        value={oldPassword}
                                        onChange={(e) => setOldPassword(e.target.value)}
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-4 px-5 text-white placeholder:text-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 transition-all font-medium"
                                        placeholder="••••••••"
                                    />
                                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-lg opacity-20 group-focus-within/input:opacity-50 transition-opacity">🔒</span>
                                </div>
                            </div>

                            <div className="relative group/input">
                                <label className="block text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-2 px-1">Mật khẩu mới</label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        required
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-4 px-5 text-white placeholder:text-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 transition-all font-medium"
                                        placeholder="Tối thiểu 6 ký tự"
                                    />
                                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-lg opacity-20 group-focus-within/input:opacity-50 transition-opacity">✨</span>
                                </div>
                            </div>

                            <div className="relative group/input">
                                <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-2 px-1">Xác nhận mật khẩu</label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        required
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-4 px-5 text-white placeholder:text-white/10 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition-all font-medium"
                                        placeholder="Nhập lại mật khẩu mới"
                                    />
                                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-lg opacity-20 group-focus-within/input:opacity-50 transition-opacity">🛡️</span>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold animate-in slide-in-from-top-2 duration-300 flex items-center gap-3">
                                <span className="text-lg">⚠️</span>
                                {error}
                            </div>
                        )}

                        {success && (
                            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold animate-in slide-in-from-top-2 duration-300 flex items-center gap-3">
                                <span className="text-lg">✅</span>
                                {success}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full relative group overflow-hidden py-4 bg-emerald-500 disabled:opacity-50 text-white font-black rounded-2xl transition-all shadow-xl shadow-emerald-500/20 active:scale-[0.98] mt-4"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-teal-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                {loading ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ĐANG XỬ LÝ...
                                    </>
                                ) : (
                                    'CẬP NHẬT MẬT KHẨU'
                                )}
                            </span>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default PasswordModal;

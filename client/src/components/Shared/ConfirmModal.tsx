import React, { useState, useEffect } from 'react';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (inputValue?: string) => void;
    title: string;
    message: string;
    type?: 'confirm' | 'input';
    confirmLabel?: string;
    cancelLabel?: string;
    placeholder?: string;
    defaultValue?: string;
    variant?: 'danger' | 'info' | 'success';
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    type = 'confirm',
    confirmLabel = 'Xác nhận',
    cancelLabel = 'Hủy',
    placeholder = 'Nhập nội dung...',
    defaultValue = '',
    variant = 'info'
}) => {
    const [inputValue, setInputValue] = useState(defaultValue);

    useEffect(() => {
        if (isOpen) setInputValue(defaultValue);
    }, [isOpen, defaultValue]);

    if (!isOpen) return null;

    const variantStyles = {
        danger: 'bg-red-500 hover:bg-red-400 shadow-red-500/20 text-white',
        info: 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20 text-white',
        success: 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/20 text-white'
    };

    const variantIcon = {
        danger: '⚠️',
        info: 'ℹ️',
        success: '✅'
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onConfirm(type === 'input' ? inputValue : undefined);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="w-full max-w-md relative group overflow-hidden rounded-[40px] border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-300">
                {/* Cinematic Background Elements */}
                <div className="absolute inset-0 z-0">
                    <div className={`absolute top-0 left-0 w-full h-full bg-gradient-to-br ${variant === 'danger' ? 'from-red-600/10 via-slate-900 to-slate-950' : 'from-blue-600/10 via-slate-900 to-slate-950'} `} />
                    <div className={`absolute -top-24 -left-24 w-48 h-48 ${variant === 'danger' ? 'bg-red-500/10' : 'bg-blue-500/10'} rounded-full blur-[80px] animate-pulse`} />
                </div>

                <div className="relative z-10 p-8 md:p-10">
                    <div className="flex flex-col items-center text-center mb-8">
                        <div className={`w-20 h-20 rounded-3xl flex items-center justify-center text-3xl mb-6 border border-white/10 bg-white/5 animate-bounce-slow`}>
                            {variantIcon[variant]}
                        </div>
                        <h2 className="text-3xl font-black text-white tracking-tight mb-3 font-playfair">{title}</h2>
                        <p className="text-white/50 text-sm leading-relaxed max-w-[280px]">{message}</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {type === 'input' && (
                            <div className="relative group/input">
                                <input
                                    autoFocus
                                    type="text"
                                    required
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    placeholder={placeholder}
                                    className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 transition-all font-medium text-center"
                                />
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white font-black rounded-2xl transition-all border border-white/5 active:scale-95 text-xs uppercase tracking-widest"
                            >
                                {cancelLabel}
                            </button>
                            <button
                                type="submit"
                                className={`flex-1 py-4 font-black rounded-2xl transition-all shadow-xl active:scale-95 text-xs uppercase tracking-widest ${variantStyles[variant]}`}
                            >
                                {confirmLabel}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;

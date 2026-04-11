import React, { useState } from 'react';
import { ThemeMode } from './types';

interface SettingsPanelProps {
    showSettings: boolean;
    setShowSettings: (show: boolean) => void;
    theme: ThemeMode;
    setTheme: (theme: ThemeMode) => void;
    fontSize: number;
    setFontSize: (size: number) => void;
    fontFamily: string;
    setFontFamily: (family: string) => void;
    sleepTimer: number | null;
    setSleepTimer: (timer: number | null) => void;
    selectedVoice: string;
    setSelectedVoice: (voice: string) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
    showSettings, setShowSettings, theme, setTheme,
    fontSize, setFontSize, fontFamily, setFontFamily,
    sleepTimer, setSleepTimer, selectedVoice, setSelectedVoice
}) => {
    if (!showSettings) return null;
    return (
        <div className="fixed top-24 right-4 w-80 max-h-[70vh] bg-black/60 backdrop-blur-3xl border border-white/10 rounded-[32px] shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200 text-white flex flex-col">
            <div className="p-4 bg-white/10 border-b border-white/20 flex justify-between items-center flex-shrink-0">
                <h3 className="text-xl font-bold">&#x2699;&#xFE0F; Cài đặt</h3>
                <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white transition-colors">&#x2715;</button>
            </div>
            <div className="p-6 space-y-8 overflow-y-auto">
                {/* Giao diện */}
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-4">Giao diện</label>
                    <div className="grid grid-cols-4 gap-2">
                        {[
                            { id: 'midnight', label: '🌙', name: 'Tối' },
                            { id: 'sepia', label: '📜', name: 'Giấy' },
                            { id: 'emerald', label: '🌿', name: 'Dịu' },
                            { id: 'oled', label: '🕶️', name: 'Đen' }
                        ].map(t => (
                            <button key={t.id} onClick={() => { setTheme(t.id as ThemeMode); localStorage.setItem('reader_theme', t.id); }}
                                className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition-all ${theme === t.id ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                                title={t.name}>
                                <span className="text-lg">{t.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Cỡ chữ */}
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-4">Cỡ chữ</label>
                    <div className="flex items-center gap-4">
                        <button onClick={() => setFontSize(Math.max(12, fontSize - 2))} className="p-2 bg-white/5 rounded-lg hover:bg-white/10 flex-1 transition-colors">A-</button>
                        <span className="font-mono w-12 text-center">{fontSize}px</span>
                        <button onClick={() => setFontSize(Math.min(32, fontSize + 2))} className="p-2 bg-white/5 rounded-lg hover:bg-white/10 flex-1 transition-colors">A+</button>
                    </div>
                </div>

                {/* Kiểu chữ */}
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-4">Kiểu chữ</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setFontFamily('noto')} className={`p-2 rounded-lg border transition-all font-noto ${fontFamily === 'noto' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-white/5 border-white/10'}`}>Hiện đại</button>
                        <button onClick={() => setFontFamily('bookerly')} className={`p-2 rounded-lg border transition-all font-bookerly ${fontFamily === 'bookerly' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-white/5 border-white/10'}`}>Cổ điển</button>
                    </div>
                </div>

                {/* Giọng đọc */}
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-4">Giọng đọc</label>
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { id: 'vbee-n_hn_male_ngankechuyen_ytstable_vc', name: 'Ngạn', provider: 'Vbee', icon: '🎧' },
                            { id: 'vbee-s_sg_male_thientam_ytstable_vc', name: 'Thiên Tâm', provider: 'Vbee', icon: '🎤' },
                            { id: 'vbee-n_hanoi_female_nguyetnganhannha_story_vc', name: 'Nguyệt Nga', provider: 'Vbee', icon: '🌸' },
                            { id: 'vi-VN-Wavenet-A', name: 'Mai Chi', provider: 'Google', icon: '👩' },
                            { id: 'vi-VN-Wavenet-B', name: 'Minh Quang', provider: 'Google', icon: '👨‍💻' },
                            { id: 'gemini-Puck', name: 'Gemini Nam', provider: 'Google', icon: '✨', premium: true },
                            { id: 'gemini-Aoede', name: 'Gemini Nữ', provider: 'Google', icon: '💫', premium: true },
                            { id: 'azure-vi-VN-HoaiMyNeural', name: 'Hoài My', provider: 'Azure', icon: '🌸', premium: true },
                            { id: 'azure-vi-VN-NamMinhNeural', name: 'Nam Minh', provider: 'Azure', icon: '👨', premium: true },
                            // { id: 'minimax-male-qn-qingse', name: 'Thanh Phong', provider: 'MiniMax', icon: '🌊', premium: true },
                            // { id: 'minimax-female-shaonv', name: 'Hà My', provider: 'MiniMax', icon: '🌺', premium: true }
                        ].map(v => (
                            <button
                                key={v.id}
                                onClick={() => setSelectedVoice(v.id)}
                                className={`p-2 rounded-lg border text-[10px] font-bold transition-all flex items-center justify-between gap-2 ${selectedVoice === v.id ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                            >
                                <span className="flex flex-col items-start leading-tight">
                                    <span>{v.name}</span>
                                    <span className="text-[8px] opacity-60">{v.provider}{v.premium ? ' · Premium' : ''}</span>
                                </span>
                                <span className="text-lg">{v.icon}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Hẹn giờ tắt */}
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-4">Hẹn giờ tắt</label>
                    <div className="grid grid-cols-3 gap-2">
                        {[15, 30, 60].map(mins => (
                            <button
                                key={mins}
                                onClick={() => setSleepTimer(sleepTimer === mins * 60 ? null : mins * 60)}
                                className={`p-2 rounded-lg border transition-all ${sleepTimer === mins * 60 ? 'bg-orange-500/20 border-orange-500 text-orange-400' : 'bg-white/5 border-white/10'}`}
                            >
                                {mins}p
                            </button>
                        ))}
                    </div>
                    {sleepTimer !== null && (
                        <p className="text-center text-xs text-orange-400 mt-2 font-mono">
                            Còn lại: {Math.floor(sleepTimer / 60)}:{(sleepTimer % 60).toString().padStart(2, '0')}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SettingsPanel;

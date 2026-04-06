import React, { useState } from 'react';
import { ThemeMode } from './types';
import { getApiKeys, setApiKeys } from '../../services/ttsService';

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
    showSettings,
    setShowSettings,
    theme,
    setTheme,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    sleepTimer,
    setSleepTimer,
    selectedVoice,
    setSelectedVoice
}) => {
    const [showApiKeys, setShowApiKeys] = useState(false);
    const [keys, setKeys] = useState(getApiKeys);

    if (!showSettings) return null;

    const saveKeys = () => {
        setApiKeys(keys);
        setShowApiKeys(false);
    };

    return (
        <div className="fixed top-24 right-4 w-80 max-h-[70vh] bg-black/60 backdrop-blur-3xl border border-white/10 rounded-[32px] shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200 text-white flex flex-col">
            <div className="p-4 bg-white/10 border-b border-white/20 flex justify-between items-center flex-shrink-0">
                <h3 className="text-xl font-bold">⚙️ Cài đặt</h3>
                <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white transition-colors">✕</button>
            </div>
            <div className="p-6 space-y-8 overflow-y-auto">
                {/* Theme */}
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-4">Giao diện</label>
                    <div className="grid grid-cols-4 gap-2">
                        {[
                            { id: 'midnight', label: '🌙', name: 'Tối' },
                            { id: 'sepia', label: '📜', name: 'Giấy' },
                            { id: 'emerald', label: '🌿', name: 'Dịu' },
                            { id: 'oled', label: '🕶️', name: 'Đen' }
                        ].map(t => (
                            <button
                                key={t.id}
                                onClick={() => {
                                    setTheme(t.id as ThemeMode);
                                    localStorage.setItem('reader_theme', t.id);
                                }}
                                className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition-all ${theme === t.id ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                                title={t.name}
                            >
                                <span className="text-lg">{t.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Font Size */}
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-4">Cỡ chữ</label>
                    <div className="flex items-center gap-4">
                        <button onClick={() => setFontSize(Math.max(12, fontSize - 2))} className="p-2 bg-white/5 rounded-lg hover:bg-white/10 flex-1 transition-colors">A-</button>
                        <span className="font-mono w-12 text-center">{fontSize}px</span>
                        <button onClick={() => setFontSize(Math.min(32, fontSize + 2))} className="p-2 bg-white/5 rounded-lg hover:bg-white/10 flex-1 transition-colors">A+</button>
                    </div>
                </div>

                {/* Font Family */}
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-4">Kiểu chữ</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setFontFamily('noto')} className={`p-2 rounded-lg border transition-all font-noto ${fontFamily === 'noto' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-white/5 border-white/10'}`}>Hiện đại</button>
                        <button onClick={() => setFontFamily('bookerly')} className={`p-2 rounded-lg border transition-all font-bookerly ${fontFamily === 'bookerly' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-white/5 border-white/10'}`}>Cổ điển</button>
                    </div>
                </div>

                {/* Voice Selection */}
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-4">Giọng đọc</label>
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { id: 'vi-VN-Wavenet-B', name: 'Anh Quân', icon: '🧔‍♂️' },
                            { id: 'vi-VN-Wavenet-A', name: 'Mai Chi', icon: '👩‍🦰' },
                            { id: 'gemini-Puck', name: 'Gemini Nam', icon: '🤖', premium: true },
                            { id: 'gemini-Aoede', name: 'Gemini Nữ', icon: '🤖', premium: true },
                            { id: 'azure-vi-VN-HoaiMyNeural', name: 'Hoài My', icon: '👩‍🦰', premium: true },
                            { id: 'azure-vi-VN-NamMinhNeural', name: 'Nam Minh', icon: '🧔‍♂️', premium: true },
                            { id: 'minimax-male-qn-qingse', name: 'Thanh Phong', icon: '🧔‍♂️', premium: true },
                            { id: 'minimax-female-shaonv', name: 'Hà My', icon: '👩‍🦰', premium: true }
                        ].map(v => (
                            <button
                                key={v.id}
                                onClick={() => setSelectedVoice(v.id)}
                                className={`p-2 rounded-lg border text-[10px] font-bold transition-all flex items-center justify-between gap-2 ${selectedVoice === v.id ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                            >
                                <span className="flex flex-col items-start leading-tight">
                                    <span>{v.name}</span>
                                    {v.premium && <span className="text-[8px] opacity-60">
                                        {v.id.includes('azure') ? 'Azure ✨' : 
                                         v.id.includes('minimax') ? 'MiniMax ✨' : 'Gemini ✨'}
                                    </span>}
                                </span>
                                <span className="text-lg">{v.icon}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* API Keys */}
                <div>
                    <button
                        onClick={() => { setShowApiKeys(!showApiKeys); setKeys(getApiKeys()); }}
                        className="flex items-center justify-between w-full text-xs font-bold text-gray-400 uppercase tracking-widest mb-4"
                    >
                        <span>🔑 API Keys</span>
                        <span className={`text-[10px] transition-transform ${showApiKeys ? 'rotate-180' : ''}`}>▼</span>
                    </button>

                    {showApiKeys && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div>
                                <label className="text-[10px] text-gray-500 mb-1 block">Google Cloud API Key</label>
                                <input
                                    type="password"
                                    value={keys.googleKey}
                                    onChange={e => setKeys({ ...keys, googleKey: e.target.value })}
                                    placeholder="AIza..."
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-gray-500 mb-1 block">Azure Speech Key</label>
                                <input
                                    type="password"
                                    value={keys.azureKey}
                                    onChange={e => setKeys({ ...keys, azureKey: e.target.value })}
                                    placeholder="abc123..."
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-gray-500 mb-1 block">Azure Region</label>
                                <input
                                    type="text"
                                    value={keys.azureRegion}
                                    onChange={e => setKeys({ ...keys, azureRegion: e.target.value })}
                                    placeholder="southeastasia"
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-gray-500 mb-1 block">MiniMax API Key</label>
                                <input
                                    type="password"
                                    value={keys.minimaxKey || ''}
                                    onChange={e => setKeys({ ...keys, minimaxKey: e.target.value })}
                                    placeholder="sk-cp-..."
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-gray-500 mb-1 block">Gemini API Key</label>
                                <input
                                    type="password"
                                    value={keys.geminiKey || ''}
                                    onChange={e => setKeys({ ...keys, geminiKey: e.target.value })}
                                    placeholder="AIza..."
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                            <button
                                onClick={saveKeys}
                                className="w-full py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs font-bold hover:bg-emerald-500/30 transition-all"
                            >
                                💾 Lưu API Keys
                            </button>
                            <p className="text-[9px] text-gray-600 text-center">
                                Keys được lưu trên thiết bị của bạn
                            </p>
                        </div>
                    )}
                </div>

                {/* Sleep Timer */}
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

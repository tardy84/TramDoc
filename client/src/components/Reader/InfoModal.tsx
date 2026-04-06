import React from 'react';
import { ThemeMode } from './types';

interface InfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    theme?: ThemeMode;
}

const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, theme = 'dark' }) => {
    if (!isOpen) return null;

    const isSepia = theme === 'sepia';
    const bgClass = isSepia ? 'bg-[#f4ecd8] text-[#433429]' : 'bg-slate-900 text-white';
    const cardClass = isSepia ? 'bg-[#ebe1c9] border-[#d3c2a3]' : 'bg-white/5 border-white/10';

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-8 backdrop-blur-sm bg-black/40 animate-in fade-in duration-300">
            <div className={`relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-[32px] shadow-2xl border ${bgClass} ${isSepia ? 'border-[#d3c2a3]' : 'border-white/10'} p-8 md:p-12 animate-in zoom-in-95 duration-300 scrollbar-hide`}>

                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors"
                >
                    <span className="text-xl">✕</span>
                </button>

                <div className="flex items-center gap-4 mb-8">
                    <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/20">
                        📖
                    </div>
                    <div>
                        <h2 className="text-3xl font-black tracking-tight">Trạm Đọc</h2>
                        <p className="text-emerald-500 font-bold uppercase tracking-widest text-xs">Phiên bản 1.2 Stable</p>
                    </div>
                </div>

                <div className="space-y-8">
                    <section>
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] mb-4 opacity-50">✨ Có gì mới ở v1.2</h3>
                        <div className={`p-5 rounded-2xl border ${cardClass}`}>
                            <ul className="space-y-3 text-sm font-medium leading-relaxed">
                                <li className="flex gap-3">
                                    <span className="text-emerald-500">●</span>
                                    <span>Hỗ trợ nghe Offline hoàn chỉnh cho từng chương truyện.</span>
                                </li>
                                <li className="flex gap-3">
                                    <span className="text-emerald-500">●</span>
                                    <span>Giao diện bento hiện đại với khả năng chuyển đổi sách nhanh.</span>
                                </li>
                                <li className="flex gap-3">
                                    <span className="text-emerald-500">●</span>
                                    <span>Tự động đồng bộ hóa thư viện và xóa dữ liệu thừa.</span>
                                </li>
                            </ul>
                        </div>
                    </section>

                    <section className="space-y-6">
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] opacity-50">📖 Hướng dẫn sử dụng</h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <GuideStep
                                icon="☁️"
                                title="Tải sách"
                                desc="Hỗ trợ định dạng EPUB. File sẽ được phân tích và lưu trữ bảo mật trên đám mây của bạn."
                                cardClass={cardClass}
                            />
                            <GuideStep
                                icon="🎧"
                                title="Nghe rảnh tay"
                                desc="Bấm vào bất kỳ đoạn văn nào để bắt đầu nghe. App sẽ tự động chuyển câu và chuyển chương."
                                cardClass={cardClass}
                            />
                            <GuideStep
                                icon="💾"
                                title="Chế độ Offline"
                                desc="Mở tab Offline trong Thư viện và bấm 'Tải về' để nghe ngay cả khi không có mạng."
                                cardClass={cardClass}
                            />
                            <GuideStep
                                icon="🎨"
                                title="Cá nhân hóa"
                                desc="Thay đổi màu nền, font chữ và giọng đọc của nhiều nhà cung cấp (Google, Vbee, Browser)."
                                cardClass={cardClass}
                            />
                        </div>
                    </section>
                </div>

                <div className="mt-12 pt-8 border-t border-black/5 flex flex-col items-center opacity-30 italic text-xs text-center">
                    <p>Phát triển bởi Đội ngũ Trạm Đọc</p>
                    <p className="mt-1">© 2026 Toàn bộ bản quyền được bảo lưu.</p>
                </div>
            </div>
        </div>
    );
};

const GuideStep = ({ icon, title, desc, cardClass }: { icon: string, title: string, desc: string, cardClass: string }) => (
    <div className={`p-6 rounded-3xl border flex flex-col gap-3 ${cardClass} hover:scale-[1.02] transition-transform duration-300`}>
        <span className="text-2xl">{icon}</span>
        <h4 className="font-bold">{title}</h4>
        <p className="text-xs opacity-60 leading-relaxed">{desc}</p>
    </div>
);

export default InfoModal;

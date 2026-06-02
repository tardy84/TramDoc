import React from 'react';
import { ThemeMode, Chapter, Bookmark, Book } from './types';
import { deleteBookmark as deleteBookmarkApi } from '../../services/apiService';
import OfflineTtsPanel from './OfflineTtsPanel';
import {
    DEFAULT_OFFLINE_TTS_QUALITY,
    ENABLED_TTS_VOICES,
    OFFLINE_TTS_QUALITIES,
    OfflineTtsQuality,
    providerSupportsOfflineBitrate,
} from '../../constants';
import {
    ChapterOfflineStatus,
    deleteOfflineChapterAudio,
    downloadChapterAudioOffline,
    getChapterOfflineStatus,
    getOfflineChapterStorageUsage,
    setChapterOfflineStatus,
} from '../../services/offlineManager';

export type LibraryTab = 'toc' | 'bookmarks' | 'offline';

interface LibraryPanelProps {
    showLibrary: boolean;
    setShowLibrary: (show: boolean) => void;
    libraryTab: LibraryTab;
    setLibraryTab: (tab: LibraryTab) => void;
    theme: ThemeMode;
    book: Book | null;
    selectedVoice: string;
    setSelectedVoice: (voice: string) => void;
    chapters: Chapter[];
    currentChapterIndex: number;
    setCurrentChapterIndex: (index: number) => void;
    setCurrentSegmentIndex: (index: number) => void;
    bookmarks: Bookmark[];
    setBookmarks: React.Dispatch<React.SetStateAction<Bookmark[]>>;
    playAudio: (index: number) => void;
    generateAudio: (index: number) => void;
    audioFiles: string[];
    pendingSegmentRef: React.MutableRefObject<number | null>;
    fontFamily: string;
    bookId: number;
}

interface ConfirmDialogState {
    title: string;
    message: string;
    details?: string[];
    downloadOptions?: {
        voice: string;
        quality: OfflineTtsQuality;
    };
    confirmText: string;
    cancelText?: string;
    tone?: 'warning' | 'danger';
    onConfirm: (options?: { voice: string; quality: OfflineTtsQuality }) => void;
    onCancel: () => void;
}

const ConfirmDialog: React.FC<{ dialog: ConfirmDialogState }> = ({ dialog }) => {
    const [voice, setVoice] = React.useState(dialog.downloadOptions?.voice || '');
    const [quality, setQuality] = React.useState<OfflineTtsQuality>(dialog.downloadOptions?.quality || DEFAULT_OFFLINE_TTS_QUALITY);
    const supportsBitrate = voice ? providerSupportsOfflineBitrate(voice) : false;
    const effectiveQuality = supportsBitrate ? quality : DEFAULT_OFFLINE_TTS_QUALITY;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 px-5 backdrop-blur-md animate-in fade-in duration-150">
            <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-white/15 bg-slate-950 text-white shadow-2xl shadow-black/50 animate-in zoom-in-95 duration-150">
                <div className={`h-1 ${dialog.tone === 'danger' ? 'bg-red-400' : 'bg-cyan-400'}`} />
                <div className="p-5">
                    <div className="mb-4 flex items-start gap-3">
                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${dialog.tone === 'danger' ? 'bg-red-500/15 text-red-200' : 'bg-cyan-500/15 text-cyan-200'}`}>
                            {dialog.tone === 'danger' ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
                            )}
                        </div>
                        <div>
                            <h3 className="text-base font-black tracking-tight">{dialog.title}</h3>
                            <p className="mt-1 text-sm leading-relaxed text-slate-300">{dialog.message}</p>
                        </div>
                    </div>

                    {dialog.details && dialog.details.length > 0 && (
                        <div className="mb-4 space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-300">
                            {dialog.details.map(item => (
                                <div key={item} className="flex gap-2">
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                                    <span>{item}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {dialog.downloadOptions && (
                        <div className="mb-4 space-y-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-3">
                            <label className="block">
                                <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/80">Giọng đọc</span>
                                <select
                                    value={voice}
                                    onChange={(event) => setVoice(event.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-300"
                                >
                                    {ENABLED_TTS_VOICES.map(item => (
                                        <option key={item.id} value={item.id}>
                                            {item.name} · {item.provider}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/80">Chất lượng</span>
                                <select
                                    value={effectiveQuality}
                                    onChange={(event) => setQuality(event.target.value as OfflineTtsQuality)}
                                    disabled={!supportsBitrate}
                                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-300 disabled:opacity-60"
                                >
                                    {OFFLINE_TTS_QUALITIES.map(item => (
                                        <option key={item.id} value={item.id}>
                                            {item.label} · {item.bitrateKbps}kbps
                                        </option>
                                    ))}
                                </select>
                                {!supportsBitrate && (
                                    <span className="mt-1 block text-[11px] text-slate-400">Nhà cung cấp này dùng chất lượng mặc định.</span>
                                )}
                            </label>
                        </div>
                    )}

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={dialog.onCancel}
                            className="flex-1 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-slate-200 transition-colors hover:bg-white/15"
                        >
                            {dialog.cancelText || 'Huỷ'}
                        </button>
                        <button
                            type="button"
                            onClick={() => dialog.onConfirm(dialog.downloadOptions ? { voice, quality: effectiveQuality } : undefined)}
                            className={`flex-1 rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-lg transition-colors ${dialog.tone === 'danger' ? 'bg-red-500 shadow-red-500/20 hover:bg-red-400' : 'bg-cyan-500 shadow-cyan-500/20 hover:bg-cyan-400'}`}
                        >
                            {dialog.confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const isSpeakableContent = (content: string) => {
    const normalized = content
        .replace(/[\s\u00a0]+/g, '')
        .replace(/[*＊✱✲✳✴✻✼✽·•●○◆◇■□_—–~….-]+/g, '');
    return /[\p{L}\p{N}]/u.test(normalized);
};

const formatStorage = (bytes?: number) => {
    if (!bytes) return '';
    const mb = bytes / 1024 / 1024;
    if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const statusRank: Record<ChapterOfflineStatus['status'], number> = {
    downloading: 5,
    downloaded: 4,
    partial: 3,
    failed: 2,
    not_downloaded: 1,
};

const isVisibleStatus = (status: ChapterOfflineStatus) =>
    status.status !== 'not_downloaded';

const pickBestChapterStatus = (
    statuses: ChapterOfflineStatus[],
    preferredQuality: OfflineTtsQuality
) => {
    const preferred = statuses.find(status =>
        status.quality === preferredQuality &&
        isVisibleStatus(status)
    );
    if (preferred) return preferred;

    const fallback = statuses
        .filter(isVisibleStatus)
        .sort((a, b) => (
            statusRank[b.status] - statusRank[a.status] ||
            (b.updatedAt || 0) - (a.updatedAt || 0)
        ))[0];
    if (fallback) return fallback;

    return statuses.find(status => status.quality === preferredQuality) || statuses[0];
};

const LibraryPanel: React.FC<LibraryPanelProps> = ({
    showLibrary,
    setShowLibrary,
    libraryTab,
    setLibraryTab,
    theme,
    book,
    selectedVoice,
    setSelectedVoice,
    chapters,
    currentChapterIndex,
    setCurrentChapterIndex,
    setCurrentSegmentIndex,
    bookmarks,
    setBookmarks,
    playAudio,
    generateAudio,
    audioFiles,
    pendingSegmentRef,
    fontFamily,
    bookId
}) => {
    const [chapterStatuses, setChapterStatuses] = React.useState<Record<number, ChapterOfflineStatus>>({});
    const [chapterStorageUsage, setChapterStorageUsage] = React.useState<Record<number, number>>({});
    const [confirmDialog, setConfirmDialog] = React.useState<ConfirmDialogState | null>(null);
    const chapterAbortControllersRef = React.useRef<Record<number, AbortController>>({});
    const effectiveOfflineQuality = DEFAULT_OFFLINE_TTS_QUALITY;

    const refreshChapterStatuses = React.useCallback(async () => {
        if (!showLibrary || libraryTab !== 'toc') return;
        const statusAndUsage = await Promise.all(
            chapters.map(async chapter => {
                const statuses = await Promise.all(
                    OFFLINE_TTS_QUALITIES.map(item =>
                        getChapterOfflineStatus(bookId, chapter.id, selectedVoice, item.id)
                    )
                );
                const status = pickBestChapterStatus(statuses, effectiveOfflineQuality);
                const usage = status && isVisibleStatus(status)
                    ? await getOfflineChapterStorageUsage(bookId, chapter.id, status.voice, status.quality)
                    : 0;
                return { status, usage };
            })
        );
        setChapterStatuses(Object.fromEntries(statusAndUsage.map(item => [item.status.chapterId, item.status])));
        setChapterStorageUsage(Object.fromEntries(statusAndUsage.map(item => [item.status.chapterId, item.usage])));
    }, [bookId, chapters, effectiveOfflineQuality, libraryTab, selectedVoice, showLibrary]);

    React.useEffect(() => {
        refreshChapterStatuses().catch(err => console.error('[Offline chapter] Status refresh failed:', err));
    }, [refreshChapterStatuses]);

    const setChapterStatus = (status: ChapterOfflineStatus) => {
        setChapterStatuses(prev => ({ ...prev, [status.chapterId]: status }));
    };

    const refreshChapterStorageUsage = async (
        chapterId: number,
        voice = selectedVoice,
        quality = effectiveOfflineQuality
    ) => {
        const usage = await getOfflineChapterStorageUsage(bookId, chapterId, voice, quality);
        setChapterStorageUsage(prev => ({ ...prev, [chapterId]: usage }));
    };

    const confirmAction = (input: Omit<ConfirmDialogState, 'onConfirm' | 'onCancel'>) => new Promise<true | { voice: string; quality: OfflineTtsQuality } | false>(resolve => {
        setConfirmDialog({
            ...input,
            onConfirm: (options) => {
                setConfirmDialog(null);
                resolve(options || true);
            },
            onCancel: () => {
                setConfirmDialog(null);
                resolve(false);
            },
        });
    });

    const downloadChapter = async (chapter: Chapter) => {
        const existing = chapterStatuses[chapter.id];
        if (existing?.status === 'downloading') return;

        const downloadVoice = selectedVoice;
        const downloadQuality = DEFAULT_OFFLINE_TTS_QUALITY;
        localStorage.setItem('offline_tts_quality', downloadQuality);

        const downloadExisting = await getChapterOfflineStatus(bookId, chapter.id, downloadVoice, downloadQuality);

        const abortController = new AbortController();
        chapterAbortControllersRef.current[chapter.id] = abortController;
        const now = Date.now();
        const totalSegments = chapter.segments.filter(segment => isSpeakableContent(segment.content)).length;
        const initialStatus: ChapterOfflineStatus = {
            key: `${bookId}_${chapter.id}_${downloadVoice}_${downloadQuality}`,
            bookId,
            chapterId: chapter.id,
            voice: downloadVoice,
            quality: downloadQuality,
            totalSegments,
            downloadedSegments: downloadExisting.downloadedSegments ?? 0,
            failedSegments: 0,
            status: 'downloading',
            updatedAt: now,
        };
        setChapterStatus(initialStatus);
        await setChapterOfflineStatus(initialStatus);

        try {
            await downloadChapterAudioOffline(bookId, chapter.id, downloadVoice, downloadQuality, (completed, total) => {
                setChapterStatus({
                    key: `${bookId}_${chapter.id}_${downloadVoice}_${downloadQuality}`,
                    bookId,
                    chapterId: chapter.id,
                    voice: downloadVoice,
                    quality: downloadQuality,
                    totalSegments: total,
                    downloadedSegments: completed,
                    failedSegments: 0,
                    status: completed >= total ? 'downloaded' : 'downloading',
                    downloadedAt: completed >= total ? Date.now() : undefined,
                    updatedAt: Date.now(),
                });
            }, abortController.signal);
            const latest = await getChapterOfflineStatus(bookId, chapter.id, downloadVoice, downloadQuality);
            setChapterStatus(latest);
            await refreshChapterStorageUsage(chapter.id, downloadVoice, downloadQuality);
        } catch (err) {
            if (!abortController.signal.aborted) {
                console.error('[Offline chapter] Download failed:', err);
            }
            const latest = await getChapterOfflineStatus(bookId, chapter.id, downloadVoice, downloadQuality);
            const nextStatus: ChapterOfflineStatus = latest.downloadedSegments > 0
                ? { ...latest, status: 'partial', updatedAt: Date.now() }
                : { ...latest, status: abortController.signal.aborted ? 'not_downloaded' : 'failed', totalSegments, updatedAt: Date.now() };
            setChapterStatus(nextStatus);
            await setChapterOfflineStatus(nextStatus);
            await refreshChapterStorageUsage(chapter.id, downloadVoice, downloadQuality);
        } finally {
            delete chapterAbortControllersRef.current[chapter.id];
        }
    };

    const cancelChapterDownload = async (chapterId: number, status?: ChapterOfflineStatus) => {
        const statusVoice = status?.voice || selectedVoice;
        const statusQuality = status?.quality || effectiveOfflineQuality;
        chapterAbortControllersRef.current[chapterId]?.abort();
        const latest = await getChapterOfflineStatus(bookId, chapterId, statusVoice, statusQuality);
        const nextStatus: ChapterOfflineStatus = latest.downloadedSegments > 0
            ? { ...latest, status: 'partial', updatedAt: Date.now() }
            : { ...latest, status: 'not_downloaded', updatedAt: Date.now() };
        setChapterStatus(nextStatus);
        await setChapterOfflineStatus(nextStatus);
    };

    const deleteChapterAudio = async (chapterId: number, status?: ChapterOfflineStatus) => {
        const chapter = chapters.find(item => item.id === chapterId);
        const statusVoice = status?.voice || selectedVoice;
        const statusQuality = status?.quality || effectiveOfflineQuality;
        const confirmed = await confirmAction({
            title: 'Xoá audio offline?',
            message: 'Chỉ audio của chương này, giọng này và chất lượng này bị xoá. Metadata sách và các chương khác vẫn được giữ lại.',
            details: [
                chapter?.title || `Chương ${chapterId}`,
                `Giọng: ${statusVoice}`,
                `Chất lượng: ${statusQuality}`,
            ],
            confirmText: 'Xoá audio',
            tone: 'danger',
        });
        if (!confirmed) return;

        await deleteOfflineChapterAudio(bookId, chapterId, statusVoice, statusQuality);
        const latest = await getChapterOfflineStatus(bookId, chapterId, selectedVoice, effectiveOfflineQuality);
        setChapterStatus(latest);
        await refreshChapterStorageUsage(chapterId);
    };

    const getChapterStatusCopy = (status?: ChapterOfflineStatus) => {
        if (!status || status.status === 'not_downloaded') return { label: 'Chưa tải', action: 'Tải chương' };
        if (status.status === 'downloading') return { label: `Đang chuẩn bị ${status.downloadedSegments}/${status.totalSegments || '?'}`, action: 'Huỷ tải' };
        const storage = formatStorage(chapterStorageUsage[status.chapterId]);
        const qualityLabel = OFFLINE_TTS_QUALITIES.find(item => item.id === status.quality)?.label || status.quality;
        const qualitySuffix = providerSupportsOfflineBitrate(status.voice) && status.quality !== DEFAULT_OFFLINE_TTS_QUALITY
            ? ` · ${qualityLabel}`
            : '';
        const suffix = `${qualitySuffix}${storage ? ` · ${storage}` : ''}`;
        if (status.status === 'downloaded') return { label: `Đã tải${suffix}`, action: 'Xoá audio' };
        if (status.status === 'partial') return { label: `Tải một phần ${status.downloadedSegments}/${status.totalSegments || '?'}${suffix}`, action: 'Tải tiếp' };
        return { label: 'Lỗi', action: 'Tải lại' };
    };

    if (!showLibrary) return null;

    return (
        <>
        <div className={`fixed top-20 right-4 w-80 md:w-96 rounded-[32px] shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200 border ${theme === 'sepia' ? 'bg-[#ebe1c9] border-[#d3c2a3]' : 'bg-black/95 border-white/20'}`}>
            {/* Tabs */}
            <div className={`flex border-b ${theme === 'sepia' ? 'border-[#d3c2a3]' : 'border-white/10'}`}>
                <button
                    onClick={() => setLibraryTab('toc')}
                    className={`flex-1 py-4 flex items-center justify-center transition-all ${libraryTab === 'toc' ? (theme === 'sepia' ? 'bg-[#d3c2a3] text-[#433429]' : 'bg-white/10 text-white') : 'opacity-40 hover:opacity-100'}`}
                    title="Mục lục"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                </button>
                <button
                    onClick={() => setLibraryTab('bookmarks')}
                    className={`flex-1 py-4 flex items-center justify-center transition-all ${libraryTab === 'bookmarks' ? 'bg-emerald-500/20 text-emerald-500' : 'opacity-40 hover:opacity-100'}`}
                    title="Dấu trang"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
                </button>
                <button
                    onClick={() => setLibraryTab('offline')}
                    className={`flex-1 py-4 flex items-center justify-center transition-all ${libraryTab === 'offline' ? 'bg-cyan-500/20 text-cyan-300' : 'opacity-40 hover:opacity-100'}`}
                    title="Nghe offline"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
                </button>

                <button onClick={() => setShowLibrary(false)} className="px-4 flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </div>

            <div className="h-[480px] overflow-y-auto no-scrollbar">
                {libraryTab === 'toc' ? (
                    <div className="p-2 space-y-1 pb-10">
                        {chapters.map((chapter, index) => {
                            const status = chapterStatuses[chapter.id];
                            const copy = getChapterStatusCopy(status);
                            const isCurrent = index === currentChapterIndex;
                            const isDownloading = status?.status === 'downloading';
                            const hasDownloadedAudio = status?.status === 'downloaded' || status?.status === 'partial';

                            return (
                                <div
                                    key={chapter.id}
                                    className={`w-full rounded-xl transition-all group ${isCurrent ? (theme === 'sepia' ? 'bg-[#d3c2a3] text-[#433429]' : 'bg-blue-500/20 text-blue-400') : 'hover:bg-white/5 opacity-80 hover:opacity-100'}`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCurrentChapterIndex(index);
                                            setCurrentSegmentIndex(0);
                                            setShowLibrary(false);
                                        }}
                                        className="flex w-full items-center justify-between px-6 pt-2 text-left"
                                    >
                                        <span className={`text-sm font-bold truncate ${fontFamily === 'bookerly' ? 'font-serif' : 'font-sans'}`}>
                                            {index === 0
                                                ? 'Bìa sách'
                                                : (/^Chapter \d+$/i.test(chapter.title) ? '' : chapter.title)
                                            }
                                        </span>
                                        {isCurrent && (
                                            <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse shadow-[0_0_8px_currentColor]" />
                                        )}
                                    </button>
                                    <div className="flex items-center justify-between gap-2 px-6 pb-2 pt-1">
                                        <span className="truncate text-[10px] text-white/45">{copy.label}</span>
                                        <div className="flex shrink-0 items-center gap-2">
                                            {hasDownloadedAudio && (
                                                <button
                                                    type="button"
                                                    onClick={() => deleteChapterAudio(chapter.id, status)}
                                                    className="text-[10px] font-bold text-red-300/70 hover:text-red-200"
                                                >
                                                    Xoá audio
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => isDownloading ? cancelChapterDownload(chapter.id, status) : downloadChapter(chapter)}
                                                className="rounded-lg bg-cyan-500/15 px-2 py-1 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/25"
                                            >
                                                {isDownloading ? 'Huỷ tải' : copy.action === 'Xoá audio' ? 'Tải lại' : copy.action}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : libraryTab === 'bookmarks' ? (
                    <div className="p-4 space-y-4 pb-10">
                        {bookmarks.length === 0 ? (
                            <div className="py-20 text-center opacity-40 text-sm">Chưa có dấu trang nào</div>
                        ) : (
                            bookmarks.map((bookmark) => (
                                <div key={bookmark.id} className={`rounded-2xl p-4 border transition-all group ${theme === 'sepia' ? 'bg-amber-900/5 border-amber-900/10' : 'bg-white/5 border-white/5'}`}>
                                    <div
                                        onClick={() => {
                                            const chapterIdx = chapters.findIndex(c => c.id === bookmark.chapterId);
                                            if (chapterIdx !== -1) {
                                                const chapter = chapters[chapterIdx];
                                                const segmentIdx = chapter.segments.findIndex(s => s.id === bookmark.segmentId);
                                                if (segmentIdx !== -1) {
                                                    if (chapterIdx === currentChapterIndex) {
                                                        setCurrentSegmentIndex(segmentIdx);
                                                        if (audioFiles.length > 0) playAudio(segmentIdx);
                                                        else generateAudio(segmentIdx);
                                                    } else {
                                                        pendingSegmentRef.current = segmentIdx;
                                                        setCurrentChapterIndex(chapterIdx);
                                                    }
                                                    setShowLibrary(false);
                                                }
                                            }
                                        }}
                                        className="cursor-pointer"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-[10px] font-black uppercase text-yellow-500/70">{bookmark.chapter?.title}</span>
                                            <span className="text-[9px] opacity-40">{new Date(bookmark.createdAt).toLocaleDateString()}</span>
                                        </div>
                                        <p className={`text-sm italic line-clamp-3 ${theme === 'sepia' ? 'text-[#5b4636]' : 'text-gray-300'}`}>"{bookmark.previewText}"</p>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            try {
                                                await deleteBookmarkApi(bookmark.id);
                                                setBookmarks(prev => prev.filter(b => b.id !== bookmark.id));
                                            } catch (err) {
                                                console.error('Failed to delete bookmark:', err);
                                            }
                                        }}
                                        className="mt-3 text-[10px] font-bold text-red-400/60 hover:text-red-400 transition-colors uppercase tracking-widest"
                                    >
                                        Xóa dấu trang
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                ) : libraryTab === 'offline' ? (
                    <div className="p-4 pb-10">
                        {book ? (
                            <OfflineTtsPanel book={book} selectedVoice={selectedVoice} setSelectedVoice={setSelectedVoice} />
                        ) : (
                            <div className="py-20 text-center opacity-40 text-sm">Không tìm thấy sách.</div>
                        )}
                    </div>
                ) : null}
            </div>
        </div >
        {confirmDialog && <ConfirmDialog dialog={confirmDialog} />}
        </>
    );
};

export default LibraryPanel;

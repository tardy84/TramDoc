import { useEffect, useRef, useState } from 'react';
import { Book } from './types';
import {
    DEFAULT_OFFLINE_TTS_QUALITY,
    ENABLED_TTS_VOICES,
    getOfflineTtsQualityConfig,
    getStoredOfflineTtsQuality,
    OfflineTtsQuality,
    OFFLINE_TTS_QUALITIES,
    isExpensiveTtsVoice,
    providerSupportsOfflineBitrate,
} from '../../constants';
import {
    cancelBookTtsJob,
    getBookTtsStatus,
    getBookTtsJob,
    regenerateSegmentTts,
    startBookTtsJob,
    TtsBookCacheStatus,
    TtsBookJobProgress,
} from '../../services/apiService';
import {
    deleteOfflineAudioSegment,
    deleteOfflineVoice,
    downloadChapterAudioOffline,
    getOfflineVoiceStorageUsage,
    saveBookOffline,
} from '../../services/offlineManager';
import { getErrorMessage } from '../../utils/errors';

interface OfflineTtsPanelProps {
    book: Book;
    selectedVoice: string;
    setSelectedVoice: (voice: string) => void;
}

type OfflinePhase = 'idle' | 'generating' | 'downloading' | 'done' | 'cancelled' | 'error';

const pollDelay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;

const isSpeakableContent = (content: string) => {
    const normalized = content
        .replace(/[\s\u00a0]+/g, '')
        .replace(/[*＊✱✲✳✴✻✼✽·•●○◆◇■□_—–~….-]+/g, '');
    return /[\p{L}\p{N}]/u.test(normalized);
};

const estimateOfflineStorageMb = (book: Book, minMbPerHour: number, maxMbPerHour = minMbPerHour) => {
    const chars = book.chapters.reduce((sum, chapter) => (
        sum + chapter.segments.reduce((chapterSum, segment) => (
            chapterSum + (isSpeakableContent(segment.content) ? segment.content.length : 0)
        ), 0)
    ), 0);
    const minHours = chars / 1200 / 60;
    const maxHours = chars / 800 / 60;
    return {
        chars,
        min: Math.ceil(minHours * minMbPerHour),
        max: Math.ceil(maxHours * maxMbPerHour),
    };
};

export default function OfflineTtsPanel({ book, selectedVoice, setSelectedVoice }: OfflineTtsPanelProps) {
    const [phase, setPhase] = useState<OfflinePhase>('idle');
    const [job, setJob] = useState<TtsBookJobProgress | null>(null);
    const [cacheStatus, setCacheStatus] = useState<TtsBookCacheStatus | null>(null);
    const [downloadProgress, setDownloadProgress] = useState({ completed: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);
    const [quality, setQuality] = useState<OfflineTtsQuality>(getStoredOfflineTtsQuality);
    const [offlineUsageBytes, setOfflineUsageBytes] = useState(0);
    const cancelRequestedRef = useRef(false);
    const downloadAbortRef = useRef<AbortController | null>(null);

    const isBusy = phase === 'generating' || phase === 'downloading';
    const isExpensiveProvider = isExpensiveTtsVoice(selectedVoice);
    const supportsBitrate = providerSupportsOfflineBitrate(selectedVoice);
    const effectiveQuality = supportsBitrate ? quality : DEFAULT_OFFLINE_TTS_QUALITY;
    const voiceLabel = ENABLED_TTS_VOICES.find(item => item.id === selectedVoice)?.name || selectedVoice;
    const qualityConfig = getOfflineTtsQualityConfig(effectiveQuality);
    const estimate = supportsBitrate
        ? estimateOfflineStorageMb(book, qualityConfig.mbPerHour)
        : estimateOfflineStorageMb(
            book,
            getOfflineTtsQualityConfig('standard').mbPerHour,
            getOfflineTtsQualityConfig('high').mbPerHour
        );
    const estimateText = `${estimate.min}–${estimate.max} MB`;
    const generationDone = job ? job.cachedSegments + job.generatedSegments + job.failedSegments : 0;
    const generationTotal = job?.totalSegments ?? 0;
    const generationPercent = generationTotal > 0 ? Math.round((generationDone / generationTotal) * 100) : 0;
    const downloadPercent = downloadProgress.total > 0
        ? Math.round((downloadProgress.completed / downloadProgress.total) * 100)
        : 0;
    const cachePercent = cacheStatus && cacheStatus.total > 0
        ? Math.round((cacheStatus.cached / cacheStatus.total) * 100)
        : 0;

    useEffect(() => {
        let cancelled = false;

        const loadCacheStatus = async () => {
            try {
                const status = await getBookTtsStatus(book.id, selectedVoice, effectiveQuality);
                if (!cancelled) setCacheStatus(status);
            } catch (err) {
                if (!cancelled) {
                    console.error('[Offline TTS] Cache status failed:', err);
                    setCacheStatus(null);
                }
            }
        };

        loadCacheStatus();

        return () => {
            cancelled = true;
        };
    }, [book.id, selectedVoice, effectiveQuality]);

    useEffect(() => {
        if (!supportsBitrate && quality !== DEFAULT_OFFLINE_TTS_QUALITY) {
            setQuality(DEFAULT_OFFLINE_TTS_QUALITY);
        }
    }, [quality, supportsBitrate]);

    useEffect(() => {
        localStorage.setItem('offline_tts_quality', quality);
    }, [quality]);

    const refreshOfflineUsage = async () => {
        const usage = await getOfflineVoiceStorageUsage(book.id, selectedVoice, effectiveQuality);
        setOfflineUsageBytes(usage);
    };

    useEffect(() => {
        let cancelled = false;
        getOfflineVoiceStorageUsage(book.id, selectedVoice, effectiveQuality)
            .then(usage => {
                if (!cancelled) setOfflineUsageBytes(usage);
            })
            .catch(err => console.error('[Offline TTS] Usage failed:', err));
        return () => {
            cancelled = true;
        };
    }, [book.id, selectedVoice, effectiveQuality]);

    const updateJobState = (nextJob: TtsBookJobProgress | null) => {
        setJob(nextJob);
    };

    const pollUntilDone = async (bookId: number, jobId: string) => {
        while (!cancelRequestedRef.current) {
            await pollDelay(2000);
            if (cancelRequestedRef.current) return null;
            const latest = await getBookTtsJob(bookId, jobId);
            updateJobState(latest);

            if (latest.status === 'completed') return latest;
            if (latest.status === 'cancelled') return null;
            if (latest.status === 'failed') {
                throw new Error(latest.error || 'Không tạo được giọng đọc offline.');
            }
        }

        return null;
    };

    const downloadBookAudio = async () => {
        setPhase('downloading');
        let completed = 0;
        let total = 0;
        const downloadAbort = new AbortController();
        downloadAbortRef.current = downloadAbort;
        setDownloadProgress({ completed, total });

        try {
            for (const chapter of book.chapters) {
                if (cancelRequestedRef.current) return false;
                let chapterCompleted = 0;
                let chapterTotal = 0;

                const result = await downloadChapterAudioOffline(book.id, chapter.id, selectedVoice, effectiveQuality, (current, currentTotal) => {
                    chapterCompleted = current;
                    chapterTotal = currentTotal;
                    setDownloadProgress({ completed: completed + chapterCompleted, total: total + chapterTotal });
                }, downloadAbort.signal);

                completed += result.completed;
                total += result.total;
                setDownloadProgress({ completed, total });
            }
        } catch (err) {
            if (cancelRequestedRef.current || downloadAbort.signal.aborted) return false;
            throw err;
        } finally {
            if (downloadAbortRef.current === downloadAbort) {
                downloadAbortRef.current = null;
            }
        }

        return true;
    };

    const startOfflineDownload = async () => {
        if (isBusy) return;

        cancelRequestedRef.current = false;
        setError(null);
        updateJobState(null);
        setDownloadProgress({ completed: 0, total: 0 });
        setPhase('generating');

        try {
            // Pre-flight cost meter: characters are exact (from the DB), audio minutes use
            // this voice's measured narration speed when available, and a dollar figure only
            // appears when the provider has a known per-character rate.
            const costEstimate = cacheStatus?.estimate;
            const costLine = costEstimate && costEstimate.characters > 0
                ? [
                    `Còn phải tạo: ${costEstimate.characters.toLocaleString('vi-VN')} ký tự`,
                    costEstimate.estimatedSeconds ? `≈ ${Math.max(1, Math.round(costEstimate.estimatedSeconds / 60))} phút audio` : '',
                    costEstimate.estimatedCostUsd !== null
                        ? `≈ $${costEstimate.estimatedCostUsd.toFixed(2)} (${costEstimate.ratePerMillionChars}$/1 triệu ký tự${costEstimate.rateSource ? ` · ${costEstimate.rateSource}` : ''})`
                        : 'chưa có đơn giá cho giọng này, chỉ hiện ký tự/thời lượng',
                    costEstimate.secondsFromMeasuredAudio ? 'thời lượng theo tốc độ đọc thực của sách' : '',
                ].filter(Boolean).join(' · ')
                : '';

            const confirmed = window.confirm([
                'Tải giọng đọc offline cho toàn bộ sách?',
                '',
                `Giọng: ${voiceLabel}`,
                `Chất lượng: ${supportsBitrate ? `${qualityConfig.label} (${qualityConfig.bitrateKbps}kbps)` : 'mặc định của nhà cung cấp'}`,
                `Dung lượng ước tính trên máy: ${supportsBitrate ? estimateText : `${estimateText} (tham khảo)`}`,
                costLine,
                isExpensiveProvider ? 'Lưu ý: Vbee/MiniMax/Grok có thể dùng nhiều quota.' : '',
            ].filter(Boolean).join('\n'));
            if (!confirmed) {
                setPhase('idle');
                return;
            }

            await saveBookOffline(book);
            if (cancelRequestedRef.current) {
                setPhase('cancelled');
                return;
            }

            const startedJob = await startBookTtsJob(book.id, selectedVoice, 'missing', isExpensiveProvider, effectiveQuality);
            updateJobState(startedJob);
            if (cancelRequestedRef.current) {
                await cancelBookTtsJob(book.id, startedJob.jobId);
                setPhase('cancelled');
                return;
            }

            const completedJob = await pollUntilDone(book.id, startedJob.jobId);
            if (!completedJob || cancelRequestedRef.current) {
                setPhase('cancelled');
                return;
            }

            const downloaded = await downloadBookAudio();
            if (downloaded) {
                setCacheStatus(await getBookTtsStatus(book.id, selectedVoice, effectiveQuality));
                await refreshOfflineUsage();
            }
            setPhase(downloaded ? 'done' : 'cancelled');
        } catch (err) {
            console.error('[Offline TTS] Failed:', err);
            setError(getErrorMessage(err, 'Không tải được giọng đọc offline.'));
            setPhase('error');
        }
    };

    const cancelOfflineDownload = async () => {
        cancelRequestedRef.current = true;
        downloadAbortRef.current?.abort();
        if (job && (job.status === 'queued' || job.status === 'running')) {
            try {
                const cancelled = await cancelBookTtsJob(book.id, job.jobId);
                updateJobState(cancelled);
            } catch (err) {
                console.error('[Offline TTS] Cancel failed:', err);
            }
        }
        setPhase('cancelled');
    };

    const deleteSelectedOfflineVoice = async () => {
        if (isBusy || offlineUsageBytes <= 0) return;

        const confirmed = window.confirm(`Xoá audio offline của "${voiceLabel}" (${supportsBitrate ? qualityConfig.label : 'provider default'})? Metadata sách vẫn được giữ lại.`);
        if (!confirmed) return;

        await deleteOfflineVoice(book.id, selectedVoice, effectiveQuality);
        await refreshOfflineUsage();
    };

    const staleChapters = (cacheStatus?.chapters ?? []).filter(chapter => (chapter.hintsStaleIndexes?.length ?? 0) > 0);
    const staleSegmentCount = staleChapters.reduce((sum, chapter) => sum + (chapter.hintsStaleIndexes?.length ?? 0), 0);

    /**
     * Audio recorded before a prosody change still plays, but at the old pace/tone.
     * Regenerate exactly those segments, drop their local copies and re-download the
     * affected chapters so offline playback matches the current settings too.
     */
    const regenerateStaleAudio = async () => {
        if (isBusy || staleSegmentCount === 0) return;

        const confirmed = window.confirm([
            `Tạo lại ${staleSegmentCount} đoạn audio ở ${staleChapters.length} chương?`,
            '',
            'Các đoạn này được tạo bằng tốc độ/giọng đọc cũ nên nghe lệch so với cài đặt hiện tại.',
            isExpensiveProvider ? 'Vbee/MiniMax/Grok sẽ tốn quota tương ứng.' : '',
            'Audio mới sẽ được tải lại vào máy cho những đoạn này.',
        ].filter(Boolean).join('\n'));
        if (!confirmed) return;

        cancelRequestedRef.current = false;
        setError(null);
        setPhase('generating');
        try {
            for (const chapter of staleChapters) {
                for (const segmentIndex of chapter.hintsStaleIndexes ?? []) {
                    if (cancelRequestedRef.current) {
                        setPhase('cancelled');
                        return;
                    }
                    await regenerateSegmentTts(book.id, chapter.chapterId, selectedVoice, segmentIndex);
                    await deleteOfflineAudioSegment(book.id, chapter.chapterId, selectedVoice, segmentIndex, effectiveQuality);
                }
                await downloadChapterAudioOffline(book.id, chapter.chapterId, selectedVoice, effectiveQuality, undefined, undefined);
            }
            setCacheStatus(await getBookTtsStatus(book.id, selectedVoice, effectiveQuality));
            await refreshOfflineUsage();
            setPhase('done');
        } catch (err) {
            console.error('[Offline TTS] Regenerate stale audio failed:', err);
            setError(getErrorMessage(err, 'Không tạo lại được các đoạn audio cũ.'));
            setPhase('error');
        }
    };

    return (
        <div className="rounded-2xl border border-white/10 bg-slate-950/85 p-4 text-sm text-white shadow-xl backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="font-bold">Nghe offline</div>
                    <div className="mt-1 text-xs text-white/60">
                        {phase === 'idle' && 'Tạo và lưu giọng đọc đã chọn cho toàn bộ sách.'}
                        {phase === 'generating' && 'Đang tạo giọng đọc...'}
                        {phase === 'downloading' && 'Đang lưu vào máy...'}
                        {phase === 'done' && 'Đã sẵn sàng nghe offline'}
                        {phase === 'cancelled' && 'Đã huỷ tải giọng đọc offline.'}
                        {phase === 'error' && (error || 'Có lỗi khi tải offline.')}
                    </div>
                </div>
                {isBusy ? (
                    <button
                        type="button"
                        onClick={cancelOfflineDownload}
                        className="rounded-xl border border-red-400/40 px-3 py-1.5 text-xs font-bold text-red-200 hover:bg-red-500/20"
                    >
                        Huỷ
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={startOfflineDownload}
                        className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
                    >
                        Tải giọng đọc offline
                    </button>
                )}
            </div>

            <div className="mt-4 space-y-3 rounded-xl bg-white/5 p-3">
                <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-white/50">Giọng đã chọn</div>
                    <select
                        value={selectedVoice}
                        disabled={isBusy}
                        onChange={(event) => setSelectedVoice(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {ENABLED_TTS_VOICES.map(item => (
                            <option key={item.id} value={item.id}>
                                {item.name} · {item.provider}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/50">Chất lượng offline</div>
                    <div className="grid grid-cols-3 gap-2">
                        {OFFLINE_TTS_QUALITIES.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                disabled={isBusy || !supportsBitrate}
                                onClick={() => setQuality(item.id)}
                                className={`rounded-lg border px-2 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${effectiveQuality === item.id ? 'border-cyan-300 bg-cyan-400/20 text-cyan-100' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'}`}
                            >
                                <div>{item.label}</div>
                                <div className="text-[10px] opacity-70">{item.bitrateKbps}kbps</div>
                            </button>
                        ))}
                    </div>
                    {!supportsBitrate && (
                        <div className="mt-2 text-[11px] text-amber-100/80">
                            Nhà cung cấp này chưa hỗ trợ đổi bitrate; file sẽ dùng chất lượng mặc định của nhà cung cấp.
                        </div>
                    )}
                </div>

                <div className="rounded-lg bg-slate-900/70 px-3 py-2 text-xs text-white/70">
                    {supportsBitrate ? 'Ước tính cần ' : 'Ước tính tham khảo '}
                    <span className="font-bold text-white">{estimateText}</span> cho giọng này
                    <span className="text-white/40"> · khoảng {estimate.chars.toLocaleString('vi-VN')} ký tự</span>
                </div>

                {cacheStatus?.estimate && cacheStatus.estimate.characters > 0 && (
                    <div className="rounded-lg bg-slate-900/70 px-3 py-2 text-xs text-white/70">
                        Còn phải tạo{' '}
                        <span className="font-bold text-white">{cacheStatus.estimate.characters.toLocaleString('vi-VN')}</span> ký tự
                        {cacheStatus.estimate.estimatedSeconds ? (
                            <> · ≈ <span className="font-bold text-white">{Math.max(1, Math.round(cacheStatus.estimate.estimatedSeconds / 60))}</span> phút audio</>
                        ) : null}
                        {cacheStatus.estimate.estimatedCostUsd !== null ? (
                            <> · ≈ <span className="font-bold text-emerald-200">${cacheStatus.estimate.estimatedCostUsd.toFixed(2)}</span>
                                <span className="text-white/40"> ({cacheStatus.estimate.ratePerMillionChars}$/1 triệu ký tự)</span>
                            </>
                        ) : (
                            <span className="text-white/40"> · chưa có đơn giá cho giọng này</span>
                        )}
                        {cacheStatus.estimate.secondsFromMeasuredAudio && (
                            <div className="mt-1 text-[11px] text-white/40">Thời lượng tính theo tốc độ đọc thực của sách này.</div>
                        )}
                    </div>
                )}

                {staleSegmentCount > 0 && (
                    <div className="rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                        <div>
                            <span className="font-bold">{staleSegmentCount} đoạn</span> ở {staleChapters.length} chương đang dùng audio tạo bằng tốc độ/giọng đọc cũ.
                        </div>
                        <button
                            type="button"
                            disabled={isBusy}
                            onClick={regenerateStaleAudio}
                            className="mt-2 rounded-lg border border-amber-200/40 px-2 py-1 font-bold text-amber-100 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-amber-400/20"
                        >
                            Tạo lại audio cho khớp
                        </button>
                    </div>
                )}

                <div className="flex items-center justify-between gap-3 text-xs text-white/60">
                    <span>Đã lưu trên máy: {formatMb(offlineUsageBytes)}</span>
                    <button
                        type="button"
                        disabled={isBusy || offlineUsageBytes <= 0}
                        onClick={deleteSelectedOfflineVoice}
                        className="rounded-lg border border-red-400/30 px-2 py-1 font-bold text-red-200 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-red-500/20"
                    >
                        Xoá giọng này
                    </button>
                </div>
            </div>

            {isExpensiveProvider && phase === 'idle' && (
                <div className="mt-3 rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                    Tạo giọng đọc cho toàn bộ sách có thể dùng nhiều quota. Tiếp tục khi có Wi‑Fi.
                </div>
            )}

            {phase === 'idle' && cacheStatus && (
                <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-white/70">
                        <span>Cache trên máy chủ</span>
                        <span>{cacheStatus.cached}/{cacheStatus.total}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full bg-violet-400 transition-all" style={{ width: `${cachePercent}%` }} />
                    </div>
                    {(cacheStatus.missing > 0 || cacheStatus.stale > 0) && (
                        <div className="text-[11px] text-white/50">
                            Thiếu {cacheStatus.missing} · cũ {cacheStatus.stale}
                        </div>
                    )}
                </div>
            )}

            {phase === 'generating' && job && (
                <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-white/70">
                        <span>{job.currentChapterTitle || 'Đang chuẩn bị...'}</span>
                        <span>{generationDone}/{generationTotal}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full bg-emerald-400 transition-all" style={{ width: `${generationPercent}%` }} />
                    </div>
                    <div className="text-[11px] text-white/50">
                        Cache {job.cachedSegments} · tạo mới {job.generatedSegments} · lỗi {job.failedSegments}
                    </div>
                </div>
            )}

            {phase === 'downloading' && (
                <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-white/70">
                        <span>Đang lưu vào máy...</span>
                        <span>{downloadProgress.completed}/{downloadProgress.total}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full bg-sky-400 transition-all" style={{ width: `${downloadPercent}%` }} />
                    </div>
                </div>
            )}
        </div>
    );
}

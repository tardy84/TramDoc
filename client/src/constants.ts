const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '');

const getApiBaseUrl = () => {
    const configuredUrl = import.meta.env.VITE_API_URL;
    if (configuredUrl) {
        return normalizeBaseUrl(configuredUrl);
    }

    return normalizeBaseUrl(window.location.origin);
};

export const API_BASE_URL = getApiBaseUrl();

export const resolveApiUrl = (url?: string | null, fallback = '') => {
    if (!url) return fallback;

    if (/^(https?:|blob:|data:|file:|capacitor:)/i.test(url)) {
        return url;
    }

    return url.startsWith('/') ? `${API_BASE_URL}${url}` : `${API_BASE_URL}/${url}`;
};

export const DEFAULT_TTS_VOICE = 'vbee-n_hn_male_ngankechuyen_ytstable_vc';

export type OfflineTtsQuality = 'low' | 'standard' | 'high';

export const DEFAULT_OFFLINE_TTS_QUALITY: OfflineTtsQuality = 'standard';

export const OFFLINE_TTS_QUALITIES: Array<{
    id: OfflineTtsQuality;
    label: string;
    bitrateKbps: number;
    mbPerHour: number;
}> = [
    { id: 'low', label: 'Low', bitrateKbps: 32, mbPerHour: 13.7 },
    { id: 'standard', label: 'Standard', bitrateKbps: 64, mbPerHour: 27.5 },
    { id: 'high', label: 'High', bitrateKbps: 128, mbPerHour: 54.9 },
];

export const isOfflineTtsQuality = (quality: string): quality is OfflineTtsQuality =>
    OFFLINE_TTS_QUALITIES.some(item => item.id === quality);

export const getOfflineTtsQualityConfig = (quality: OfflineTtsQuality) =>
    OFFLINE_TTS_QUALITIES.find(item => item.id === quality) || OFFLINE_TTS_QUALITIES[1];

export const getStoredOfflineTtsQuality = (): OfflineTtsQuality => {
    const stored = localStorage.getItem('offline_tts_quality');
    return stored && isOfflineTtsQuality(stored) ? stored : DEFAULT_OFFLINE_TTS_QUALITY;
};

export const providerSupportsOfflineBitrate = (voice: string) =>
    voice.startsWith('minimax-');

export const ENABLED_TTS_VOICES = [
    { id: DEFAULT_TTS_VOICE, name: 'Ngạn', provider: 'Vbee', icon: '🎧' },
    { id: 'vbee-s_sg_male_thientam_ytstable_vc', name: 'Thiên Tâm', provider: 'Vbee', icon: '🎤' },
    { id: 'vbee-n_hanoi_female_nguyetnganhannha_story_vc', name: 'Nguyệt Nga', provider: 'Vbee', icon: '🌸' },
    {
        id: 'minimax-profile-vietnamese-natural-v1',
        name: 'MiniMax Natural 4 giọng',
        provider: 'MiniMax',
        icon: '🎭',
        description: 'Kể: nam qn · Trang trọng: News Anchor · Nam: Gentleman · Nữ: Mature Woman',
    },
    { id: 'minimax-male-qn-qingse', name: 'Nam kể chuyện', provider: 'MiniMax · Nam', icon: '🎙️' },
    { id: 'minimax-mandarin-news-anchor', name: 'News Anchor', provider: 'MiniMax · Trang trọng', icon: '📻' },
    { id: 'minimax-mandarin-gentleman', name: 'Gentleman', provider: 'MiniMax · Nam', icon: '🧔' },
    { id: 'minimax-mandarin-mature-woman', name: 'Mature Woman', provider: 'MiniMax · Nữ', icon: '👩' },
] as const;

export const isEnabledTtsVoice = (voice: string) =>
    ENABLED_TTS_VOICES.some(item => item.id === voice);

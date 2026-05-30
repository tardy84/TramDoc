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

export const ENABLED_TTS_VOICES = [
    { id: DEFAULT_TTS_VOICE, name: 'Ngạn', provider: 'Vbee', icon: '🎧' },
    { id: 'vbee-s_sg_male_thientam_ytstable_vc', name: 'Thiên Tâm', provider: 'Vbee', icon: '🎤' },
    { id: 'vbee-n_hanoi_female_nguyetnganhannha_story_vc', name: 'Nguyệt Nga', provider: 'Vbee', icon: '🌸' },
] as const;

export const isEnabledTtsVoice = (voice: string) =>
    ENABLED_TTS_VOICES.some(item => item.id === voice);

const getApiBaseUrl = () => {
    if (import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL;
    }

    return window.location.origin;
};

export const API_BASE_URL = getApiBaseUrl();

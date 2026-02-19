const getApiBaseUrl = () => {
    const hostname = window.location.hostname;
    // Server backend runs on port 3005
    return `${window.location.protocol}//${hostname}:3005`;
};

export const API_BASE_URL = getApiBaseUrl();

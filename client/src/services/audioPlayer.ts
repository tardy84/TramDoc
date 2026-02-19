// Singleton to hold the audio instance
let globalAudio: HTMLAudioElement | null = null;

export const getGlobalAudio = () => globalAudio;
export const setGlobalAudio = (audio: HTMLAudioElement | null) => {
    globalAudio = audio;
};

import { parseTtsHints, TtsHints } from './ttsHints.js';
import { TtsProvider } from './ttsVoiceCatalog.js';

export interface RenderTtsTextInput {
    content: string;
    ttsHints?: string | null;
    provider: TtsProvider | 'grok';
    expressive?: boolean;
}

export interface RenderTtsTextOutput {
    text: string;
    hints: TtsHints;
    rendererVersion: 'tts-renderer-v1';
}

export function renderTtsText(input: RenderTtsTextInput): RenderTtsTextOutput {
    const hints = parseTtsHints(input.ttsHints);
    const clean = input.content.trim();

    if (!input.expressive) {
        return { text: clean, hints, rendererVersion: 'tts-renderer-v1' };
    }

    if (input.provider === 'grok') {
        return { text: renderGrokText(clean, hints), hints, rendererVersion: 'tts-renderer-v1' };
    }

    return { text: clean, hints, rendererVersion: 'tts-renderer-v1' };
}

function renderGrokText(content: string, hints: TtsHints): string {
    let text = content;
    const tags: string[] = [];

    if (hints.confidence >= 0.75) {
        if (hints.tone === 'whisper') tags.push('whisper');
        if (hints.tone === 'angry' && hints.intensity >= 0.6) tags.push('shout');
        if (hints.pace === 'slow') tags.push('slow');
        if (hints.pace === 'fast') tags.push('fast');
        if (hints.pitch === 'low') tags.push('pitch-low');
        if (hints.pitch === 'high') tags.push('pitch-high');
    }

    const selectedTags = tags.slice(0, 2);
    for (const tag of selectedTags) {
        text = `<${tag}>${text}</${tag}>`;
    }

    if (hints.pauseAfterMs >= 700) text += ' [long-pause]';
    else if (hints.pauseAfterMs >= 250) text += ' [pause]';

    return text;
}

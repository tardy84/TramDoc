# Expressive EPUB TTS mode

- `TextSegment.content` stays clean book text. Parser and TTS providers must not persist inline emotion/prosody tags there.
- `TextSegment.role` remains the voice-selection hint: `narrator`, `heading`, `male`, `female`, or `child`.
- `TextSegment.ttsHints` stores rule-based JSON metadata for tone, pace, pitch, pauses, confidence, source, and version.
- Expressive rendering happens only at TTS generation time through `server/services/ttsTextRenderer.ts`.

## Provider behavior

- Grok-ready renderer: can turn high-confidence hints into inline tags such as `<whisper>`, `<slow>`, `<shout>`, and pause markers like `[pause]`.
- MiniMax: receives clean text in this slice. MiniMax-specific emotion controls can be wired later.
- Vbee: receives clean text only.
- Google, Azure, Gemini: receive clean text unless a future provider-specific renderer is added.

Expressive mode is explicit opt-in (`expressive=true` or `expressive=1`) until audio QA accepts the output. Cache identity includes provider, concrete cache voice, expressive flag, renderer version, and rendered TTS text so plain and expressive audio do not reuse the same cache path.

## Existing books

Old books do not need EPUB re-upload for baseline `ttsHints`. Use `POST /books/:id/reanalyze-tts-hints` to backfill from stored `TextSegment.content`.

Reanalysis is metadata-only: it updates `role`/`ttsHints` and does not regenerate audio, delete cached files, or change `audioUrl`. Existing audio remains valid for plain playback.

Segment-only reanalysis cannot recover lost EPUB HTML context such as `blockquote`, `epub:type`, or exact stanza layout. It still catches most light expressive cases from dialogue markers, speaker attribution, emotional keywords, punctuation, and pause hints. Perfect HTML-aware reanalysis requires retaining or re-uploading the original EPUB in a future feature.

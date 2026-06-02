# Grok TTS in Trạm Đọc

## Enabled voices

- `grok-eve` → xAI raw `eve` (female / energetic, upbeat)
- `grok-ara` → xAI raw `ara` (female / warm, friendly, conversational)
- `grok-sal` → xAI raw `sal` (male / smooth, versatile)

Other xAI built-ins are wired at the backend for future UI use: `grok-rex` → `rex`, `grok-leo` → `leo`.

## Required server env

- `XAI_API_KEY`: xAI API key for production/server calls.
- Optional `XAI_TTS_API_URL`: defaults to `https://api.x.ai/v1/tts`.

## Behavior

- Frontend never sees `XAI_API_KEY`.
- Grok is treated as a paid/quota-sensitive provider.
- Full-book/offline generation requires explicit confirmation.
- Expressive tags are only sent when `expressive=true`.
- Existing plain audio cache does not get overwritten automatically.
- Grok cache keys include a provider cache version so Ara/Sal audio generated
  by older mappings is not silently reused after provider wiring changes.

## Cost note

Grok TTS can be expensive for full books. Prefer chapter-level or missing-only generation during QA.

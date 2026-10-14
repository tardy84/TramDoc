# TTS follow-along, prefetch, stale-audio regeneration, cost metering

> Follow-up to "Sentence marks + reader follow-along highlight" (same branch). Do not deploy without review.

## What changed

### 1) Prefetch: no more stall at chapter boundaries

The reader already preloaded audio *files* into the browser, but playback still stalled when the
**server had not generated** the next segments yet (long chapters, or after skipping ahead).

- New `POST /books/:bookId/chapters/:chapterId/tts/warm` — server-side pre-generation:
  - bounded: **6 segments** for cheap providers, **2 for Vbee/MiniMax/Grok**;
  - either `segmentIndexes` (explicit list) or `fromSegmentIndex` (`-1` = start of chapter, used
    when the reader moves into the next one);
  - skips cached segments and reuses the normal generation path, which already waits on in-flight
    jobs — so warming can never double-charge a segment that is being generated.
- Client (`useReaderAudio.warmAhead`): called when playback of a segment starts; within 3 segments
  of a chapter's end it warms the **next chapter from its start**. Debounced per
  `chapterId + position` (60s) so scrubbing cannot spam the server.
- Response includes `requested` (what was considered after filtering), `cached`, `queued`, and is
  always fast (<25ms) — it never blocks playback; failures are swallowed.

### 2) Stale audio (hintsStale) is now actionable

`ttsHints` (tone/pace/pitch) changed the meaning of cached audio without changing the cache key, so
a chapter could keep playing audio recorded with the old prosody.

- `GET /books/:bookId/chapters/:chapterId/tts/status` now returns `hintsStaleIndexes` (1-based
  segment numbers) and `missingIndexes`.
- `GET /books/:tts/status` returns `hintsStale` per chapter.
- Client (`OfflineTtsPanel`): an amber notice lists how many segments/chapters are affected and a
  **"Tạo lại audio cho khớp"** button regenerates exactly those segments, drops their cached copies,
  and re-downloads the affected chapters so offline playback also matches.

### 3) Cost metering before a full-book job

`services/ttsCost.ts` answers "how much text/audio/money does this book still need?".

- `characters` is exact (speakable characters from the DB).
- `estimatedSeconds` uses **this voice's measured narration speed** when the book already has audio
  (chars ÷ measured seconds from sidecar `durationMs`); otherwise a documented default
  (`DEFAULT_CHARS_PER_SECOND = 15`); absurd measured rates (outside 0.5–60 chars/s) are rejected
  rather than trusted.
- `estimatedCostUsd` only exists for providers with a **published per-character rate** (google $16,
  azure $15). Vbee/MiniMax/Gemini/Grok bill via credits/tokens, so they return `null` and the UI
  says "chưa có đơn giá cho giọng này" instead of inventing a number. Operators can override or
  extend the table with `TTS_COST_RATES_JSON`.
- The book/chapter status responses now carry `characters`, `missingCharacters` (per chapter and
  total) and an `estimate` block; the offline panel shows it and the pre-run `window.confirm`
  includes it.

## Performance note

Status endpoints previously read each sidecar twice (once for the cache check, once for the
hints/duration). They now use `readSegmentAudioState()` which returns both in one read, so the
added fields cost no extra file I/O.

## Verification (2026-10-14)

- `server tsc --noEmit` clean; `client npm run build` ok (508 KB bundle, pre-existing size warning).
- `npm run smoke:tts-cost` — **22/22 checks passed** (provider detection matches `resolveTtsVoice`,
  char counting, cost math, no invented price, measured-speed preference with guard, env override,
  malformed JSON fallback).
- Live server against a scratch SQLite fixture (bypass auth, **no provider calls, no credits**):
  - chapter status → `cached 1 / missing 2 / hintsStale 1, hintsStaleIndexes [0] / missingIndexes [1,2]
    / characters 99`;
  - book status → `characters 146, missingCharacters 103`,
    `estimate {characters: 103, estimatedSeconds: 29, estimatedCostUsd: null, secondsFromMeasuredAudio: true}`;
  - warm from 0 → `requested [1,2], queued [1,2]`; warm from 1 → `requested [2]`; warm from -1 on
    another chapter → `requested [0,1]` — an off-by-one in the lookahead offset was caught here and
    fixed (`getLookaheadSegmentIndexes` already advances past its argument);
  - after caching segment 0 of chapter 2, warm returns `cached [0], queued [1]` and its status flips
    to `hintsStale 1`.
- Cleaned up: temp server, scratch DB, fixture audio and `/tmp` artifacts removed; repo `git status`
  only contains real changes.

## Next

1. Deploy behind the existing nginx (vercel build path unchanged; server is `tsx index.ts`).
2. Optional: word-level highlight could use minimax `words` to highlight the spoken word only.
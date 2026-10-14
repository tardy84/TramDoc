# Sentence marks + reader follow-along highlight

> Slice 1 of "học từ Speechify, áp dụng vào Trạm Đọc". Keep changes surgical. Do not deploy.

**Goal:** while audio plays, highlight the sentence being spoken and let the reader tap a sentence to
seek to it. Works with the providers we already use, and adds **no new vendor SDK**.

## Why not just ask the provider

Timing support differs per provider:

| provider | timing today |
|---|---|
| `google` | native **timepoints** when SSML contains `<mark>` (`enableTimePointing: ['SSML_MARK']`) → exact |
| `minimax` | `subtitle_enable: true` returns a subtitle file with word/sentence timestamps → exact when present |
| `azure` (REST), `vbee` (poll), `gemini`, `grok` | no timing in the response |

So the pipeline is: **exact marks when the provider gives them, otherwise an estimated timeline**
distributed over sentences by character weight using the **real audio duration** (ffprobe, with a pure
Node MP3 frame walk as fallback). That keeps every existing provider usable for highlighting.

## Server

New:
- `server/services/ttsAlignment.ts` — Vietnamese-aware sentence splitting with exact char offsets,
  estimated timeline, google-timepoint mapping, subtitle (word) mapping, monotonicity validation.
- `server/services/audioDuration.ts` — `ffprobe` probe with MP3 frame-walk fallback.
- `server/services/ttsTiming.ts` — timing-capable synthesis for `google` (SSML marks) and `minimax`
  (subtitle); returns `null` when unavailable so the caller falls back to the plain synthesis path.
  Audio is never lost: usable audio is returned even if the timing payload is not.
- `server/scripts/smoke-tts-marks.ts` — offline verification (`npm run smoke:tts-marks`), no API calls.

Changed (`server/routes/tts.ts`):
- `generateSegment()` tries the timing path first for timing-capable providers, writes `marks`,
  `marksSource` and `durationMs` into the existing audio sidecar (no DB migration), and refines the
  last boundary with the probed duration.
- Marks are only trusted when the spoken text equals the rendered segment text, so expressive/Grok
  rewrites cannot misalign highlights.
- New `GET /books/:bookId/chapters/:chapterId/tts/marks?voice=…` — returns marks per speakable segment,
  computing (and caching into the sidecar) the estimated timeline for audio generated before this change.
- Chapter TTS status now also returns `hintsStale`: audio is being reused although `ttsHints`
  (tone/pace/pitch) changed since it was generated.

## Client

- `services/apiService.ts` — `getChapterTtsMarks()`.
- `components/Reader/useSentenceHighlight.ts` — turns `audio.currentTime` into the active sentence with a
  rAF loop that only re-renders when the active sentence changes (not every frame).
- `components/BookReader.tsx` — fetches marks per chapter × voice, splits the **active** segment's text by
  char offsets, highlights the spoken sentence with the active theme, and seeks when a sentence is tapped.
  Marks are cached in memory per `book:chapter:voice:expressive`.
- `types.ts` — optional `ThemeStyles.sentenceActive` per theme.

Offline: marks live in the audio sidecar that the offline download path already copies, so highlighting
keeps working from downloaded audio.

## Verify

```bash
cd server && npm run typecheck && npm run smoke:tts-marks
cd client && npm run build
```

Expected: smoke prints all checks passed (sentence offsets slice back exactly, duration probe ≈2.5s,
timeline monotonic and ending at duration, timepoints → exact marks, subtitle payload shapes parse).

## Verified on 2026-10-14

- `server npx tsc --noEmit` → clean; `client npm run build` → built (503 KB bundle, pre-existing size warning).
- `npm run smoke:tts-marks` → **all checks passed** (6 sentences from the sample text, offsets slice back to
  232/232 chars, ffprobe 2500 ms, MP3 frame walker 2560 ms, timeline monotonic 0→2500 ms, timepoints →
  exact marks at 0/700 ms, subtitle payloads in 3 shapes parse).
- Live server against a scratch SQLite fixture (`TRAMDOC_BYPASS_AUTH=1`, temp DB, no provider calls):
  - `GET /api/books/1/chapters/1/tts/marks?voice=vbee-…` → 200, two segments `status: missing` with the
    resolved `audioFile` names, `timingCapable: false` for vbee (correct — estimated path).
  - after placing real 8 s / 3 s MP3s at those names → `status: ready`, `source: estimated`,
    `durationMs 8000 / 3000`, `4 / 3` sentences, monotonic char ranges covering 0→159 chars,
    and the sidecar JSON persisted `marks`, `marksSource`, `durationMs` next to each audio file.
  - route is auth-protected: 401 without a token, 403 with a bad token.
- Not verified: the google timepoints / minimax subtitle paths need live provider keys (no API calls were
  made, so no credits were spent).

## Word-level highlight (same PR)

When the provider returned real word timings (`source: provider-subtitle`, i.e. MiniMax), the payload carries
`marks.words` and the reader highlights **the word** being spoken instead of the whole sentence; tapping a word
seeks to that word, tapping a sentence (estimated timeline) seeks to the sentence start. `useSentenceHighlight`
exposes `wordIndex` (−1 when only an estimated sentence timeline exists) and keeps the previous word highlighted
during natural pauses instead of jumping ahead.

## Next (not in this slice)

1. Prefetch the next segments' audio while one plays (Speechify's `chunkIndex` pattern) to cut the
   "đang tạo audio" wait on long chapters.
2. Surface `hintsStale` in the UI as a "tạo lại audio cho khớp giọng đọc" action.
3. Character/cost metering per book before generating a full-book job.
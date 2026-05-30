# Codex handoff — EPUB parser + TTS hardening

Context: Hermes/Zeus optimized the Trạm Đọc EPUB parser for TTS-first reading quality and hardened server-side TTS cache/generation. The repo also has unrelated dirty client/iOS files from the Capacitor/TestFlight lane; avoid overwriting those unless explicitly working on that lane.

## Scope touched by Hermes/Zeus

Files changed/created in this slice:

- `server/services/epubProcessor.ts`
- `server/routes/tts.ts`
- `server/package.json`
- `server/scripts/smoke-epub-parser.ts` (new)

Do not assume other dirty client/iOS files are from this slice.

## EPUB parser changes

Primary goal: produce cleaner, TTS-friendly text segments for Vietnamese EPUBs.

Implemented in `server/services/epubProcessor.ts`:

- Faster ZIP lookup via `zipEntryMap` instead of repeated `zipEntries.find(...)` for spine content.
- Safer EPUB path resolution:
  - POSIX path handling for EPUB internals.
  - Strip href fragments/query before resolving.
  - Prevent path traversal outside EPUB root.
- Better spine filtering:
  - Skip `linear="no"` items.
  - Only process HTML-ish manifest items (`application/xhtml+xml`, `text/html`, `.xhtml`, `.html`, `.htm`).
- Cover extraction now resolves hrefs safely.
- Parser cleanup on failure:
  - If book creation succeeded but chapter/segment processing fails, delete partial book record to avoid orphaned partial imports.
- Cleaner text extraction:
  - Prefer semantic blocks (`h1-h6`, `p`, `li`, `blockquote`, etc.).
  - Avoid duplicated parent/child text.
  - Fallback to leaf `div` text for EPUBs that store content in bare divs.
  - Filter decorative separators and likely front-matter junk.
- Improved chapter skipping / ToC detection:
  - Prefer EPUB navigation titles (`toc.ncx` / EPUB3 `nav`) over fragile in-document guesses when available.
  - Avoid parsing cover/titlepage/toc-like content as normal chapters where possible.
  - Skip publisher/ebook-project promotional pages that include repeated ToC/metadata blocks.
- TTS-oriented segmentation:
  - Target chunk size roughly 220–420 chars.
  - Hard cap expectation: <= 700 chars.
  - Sentence splitting protects common Vietnamese abbreviations like `v.v.`, `TS.`, `TP.HCM`, etc.
  - `role` currently remains simple (`heading` / `narrator`) to match existing schema.

## TTS backend changes

Implemented in `server/routes/tts.ts`:

- Added transient retry around provider synthesis:
  - `TTS_GENERATION_MAX_ATTEMPTS = 2`
  - `TTS_GENERATION_RETRY_DELAY_MS = 750`
- Audio cache is now content-hash aware:
  - Existing audio filename convention remains: `{bookId}_{chapterId}_{voice}_{segmentIndex}.mp3`
  - New sidecar metadata file: `{bookId}_{chapterId}_{voice}_{segmentIndex}.mp3.json`
  - Metadata stores hash derived from `{ content, role, voice }`.
  - Cache is valid only when mp3 exists AND metadata hash matches current DB segment content/role/voice.
- Stale audio protection:
  - `/audio/:filename` no longer serves a stale mp3 just because the file exists.
  - If metadata is missing or hash mismatches, route treats it as cache miss and regenerates on demand.
- Generation dedupe still uses `generatingFiles` set keyed by filename.
- Added cache utilities:
  - `isSegmentAudioCached(...)`
  - `writeAudioMetadata(...)`
  - `deleteAudioCache(...)`
  - `doesFileExist(...)`

### New TTS endpoints

All require JWT auth and same book/chapter ownership checks as existing routes.

1. Inspect cache health:

```http
GET /api/books/:bookId/chapters/:chapterId/tts/status?voice=<voice>
```

Response:

```json
{
  "total": 123,
  "cached": 100,
  "stale": 3,
  "missing": 20
}
```

2. Regenerate one segment or whole chapter:

```http
POST /api/books/:bookId/chapters/:chapterId/tts/regenerate
Content-Type: application/json

{ "voice": "vbee-...", "segmentIndex": 12 }
```

- With `segmentIndex`: delete mp3 + metadata for that segment and regenerate blocking.
- Without `segmentIndex`: delete cache for the whole chapter, preload first segment(s), then background-generate the rest.

Whole chapter request:

```json
{ "voice": "vbee-..." }
```

## Smoke test added

`server/scripts/smoke-epub-parser.ts` processes fixture EPUBs and asserts parser quality:

- Book record exists after processing.
- Minimum chapter count.
- Minimum segment count.
- No empty chapters.
- Max segment length <= 700.
- No decorative separator-only segments.
- Cleanup after each fixture.

`server/package.json` now has:

```json
"smoke:epub": "DATABASE_URL=${DATABASE_URL:-file:./prisma/dev.db} tsx scripts/smoke-epub-parser.ts"
```

The default `DATABASE_URL` fallback was added because `tsx scripts/smoke-epub-parser.ts` failed when env did not define `DATABASE_URL`.

## Verification already run

From `server/`:

```bash
npm run typecheck
npm run smoke:epub
npm test
```

Results:

- `typecheck`: PASS
- `prisma validate`: PASS
- `smoke:epub`: PASS

Fixture results observed after the extra real-EPUB tuning pass:

- `Trại Súc Vật - George Orwell & Phạm Minh Ngọc (dịch).epub`
  - title: `Trại Súc Vật`
  - chapters: 11
  - segments: 822
  - max segment length: 415
- `Dia dang tran gian - Thomas More.epub`
  - title: `Địa đàng trần gian`
  - chapters: 14
  - segments: 1092
  - max segment length: 655
  - first titles: `GIỚI THIỆU`, `THỜI ĐIỀM RA ĐỜi`, `LỜI NGƯỜI DỊCH`, `TÁC GIẢ`, `MẪU TỰ UTOPIA`

Extra ad-hoc real EPUB probes from local iCloud library also passed with no empty chapters, no decorative-only segments, and no segment over 700 chars. After the navigation-title / promo-page follow-up, re-probed a representative subset:

- `Hành Trình Về Phương Đông`: 10 chapters, 1640 segments, max 413; first titles `Chương I`, `Chương II`, `Chương III`, `Chương IV`, `Chương V`.
- `Muôn Kiếp Nhân Sinh`: 10 chapters, 2816 segments, max 596; first titles `Lời giới thiệu`, `Phần mở đầu`, `Phần một`, `Phần hai`, `Phần ba`.
- `Bá Tước Monte Cristo`: 118 chapters, 6935 segments, max 420; first titles `LỜI GIỚI THIỆU`, `PHẦN I. MARSEILLE`, `Chương 2`, `Chương 3`, `Chương 4`.
- `Trại Súc Vật` from iCloud: 11 chapters, 822 segments, max 415; first titles `Lời tựa`, `Chương 1`, `Chương 2`, `Chương 3`, `Chương 4`.

Earlier broader probe matrix before this final follow-up:

- `Hành Trình Về Phương Đông`: 10 chapters, 1640 segments, max 413.
- `Hoàng Tử Bé`: 2 chapters, 900 segments, max 418. Note: this EPUB's spine groups content into only 2 large HTML documents, so chapter titles are not semantically ideal yet.
- `Tam Quốc Diễn Nghĩa`: 120 chapters, 25273 segments, max 695.
- `Bá Tước Monte Cristo`: 118 chapters, 6935 segments, max 420.
- `Muôn Kiếp Nhân Sinh`: 10 chapters, 2816 segments, max 596.
- `Why We Sleep`: 52 chapters, 4191 segments, max 659.

## Important integration notes for iOS/Capacitor lane

- iOS client should call server-side TTS routes only; do not put Vbee/TTS provider keys in client bundle.
- Signed `/audio/...` URLs returned by server are relative URLs. Client iOS lane should keep using `resolveApiUrl(...)` so `capacitor://localhost` resolves audio against the public HTTPS API base.
- The new audio metadata sidecar files live in `server/audio/` next to mp3s. Deployment storage must persist both `*.mp3` and `*.mp3.json`.
- If existing production/staging audio files have no `.mp3.json`, they will be considered stale and regenerated on first request. This is expected.
- Persistent storage for `uploads/`, `uploads/covers/`, `audio/`, and SQLite DB remains mandatory for TestFlight.

## Suggested next checks for Codex

1. Keep this parser/TTS diff isolated from client/iOS dirty files if committing separately.
2. Run backend verification after any merge/rebase:

```bash
cd server
npm test
npm run smoke:epub
```

3. If changing client audio playback, verify:

- `generateTTS()` response `audioFiles` are resolved through API base URL before `new Audio(...)`.
- signed `/audio/:filename?token=...` still reaches public HTTPS backend from iOS Simulator/TestFlight.
- no `VITE_*_KEY` TTS secrets appear in built client bundle.

4. If deploying to a VPS with old audio cache, expect first playback to regenerate because hash metadata is missing.

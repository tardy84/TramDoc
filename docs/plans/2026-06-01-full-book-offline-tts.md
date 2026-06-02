# Full-book Offline TTS Implementation Plan

> Implement task-by-task. Keep changes small and surgical. Follow `AGENTS.md`. Do not deploy. Do not touch unrelated dirty files.

**Goal:** Let a reader generate and download the selected server-side TTS voice for an entire book, then play it offline from the device without requiring realtime TTS requests.

**Current architecture:** React 18 + TypeScript + Vite client; Express 5 + TypeScript server; Prisma + SQLite; audio files served from signed `/audio/:filename` URLs. Client calls `/api` through the Vite/nginx proxy.

---

## Storage and quality model

### Storage locations

- **Server-side TTS cache**
  - Local development: `server/audio/`.
  - VPS deployment: `/srv/tramdoc/app/audio/`.
  - This cache is shared server storage and is used by signed `/audio/:filename` URLs.
- **Offline device cache**
  - Browser/iOS WebView IndexedDB database: `audiobook-db`.
  - Object stores:
    - `books`: book metadata, chapters, optional cover blob.
    - `audio`: downloaded audio blobs for offline playback.
- **Audio cache keys must include voice/profile and quality where quality changes audio output:**
  - Baseline voice-aware format: `bookId_chapterId_voice_segmentIndex`.
  - Offline quality-aware format: `bookId_chapterId_voice_quality_segmentIndex`.
  - Realtime playback must keep working with existing signed server URLs.
- **Important storage implication:** offline download stores a second copy of audio:
  1. one copy in the server TTS cache (`server/audio/` locally or `/srv/tramdoc/app/audio/` on VPS), and
  2. one copy on the user's device in IndexedDB.

### Storage estimate before download

Before starting an offline full-book download, the client must show an estimated device storage range.

- Estimate from total text characters or speakable segment count.
- Vietnamese reading speed estimate: **800–1,200 characters/minute**.
- Estimate MP3 storage by selected quality/bitrate:
  - Low — 32kbps ≈ **13.7 MB/hour**
  - Standard — 64kbps ≈ **27.5 MB/hour**
  - High — 128kbps ≈ **54.9 MB/hour**
- Show a Vietnamese range, e.g. `Ước tính cần 300–550 MB cho giọng này`.
- Estimate is advisory; provider defaults and silence/pacing may make real file sizes differ.

### Offline quality setting

- Add an offline audio quality option in the offline UI:
  - `Low`: 32kbps
  - `Standard`: 64kbps default
  - `High`: 128kbps
- Default offline quality is **64kbps** to save device storage.
- Do **not** change realtime playback quality unless explicitly needed.
- Backend full-book/offline TTS generation should accept desired `quality`/`bitrate` where the provider supports it.
- If a provider does not support bitrate control, document fallback and show `chất lượng mặc định của nhà cung cấp` / `provider default quality` in the UI.

### Delete controls

- Add the ability to delete offline audio by **book + voice + quality** while preserving book metadata.
- Preserve book metadata if the user deletes only one voice/quality.
- Existing `deleteOfflineBook(bookId)` can continue removing all offline metadata and audio for a book.
- Add helper:
  - `deleteOfflineVoice(bookId, voice, quality?)`
- Add helper:
  - `getOfflineVoiceStorageUsage(bookId, voice, quality?)`

### Guardrails before generation/download

Before starting full-book offline generation/download, the UI must show:

- provider warning for Vbee/MiniMax quota,
- estimated device storage,
- selected voice,
- selected quality,
- fallback note when provider bitrate control is not supported.

The user must explicitly confirm before the job starts.

---

## Non-goals

- No Prisma job table for this slice; in-memory jobs are acceptable.
- No push notifications/background native download manager.
- No zip import/export.
- No cross-device sync of offline audio.
- No production deploy.
- No destructive server audio cleanup without explicit confirmation.

---

## Task 1: Add in-memory full-book TTS job store

**Objective:** Track full-book TTS generation progress without adding a database migration.

**Files:**
- Create: `server/services/ttsBookJobs.ts`

**Requirements:**
- Track `queued | running | completed | failed | cancelled`.
- Track `bookId`, `userId`, `voice`, `mode`, optional `quality`, totals, cached/generated/failed/skipped counts, current chapter/segment, timestamps, and error.
- Support create, get, update, cancel, and cancellation checks.

**Verification:**
- Covered by `npm run smoke:tts-book-job`.

---

## Task 2: Add shared TTS route helpers

**Objective:** Reuse safe helpers for chapter lookup, cache filename resolution, speakable segment filtering, provider selection, and audio metadata.

**Files:**
- Modify: `server/routes/tts.ts`

**Requirements:**
- Preserve signed `/audio/:filename` access checks.
- Cache lookup must be voice/profile-aware.
- For multi-voice profiles, resolve per-segment cache voice while keeping client request voice stable.
- Include quality/bitrate in cache identity only when it changes generated audio output.

**Verification:**
- `npm test`
- `npm run smoke:tts-book-job`

---

## Task 3: Add full-book TTS endpoints

**Objective:** Expose server APIs to start, poll, cancel, and inspect full-book TTS cache state.

**Files:**
- Modify: `server/routes/tts.ts`

**Endpoints:**
- `POST /api/books/:bookId/tts/jobs`
  - Body: `{ voice, mode, quality?, confirmExpensiveProvider }`.
  - `mode`: `missing | force`.
  - Guard Vbee/MiniMax full-book generation with explicit confirmation.
- `GET /api/books/:bookId/tts/jobs/:jobId`
- `POST /api/books/:bookId/tts/jobs/:jobId/cancel`
- `GET /api/books/:bookId/tts/status?voice=...&quality=...`

**Requirements:**
- Enforce book ownership.
- Validate safe voice and quality values.
- Skip non-speech segments.
- Return cache totals: `total`, `cached`, `stale`, `missing`, `skipped`, per chapter.
- Failed segment generation must not produce a false `completed` job.

**Verification:**
- `npm run smoke:tts-book-job`

---

## Task 4: Add client API helpers

**Objective:** Let the reader UI call the new endpoints.

**Files:**
- Modify: `client/src/services/apiService.ts`

**Requirements:**
- Add types for job progress and cache status.
- Add helpers:
  - `startBookTtsJob(bookId, voice, mode, confirmExpensiveProvider, quality?)`
  - `getBookTtsJob(bookId, jobId)`
  - `cancelBookTtsJob(bookId, jobId)`
  - `getBookTtsStatus(bookId, voice, quality?)`

**Verification:**
- `npm run build`

---

## Task 5: Make IndexedDB audio cache voice/profile/quality-aware

**Objective:** Avoid collisions when a user downloads different voices or offline qualities for the same book.

**Files:**
- Modify: `client/src/services/offlineManager.ts`

**Requirements:**
- IndexedDB database remains `audiobook-db`.
- Stores remain `books` and `audio`.
- Audio values must include `bookId`, `chapterId`, `voice`, `quality`, `segmentIndex`, and `audioBlob`.
- Audio key format for new offline downloads: `bookId_chapterId_voice_quality_segmentIndex`.
- Reader lookup must use the same voice + quality defaulting rules.
- Existing `deleteOfflineBook(bookId)` still deletes all offline data for the book.
- Add:
  - `deleteOfflineVoice(bookId, voice, quality?)`
  - `getOfflineVoiceStorageUsage(bookId, voice, quality?)`

**Verification:**
- `npm run build`

---

## Task 6: Download chapter/book audio offline

**Objective:** Download signed server audio files into IndexedDB after server cache generation.

**Files:**
- Modify: `client/src/services/offlineManager.ts`

**Requirements:**
- Add/keep `downloadChapterAudioOffline(bookId, chapterId, voice, quality, onProgress?, signal?)`.
- Trigger server `generateTTS` for signed URLs but do not persist login JWT in media URLs.
- Store blobs with voice/profile + quality keys.
- Support cancellation via `AbortSignal`.

**Verification:**
- `npm run build`

---

## Task 7: Reader prefers downloaded audio offline

**Objective:** When downloaded audio exists for the selected voice/quality, playback should use IndexedDB blobs before server URLs.

**Files:**
- Modify: `client/src/components/Reader/useReaderAudio.ts`

**Requirements:**
- Look up IndexedDB blobs by `bookId`, `chapterId`, `voice`, selected/default offline quality, and segment index.
- Revoke object URLs to avoid leaks.
- Keep realtime playback unchanged when no offline blob exists.
- Realtime playback quality remains provider/default unless explicitly changed later.

**Verification:**
- `npm run build`

---

## Task 8: Offline TTS UI tab

**Objective:** Put full-book offline controls in the reader library menu as a tab next to Mục lục and Dấu trang.

**Files:**
- Modify: `client/src/components/Reader/LibraryPanel.tsx`
- Modify: `client/src/components/BookReader.tsx`
- Create/modify: `client/src/components/Reader/OfflineTtsPanel.tsx`

**Requirements:**
- No floating offline panel.
- Add `Nghe offline` tab in the menu.
- Show selected voice.
- Show offline quality selector, default Standard 64kbps.
- Show estimated storage before start.
- Show provider quota warning for Vbee/MiniMax.
- Show fallback note when selected provider uses provider default quality.
- Require explicit user confirmation before starting.
- Show progress for server cache generation and device download.
- Allow cancel while generating/downloading.
- Allow deleting one downloaded voice/quality without deleting the book metadata.

**Verification:**
- `npm run build`
- `npm run lint`
- Manual/browser check when feasible: open reader menu and confirm `Nghe offline` is a tab, not a floating panel.

---

## Chapter-level offline downloads

**Objective:** Add a smaller, safer chapter-level offline audio workflow in the Reader chapter list. Full-book download remains available, but downloading one chapter should be the default low-risk path.

### User-facing behavior

In the Reader chapters tab/list, each chapter row must show offline audio status for the currently selected voice/quality:

- `Chưa tải` / Not downloaded
- `Tải một phần` / Partially downloaded
- `Đã tải` / Downloaded
- `Đang tải` with progress
- `Lỗi` with retry available

Each chapter row should expose a context-appropriate action:

- `Tải chương`
- `Huỷ tải`
- `Tải lại` or `Tải tiếp` for partial/failed chapters
- `Xoá audio` for downloaded/partial chapters

For Vbee/MiniMax chapter downloads, show the quota warning before starting:

```txt
Tải giọng đọc có thể dùng quota của provider. Nên tải từng chương trước.
```

The user must confirm before starting Vbee/MiniMax chapter downloads. Chapter actions must not fan out into full-book generation.

### Storage model

Offline audio remains in IndexedDB database `audiobook-db`. Audio blobs continue using key format:

```txt
bookId_chapterId_voice_quality_segmentIndex
```

Add/update an IndexedDB object store for per-chapter audio status, e.g. `chapterAudioStatus`. Bump the IndexedDB version safely and create missing stores without breaking existing stored `books`/`audio` data.

Store chapter status metadata:

```ts
{
  key: `${bookId}_${chapterId}_${voice}_${quality}`,
  bookId,
  chapterId,
  voice,
  quality,
  totalSegments,
  downloadedSegments,
  failedSegments,
  status: 'not_downloaded' | 'downloading' | 'partial' | 'downloaded' | 'failed',
  downloadedAt?,
  updatedAt,
}
```

### Client offline helpers

Modify `client/src/services/offlineManager.ts` and add:

- `getChapterOfflineStatus(bookId, chapterId, voice, quality)`
- `setChapterOfflineStatus(status)`
- `listBookChapterOfflineStatuses(bookId, voice, quality)`
- `deleteOfflineChapterAudio(bookId, chapterId, voice, quality)`
- `deleteOfflineVoice(bookId, voice, quality?)` must delete matching chapter statuses too
- `getOfflineChapterStorageUsage(bookId, chapterId, voice, quality)`
- `saveChapterAudio(bookId, chapterId, voice, quality, audioFiles, onProgress?)`

Important details:

- Skip empty audio URLs for non-speech segments.
- Progress counts only non-empty audio URLs.
- A chapter can be `partial` if some segments fail.
- Delete chapter audio must preserve book metadata and other chapters/voices/qualities.

### API / generation behavior

Reuse existing endpoint:

```http
POST /api/books/:bookId/chapters/:chapterId/tts
```

with `voice`, `startSegmentIndex`, and `quality` when available.

- Chapter download should trigger/generate only that chapter and then download returned signed `/audio` URLs into IndexedDB.
- Do not start full-book jobs from a chapter row.
- If a provider does not support bitrate control, still include `quality` in offline keys/status, but mark provider quality as default in the UI.

### UI integration

Inspect before editing:

- `client/src/components/BookReader.tsx`
- `client/src/components/Reader/LibraryPanel.tsx`
- `client/src/components/Reader/ReaderControls.tsx`
- `client/src/components/Reader/useReaderAudio.ts`

Likely first implementation surface: `LibraryPanel` chapter list.

Behavior:

- On opening a book/reader, load offline statuses for all chapters for the selected voice/quality.
- When selected voice or quality changes, refresh statuses.
- While a chapter is downloading, show progress in that row.
- After completion, row shows `Đã tải`.
- If partially downloaded, show `Tải tiếp` or `Tải lại`.
- If failed, show error/retry.
- Delete action removes only that chapter’s audio for that voice/quality, then updates status.

### Reader playback

- Reader should prefer offline audio for the selected book/chapter/voice/quality.
- If a chapter is fully or partially downloaded, play available offline segments.
- If a specific segment is missing:
  - when online: fall back to server audio/generation for that segment/chapter,
  - when offline: show Vietnamese error `Đoạn này chưa được tải offline.`
- Never block text reading when audio is unavailable.

### Chapter-level acceptance criteria

- A single chapter can be downloaded from the chapters tab.
- Chapter row shows downloading progress.
- Downloaded chapter row shows `Đã tải`.
- Deleting one chapter audio does not delete other chapters or book metadata.
- Switching voice/quality shows separate status.
- Offline playback works for a downloaded chapter.
- Missing offline segment while offline shows a clear Vietnamese error.
- Existing full-book offline plan remains compatible.
- Build gates pass:

```bash
cd /Users/nguyenphong/projects/tramdoc/server && npm run typecheck && npm run prisma:validate
cd /Users/nguyenphong/projects/tramdoc/client && npm run build
```

---

## Task 9: Smoke tests and acceptance criteria

**Server verification commands:**

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm test
npm run smoke:epub
npm run smoke:tts-book-job
```

**Client verification commands:**

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run build
npm run lint
```

**Acceptance criteria:**

- UI shows estimated storage before download.
- Default offline quality is 64kbps.
- Offline audio is stored per voice and quality.
- User can delete one voice/quality without deleting the whole book metadata.
- Full-book generation shows provider quota guardrails for Vbee/MiniMax.
- User confirmation includes selected voice, selected quality, and estimated storage.
- Reader still plays downloaded audio offline from IndexedDB.
- Realtime playback remains unchanged unless no offline blob exists.
- Existing server/client build gates pass.
- A single chapter can be downloaded from the chapters tab.
- Chapter row shows downloading progress and final `Đã tải` state.
- Deleting one chapter audio does not delete other chapters or book metadata.
- Switching voice/quality shows separate chapter status.
- Missing offline segment while offline shows `Đoạn này chưa được tải offline.`

---

## Implementation order

1. Restore/update this plan.
2. Confirm current code is consistent with the plan.
3. Add storage estimate + quality constants on the client.
4. Make IndexedDB helpers quality-aware and add delete/usage helpers.
5. Wire offline UI quality selector, estimate, confirmation, and delete-one-voice controls.
6. Pass quality through client API/server job/status as a validated optional field.
7. Only add provider bitrate integration where it is supported and can be tested safely; otherwise show provider-default fallback.
8. Run verification gates.

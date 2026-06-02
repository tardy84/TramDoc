# MiniMax Provider + Multi-Voice Reader Implementation Plan

> **For Hermes:** Delegate this plan to MiniMax Code with model **MiniMax-M3**. Implement task-by-task, keep changes surgical, and run the verification commands after each slice.

**Goal:** Enable MiniMax as a first-class Trạm Đọc TTS provider, add the 4 user-approved MiniMax voices with clear labels, and support multiple voices inside one book based on segment roles.

**Architecture:** Keep provider keys server-side. Treat the Reader voice picker as selecting either a single voice or a voice profile. A voice profile resolves each `TextSegment.role` to a concrete provider voice before generation/cache lookup. Use safe internal IDs for UI/API/cache filenames and map them to raw MiniMax `voice_id` values on the server so raw IDs containing spaces/parentheses never enter filenames.

**Tech Stack:** React 18 + TypeScript + Vite client; Express 5 + TypeScript server; Prisma + SQLite; MiniMax T2A HTTP `speech-2.8-hd`.

---

## Non-negotiable decisions from Sếp's listening test

Use exactly these approved voices for the first MiniMax Vietnamese profile:

- Narrator / giọng kể mặc định:
  - UI label: `MiniMax Nam kể chuyện`
  - Safe ID: `minimax-male-qn-qingse`
  - Raw MiniMax `voice_id`: `male-qn-qingse`
  - Gender/role label: `Nam · kể chuyện`
- Formal narrator / heading / phát thanh:
  - UI label: `MiniMax Phát thanh Mandarin`
  - Safe ID: `minimax-mandarin-news-anchor`
  - Raw MiniMax `voice_id`: `Chinese (Mandarin)_News_Anchor`
  - Gender/role label: `Trung tính/Nam · phát thanh, trang trọng`
- Male dialogue:
  - UI label: `MiniMax Gentleman`
  - Safe ID: `minimax-mandarin-gentleman`
  - Raw MiniMax `voice_id`: `Chinese (Mandarin)_Gentleman`
  - Gender/role label: `Nam · thoại nam`
- Female dialogue:
  - UI label: `MiniMax Mature Woman`
  - Safe ID: `minimax-mandarin-mature-woman`
  - Raw MiniMax `voice_id`: `Chinese (Mandarin)_Mature_Woman`
  - Gender/role label: `Nữ · thoại nữ/người lớn`

First voice profile:

```txt
MiniMax Vietnamese Natural v1
- narrator: minimax-male-qn-qingse
- heading/formal: minimax-mandarin-news-anchor
- male: minimax-mandarin-gentleman
- female: minimax-mandarin-mature-woman
- child/unknown fallback: minimax-male-qn-qingse
```

Official Vietnamese voice `Vietnamese_kindhearted_girl` is not default. It may be listed as a secondary single-voice option only if useful.

---

## Important current-state findings

- `client/src/constants.ts` currently enables only 3 Vbee voices and validates `reader_voice` against that list.
- `server/routes/tts.ts` already imports `MiniMaxTTSService` and chooses it when the requested voice starts with `minimax-`.
- Current `isSafeVoice()` only allows `[A-Za-z0-9._-]`; raw Mandarin voice IDs like `Chinese (Mandarin)_News_Anchor` cannot be used directly in the request or filename.
- `server/services/minimaxTTS.ts` strips `minimax-` and sends the rest as `voice_id`; this works for `male-qn-qingse`, but not for safe aliases like `minimax-mandarin-news-anchor` unless a resolver is added.
- `TextSegment.role` already exists in Prisma and comments mention `'narrator', 'male', 'female', 'child'`, but `epubProcessor.ts` currently only assigns `narrator` or `heading`.
- `server/routes/tts.ts` cache content hash already includes `content + role + voice`; for multi-voice, the cache key must include the resolved per-segment voice or the profile key + role mapping version.
- `client/src/components/Reader/useReaderAudio.ts` currently asks for one `selectedVoice` and receives one URL per segment. The server can keep that contract by accepting `voice=minimax-profile-vietnamese-natural-v1` and generating per-segment concrete voices behind the scenes.

---

## Task 1: Add shared MiniMax voice/profile catalog

**Objective:** Define safe public IDs, raw provider voice IDs, labels, and profile role mappings in one place.

**Files:**
- Create: `server/services/ttsVoiceCatalog.ts`
- Modify: `server/services/minimaxTTS.ts`
- Modify: `server/routes/tts.ts`
- Modify: `client/src/constants.ts`

**Implementation notes:**

Create `server/services/ttsVoiceCatalog.ts` with exports like:

```ts
export type SegmentRole = 'narrator' | 'heading' | 'male' | 'female' | 'child' | string;

export interface ResolvedTtsVoice {
    requestVoice: string;
    cacheVoice: string;
    provider: 'vbee' | 'minimax' | 'azure' | 'gemini' | 'google';
    providerVoiceId: string;
}

const MINIMAX_SINGLE_VOICES: Record<string, string> = {
    'minimax-male-qn-qingse': 'male-qn-qingse',
    'minimax-mandarin-news-anchor': 'Chinese (Mandarin)_News_Anchor',
    'minimax-mandarin-gentleman': 'Chinese (Mandarin)_Gentleman',
    'minimax-mandarin-mature-woman': 'Chinese (Mandarin)_Mature_Woman',
    'minimax-vietnamese-kindhearted-girl': 'Vietnamese_kindhearted_girl',
};

const MINIMAX_NATURAL_PROFILE: Record<string, string> = {
    narrator: 'minimax-male-qn-qingse',
    heading: 'minimax-mandarin-news-anchor',
    male: 'minimax-mandarin-gentleman',
    female: 'minimax-mandarin-mature-woman',
    child: 'minimax-male-qn-qingse',
};

export function resolveTtsVoice(requestVoice: string, role: SegmentRole): ResolvedTtsVoice {
    if (requestVoice === 'minimax-profile-vietnamese-natural-v1') {
        const safeVoice = MINIMAX_NATURAL_PROFILE[role] || MINIMAX_NATURAL_PROFILE.narrator;
        return {
            requestVoice,
            cacheVoice: `${requestVoice}-${role}-${safeVoice}`,
            provider: 'minimax',
            providerVoiceId: MINIMAX_SINGLE_VOICES[safeVoice],
        };
    }

    if (MINIMAX_SINGLE_VOICES[requestVoice]) {
        return {
            requestVoice,
            cacheVoice: requestVoice,
            provider: 'minimax',
            providerVoiceId: MINIMAX_SINGLE_VOICES[requestVoice],
        };
    }

    // Existing providers: preserve old behavior.
    if (requestVoice.startsWith('vbee-')) return { requestVoice, cacheVoice: requestVoice, provider: 'vbee', providerVoiceId: requestVoice };
    if (requestVoice.startsWith('azure-')) return { requestVoice, cacheVoice: requestVoice, provider: 'azure', providerVoiceId: requestVoice };
    if (requestVoice.startsWith('gemini-')) return { requestVoice, cacheVoice: requestVoice, provider: 'gemini', providerVoiceId: requestVoice };
    return { requestVoice, cacheVoice: requestVoice, provider: 'google', providerVoiceId: requestVoice };
}
```

Do not use raw Mandarin voice IDs in filenames or URL params.

**Verification:**

Run:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm run typecheck
```

Expected: TypeScript passes.

---

## Task 2: Update MiniMax service to accept resolved raw voice IDs

**Objective:** Let server pass a raw MiniMax `voice_id` independent of safe UI/cache IDs.

**Files:**
- Modify: `server/services/minimaxTTS.ts`

**Steps:**

1. Keep model `speech-2.8-hd`.
2. Keep `language_boost: 'Vietnamese'` in MiniMax requests, because all accepted voices are being used to read Vietnamese.
3. Change `synthesize(text, role, voiceOverride)` so `voiceOverride` is treated as the raw provider voice ID when supplied by the resolver.
4. Preserve role fallback when no override is passed.
5. Do not log API keys or request headers.

Suggested change:

```ts
const voiceId = voiceOverride || this.getDefaultVoiceForRole(role);
```

Add helper:

```ts
private getDefaultVoiceForRole(role: 'narrator' | 'male' | 'female' | string): string {
    if (role === 'female') return 'Chinese (Mandarin)_Mature_Woman';
    if (role === 'male') return 'Chinese (Mandarin)_Gentleman';
    return 'male-qn-qingse';
}
```

**Verification:**

Run:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm run typecheck
```

Expected: TypeScript passes.

---

## Task 3: Resolve per-segment voice in the TTS route

**Objective:** Make one selected profile produce different voices for different `TextSegment.role` values while preserving the client response shape.

**Files:**
- Modify: `server/routes/tts.ts`

**Steps:**

1. Import `resolveTtsVoice` from `../services/ttsVoiceCatalog.js`.
2. Keep validating the request-level `voice` using `isSafeVoice()`. The profile/safe IDs are all safe.
3. Inside `generateSegment(bookId, chapterId, segmentIndex, voice)`:
   - Load segment as already done.
   - Resolve with `const resolved = resolveTtsVoice(voice, segment.role);`
   - Use `resolved.cacheVoice` for filename and metadata hash.
   - Use `resolved.provider` to select the service.
   - Pass `resolved.providerVoiceId` as the third arg to MiniMax service.
4. In routes that build `audioFiles`, use a helper `buildSegmentAudioFileName(bookId, chapterId, requestVoice, segment)` that resolves the segment role and uses `resolved.cacheVoice`.
5. In `/audio/:filename`, parse the cache voice from the filename, then use metadata to validate. If filename no longer contains request profile, metadata should include at least `{ requestVoice, cacheVoice, providerVoiceId, role }`.
6. Keep existing Vbee credit-safety behavior: low concurrency and no fanout from `/audio` cache miss for Vbee.

**Important cache rule:**

For profile mode, two segments in the same chapter may use different voice files. A narrator segment and female segment must not share a cache key. Recommended file name:

```txt
{bookId}_{chapterId}_{cacheVoice}_{segmentIndex}.mp3
```

Example:

```txt
12_34_minimax-profile-vietnamese-natural-v1-female-minimax-mandarin-mature-woman_9.mp3
```

This remains safe because it contains only letters, numbers, dots, underscores, hyphens.

**Verification:**

Run:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm run typecheck
npm run prisma:validate
```

Expected: both pass.

---

## Task 4: Add MiniMax voices/profile to the Reader UI with clear role labels

**Objective:** Sếp can select MiniMax Provider and see which option is narrator/male/female/formal.

**Files:**
- Modify: `client/src/constants.ts`
- Modify: `client/src/components/Reader/SettingsPanel.tsx` if layout needs description text.

**Steps:**

1. Extend `ENABLED_TTS_VOICES` with a provider/profile item first or after Vbee:

```ts
{
  id: 'minimax-profile-vietnamese-natural-v1',
  name: 'MiniMax Natural 4 giọng',
  provider: 'MiniMax',
  icon: '🎭',
  description: 'Kể: nam qn · Trang trọng: News Anchor · Nam: Gentleman · Nữ: Mature Woman'
}
```

2. Add single-voice items:

```ts
{ id: 'minimax-male-qn-qingse', name: 'Nam kể chuyện', provider: 'MiniMax · Nam', icon: '🎙️' }
{ id: 'minimax-mandarin-news-anchor', name: 'News Anchor', provider: 'MiniMax · Trang trọng', icon: '📻' }
{ id: 'minimax-mandarin-gentleman', name: 'Gentleman', provider: 'MiniMax · Nam', icon: '🧔' }
{ id: 'minimax-mandarin-mature-woman', name: 'Mature Woman', provider: 'MiniMax · Nữ', icon: '👩' }
```

3. If adding `description`, update the type inference and SettingsPanel render:

```tsx
{v.description && <span className="text-[8px] opacity-60 text-left">{v.description}</span>}
```

4. Keep `DEFAULT_TTS_VOICE` unchanged unless Sếp explicitly wants MiniMax as global default. For now, simply enabling it is safer.

**Verification:**

Run:

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run build
```

Expected: build passes.

---

## Task 5: Add role classification during EPUB parsing

**Objective:** Newly imported EPUBs can contain `narrator`, `heading`, `male`, and `female` segment roles so the MiniMax profile can switch voices inside one book.

**Files:**
- Modify: `server/services/epubProcessor.ts`

**Approach:** Rule-based first; no LLM. Keep it conservative so wrong role changes are less distracting than no role changes.

**Current state:** `type SegmentRole = 'narrator' | 'heading';`

Change to:

```ts
type SegmentRole = 'narrator' | 'heading' | 'male' | 'female' | 'child';
```

Add helper functions:

```ts
private inferSegmentRole(text: string, currentSpeakerHint?: SegmentRole): SegmentRole {
    const normalized = this.normalizeForComparison(text);
    const trimmed = text.trim();

    if (!/["“”‘’'«»]/.test(trimmed) && !/^[-–—]/.test(trimmed)) return 'narrator';

    const femaleMarkers = [
        'nang noi', 'co noi', 'ba noi', 'me noi', 'chi noi', 'em gai noi',
        'giong nang', 'giong co', 'giong ba', 'giong me'
    ];
    const maleMarkers = [
        'chang noi', 'anh noi', 'ong noi', 'bo noi', 'cha noi', 'cau noi',
        'giong chang', 'giong anh', 'giong ong', 'giong bo'
    ];

    if (femaleMarkers.some(marker => normalized.includes(marker))) return 'female';
    if (maleMarkers.some(marker => normalized.includes(marker))) return 'male';

    return currentSpeakerHint || 'narrator';
}
```

Then when pushing segment roles:

- Heading stays `heading`.
- Non-heading text uses `inferSegmentRole(s)`.
- Optional: maintain a short-lived speaker hint only within adjacent quote lines; avoid spreading one role across long narrator paragraphs.

**Acceptance criteria:**

- Pure narration remains `narrator`.
- Headings remain `heading`.
- Obvious quote-attribution lines can become `male` or `female`.
- No schema migration is needed because `role` is already a string.

**Verification:**

Run:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm run typecheck
npm run smoke:epub
```

Expected: typecheck passes; smoke EPUB still passes chapter/segment quality checks.

---

## Task 6: Add a small parser smoke metric for role distribution

**Objective:** Make it visible whether multi-voice roles are present after EPUB import without making the smoke brittle.

**Files:**
- Modify: `server/scripts/smoke-epub-parser.ts`

**Steps:**

1. After processing fixture EPUBs, query role counts:

```ts
const roleCounts = await prisma.textSegment.groupBy({
    by: ['role'],
    _count: { role: true },
});
console.log('[EPUB Smoke] role counts:', roleCounts);
```

2. Do not fail if no `male`/`female` roles appear in a fixture unless the fixture is known to contain dialogue.
3. Fail only if all segments have empty/invalid role.

**Verification:**

Run:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm run smoke:epub
```

Expected: smoke output includes role counts and exits 0.

---

## Task 7: Add a local MiniMax API smoke script without committing secrets

**Objective:** Let developers verify the 4 selected voices if `MINIMAX_API_KEY` is set.

**Files:**
- Create: `server/scripts/smoke-minimax-voices.ts`
- Modify: `server/package.json`

**Steps:**

1. Script reads `process.env.MINIMAX_API_KEY` only. Do not hard-code or commit Sếp's key.
2. Generate a short Vietnamese text for each of the 4 raw voices.
3. Save output under ignored temp path like `tmp/minimax-smoke/` or `server/tmp/minimax-smoke/`.
4. Print voice ID, bytes, sample rate/format from response `extra_info`.
5. Add package script:

```json
"smoke:minimax": "tsx scripts/smoke-minimax-voices.ts"
```

6. Ensure `.gitignore` excludes generated audio/temp outputs if not already.

**Verification:**

Run only when key is available:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
MINIMAX_API_KEY=*** npm run smoke:minimax
```

Expected: 4 MP3 files generated, no key printed.

---

## Task 8: End-to-end local verification

**Objective:** Confirm the full Reader path works with profile voice selection.

**Prerequisites:**

Set server-side env locally only:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
export DATABASE_URL="file:./prisma/dev.db"
export JWT_SECRET="local-dev-secret"
export MINIMAX_API_KEY="***"
```

**Run server checks:**

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm run typecheck
npm run prisma:validate
npm run smoke:epub
```

**Run client checks:**

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run build
```

**Manual Reader acceptance:**

1. Start server and client.
2. Open a book in Reader.
3. Open settings → `Giọng đọc`.
4. Verify these labels are visible:
   - `MiniMax Natural 4 giọng`
   - `Nam kể chuyện` / `MiniMax · Nam`
   - `News Anchor` / `MiniMax · Trang trọng`
   - `Gentleman` / `MiniMax · Nam`
   - `Mature Woman` / `MiniMax · Nữ`
5. Select `MiniMax Natural 4 giọng`.
6. Press play from a narrator segment; first file should use `male-qn-qingse` through resolver.
7. Click/advance to a `female` role segment if one exists; generated filename/cache metadata should show `minimax-mandarin-mature-woman` and raw provider voice should be `Chinese (Mandarin)_Mature_Woman`.
8. Confirm no API key appears in browser network payloads except if using old client-side `ttsService.ts`; server `/api/books/:bookId/chapters/:chapterId/tts` must be the Reader path.

---

## MiniMax Code M3 handoff prompt

Use this prompt for MiniMax Code. Do not include secrets.

```txt
Sếp wants Trạm Đọc to enable MiniMax Provider and multi-voice reading. Use model MiniMax-M3. Work in /Users/nguyenphong/projects/tramdoc. Follow AGENTS.md. Read docs/plans/2026-06-01-minimax-provider-multivoice.md fully before editing.

Implement the plan task-by-task:
1. Add safe MiniMax voice/profile catalog.
2. Resolve safe IDs/profile roles to raw MiniMax voice_id server-side.
3. Add 4 approved MiniMax voices to Reader settings with clear labels:
   - male-qn-qingse = Nam/kể chuyện
   - Chinese (Mandarin)_News_Anchor = formal/phát thanh
   - Chinese (Mandarin)_Gentleman = Nam/thoại nam
   - Chinese (Mandarin)_Mature_Woman = Nữ/thoại nữ
4. Implement multi-voice profile: minimax-profile-vietnamese-natural-v1.
5. Add conservative EPUB role classification for narrator/heading/male/female.
6. Add smoke visibility for role counts and optional MiniMax voice smoke script.

Do not commit secrets. Do not put MINIMAX_API_KEY in client code or committed files. Keep changes surgical. Run:
- server: npm run typecheck && npm run prisma:validate && npm run smoke:epub
- client: npm run build
Report exact files changed and verification output.
```

---

## Final acceptance criteria

- MiniMax provider selectable in Reader settings.
- The 4 user-approved voices are listed with clear gender/role labels.
- Multi-voice profile `MiniMax Natural 4 giọng` exists and uses different MiniMax voices by segment role.
- Raw MiniMax voice IDs with spaces/parentheses never enter URL/file names.
- Cache invalidates correctly when content, role, or resolved profile voice changes.
- Existing Vbee voices continue to work.
- No API keys are committed or exposed in client bundles.
- `server npm run typecheck`, `server npm run prisma:validate`, `server npm run smoke:epub`, and `client npm run build` pass.

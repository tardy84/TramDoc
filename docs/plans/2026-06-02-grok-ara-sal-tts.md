# Grok Ara and Sal TTS Voices Implementation Plan

> **For Codex:** Implement this plan task-by-task. Keep scope narrow: add Grok TTS provider support and expose exactly two app voices: Ara and Sal.

**Goal:** Add Grok TTS voices `Ara` and `Sal` to Trạm Đọc so users can select them for reader playback and offline/book TTS jobs.

**Architecture:** Add a backend `GrokTTSService` that calls xAI TTS with safe public voice IDs resolved by `ttsVoiceCatalog`. Reuse the existing TTS route pipeline, cache identity, offline job flow, and `ttsTextRenderer` expressive path. Add Ara/Sal to the frontend enabled voice list with explicit paid/quota guardrails.

**Tech Stack:** Node/TypeScript, Express, Axios/fetch, Prisma, existing `server/routes/tts.ts`, existing `server/services/ttsVoiceCatalog.ts`, existing `client/src/constants.ts`.

---

## Current code context

Relevant files already exist:

- `server/services/ttsVoiceCatalog.ts`
  - `TtsProvider` currently: `vbee | minimax | azure | gemini | google`.
  - `resolveTtsVoice()` maps safe client IDs to provider/raw voice IDs.
- `server/routes/tts.ts`
  - Instantiates provider services.
  - Uses `resolveTtsVoice()` and `renderTtsText()`.
  - `renderTtsText()` already supports provider `'grok'` for expressive tags.
  - Cache identity already includes `provider`, `cacheVoice`, `expressive`, `rendererVersion`, and rendered text hash.
- `server/services/ttsTextRenderer.ts`
  - Accepts `provider: TtsProvider | 'grok'`.
  - Renders Grok expressive tags when `expressive = true`.
- `client/src/constants.ts`
  - `ENABLED_TTS_VOICES` controls reader/settings/offline voice options.
  - `providerSupportsOfflineBitrate()` currently only supports MiniMax.
- `client/src/components/Reader/SettingsPanel.tsx`
  - Renders `ENABLED_TTS_VOICES`.
- `client/src/components/Reader/OfflineTtsPanel.tsx`
  - Treats Vbee/MiniMax as expensive providers; needs Grok included.

Existing Grok smoke/probe reference files:

- `server/tmp/grok-oauth-tts-probe.py`
- `server/tmp/grok-tts-probe.mjs`
- `server/tmp/grok-tts-smoke/xai-oauth-grok-ara-*.mp3`
- `server/tmp/grok-tts-smoke/xai-oauth-grok-sal-*.mp3`

Known xAI TTS direct request shape from smoke probe:

```json
{
  "text": "...",
  "voice_id": "ara",
  "language": "vi",
  "output_format": { "codec": "mp3", "sample_rate": 24000, "bit_rate": 128000 }
}
```

Endpoint:

```text
POST https://api.x.ai/v1/tts
Authorization: Bearer $XAI_API_KEY
Content-Type: application/json
```

Expected response: `audio/*` bytes, usually MP3.

---

## Non-goals

- Do not add every Grok voice. Only add Ara and Sal.
- Do not rely on Hermes/xAI OAuth in production app code.
- Do not store xAI tokens in frontend code.
- Do not make Grok the default voice unless explicitly approved after QA.
- Do not regenerate existing audio automatically.
- Do not change canonical book text.
- Do not implement LLM prosody annotation in this pass.

---

## Acceptance Criteria

- Backend can synthesize audio using `grok-ara` and `grok-sal` safe voice IDs.
- Raw xAI voice IDs passed to provider are exactly `ara` and `sal`.
- `resolveTtsVoice('grok-ara', role)` returns provider `grok`, cache voice `grok-ara`, provider voice `ara`.
- `resolveTtsVoice('grok-sal', role)` returns provider `grok`, cache voice `grok-sal`, provider voice `sal`.
- `GET/POST` TTS flows that already work for Vbee/MiniMax also work for Grok.
- Expressive mode can render Grok tags through existing `ttsTextRenderer` when explicitly requested.
- Offline/book TTS jobs require confirmation for Grok because it can be expensive.
- Frontend shows Ara and Sal in reader voice settings/offline panel.
- Cache filenames remain safe and do not include raw user text or unsafe provider IDs.
- `npm run typecheck` passes for both server and client.
- A smoke script can generate one short Ara MP3 and one short Sal MP3 when `XAI_API_KEY` is configured.

---

## Task 1: Add Grok provider and voice catalog entries

**Objective:** Let safe frontend voice IDs resolve to raw xAI voice IDs.

**Files:**
- Modify: `server/services/ttsVoiceCatalog.ts`

**Step 1: Extend `TtsProvider`**

Change:

```ts
export type TtsProvider =
    | 'vbee'
    | 'minimax'
    | 'azure'
    | 'gemini'
    | 'google';
```

to:

```ts
export type TtsProvider =
    | 'vbee'
    | 'minimax'
    | 'grok'
    | 'azure'
    | 'gemini'
    | 'google';
```

**Step 2: Add safe Grok map**

Near MiniMax maps, add:

```ts
const GROK_SINGLE_VOICES: Record<string, string> = {
    'grok-ara': 'ara',
    'grok-sal': 'sal',
};
```

**Step 3: Resolve Grok voices before provider-prefix fallbacks**

Add after MiniMax resolution and before existing provider prefixes:

```ts
if (Object.prototype.hasOwnProperty.call(GROK_SINGLE_VOICES, requestVoice)) {
    return {
        requestVoice,
        cacheVoice: requestVoice,
        provider: 'grok',
        providerVoiceId: GROK_SINGLE_VOICES[requestVoice],
    };
}
```

**Step 4: Verify**

```bash
cd server
npm run typecheck
```

Expected: typecheck may fail until `selectTtsService()` handles `grok`; continue to Task 2 if so.

---

## Task 2: Implement `GrokTTSService`

**Objective:** Add xAI TTS provider service with safe config checks and MP3 output.

**Files:**
- Create: `server/services/grokTTS.ts`

**Implementation:**

```ts
const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_TTS_API_URL = process.env.XAI_TTS_API_URL || 'https://api.x.ai/v1/tts';

type GrokTtsOptions = {
    bitrate?: number;
};

export class GrokTTSService {
    async synthesize(
        text: string,
        _role: 'narrator' | 'male' | 'female' | string,
        voiceOverride?: string,
        options?: GrokTtsOptions
    ): Promise<Buffer> {
        if (!XAI_API_KEY) {
            throw new Error('Grok TTS is not configured on the server (missing XAI_API_KEY).');
        }

        const voiceId = voiceOverride || 'ara';
        if (voiceId !== 'ara' && voiceId !== 'sal') {
            throw new Error(`Unsupported Grok voice: ${voiceId}`);
        }

        const response = await fetch(XAI_TTS_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${XAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                voice_id: voiceId,
                language: 'vi',
                output_format: {
                    codec: 'mp3',
                    sample_rate: 24000,
                    bit_rate: options?.bitrate ?? 128000,
                },
            }),
        });

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || '';

        if (!response.ok) {
            const errorText = buffer.toString('utf8').slice(0, 1000);
            throw new Error(`Grok TTS failed: HTTP ${response.status} ${errorText}`);
        }

        if (!contentType.startsWith('audio/')) {
            const errorText = buffer.toString('utf8').slice(0, 500);
            throw new Error(`Grok TTS expected audio/*, got ${contentType}: ${errorText}`);
        }

        return buffer;
    }
}
```

**Notes:**

- Use built-in `fetch` if Node runtime supports it. If TypeScript complains, use `axios` with `responseType: 'arraybuffer'` like Vbee/MiniMax.
- Do not log full text or API key.
- Keep `voiceOverride` restricted to `ara | sal`.

**Verify:**

```bash
cd server
npm run typecheck
```

---

## Task 3: Wire Grok into TTS routes

**Objective:** Let existing segment/chapter/book TTS generation select Grok service.

**Files:**
- Modify: `server/routes/tts.ts`

**Step 1: Import and instantiate service**

Add imports near other provider services:

```ts
import { GrokTTSService } from '../services/grokTTS.js';
```

Add instance near other providers:

```ts
const grokTTS = new GrokTTSService();
```

**Step 2: Add provider switch case**

Update `selectTtsService(provider)`:

```ts
case 'grok':
    return grokTTS;
```

**Step 3: Add provider config check**

Update `getMissingProviderConfig(voice)`:

```ts
if (voice.startsWith('grok-')) {
    if (!process.env.XAI_API_KEY) return 'Grok TTS is not configured';
    return null;
}
```

**Step 4: Add Grok book-job pacing**

Update `getBookJobDelayMs(voice)`:

```ts
if (voice.startsWith('grok-')) return 250;
```

**Step 5: Treat Grok as paid provider in job confirmation**

In `/books/:bookId/tts/jobs`, change:

```ts
if ((voice.startsWith('vbee-') || voice.startsWith('minimax-')) && req.body.confirmExpensiveProvider !== true) {
```

to:

```ts
if ((voice.startsWith('vbee-') || voice.startsWith('minimax-') || voice.startsWith('grok-')) && req.body.confirmExpensiveProvider !== true) {
```

Update error copy:

```ts
error: 'Tạo toàn bộ sách bằng Vbee/MiniMax/Grok có thể chậm và tốn quota. Vui lòng xác nhận trước khi chạy.'
```

**Step 6: Keep existing rendering behavior**

No change should be needed for `renderTtsText()` because it already accepts provider `'grok'` and renders tags only when `expressive=true`.

**Verify:**

```bash
cd server
npm run typecheck
```

---

## Task 4: Make cache metadata include rendered/expressive identity correctly

**Objective:** Ensure Grok expressive/plain audio do not collide.

**Files:**
- Inspect/modify: `server/routes/tts.ts`

**Existing good behavior to preserve:**

`buildSegmentAudioIdentity()` already includes:

```ts
const cacheMaterial = JSON.stringify({
    segmentId: segment.id ?? null,
    provider: resolved.provider,
    cacheVoice,
    expressive,
    rendererVersion: rendered.rendererVersion,
    text: rendered.text,
});
```

**Required check:**

- Confirm `resolved.provider === 'grok'` participates in the hash.
- Confirm `rendered.text` is passed to `ttsService.synthesize()`.
- Confirm filename uses safe `grok-ara` / `grok-sal`, never raw text.

**If metadata hash still uses `getSegmentContentHash(segment, cacheVoice)` only:**

Leave it if filename hash already includes rendered text; however, safer improvement is to include rendered identity in metadata too:

```ts
contentHash: crypto
    .createHash('sha256')
    .update(JSON.stringify({
        content: segment.content,
        role: segment.role,
        voice: cacheVoice,
        expressive,
        renderedText: rendered.text,
    }))
    .digest('hex')
```

Only do this if it does not destabilize existing cache reads more than intended. The filename hash is the primary safety gate.

**Verify:**

```bash
cd server
npm run typecheck
```

---

## Task 5: Add Grok Ara/Sal to frontend voice list

**Objective:** Let users select Ara and Sal in reader settings and offline panel.

**Files:**
- Modify: `client/src/constants.ts`

**Step 1: Add voices to `ENABLED_TTS_VOICES`**

Add near the top of the array, after current default Vbee or before MiniMax:

```ts
{
    id: 'grok-ara',
    name: 'Ara',
    provider: 'Grok · Expressive',
    icon: '✨',
    description: 'Giọng Grok giàu sắc thái, hợp kể chuyện/truyền cảm',
},
{
    id: 'grok-sal',
    name: 'Sal',
    provider: 'Grok · Expressive',
    icon: '🌙',
    description: 'Giọng Grok ấm, hợp đọc truyện dài và hội thoại',
},
```

**Step 2: Keep default unchanged for now**

Do not change:

```ts
export const DEFAULT_TTS_VOICE = 'vbee-n_hn_male_ngankechuyen_ytstable_vc';
```

Reason: Grok is paid/quota-sensitive. Sếp can approve switching default after listening in app.

**Step 3: Update expensive provider helper if present**

If adding a helper is acceptable, add:

```ts
export const isExpensiveTtsVoice = (voice: string) =>
    voice.startsWith('vbee-') || voice.startsWith('minimax-') || voice.startsWith('grok-');
```

Then use it in `OfflineTtsPanel.tsx` instead of duplicating prefix checks.

**Verify:**

```bash
cd client
npm run typecheck
```

If client package has no `typecheck`, run:

```bash
cd client
npm run build
```

---

## Task 6: Update offline TTS panel cost/quality handling for Grok

**Objective:** Make full-book Grok generation explicitly confirmed and storage estimates clear.

**Files:**
- Modify: `client/src/components/Reader/OfflineTtsPanel.tsx`
- Modify: `client/src/services/apiService.ts` if expressive mode is exposed for jobs

**Step 1: Mark Grok as expensive**

Change:

```ts
const isExpensiveProvider = selectedVoice.startsWith('vbee-') || selectedVoice.startsWith('minimax-');
```

to either:

```ts
const isExpensiveProvider = selectedVoice.startsWith('vbee-') || selectedVoice.startsWith('minimax-') || selectedVoice.startsWith('grok-');
```

or import and use `isExpensiveTtsVoice()` from constants.

**Step 2: Update confirm copy**

Change copy that says `Vbee/MiniMax` to `Vbee/MiniMax/Grok`.

**Step 3: Keep bitrate selection disabled for Grok**

`providerSupportsOfflineBitrate()` should remain MiniMax-only unless Grok quality control is fully tested. For Grok, use provider default/high-ish output format server-side.

**Optional Step 4: Expose expressive jobs later**

If this implementation also wants expressive Grok full-book jobs, update `startBookTtsJob()` signature to accept `expressive?: boolean` and pass it in request body. Keep UI toggle out of this pass unless already present.

**Verify:**

```bash
cd client
npm run build
```

---

## Task 7: Add Grok smoke script for Ara/Sal

**Objective:** Verify credentials and provider output independently of the reader UI.

**Files:**
- Create: `server/scripts/smoke-grok-voices.ts`
- Modify: `server/package.json`

**Script implementation:**

```ts
import fs from 'fs/promises';
import path from 'path';
import { GrokTTSService } from '../services/grokTTS.js';

const outDir = path.resolve(process.cwd(), 'tmp', 'grok-ara-sal-smoke');
const service = new GrokTTSService();

const samples = [
    { voice: 'ara', slug: 'ara', text: 'Đây là giọng Ara của Grok cho Trạm Đọc. [pause] Sếp nghe thử xem có hợp đọc truyện không.' },
    { voice: 'sal', slug: 'sal', text: 'Đây là giọng Sal của Grok cho Trạm Đọc. [pause] Giọng này dùng để đọc sách dài và hội thoại.' },
];

await fs.mkdir(outDir, { recursive: true });

for (const sample of samples) {
    const buffer = await service.synthesize(sample.text, 'narrator', sample.voice);
    const file = path.join(outDir, `grok-${sample.slug}.mp3`);
    await fs.writeFile(file, buffer);
    console.log(JSON.stringify({ voice: sample.voice, file, bytes: buffer.length }));
}

console.log('[smoke-grok-voices] PASS');
```

Add package script:

```json
"smoke:grok-voices": "tsx scripts/smoke-grok-voices.ts"
```

**Verify with credential:**

```bash
cd server
XAI_API_KEY=... npm run smoke:grok-voices
```

Expected:

- Creates `server/tmp/grok-ara-sal-smoke/grok-ara.mp3`
- Creates `server/tmp/grok-ara-sal-smoke/grok-sal.mp3`
- Logs `[smoke-grok-voices] PASS`

---

## Task 8: Add route-level smoke test for cache/generation

**Objective:** Prove Grok works through the app's normal TTS endpoint, not just direct service.

**Files:**
- Create or modify: `server/scripts/smoke-grok-route.ts` if desired
- Or run manual curl against local dev server

**Manual verification:**

1. Start server:

```bash
cd server
env TRAMDOC_BYPASS_AUTH=1 XAI_API_KEY=... npm run dev
```

2. Use an existing book/chapter with at least one speakable segment.

3. Generate Ara:

```bash
curl -X POST "http://localhost:3005/api/books/:bookId/chapters/:chapterId/tts" \
  -H 'Content-Type: application/json' \
  -d '{"voice":"grok-ara","startSegmentIndex":0}'
```

4. Generate Sal:

```bash
curl -X POST "http://localhost:3005/api/books/:bookId/chapters/:chapterId/tts" \
  -H 'Content-Type: application/json' \
  -d '{"voice":"grok-sal","startSegmentIndex":0}'
```

5. Confirm response contains signed audio URLs and generated files exist under `server/audio/`.

**Expected:**

- Request does not fall back to Google.
- Metadata JSON has `requestVoice: grok-ara` or `grok-sal`.
- Metadata JSON has `providerVoiceId: ara` or `sal`.

---

## Task 9: Document environment variables and cost guardrails

**Objective:** Make production setup and quota behavior explicit.

**Files:**
- Modify: `docs/tts-expressive-mode.md` if present
- Or create: `docs/grok-tts.md`

**Content to include:**

```md
# Grok TTS in Trạm Đọc

## Enabled voices

- `grok-ara` → xAI raw `ara`
- `grok-sal` → xAI raw `sal`

## Required server env

- `XAI_API_KEY`: xAI API key for production/server calls.
- Optional `XAI_TTS_API_URL`: defaults to `https://api.x.ai/v1/tts`.

## Behavior

- Frontend never sees `XAI_API_KEY`.
- Grok is treated as a paid/quota-sensitive provider.
- Full-book/offline generation requires explicit confirmation.
- Expressive tags are only sent when `expressive=true`.
- Existing plain audio cache does not get overwritten automatically.

## Cost note

Grok TTS can be expensive for full books. Prefer chapter-level or missing-only generation during QA.
```

**Verify:**

```bash
cd server
npm run typecheck
```

---

## Task 10: Final verification checklist

Run:

```bash
cd server
npm run prisma:validate
npm run typecheck
XAI_API_KEY=... npm run smoke:grok-voices
```

Run client:

```bash
cd client
npm run build
```

Manual QA:

1. Open reader settings.
2. Confirm voices appear:
   - Ara — Grok · Expressive
   - Sal — Grok · Expressive
3. Select Ara and play a segment.
4. Select Sal and play a segment.
5. Confirm server logs show Grok provider, not Google fallback.
6. Confirm `server/audio/*.mp3.json` metadata includes:

```json
{
  "requestVoice": "grok-ara",
  "providerVoiceId": "ara"
}
```

or:

```json
{
  "requestVoice": "grok-sal",
  "providerVoiceId": "sal"
}
```

7. Start a full-book offline job with Grok and confirm UI warns about quota/cost.
8. Cancel job and confirm cancellation works.
9. Run one missing-only chapter/book job and confirm cached count increases.

---

## Rollback plan

- Remove `grok-ara` and `grok-sal` from `client/src/constants.ts` to hide UI entries.
- Keep `GrokTTSService` code if already deployed; it is inert without UI selection.
- If provider has runtime failures, leave voices hidden and keep Vbee/MiniMax unchanged.
- Existing audio files for `grok-*` can remain in cache; they are isolated by voice/cache key.

---

## Suggested commit sequence

1. `feat(tts): add Grok provider voice catalog entries`
2. `feat(tts): implement Grok TTS service`
3. `feat(tts): wire Grok into generation routes`
4. `feat(reader): expose Grok Ara and Sal voices`
5. `feat(reader): add Grok quota confirmation for offline TTS`
6. `test(tts): add Grok Ara Sal smoke script`
7. `docs(tts): document Grok TTS setup and guardrails`

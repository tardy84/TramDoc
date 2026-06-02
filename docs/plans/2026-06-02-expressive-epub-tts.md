# Expressive EPUB TTS Hints Implementation Plan

> **For Codex:** Implement this plan task-by-task. Keep scope narrow: rule-based EPUB parsing + provider-specific TTS rendering. Do not add LLM annotation in this pass.

**Goal:** Parse EPUB segments into stable `role + ttsHints` metadata so the reader/TTS layer can generate smoother, more expressive audiobook audio without mutating original book text.

**Architecture:** Add a lightweight semantic/prosody layer in the backend. `EpubProcessor` extracts content exactly as today, then assigns `role` and JSON `ttsHints`; TTS providers render those hints into provider-specific markup only at generation time. Grok can use inline tags, MiniMax/Vbee should degrade safely.

**Tech Stack:** Node/TypeScript, Prisma 5, SQLite, Cheerio, existing `server/services/epubProcessor.ts`, existing TTS services/routes.

---

## Non-goals for this pass

- Do not integrate LLM annotation yet.
- Do not rewrite the reader UI.
- Do not alter `TextSegment.content` with Grok/MiniMax tags.
- Do not require all providers to support emotion tags.
- Do not bulk-regenerate existing audio automatically.
- Do not require users to re-upload old EPUBs just to get baseline expressive metadata.

## Acceptance Criteria

- New EPUB uploads persist `TextSegment.ttsHints` as JSON string.
- Existing books with `ttsHints = null` still work.
- Existing books can be reanalyzed from stored `TextSegment.content` via a protected endpoint/job, without re-uploading EPUB files.
- Parser detects at least: heading, dialogue, whisper, shout/angry, question, sad/reflective, suspense, action/excited, scene-break pause candidates.
- `role` inference remains backward compatible: `narrator | heading | male | female | child`.
- A renderer function converts hints to safe Grok-style markup, but strips/degrades for unsupported providers.
- Audio cache key includes the rendered TTS text or hints version so old audio is not accidentally reused for changed expressive markup.
- Reanalysis updates metadata only; it must not delete/regenerate audio files unless a separate explicit TTS job is requested.
- `npm run typecheck`, `npm run prisma:validate`, and `npm run smoke:epub` pass.

---

## Task 1: Add `ttsHints` column to `TextSegment`

**Objective:** Persist semantic/prosody metadata without destabilizing existing schema.

**Files:**
- Modify: `server/prisma/schema.prisma`
- Generate migration via Prisma CLI

**Steps:**

1. In `server/prisma/schema.prisma`, update `TextSegment`:

```prisma
model TextSegment {
  id          Int       @id @default(autoincrement())
  content     String
  startTime   Float?    // Start time in audio file (if consolidated)
  endTime     Float?    // End time in audio file
  role        String    // 'narrator', 'heading', 'male', 'female', 'child'
  ttsHints    String?   // JSON: tone/pace/pitch/pause/confidence/source/version
  chapterId   Int
  chapter     Chapter   @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  orderIndex  Int       @default(0)
  audioUrl    String?   // URL to generated audio for this specific segment (if not consolidated)
  bookmarks   Bookmark[]
}
```

2. Create migration:

```bash
cd server
DATABASE_URL=${DATABASE_URL:-file:./prisma/dev.db} npx prisma migrate dev --name add_text_segment_tts_hints
```

3. Regenerate client:

```bash
npm run prisma:generate
```

4. Verify:

```bash
npm run prisma:validate
npm run typecheck
```

**Expected:** Prisma validates and TS compiles.

---

## Task 2: Create typed TTS hints module

**Objective:** Centralize hint types and JSON helpers so providers and parser share one contract.

**Files:**
- Create: `server/services/ttsHints.ts`

**Implementation:**

```ts
export type TtsTone =
    | 'neutral'
    | 'warm'
    | 'formal'
    | 'reflective'
    | 'sad'
    | 'suspense'
    | 'tense'
    | 'excited'
    | 'angry'
    | 'whisper'
    | 'question';

export type TtsPace = 'normal' | 'slow' | 'fast';
export type TtsPitch = 'normal' | 'low' | 'high';
export type TtsHintSource = 'rules-v1' | 'manual' | 'unknown';

export interface TtsHints {
    version: 1;
    tone: TtsTone;
    pace: TtsPace;
    pitch: TtsPitch;
    pauseBeforeMs: number;
    pauseAfterMs: number;
    intensity: number; // 0..1
    confidence: number; // 0..1
    source: TtsHintSource;
    isDialogue?: boolean;
    isSceneBreak?: boolean;
    reason?: string[];
}

export const DEFAULT_TTS_HINTS: TtsHints = {
    version: 1,
    tone: 'neutral',
    pace: 'normal',
    pitch: 'normal',
    pauseBeforeMs: 0,
    pauseAfterMs: 0,
    intensity: 0,
    confidence: 0.5,
    source: 'rules-v1',
};

export function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export function serializeTtsHints(hints: TtsHints): string {
    return JSON.stringify({
        ...hints,
        pauseBeforeMs: Math.max(0, Math.round(hints.pauseBeforeMs || 0)),
        pauseAfterMs: Math.max(0, Math.round(hints.pauseAfterMs || 0)),
        intensity: clamp01(hints.intensity),
        confidence: clamp01(hints.confidence),
    });
}

export function parseTtsHints(value: string | null | undefined): TtsHints {
    if (!value) return DEFAULT_TTS_HINTS;
    try {
        const parsed = JSON.parse(value) as Partial<TtsHints>;
        return {
            ...DEFAULT_TTS_HINTS,
            ...parsed,
            version: 1,
            tone: parsed.tone || DEFAULT_TTS_HINTS.tone,
            pace: parsed.pace || DEFAULT_TTS_HINTS.pace,
            pitch: parsed.pitch || DEFAULT_TTS_HINTS.pitch,
            pauseBeforeMs: Math.max(0, Math.round(parsed.pauseBeforeMs || 0)),
            pauseAfterMs: Math.max(0, Math.round(parsed.pauseAfterMs || 0)),
            intensity: clamp01(parsed.intensity ?? DEFAULT_TTS_HINTS.intensity),
            confidence: clamp01(parsed.confidence ?? DEFAULT_TTS_HINTS.confidence),
            source: parsed.source || DEFAULT_TTS_HINTS.source,
        };
    } catch {
        return DEFAULT_TTS_HINTS;
    }
}
```

**Verify:**

```bash
cd server
npm run typecheck
```

---

## Task 3: Create rule-based EPUB prosody analyzer

**Objective:** Infer tone/pace/pitch/pause from Vietnamese text + HTML block context.

**Files:**
- Create: `server/services/epubProsodyAnalyzer.ts`
- Uses: `server/services/ttsHints.ts`

**Implementation notes:**

Create:

```ts
import { DEFAULT_TTS_HINTS, TtsHints } from './ttsHints.js';

export type SegmentRole = 'narrator' | 'heading' | 'male' | 'female' | 'child';

export interface ProsodyContext {
    isHeading?: boolean;
    tagName?: string;
    blockClass?: string;
    blockId?: string;
    previousText?: string;
    previousRole?: SegmentRole;
}

export interface ProsodyResult {
    role: SegmentRole;
    hints: TtsHints;
}
```

Add exported function:

```ts
export function inferProsody(text: string, initialRole: SegmentRole, context: ProsodyContext = {}): ProsodyResult {
    const normalized = normalizeForComparison(text);
    const reasons: string[] = [];
    let role = initialRole;
    const hints: TtsHints = { ...DEFAULT_TTS_HINTS, reason: reasons };

    if (context.isHeading || role === 'heading') {
        return {
            role: 'heading',
            hints: {
                ...hints,
                tone: 'formal',
                pace: 'slow',
                pitch: 'normal',
                pauseBeforeMs: 300,
                pauseAfterMs: 800,
                intensity: 0.35,
                confidence: 0.95,
                reason: ['heading'],
            },
        };
    }

    const isDialogue = hasDialogueMarker(text);
    if (isDialogue) {
        hints.isDialogue = true;
        hints.confidence = Math.max(hints.confidence, 0.7);
        reasons.push('dialogue-marker');
    }

    const speakerRole = inferSpeakerRole(normalized);
    if (speakerRole) {
        role = speakerRole;
        hints.confidence = Math.max(hints.confidence, 0.82);
        reasons.push(`speaker-${speakerRole}`);
    }

    applyEmotionRules(normalized, text, hints, reasons);
    applyPunctuationRules(text, hints, reasons);
    applyHtmlContextRules(context, hints, reasons);

    if (isDialogue && role === 'narrator' && context.previousRole && context.previousRole !== 'heading') {
        role = context.previousRole;
        hints.confidence = Math.max(hints.confidence, 0.62);
        reasons.push('dialogue-previous-role-carry');
    }

    return { role, hints };
}
```

Rules to include:

- Dialogue markers: `“...”`, `"..."`, `‘...’`, leading `- `, leading `— `.
- Female role markers: `nàng nói`, `cô nói`, `bà nói`, `mẹ nói`, `chị nói`, `giọng nàng`, `giọng cô`.
- Male role markers: `chàng nói`, `anh nói`, `ông nói`, `bố nói`, `cha nói`, `hắn nói`, `giọng ông`, `giọng hắn`.
- Whisper: `thì thầm`, `nói nhỏ`, `khẽ nói`, `rì rầm`.
- Angry/shout: `gào`, `hét`, `quát`, `giận`, `cáu`, `gầm lên`.
- Sad: `khóc`, `nước mắt`, `thở dài`, `buồn`, `đau đớn`, `cô đơn`, `tiếc nuối`.
- Suspense/tense: `im lặng`, `bóng tối`, `lạnh gáy`, `rùng mình`, `máu`, `chết`, `dao`, `súng`, `tiếng chân`, `cánh cửa`, `lén lút`.
- Excited/action: `lao tới`, `chạy`, `đuổi theo`, `vụt`, `nổ tung`, `vỡ tung`, `nhanh`.
- Question: `?`, `hỏi`, `tại sao`, `vì sao`, `sao lại`.
- Ellipsis `…` or `...`: add pause 250-500ms, reflective/suspense depending keywords.
- Exclamation `!`: increase intensity. If dialogue + angry marker, tone `angry`; otherwise `excited`.
- Blockquote: tone `reflective`, pace `slow`, pauseBefore 300, pauseAfter 500.

Policy:

- Never set `confidence > 0.9` except headings or explicit speaker/emotion markers.
- Prefer `pauseAfterMs` and `pace` over strong tags.
- If multiple tones match, priority: `whisper > angry > suspense > sad > excited > question > reflective > neutral`.

**Verify:**

```bash
cd server
npm run typecheck
```

---

## Task 4: Add a local smoke script for analyzer examples

**Objective:** Let Codex verify deterministic labels without adding a full test framework.

**Files:**
- Create: `server/scripts/smoke-epub-prosody.ts`
- Modify: `server/package.json`

**Script cases:**

```ts
import { inferProsody } from '../services/epubProsodyAnalyzer.js';

const cases = [
    { text: 'Chương Một', role: 'heading' as const, expectTone: 'formal', expectRole: 'heading' },
    { text: '“Đừng lại gần,” cô thì thầm.', role: 'narrator' as const, expectTone: 'whisper', expectRole: 'female' },
    { text: '“Cút đi!” hắn quát.', role: 'narrator' as const, expectTone: 'angry', expectRole: 'male' },
    { text: 'Bên ngoài, tiếng chân dừng lại trước cửa.', role: 'narrator' as const, expectTone: 'suspense', expectRole: 'narrator' },
    { text: 'Nàng thở dài, nước mắt lặng lẽ rơi.', role: 'narrator' as const, expectTone: 'sad', expectRole: 'female' },
];

for (const c of cases) {
    const result = inferProsody(c.text, c.role, { isHeading: c.role === 'heading' });
    console.log(c.text, result);
    if (result.role !== c.expectRole || result.hints.tone !== c.expectTone) {
        throw new Error(`Unexpected result for ${c.text}: ${JSON.stringify(result)}`);
    }
}

console.log('[smoke-epub-prosody] PASS');
```

Add package script:

```json
"smoke:epub-prosody": "tsx scripts/smoke-epub-prosody.ts"
```

**Verify:**

```bash
cd server
npm run smoke:epub-prosody
npm run typecheck
```

---

## Task 5: Wire prosody into `EpubProcessor`

**Objective:** New uploads create text segments with role + serialized hints.

**Files:**
- Modify: `server/services/epubProcessor.ts`

**Current touchpoints:**
- `type SegmentRole` around line 11.
- `processChapter()` around lines 330-365.
- `extractSegments()` around lines 370-437.
- Current arrays: `segmentTexts`, `segmentRoles`.

**Implementation approach:**

1. Import helpers:

```ts
import { inferProsody } from './epubProsodyAnalyzer.js';
import { serializeTtsHints } from './ttsHints.js';
```

2. Extend extraction return shape:

```ts
type ExtractedSegment = {
    text: string;
    role: SegmentRole;
    ttsHints: string;
};
```

3. Minimal-change option: keep current arrays internally, but before DB insert compute hints:

```ts
const segmentData = segmentTexts.map((content, i) => {
    const initialRole = segmentRoles[i] as SegmentRole;
    const previousRole = i > 0 ? (segmentRoles[i - 1] as SegmentRole) : undefined;
    const prosody = inferProsody(content, initialRole, { previousRole });
    segmentRoles[i] = prosody.role;
    return {
        content,
        role: prosody.role as any,
        ttsHints: serializeTtsHints(prosody.hints),
        chapterId: chapter.id,
        orderIndex: i,
    };
});
```

4. Better option if Codex has time: preserve HTML block context in `extractSegments()`:

- Add parallel `segmentContexts` array with `tagName`, `blockClass`, `blockId`, `isHeading`, `isBlockquote`.
- Pass it into `inferProsody()` so blockquote/heading is more accurate.

**Verify:**

```bash
cd server
npm run typecheck
npm run smoke:epub
```

**Manual DB check:**

```bash
cd server
DATABASE_URL=${DATABASE_URL:-file:./prisma/dev.db} npx prisma studio
```

Open `TextSegment`, confirm new imported segments have non-null `ttsHints` JSON.

---

## Task 6: Create provider-specific expressive renderer

**Objective:** Render hints into TTS request text safely at generation time.

**Files:**
- Create: `server/services/ttsTextRenderer.ts`
- Uses: `server/services/ttsHints.ts`
- Uses provider type from `server/services/ttsVoiceCatalog.ts`

**Implementation:**

```ts
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

    // Safe default: unsupported providers get clean text.
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

    // Limit dramatic stacking.
    const selectedTags = tags.slice(0, 2);
    for (const tag of selectedTags) {
        text = `<${tag}>${text}</${tag}>`;
    }

    if (hints.pauseAfterMs >= 700) text += ' [long-pause]';
    else if (hints.pauseAfterMs >= 250) text += ' [pause]';

    return text;
}
```

**Verify:**

```bash
cd server
npm run typecheck
```

---

## Task 7: Wire renderer into TTS generation path

**Objective:** Actual TTS calls receive rendered expressive text when enabled.

**Files to inspect/modify:**
- `server/routes/tts.ts`
- `server/services/ttsBookJobs.ts`
- `server/services/minimaxTTS.ts`
- `server/services/vbeeTTS.ts`
- Future/if present: `server/services/grokTTS.ts`

**Implementation guidance:**

1. Find where `TextSegment.content` is passed into provider generation.
2. Load/select `segment.ttsHints` along with `content`, `role`.
3. Resolve provider using existing `resolveTtsVoice(requestVoice, role)`.
4. Call:

```ts
const rendered = renderTtsText({
    content: segment.content,
    ttsHints: segment.ttsHints,
    provider: resolved.provider,
    expressive: req.query.expressive === '1' || req.body?.expressive === true,
});
```

5. Pass `rendered.text` to the provider instead of raw `segment.content`.

6. Default `expressive` should be `false` until Grok service is fully production-ready. For Grok expressive smoke tests, allow explicit opt-in.

**Important:** if provider enum does not yet include Grok, add `grok` only when implementing Grok service. Otherwise keep renderer ready but unused for Grok.

**Verify:**

```bash
cd server
npm run typecheck
npm run smoke:tts-book-job
```

---

## Task 8: Include renderer/hints in audio cache identity

**Objective:** Avoid reusing plain audio when expressive markup changes.

**Files to inspect/modify:**
- `server/routes/tts.ts`
- `server/services/ttsBookJobs.ts`
- Any utility that builds audio filename/cache key from text/voice/provider.

**Required cache key inputs:**

- segment id or content hash
- provider
- concrete voice/cacheVoice
- expressive flag
- `rendered.text` hash OR `segment.ttsHints + rendererVersion`

**Suggested approach:**

```ts
const cacheMaterial = JSON.stringify({
    segmentId: segment.id,
    provider: resolved.provider,
    cacheVoice: resolved.cacheVoice,
    expressive,
    rendererVersion: rendered.rendererVersion,
    text: rendered.text,
});
```

Then hash `cacheMaterial` for filename. Do not put raw provider voice IDs or raw text in filenames.

**Verify:**

- Generate same segment with `expressive=false`, note URL/path.
- Generate same segment with `expressive=true`, path must differ.
- Generate again with same expressive flag, path should reuse cache.

---

## Task 9: Add API/debug visibility for hints

**Objective:** Make it easy to inspect parser output without reading DB manually.

**Files to inspect/modify:**
- `server/routes/books.ts`

**Implementation guidance:**

- If segment endpoint already returns `role`, include `ttsHints` as parsed object or raw string.
- Prefer parsed object only if response shape is clearly internal/debug. If client consumes this endpoint, raw string is acceptable but less useful.
- Do not expose provider secrets.

**Verify:**

```bash
curl "$API/books/:bookId/chapters/:chapterId" | jq '.segments[0]'
```

Expected includes:

```json
{
  "content": "...",
  "role": "narrator",
  "ttsHints": "{...}"
}
```

---

## Task 10: Add EPUB parser smoke validation for hints

**Objective:** Ensure smoke import proves hints are persisted.

**Files:**
- Modify: `server/scripts/smoke-epub-parser.ts`

**Steps:**

1. After smoke import, query a handful of `TextSegment` rows.
2. Assert:
   - At least one segment exists.
   - Every new segment has `role`.
   - At least 80% of sampled segments have non-null `ttsHints`.
   - `ttsHints` parses as JSON and has `version: 1`, `tone`, `pace`, `confidence`.

**Verify:**

```bash
cd server
npm run smoke:epub
```

Expected: smoke passes and logs summary like:

```text
[smoke-epub] ttsHints coverage: 48/50 sampled segments
```

---

## Task 11: Add metadata-only reanalysis for existing books

**Objective:** Let old books receive baseline `ttsHints` without forcing users to re-upload EPUBs or regenerate audio.

**Important behavior:** This task updates DB metadata only. It must not delete existing `audioUrl`, remove cached files, or call any TTS provider. Existing audio continues to work for non-expressive playback. Expressive audio is generated later only when a separate explicit TTS request/job asks for it.

**Files:**
- Create: `server/services/ttsHintsBackfill.ts`
- Modify: `server/routes/books.ts`
- Optionally modify: `server/package.json` for a smoke script

**Implementation guidance:**

1. Create a reusable service:

```ts
import { PrismaClient } from '@prisma/client';
import { inferProsody, SegmentRole } from './epubProsodyAnalyzer.js';
import { serializeTtsHints } from './ttsHints.js';

export interface ReanalyzeBookTtsHintsResult {
    bookId: number;
    totalSegments: number;
    updatedSegments: number;
    skippedSegments: number;
    toneCounts: Record<string, number>;
}

export interface ReanalyzeBookTtsHintsOptions {
    force?: boolean;
    batchSize?: number;
}

export async function reanalyzeBookTtsHints(
    prisma: PrismaClient,
    bookId: number,
    userId: number,
    options: ReanalyzeBookTtsHintsOptions = {}
): Promise<ReanalyzeBookTtsHintsResult> {
    const book = await prisma.book.findFirst({
        where: { id: bookId, userId },
        select: { id: true },
    });
    if (!book) throw new Error('Book not found');

    const segments = await prisma.textSegment.findMany({
        where: { chapter: { bookId } },
        orderBy: [
            { chapter: { orderIndex: 'asc' } },
            { orderIndex: 'asc' },
        ],
        select: { id: true, content: true, role: true, ttsHints: true, orderIndex: true },
    });

    let updatedSegments = 0;
    let skippedSegments = 0;
    const toneCounts: Record<string, number> = {};
    let previousRole: SegmentRole | undefined;
    let previousText: string | undefined;

    for (const segment of segments) {
        if (segment.ttsHints && !options.force) {
            skippedSegments += 1;
            previousRole = segment.role as SegmentRole;
            previousText = segment.content;
            continue;
        }

        const initialRole = (segment.role || 'narrator') as SegmentRole;
        const result = inferProsody(segment.content, initialRole, { previousRole, previousText });
        toneCounts[result.hints.tone] = (toneCounts[result.hints.tone] || 0) + 1;

        await prisma.textSegment.update({
            where: { id: segment.id },
            data: {
                role: result.role,
                ttsHints: serializeTtsHints(result.hints),
            },
        });

        updatedSegments += 1;
        previousRole = result.role;
        previousText = segment.content;
    }

    return {
        bookId,
        totalSegments: segments.length,
        updatedSegments,
        skippedSegments,
        toneCounts,
    };
}
```

2. Add a protected endpoint in `server/routes/books.ts` near the existing book routes:

```ts
router.post('/books/:id/reanalyze-tts-hints', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const bookId = parsePositiveInt(req.params.id);
        if (!bookId) return res.status(400).json({ error: 'Book ID không hợp lệ' });

        const force = req.query.force === '1' || req.body?.force === true;
        const result = await reanalyzeBookTtsHints(prisma, bookId, req.user.id, { force });
        res.json(result);
    } catch (error: any) {
        if (error.message === 'Book not found') return res.status(404).json({ error: 'Book not found' });
        res.status(500).json({ error: error.message });
    }
});
```

3. Import service at top of `server/routes/books.ts`:

```ts
import { reanalyzeBookTtsHints } from '../services/ttsHintsBackfill.js';
```

4. Add these response semantics:

- `force=false` default: only segments where `ttsHints IS NULL` are updated.
- `force=true`: recompute all segments for the book.
- Always enforce `book.userId === req.user.id`.
- Return counts and tone distribution.
- Do not modify `audioUrl`; this is metadata-only.

**Limitations to document:**

- Reanalysis from existing `TextSegment.content` cannot recover lost EPUB HTML context (`blockquote`, `epub:type`, exact stanza layout) if the original EPUB file was deleted after upload.
- It still catches most light expressive cases: dialogue markers, speaker attribution, emotional keywords, punctuation, and pause hints.
- If the original EPUB needs perfect semantic parsing, user must re-upload or backend must retain original EPUB files in a future feature.

**Verify:**

```bash
cd server
npm run typecheck
```

Manual/API verification:

```bash
curl -X POST "${API}/books/:bookId/reanalyze-tts-hints" -H '<auth header>'
curl -X POST "${API}/books/:bookId/reanalyze-tts-hints?force=1" -H '<auth header>'
```

Expected first response shape:

```json
{
  "bookId": 123,
  "totalSegments": 420,
  "updatedSegments": 420,
  "skippedSegments": 0,
  "toneCounts": { "neutral": 300, "suspense": 30, "whisper": 8 }
}
```

Then inspect a segment: `ttsHints` is non-null, `audioUrl` remains unchanged.

---

## Task 12: Document expressive modes and provider behavior

**Objective:** Prevent future confusion about why Vbee/MiniMax/Grok behave differently.

**Files:**
- Create or modify: `docs/tts-expressive-mode.md`

**Content outline:**

- `TextSegment.content` remains clean text.
- `TextSegment.role` chooses voice profile.
- `TextSegment.ttsHints` controls tone/pace/pause.
- Provider behavior:
  - Grok: can render inline tags such as `<whisper>`, `<slow>`, `[pause]`.
  - MiniMax: currently receives clean text unless specific MiniMax emotion support is later wired.
  - Vbee: clean text only.
- Expressive mode must be explicit opt-in until QA accepts quality.
- Cache keys must include renderer version/hints.
- Existing books do not need EPUB re-upload for baseline `ttsHints`; use `POST /books/:id/reanalyze-tts-hints`.
- Reanalysis is metadata-only and does not regenerate audio. Existing audio files remain valid for plain playback.
- Perfect HTML-aware reanalysis needs the original EPUB file; segment-only backfill is a practical 70-85% fallback.

**Verify:**

```bash
cd server
npm run typecheck
```

---

## Final verification checklist

Run from repo root/server:

```bash
cd server
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run smoke:epub-prosody
npm run smoke:epub
npm run smoke:tts-book-job
```

Manual QA:

1. Upload/import an EPUB.
2. Inspect first real chapter segments in DB or API.
3. Confirm `role` still looks sane.
4. Confirm `ttsHints` has varied tones only where obvious, not every segment dramatic.
5. Pick an existing old book with null `ttsHints` and call `POST /books/:id/reanalyze-tts-hints`.
6. Confirm old book now has non-null `ttsHints` and existing `audioUrl` values were not changed.
7. Generate one plain TTS segment and one expressive TTS segment.
8. Confirm cache paths differ.
9. Listen to 3 samples:
   - neutral narration
   - whisper dialogue
   - suspense narration

---

## Rollback plan

- If parsing quality is bad, keep `ttsHints` column but set `expressive=false` by default; app remains functionally unchanged.
- If Prisma migration causes trouble, revert migration and schema change; parser can still run with role-only behavior.
- If provider markup sounds bad, disable only renderer expressive path; keep metadata for future tuning.

---

## Suggested commit sequence

1. `feat(tts): add TextSegment ttsHints schema field`
2. `feat(tts): add typed TTS hints helpers`
3. `feat(epub): infer rule-based prosody hints`
4. `test(epub): add prosody smoke script`
5. `feat(epub): persist tts hints for imported segments`
6. `feat(tts): add provider-specific text renderer`
7. `feat(tts): include expressive renderer in cache key`
8. `feat(tts): add metadata-only tts hints reanalysis for existing books`
9. `docs(tts): document expressive EPUB mode`

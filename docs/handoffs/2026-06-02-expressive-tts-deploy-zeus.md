# Handoff: Deploy expressive EPUB TTS hints + backfill endpoint

Repo: `/Users/nguyenphong/projects/tramdoc`  
Backend remote currently used by app: `commocsan.cloud` / production API origin.

## Context

Codex đã implement local:

- `TextSegment.ttsHints` Prisma field + migration
- Rule-based prosody analyzer
- Persist `ttsHints` for new EPUB uploads
- TTS renderer/cache identity update
- Metadata-only backfill endpoint:
  - `POST /api/books/:id/reanalyze-tts-hints`
  - Optional force recompute: `?force=1`
- Client UI:
  - Book card shows `HINT OK`, `HINT xx%`, or `NO HINT`
  - `Backfill` button calls endpoint above

## Problem

App đang gọi production API, không phải local `localhost:3005`.
When clicking Backfill, production returns `404`, meaning remote backend does not have the new route deployed yet.

Expected behavior after deploy:

- unauthenticated `POST /api/books/1/reanalyze-tts-hints` should return `401`, not `404`
- authenticated call should backfill `ttsHints`

## Files changed locally relevant to deploy

Server:

- `server/prisma/schema.prisma`
- `server/prisma/migrations/20260602062928_add_text_segment_tts_hints/migration.sql`
- `server/services/ttsHints.ts`
- `server/services/epubProsodyAnalyzer.ts`
- `server/services/ttsHintsBackfill.ts`
- `server/services/ttsTextRenderer.ts`
- `server/services/epubProcessor.ts`
- `server/routes/books.ts`
- `server/routes/tts.ts`
- `server/services/ttsBookJobs.ts`
- `server/scripts/smoke-epub-prosody.ts`
- `server/scripts/smoke-epub-parser.ts`
- `server/package.json`

Client:

- `client/src/App.tsx`
- `client/src/components/Library/BookCard.tsx`
- `client/src/services/apiService.ts`
- `client/src/types.ts`

Docs:

- `docs/tts-expressive-mode.md`

## Deploy steps on production server

```bash
cd /path/to/tramdoc

git pull

cd server
npm ci
npx prisma migrate deploy
npm run prisma:generate
npm run typecheck
npm run prisma:validate

# restart backend process
# e.g. pm2 restart <app> OR systemctl restart <service> OR docker compose restart
```

Then client if production frontend is deployed separately:

```bash
cd ../client
npm ci
npm run build
# deploy dist/ according to current setup
```

## Verification

Backend route exists:

```bash
curl -i -X POST https://<API_DOMAIN>/api/books/1/reanalyze-tts-hints
```

Expected without auth:

```txt
401 Unauthorized
```

Not expected:

```txt
404 Not Found
```

Authenticated test:

```bash
curl -X POST "https://<API_DOMAIN>/api/books/<bookId>/reanalyze-tts-hints" \
  -H "Authorization: Bearer <token>"
```

Expected JSON:

```json
{
  "bookId": 123,
  "totalSegments": 420,
  "updatedSegments": 420,
  "skippedSegments": 0,
  "toneCounts": {
    "neutral": 300,
    "suspense": 30
  }
}
```

Force recompute all:

```bash
curl -X POST "https://<API_DOMAIN>/api/books/<bookId>/reanalyze-tts-hints?force=1" \
  -H "Authorization: Bearer <token>"
```

## Important behavior

Backfill endpoint is metadata-only:

- Updates only `TextSegment.role` and `TextSegment.ttsHints`
- Must not regenerate audio
- Must not delete cache
- Must not modify `audioUrl`

## Local verification already passed

From `server/`:

- `npm run prisma:validate` ✅
- `npm run prisma:generate` ✅
- `npm run typecheck` ✅
- `npm run smoke:epub-prosody` ✅
- `npm run smoke:epub` ✅
- `npm run smoke:tts-book-job` ✅

From `client/`:

- `npm run build` ✅
- `npm run lint` ✅

## Notes

If `https://commocsan.cloud` has SSL hostname mismatch, verify actual API origin used by production client (`VITE_API_URL` or nginx config). The fix still requires deploying server changes to whichever backend origin the app calls.

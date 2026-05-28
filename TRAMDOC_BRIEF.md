# Trạm Đọc Project Brief

## Mission

Build and improve **Trạm Đọc** as a Vietnamese-first reading station: upload EPUBs, read comfortably, track progress/bookmarks, and optionally generate/listen to audiobook/TTS.

## Current product capabilities observed in code

- Login using `ADMIN_USERNAME` / `ADMIN_PASSWORD` from server env, with JWT stored client-side.
- Library of uploaded EPUB books.
- EPUB upload with polling progress by `jobId`.
- Reader mode with chapters/segments, audio controls, progress persistence, and bookmarks.
- Dashboard/admin screens for overview and user/book management.
- TTS paths on both client and server:
  - client-side direct Azure/Google/MiniMax/Gemini calls via `client/src/services/ttsService.ts`.
  - server-side provider services under `server/services/*TTS.ts` plus audio route handling.
- SQLite/Prisma models for users, books, chapters, text segments, progress, and bookmarks.

## Product principles

- Vietnamese UX first: natural Vietnamese labels, errors, and reading ergonomics.
- Reading experience over generic SaaS polish: fast library access, clear typography, stable progress sync, simple audiobook controls.
- Personal app assumptions are acceptable, but security-sensitive changes still need care: never expose server secrets or production credentials.
- Offline/local-first improvements are welcome when scoped and tested.

## Near-term improvement themes for Codex

1. **Stabilize local dev/build**
   - Add missing server build/typecheck scripts.
   - Add README setup docs.
   - Ensure `.env.example` files exist without secrets.

2. **TTS reliability**
   - Audit client/server TTS split.
   - Improve provider errors and fallback behavior.
   - Avoid hardcoded keys; keep API key entry/settings clear.

3. **Reader quality**
   - Improve segment navigation, progress save throttling, resume behavior, and bookmark UX.
   - Verify mobile layout and touch targets.

4. **EPUB processing**
   - Handle malformed EPUBs gracefully.
   - Improve metadata/cover extraction.
   - Add fixtures/tests using `test/*.epub` when feasible.

5. **Admin/auth hardening**
   - Replace placeholder secrets in local docs with examples only.
   - Clarify production deployment path and DB backup practices.

## Recommended first Codex slice

Run a repo health check and create minimal setup docs/scripts:

- Add `README.md` with local setup and commands.
- Add `server/.env.example` and `client/.env.example`.
- Add safe server scripts: `build`, `typecheck`, `prisma:validate`, maybe `prisma:generate`.
- Run `npm run build` in `client` and `npx tsc --noEmit` or `npm run typecheck` in `server`.
- Report failures without making unrelated fixes unless the task is explicitly to repair them.

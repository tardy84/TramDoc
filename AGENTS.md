# Trạm Đọc — Codex Working Guide

This repository is the working codebase for **Trạm Đọc**, a personal reading/audiobook app. Treat this file as the primary instruction file for Codex or other coding agents.

## Project context

- Product: EPUB library + reader + audiobook/TTS helper for Vietnamese reading.
- Current repo: `https://github.com/tardy84/TramDoc`.
- Local checkout: `/Users/nguyenphong/projects/tramdoc`.
- Coordination topic: Telegram thread for **Trạm Đọc**. Keep Trạm Đọc decisions, status notes, and follow-up tasks associated with that topic.
- User-facing language: Vietnamese by default.

## Tech stack

- `client/`: React 18 + TypeScript + Vite + Tailwind + Capacitor iOS.
- `server/`: Express 5 + TypeScript + Prisma + SQLite.
- DB schema: `server/prisma/schema.prisma`.
- Runtime server port: `3005` by default.
- Client dev server proxies `/api`, `/covers`, `/audio` to `http://localhost:3005`.

## Important repository layout

```text
client/
  src/App.tsx                         Main app shell, auth/routing/library UI
  src/components/BookReader.tsx        Reader screen
  src/components/Reader/               Reader subcomponents and hooks
  src/components/Library/              Library cards/carousel
  src/components/Admin/                Admin UI
  src/services/apiService.ts           Backend API client, baseURL /api
  src/services/ttsService.ts           Client-side TTS providers and localStorage keys
  vite.config.ts                       Dev proxy config

server/
  index.ts                             Express app bootstrap, static file serving, route mount
  routes/auth.ts                       Login/me/password endpoints
  routes/books.ts                      Upload, library, progress, bookmarks
  routes/tts.ts                        Server-side TTS/audio endpoints
  services/epubProcessor.ts            EPUB parsing/segmentation
  services/*TTS.ts                     Provider-specific server TTS implementations
  prisma/schema.prisma                 SQLite data model
```

## Setup commands

Run commands from the directory shown in each block. There is no root `package.json`.

```bash
# server dependencies
cd /Users/nguyenphong/projects/tramdoc/server
npm ci

# client dependencies
cd /Users/nguyenphong/projects/tramdoc/client
npm ci
```

Create local env only when needed. Do **not** commit `.env` files.

```bash
# /Users/nguyenphong/projects/tramdoc/server/.env
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET="replace-with-local-secret"
ADMIN_USERNAME="admin@example.com"
ADMIN_PASSWORD="replace-with-local-password"
PORT=3005
```

Optional client-side TTS env values are read by Vite and may also be set in the app UI/localStorage:

```bash
# /Users/nguyenphong/projects/tramdoc/client/.env.local
VITE_AZURE_SPEECH_KEY=""
VITE_AZURE_SPEECH_REGION="southeastasia"
VITE_GOOGLE_CLOUD_API_KEY=""
VITE_MINIMAX_API_KEY=""
VITE_GEMINI_API_KEY=""
```

## Local development

Use two terminals:

```bash
# terminal 1 — API server
cd /Users/nguyenphong/projects/tramdoc/server
npx prisma generate
npx prisma migrate dev
npm run dev

# terminal 2 — web client
cd /Users/nguyenphong/projects/tramdoc/client
npm run dev
```

Open the Vite URL printed by the client. The API should answer `GET http://localhost:3005/ping` with `pong`.

## Verification commands

Before proposing changes as done, run the narrowest relevant checks and include the output summary in the handoff.

```bash
# client typecheck + build
cd /Users/nguyenphong/projects/tramdoc/client
npm run build

# client lint, if touching UI/client TS
cd /Users/nguyenphong/projects/tramdoc/client
npm run lint

# server compile sanity, because server/package.json currently has no build script
cd /Users/nguyenphong/projects/tramdoc/server
npx tsc --noEmit

# Prisma sanity, if touching schema/routes/services depending on Prisma
cd /Users/nguyenphong/projects/tramdoc/server
npx prisma generate
npx prisma validate
```

Known caveat: `server/package.json` has a placeholder `npm test` that intentionally exits with error; do not use it as a project health signal until real tests are added.

## Coding rules for Codex

1. Keep changes small and reviewable. Prefer one focused task per branch/PR.
2. Do not commit secrets, EPUB uploads, audio files, DB files, generated `dist/`, `node_modules/`, or `.env*`.
3. Preserve Vietnamese UX copy unless the task explicitly asks for copy changes.
4. Preserve the client proxy model: browser calls `/api`; Vite/nginx forwards to the server.
5. If touching auth, uploads, progress, bookmarks, or TTS, trace both client and server paths before editing.
6. If touching database models, add/update Prisma migration and explain migration risk.
7. Do not make destructive DB/file operations without explicit confirmation.
8. Prefer explicit error handling and user-facing Vietnamese messages for expected failures.
9. Avoid broad formatting churn. Respect existing style: 4-space indentation in most TS/TSX files.
10. If a task is blocked by missing API keys or production credentials, stub/mock locally and document the assumption.

## Common pitfalls

- Root directory has no `package.json`; commands must run in `client/` or `server/`.
- Client TTS keys can come from `import.meta.env` or `localStorage`; avoid hardcoding keys.
- Server mounts `booksRouter` and `ttsRouter` under `/api`, and also mounts `ttsRouter` at `/` for `/audio/:filename`.
- SQLite path is relative to server working directory. Run server commands from `server/` unless deliberately overriding `DATABASE_URL`.
- Test EPUB files live under `test/`; do not remove them unless the task is about fixtures/assets.
- Capacitor/iOS files under `client/ios/` may need `npx cap sync ios` after web build changes; do not edit generated native files casually.

## Handoff format

When finishing a Codex run, report:

- Goal: what task was attempted.
- Changed files: bullet list.
- Verification: commands run and pass/fail status.
- Risks/assumptions: secrets, DB migrations, untested paths, follow-ups.
- Next suggested slice: one small next task.

# Zeus Handoff — Trạm Đọc iOS/TestFlight

Date: 2026-05-30
Owner handoff from: Codex
Repo: `/Users/nguyenphong/projects/tramdoc`

## Goal

Hoàn thiện Trạm Đọc iOS v1 bằng Capacitor để có TestFlight build dùng thật:
login → upload EPUB → đọc sách → chọn Vbee voice → generate/play audio → persist progress/bookmark.

## Current state

### Done in repo

- iOS/Capacitor config exists under `client/ios/`.
- Client API base supports iOS via `VITE_API_URL`:
  - Browser dev falls back to current origin/Vite proxy.
  - iOS/TestFlight must build with public HTTPS API origin.
- `/covers` and `/audio` URLs are resolved through API base for Capacitor.
- TTS UI is temporarily limited to Vbee voices only.
- Browser/system TTS fallback was disabled to prevent reader jumping to later paragraphs/default system voice.
- TTS generation route now prioritizes current segment first instead of scanning/generating whole chapter before playback.
- Added signed audio token flow earlier; current route returns signed `/audio/...` URLs.
- Added iOS API health/CORS check:
  - Server: `GET /api/health`
  - Client script: `npm run ios:smoke-api`
- Added iOS checks/scripts:
  - `npm run ios:validate-env`
  - `npm run ios:smoke-api`
  - `npm run ios:check-native`
  - `npm run ios:preflight`
  - `npm run ios:xcode-check`
  - `npm run ios:set-version -- <version> <build>`
- Added TestFlight checklist: `IOS_TESTFLIGHT_CHECKLIST.md`.
- UX improvements:
  - API network errors now show the API base URL and clearer Vietnamese message.
  - Library load failure shows retry banner.
  - Audio/Vbee errors show banner in reader controls.
  - Upload checks offline before starting; upload job errors stop progress and show toast.

### Current dirty files to review

Run:

```bash
cd /Users/nguyenphong/projects/tramdoc
git status --short
```

Expected notable dirty files:

- `README.md`
- `IOS_TESTFLIGHT_CHECKLIST.md`
- `client/package.json`
- `client/scripts/check-ios-native.mjs`
- `client/scripts/check-xcode.mjs`
- `client/scripts/smoke-ios-api.mjs`
- `client/src/App.tsx`
- `client/src/components/BookReader.tsx`
- `client/src/components/Reader/ReaderControls.tsx`
- `client/src/components/Reader/useReaderAudio.ts`
- `client/src/services/apiService.ts`
- `client/src/utils/errors.ts`
- `server/index.ts`
- `server/routes/tts.ts`

Do not assume all dirty changes are yours; review diffs before editing.

## Verification already run

From Codex run:

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run lint
npm run build
npm run ios:check-native
ALLOW_INSECURE_IOS_API=1 VITE_API_URL=http://localhost:3005 npm run ios:preflight

cd /Users/nguyenphong/projects/tramdoc/server
npm test

cd /Users/nguyenphong/projects/tramdoc
git diff --check
```

All passed.

Known blocked check:

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run ios:xcode-check
```

Currently fails because full Xcode CLI is not active/available:

```text
xcodebuild -version failed. Install/open full Xcode and run: sudo xcode-select -s /Applications/Xcode.app
```

## Remaining blockers before TestFlight

1. Public HTTPS backend domain is required.
   - iPhone/TestFlight cannot use `localhost`.
   - Need deploy `server/` with persistent DB/uploads/covers/audio.

2. Production server env must be configured outside repo.
   - Do not commit/read secrets.
   - Required categories:
     - `DATABASE_URL`
     - `JWT_SECRET`
     - admin username/password
     - `VBEE_APP_ID`
     - `VBEE_TOKEN`
     - `VBEE_CALLBACK_URL=https://<api-domain>/vbee-callback`
     - optional `FRONTEND_URL` for web origin allowlist

3. Xcode is required for archive/upload.
   - Full Xcode app must be installed/opened.
   - `sudo xcode-select -s /Applications/Xcode.app`
   - Apple Developer signing team must be selected.

## Exact next steps for Zeus

### 1. Review diff before touching code

```bash
cd /Users/nguyenphong/projects/tramdoc
git status --short
git diff --stat
git diff -- client/src/components/Reader/useReaderAudio.ts server/routes/tts.ts
```

Check that reader/audio behavior matches intended Vbee-only flow.

### 2. Deploy/verify backend HTTPS

After backend is deployed, verify:

```bash
curl https://<api-domain>/ping
curl -H 'Origin: capacitor://localhost' -i https://<api-domain>/api/health
```

Expected:

- `/ping` returns `pong`.
- `/api/health` returns `{"ok":true}`.
- Response includes `Access-Control-Allow-Origin: capacitor://localhost` or equivalent allowed origin.

### 3. Run iOS preflight against real HTTPS API

```bash
cd /Users/nguyenphong/projects/tramdoc/client
VITE_API_URL=https://<api-domain> npm run ios:preflight
```

This must pass before TestFlight build.

### 4. Build/sync Capacitor iOS

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run ios:set-version -- 1.0 <next-build-number>
VITE_API_URL=https://<api-domain> npm run build:ios
npm run ios:xcode-check
npm run ios:open
```

Notes:

- `build:ios` includes env validation, API smoke, web build, `cap sync ios`, bundle audit.
- Do not use `ALLOW_INSECURE_IOS_API=1` for TestFlight.
- Do not put Vbee/JWT secrets in client env.

### 5. Xcode/TestFlight

In Xcode:

- Confirm Bundle Identifier: `com.tramdoc.app` unless user wants another ID.
- Select signing team.
- Confirm version/build number.
- Archive → Distribute App → App Store Connect → TestFlight.

### 6. Acceptance smoke on iPhone/TestFlight

Use `IOS_TESTFLIGHT_CHECKLIST.md`.

Minimum acceptance:

- Login succeeds.
- Upload EPUB under 50MB succeeds with progress.
- Library refreshes and book appears.
- Reader opens correct chapter/segments.
- Only Vbee voices are shown.
- First playback starts at current segment, not final paragraph.
- Changing Vbee voice does not fall back to system TTS.
- Signed `/audio/...` plays.
- Progress/bookmark persists after logout/relogin.
- If backend/API is unavailable, app shows clear error and retry path.

## Risks / watchouts

- Current server uses SQLite/filesystem. Production must preserve DB/uploads/covers/audio directories across restarts/deploys.
- Vbee generation latency may still depend on provider; server now prioritizes current segment first to reduce initial wait.
- `npm run ios:xcode-check` cannot pass until full Xcode CLI is configured.
- Do not read, print, or commit `.env` or secrets.
- Do not push/deploy without explicit user approval.
- Preserve unrelated dirty changes; this repo has had multiple lanes of changes.

## Useful commands

```bash
# Local dev
cd /Users/nguyenphong/projects/tramdoc/server && npm run dev
cd /Users/nguyenphong/projects/tramdoc/client && npm run dev -- --host 0.0.0.0

# Verification
cd /Users/nguyenphong/projects/tramdoc/client && npm run lint && npm run build && npm run ios:check-native
cd /Users/nguyenphong/projects/tramdoc/server && npm test
cd /Users/nguyenphong/projects/tramdoc && git diff --check

# iOS with real API
cd /Users/nguyenphong/projects/tramdoc/client
VITE_API_URL=https://<api-domain> npm run ios:preflight
VITE_API_URL=https://<api-domain> npm run build:ios
```

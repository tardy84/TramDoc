# Trạm Đọc

Trạm Đọc là ứng dụng đọc EPUB cá nhân, ưu tiên tiếng Việt, có thư viện sách, reader, lưu tiến độ/bookmark và hỗ trợ tạo/nghe audiobook bằng TTS.

## Tech stack

- `client/`: React 18 + TypeScript + Vite + Tailwind + Capacitor iOS.
- `server/`: Express 5 + TypeScript + Prisma + SQLite.
- Server mặc định chạy ở port `3005`.
- Client gọi API qua `/api`; Vite proxy `/api`, `/covers`, `/audio` sang `http://localhost:3005`.

## Cài đặt lần đầu

Repo không có `package.json` ở thư mục gốc. Cài dependencies trong từng thư mục:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm ci

cd /Users/nguyenphong/projects/tramdoc/client
npm ci
```

Tạo file env cục bộ từ file mẫu khi cần:

```bash
cp /Users/nguyenphong/projects/tramdoc/server/.env.example /Users/nguyenphong/projects/tramdoc/server/.env
cp /Users/nguyenphong/projects/tramdoc/client/.env.example /Users/nguyenphong/projects/tramdoc/client/.env.local
```

Không commit `.env`, database SQLite, EPUB upload, audio generated, `dist/` hoặc `node_modules/`.

## Chạy local

Terminal 1 — API server:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npx prisma generate
npx prisma migrate dev
npm run dev
```

Terminal 2 — web client:

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run dev
```

Kiểm tra server:

```bash
curl http://localhost:3005/ping
```

Kết quả mong đợi: `pong`.

## Cấu hình Vbee TTS

Điền key ở `/Users/nguyenphong/projects/tramdoc/server/.env`:

```env
VBEE_APP_ID="your-vbee-app-id"
VBEE_TOKEN="your-vbee-token"
VBEE_CALLBACK_URL="https://localhost/vbee-callback"
```

Nếu Vbee yêu cầu callback public HTTPS, dùng domain/ngrok trỏ về server:

```env
VBEE_CALLBACK_URL="https://your-domain.com/vbee-callback"
```

Server có endpoint `POST /vbee-callback`, nhưng app vẫn chủ động poll Vbee để lấy audio.
Sau khi sửa `.env`, restart server.

## Build iOS bằng Capacitor

Repo đã có project Capacitor ở `/Users/nguyenphong/projects/tramdoc/client/ios`.
Bản iOS/TestFlight không dùng được `localhost` của máy dev, nên cần deploy server lên public HTTPS trước.
Checklist chi tiết nằm ở `/Users/nguyenphong/projects/tramdoc/IOS_TESTFLIGHT_CHECKLIST.md`.

1. Deploy backend và kiểm tra API:

```bash
curl https://api.your-domain.com/ping
curl -H 'Origin: capacitor://localhost' -i https://api.your-domain.com/api/health
```

Trên backend production, set `FRONTEND_URL` theo web origin được phép nếu có web client riêng; app iOS Capacitor (`capacitor://localhost`) đã được allow sẵn:

```env
FRONTEND_URL=https://app.your-domain.com
VBEE_CALLBACK_URL=https://api.your-domain.com/vbee-callback
```

2. Build client cho iOS với API public:

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run ios:doctor
npm run ios:check-native
npm run ios:set-version -- 1.0 1
VITE_API_URL=https://api.your-domain.com npm run ios:smoke-api
VITE_API_URL=https://api.your-domain.com npm run ios:preflight
VITE_API_URL=https://api.your-domain.com npm run build:ios
npm run ios:xcode-check
npm run ios:open
```

3. Trong Xcode:

- Kiểm tra Bundle Identifier (`com.tramdoc.app` hoặc id riêng).
- Chọn Signing Team.
- Tăng build number trước mỗi lần upload TestFlight, ví dụ `npm run ios:set-version -- 1.0 2`.
- Archive và upload TestFlight.

Lưu ý: Không đặt Vbee/Azure/Google/MiniMax/Gemini API key trong env của client. TTS provider keys phải nằm ở `/Users/nguyenphong/projects/tramdoc/server/.env` trên backend HTTPS.
App iPhone đang khóa portrait để tránh lỗi layout reader ở TestFlight đầu tiên; iPad vẫn hỗ trợ đầy đủ orientation.
`npm run build:ios` sẽ fail nếu thiếu `VITE_API_URL` HTTPS để tránh build nhầm bản iPhone trỏ về `localhost`; chỉ dùng `ALLOW_INSECURE_IOS_API=1` cho simulator local tạm thời.

## Verification

Client:

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run build
npm run lint
npm run ios:doctor
npm run ios:check-native
VITE_API_URL=https://api.your-domain.com npm run ios:smoke-api
VITE_API_URL=https://api.your-domain.com npm run ios:preflight
VITE_API_URL=https://api.your-domain.com npm run build:ios
```

Server:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm run typecheck
npm run prisma:generate
npm run prisma:validate
npm test
```

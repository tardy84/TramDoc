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

## Verification

Client:

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run build
npm run lint
```

Server:

```bash
cd /Users/nguyenphong/projects/tramdoc/server
npm run typecheck
npm run prisma:generate
npm run prisma:validate
npm test
```

# Trạm Đọc iOS/TestFlight checklist

## 1. Backend HTTPS

- Deploy `server/` lên public HTTPS domain.
- Set server env trên production: `DATABASE_URL`, `JWT_SECRET`, admin credential, `VBEE_APP_ID`, `VBEE_TOKEN`, `VBEE_CALLBACK_URL`.
- Kiểm tra health + CORS cho Capacitor:

```bash
curl https://api.your-domain.com/ping
curl -H 'Origin: capacitor://localhost' -i https://api.your-domain.com/api/health
```

## 2. Local preflight trước khi mở Xcode

```bash
cd /Users/nguyenphong/projects/tramdoc/client
npm run ios:doctor
npm run ios:check-native
VITE_API_URL=https://api.your-domain.com npm run ios:preflight
npm run ios:set-version -- 1.0 1
VITE_API_URL=https://api.your-domain.com npm run build:ios
npm run ios:xcode-check
npm run ios:open
```

## 3. Xcode/TestFlight

- Bundle Identifier: `com.tramdoc.app` hoặc bundle id riêng đã đăng ký.
- Signing Team: chọn team Apple Developer.
- Version/build: tăng build number trước mỗi lần upload.
- Release build không được dùng localhost, cleartext, hoặc dev server URL.
- Archive → Distribute App → App Store Connect → TestFlight.

## 4. Acceptance smoke trên iPhone/TestFlight

- Login thành công.
- Upload EPUB dưới 50MB, thấy progress và sách xuất hiện trong thư viện.
- Mở sách, reader hiển thị chapter/segment đúng.
- Đổi giọng Vbee chỉ thấy các voice Vbee.
- Bấm phát: đoạn hiện tại phát trước, không nhảy xuống cuối chapter.
- Generate/play signed `/audio/...` thành công.
- Tắt/mở app hoặc logout/relogin: progress và bookmark vẫn còn.
- Khi API/backend tắt hoặc sai domain, app hiện lỗi kết nối rõ ràng và có nút thử lại.
- Không có Vbee token/JWT secret trong client bundle.

# Hướng dẫn Deploy Audiobook App lên VPS (Linux)

Tài liệu này hướng dẫn cách triển khai ứng dụng Audiobook lên một VPS sử dụng Linux (Ubuntu/Debian).

## 1. Yêu cầu hệ thống
- Một Linux VPS (Ubuntu 22.04 khuyến nghị).
- Node.js (v18 trở lên).
- Git.
- Nginx (làm Reverse Proxy).
- PM2 (quản lý tiến trình Node.js).
- FFmpeg (để xử lý âm thanh nếu cần mở rộng).

## 2. Chuẩn bị môi trường trên VPS

### Cài đặt Node.js và NPM
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Cài đặt PM2
```bash
sudo npm install -g pm2
```

## 3. Triển khai Mã nguồn

### Clone dự án
```bash
git clone <URL_KHO_MA_NGUON> audiobook-app
cd audiobook-app
```

### Cấu hình Server
1. Chuyển vào thư mục server: `cd server`
2. Cài đặt dependency: `npm install`
3. Tạo file `.env` dựa trên file mẫu và điền thông tin:
   - `DATABASE_URL`: Đường dẫn CSDL (SQLite mặc định: `file:./dev.db`)
   - `JWT_SECRET`: Chuỗi bí mật cho token.
   - Các API Key cho TTS (OpenAI, Azure, Google).
4. Chạy Migration database: 
   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

### Xây dựng Client (Build)
1. Chuyển vào thư mục client: `cd ../client`
2. Cài đặt dependency: `npm install`
3. Tạo file `.env` nếu cần thiết (thường API_BASE_URL sẽ được config code hoặc qua proxy).
4. Build dự án React:
   ```bash
   npm run build
   ```
5. Sau khi build xong, các file tĩnh sẽ nằm trong thư mục `dist`. Chúng ta sẽ cấu hình server để phục vụ các file này.

## 4. Chạy ứng dụng với PM2

Quay lại thư mục server và chạy ứng dụng:
```bash
cd ../server
pm2 start index.ts --name "audiobook-server" --interpreter npx -- ts-node
```
*(Hoặc nếu bạn đã compile server sang JS, hãy chạy file `.js` tương ứng).*

## 5. Cấu hình Nginx (Reverse Proxy)

Tạo file cấu hình nginx mới:
`sudo nano /etc/nginx/sites-available/audiobook`

Nội dung mẫu (Giả sử server chạy port 3005):
```nginx
server {
    listen 80;
    server_name your_domain.com;

    location / {
        proxy_pass http://localhost:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Cấu hình serve file audio tĩnh
    location /audio/ {
        alias /path/to/audiobook-app/server/audio/;
    }
}
```

Kích hoạt cấu hình:
```bash
sudo ln -s /etc/nginx/sites-available/audiobook /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 6. Lưu ý quan trọng
- **Quyền truy cập file**: Đảm bảo thư mục `server/audio` và `server/uploads` có quyền ghi cho user chạy Node.js.
- **Bảo mật**: Sử dụng SSL với Let's Encrypt (`certbot`).
- **Backup**: Thường xuyên backup file `dev.db` nếu sử dụng SQLite.

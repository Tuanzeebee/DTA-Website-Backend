# DTA Website — Backend (API)

API cho website **dta.com.vn**: tin tức, hội viên, đơn đăng ký hội viên, thư viện ảnh, quảng cáo và trang quản trị.
Frontend nằm ở repo `dta-news`.

## Công nghệ

| Thành phần | Phiên bản |
|---|---|
| Node.js | ≥ 20 (khuyến nghị 22 LTS) |
| NestJS (Express) | 11 |
| TypeScript | 5.9 |
| Prisma ORM | 6.19 |
| PostgreSQL | ≥ 14 (đang chạy bản 18) |
| Xác thực | JWT access token + refresh token, mật khẩu băm bcrypt |
| Xử lý ảnh | sharp (ảnh upload tự chuyển sang WebP) |

## Cấu trúc thư mục

```
src/            mã nguồn NestJS (auth, news, members, applications, gallery, ads...)
prisma/         schema.prisma + migrations
scripts/        script quản trị (seed, import WordPress, nén ảnh)
craw-data/      công cụ cào bài từ trang DSA cũ (Python), xem craw-data/README.md
uploads/        ảnh admin upload (KHÔNG có trong git, phải chép riêng)
```

## Biến môi trường (`.env`)

Tạo từ `.env.example`:

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | `postgresql://USER:PASSWORD@HOST:5432/dta?schema=public` |
| `JWT_ACCESS_SECRET` | Chuỗi ngẫu nhiên ≥ 32 ký tự. Đổi chuỗi này thì mọi phiên đăng nhập cũ hết hiệu lực |
| `JWT_EXPIRES_IN` | Thời hạn access token, ví dụ `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | Số ngày giữ đăng nhập, ví dụ `7` |
| `EXPORT_DIR` | Thư mục **chứa** thư mục `images/` (ảnh bài viết), ví dụ `/opt/dta-data/export` |
| `HOST` | Mặc định `127.0.0.1` (chỉ cho Nginx truy cập) |
| `PORT` | Mặc định `3000` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Chỉ dùng khi seed DB trống. Bỏ qua nếu restore từ backup |

## Build và chạy

```bash
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy     # đồng bộ schema DB
node dist/main.js             # hoặc: npm run start:prod
```

Production nên chạy bằng systemd (Linux, mẫu ở `dta-news/deploy/dta-backend.service.example`)
hoặc NSSM (Windows). Kiểm tra: `curl http://127.0.0.1:3000/news/topics`.

Backend tự phục vụ hai nhóm file tĩnh:

| URL | Thư mục trên đĩa |
|---|---|
| `/uploads/*` | `./uploads` (ảnh tin, gallery, quảng cáo, hồ sơ hội viên do admin upload) |
| `/news-images/*` | `$EXPORT_DIR/images` (ảnh bài viết chuyển từ WordPress) |

Nginx chuyển tiếp `/api/`, `/uploads/`, `/news-images/` vào cổng 3000, xem `dta-news/nginx.conf`.

## Chuyển server (khôi phục từ dữ liệu bàn giao)

Dữ liệu bàn giao gồm:

| File | Nội dung |
|---|---|
| `dta.dump` | Database PostgreSQL (định dạng custom của `pg_dump`) |
| `uploads.tar` | Thư mục `uploads/` |
| Thư mục `export/` (Google Drive) | Ảnh bài viết `images/` + dữ liệu bài cào từ DSA |

Các bước:

```bash
# 1. Tạo DB
sudo -u postgres createuser --pwprompt dta
sudo -u postgres createdb -O dta dta

# 2. Restore dữ liệu
pg_restore -U dta -h localhost -d dta --no-owner --role=dta dta.dump

# 3. Ảnh
mkdir -p uploads && tar -xf uploads.tar -C uploads
#    Chép thư mục export/ từ Drive, rồi đặt EXPORT_DIR trỏ tới nó (chứa images/)

# 4. Tạo .env, build, đồng bộ schema
npx prisma migrate deploy     # "No pending migrations" là đã khớp
```

5. (Tuỳ chọn) Nếu thư mục `export/` có bài mới hơn bản `dta.dump`:

   ```bash
   npm run import:wordpress -- --export "$EXPORT_DIR" --dry-run   # xem trước
   npm run import:wordpress -- --export "$EXPORT_DIR"
   ```

   Lệnh này cập nhật theo ID bài WordPress nên không tạo bài trùng. Nhưng nó **ghi đè** tiêu đề, nội dung,
   chuyên mục và ảnh đại diện của các bài WordPress đã có bằng bản trên DSA (giữ trạng thái xuất bản và tags).

6. Khởi động service, mở trang chủ, trang `/thu-vien-anh`, đăng nhập admin để kiểm tra.

> ⚠️ **Sau khi restore KHÔNG chạy** `seed:rbac`, `seed:members` (sẽ tạo trùng dữ liệu).
> Tài khoản admin và hội viên đã có sẵn trong `dta.dump`.

## Script quản trị

| Lệnh | Tác dụng |
|---|---|
| `npm run seed:rbac` | Tạo vai trò + admin đầu tiên (chỉ cho DB trống) |
| `npm run seed:members` | Nạp danh sách hội viên ban đầu (chỉ cho DB trống) |
| `npm run import:wordpress -- --export <dir>` | Nạp/cập nhật bài từ thư mục cào DSA |
| `npx ts-node scripts/compress-images.ts [--write]` | Nén ảnh tại chỗ, giữ tên file (không có `--write` thì chỉ thống kê) |
| `npm run gallery:thumbs` | Tạo ảnh thumbnail cho thư viện ảnh |
| `npm test` | Chạy unit test |

## Backup định kỳ

```bash
pg_dump -U dta -h localhost -F c -f dta-$(date +%Y%m%d).dump dta
tar -cf uploads-$(date +%Y%m%d).tar -C uploads .
```

Ảnh bài viết (`$EXPORT_DIR/images`) ít thay đổi, chỉ cần backup một lần.
Bản Windows: `dta-news/deploy/backup-dta.ps1`.

# Cào và cập nhật bài DSA

## Xuất riêng bài mới theo từng đợt

Đối chiếu bộ cũ ở `D:\CloneDataDTA\export`, tạo bộ mới `export11-10`:

```powershell
python craw-data/dsa_migrate.py new --previous D:\CloneDataDTA\export --out craw-data/export11-10
```

Bộ mới chỉ chứa bài có ID chưa có trong `manifest.json` của bộ cũ. Có đủ
`manifest.json`, `categories.json`, HTML và ảnh để import độc lập. Không sửa
bộ cũ. Bỏ `--out` để tự đặt tên `exportDD-MM` theo ngày chạy. Nếu bị ngắt,
chạy lại chính lệnh đó; `batch.json` chỉ báo `ready: true` sau khi hoàn tất.

Chép nguyên thư mục `export11-10` vào `craw-data` trên VPS, cập nhật script
importer mới, rồi chạy từ thư mục backend:

```powershell
npm run import:wordpress -- --export ./craw-data/export11-10
```

Importer tự gộp ảnh của đợt mới vào thư mục `EXPORT_DIR` trong `.env`
(mặc định `craw-data/export`) mà backend đang phục vụ; giữ ảnh bài cũ.
Không cần đổi `EXPORT_DIR` sang thư mục đợt mới. DB phải dùng schema mới
nhất của dự án. Có thể thêm `--dry-run` để kiểm tra trước, chưa ghi DB/chép ảnh.

Đợt tiếp theo cần đối chiếu cả các đợt đã cào trước đó để không lấy lại chúng:

```powershell
python craw-data/dsa_migrate.py new --previous D:\CloneDataDTA\export craw-data/export11-10 --out craw-data/export12-10
```

Nếu không có bài mới, bộ đợt mới có manifest rỗng và importer không ghi DB.
Lệnh `new` chỉ lấy bài mới; dùng `sync` bên dưới nếu muốn làm mới cả bài cũ.

Chạy các lệnh bên dưới từ thư mục `dta-new-backend`. Cần Python 3 và các
dependency Node của backend (`npm ci`, `npx prisma generate`).

```powershell
python -m pip install -r craw-data/requirements.txt
python craw-data/dsa_migrate.py sync
```

`sync` chỉ cào về máy, chưa ghi vào database:

- Mỗi lần chạy quét lại API WordPress từ trang đầu, thêm bài mới và làm mới bài
  cũ theo ID. `posts.json` không có bài trùng ID, kể cả khi chạy lại sau lỗi.
- Tạo lại HTML/JSON và `manifest.json`, giữ mapping ảnh còn tồn tại. Tên file
  nội dung có ID bài để các slug dài không ghi đè nhau.
- Ảnh đã có và không rỗng được giữ; ảnh thiếu được tải. Dùng `--refresh-images`
  nếu muốn tải lại cả ảnh đã có (ví dụ nguồn thay ảnh nhưng giữ nguyên URL).
- Ghi checkpoint JSON và ảnh bằng file tạm rồi thay thế. Nếu có ảnh lỗi, lệnh
  trả mã lỗi; xem `failed_images.json` và chạy lại bước `images`.
- Không tự xoá bài đã lưu khi bài không còn xuất hiện ở site nguồn.

Output mặc định là `craw-data/export` cạnh script, không phụ thuộc thư mục
đang chạy. Nếu đã cào ở thư mục khác, dùng `--out` trỏ tới thư mục export cũ
để tận dụng dữ liệu/ảnh và dùng cùng đường dẫn với `--export` khi import.

Chạy riêng từng bước hoặc thử vài bài mới nhất:

```powershell
python craw-data/dsa_migrate.py meta
python craw-data/dsa_migrate.py organize
python craw-data/dsa_migrate.py images
python craw-data/dsa_migrate.py sync --limit 5
python craw-data/dsa_migrate.py images --refresh-images
```

`--limit` giới hạn số bài xử lý, giữ nguyên các bài khác trong export/manifest.
Metadata chuyên mục vẫn được lấy đầy đủ để gán đúng chuyên mục. Không chạy
hai crawler cùng lúc vào cùng thư mục export.

## Cập nhật database website

Kiểm tra `DATABASE_URL` trong `.env` trỏ đúng DB, backup DB hiện tại trước khi
đồng bộ. Với DB đang dùng phiên bản schema mới nhất:

```powershell
npm run import:wordpress -- --export ./craw-data/export --dry-run
npm run import:wordpress -- --export ./craw-data/export
```

`--dry-run` kiểm tra file và thống kê chuyên mục/ảnh, không ghi DB; chỉ ghi báo
cáo ảnh thiếu vào `export/khong-hien-thi/`. Nếu schema chưa cập nhật, áp dụng
migration của dự án trước bằng `npx prisma migrate deploy`.

Importer dùng `news_articles.wpId` (unique) để **upsert**:

- Chưa có ID WordPress: tạo bài `PUBLISHED` và các blocks.
- Đã có: cập nhật tiêu đề, slug, nội dung, mô tả, ảnh đại diện, chuyên mục,
  URL nguồn và ngày xuất bản; thay các blocks của đúng bài trong cùng thao
  tác Prisma. Giữ ID DB, lượt xem, tác giả, tags, trạng thái và `deletedAt`.
- Nội dung DSA đã sửa tay trong admin sẽ được ghi đè bởi nội dung nguồn.
  Các bài tạo riêng trên website không có `wpId` tương ứng không bị cập nhật.
- Thiếu hoặc rỗng HTML: dừng trước khi ghi DB. Trùng slug với bài khác: báo
  và bỏ qua, không ghi đè bài kia. Import theo từng bài; nếu bị ngắt có thể
  chạy lại cùng lệnh mà không tạo thêm bài trùng ID.

Ảnh không có bản local sẽ bị importer bỏ khỏi blocks và báo trong
`khong-hien-thi/anh-khong-hien-thi.json`. Sửa lỗi ảnh rồi chạy lại import để
bổ sung. Ảnh được gộp vào `EXPORT_DIR` backend để phục vụ
qua `/news-images`. Cache bài viết hết hạn sau tối đa 60 giây; cập nhật
DB không cần build lại backend.

**Không dùng `import_to_postgres.py`, `import_to_postgres1.py` hoặc
`import_to_db.py` để cập nhật website:** đây là các importer cũ cho bảng
`posts/blocks`, có lệnh DROP bảng và không dùng schema Prisma của website.

## Kiểm tra

```powershell
python -m unittest discover -s craw-data -p "test_*.py"
npm test -- --runInBand --rootDir . --testRegex "scripts/import-wordpress.spec.ts$"
```

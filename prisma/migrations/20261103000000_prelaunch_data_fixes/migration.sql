-- Link website hội viên thiếu "https://" bị trình duyệt hiểu là đường dẫn tương đối (404).
UPDATE "members"
SET "website" = 'https://' || btrim("website")
WHERE btrim(coalesce("website", '')) <> ''
  AND "website" !~* '^[a-z][a-z0-9+.-]*:';

-- Bài mẫu tiếng Anh của theme WordPress cũ lọt vào "Tin trong ngành" — gỡ (ARCHIVED, khôi phục được trong CMS).
UPDATE "news_articles"
SET "status" = 'ARCHIVED'
WHERE "slug" IN ('coronavirus-disease-2019', 'coronavirus-disease-2019-2', 'coronavirus-disease-2019-3')
  AND "authorId" IS NULL;

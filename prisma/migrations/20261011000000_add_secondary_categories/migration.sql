-- AlterTable: bài viết thuộc nhiều chuyên mục (dữ liệu DSA gắn 2-4 chuyên mục/bài)
ALTER TABLE "news_articles" ADD COLUMN "secondaryCategoryIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

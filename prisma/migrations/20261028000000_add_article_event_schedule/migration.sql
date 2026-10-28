-- AlterTable
ALTER TABLE "news_articles" ADD COLUMN "eventStartAt" TIMESTAMP(3),
ADD COLUMN "eventEndAt" TIMESTAMP(3),
ADD COLUMN "eventPostponed" BOOLEAN NOT NULL DEFAULT false;
